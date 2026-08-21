import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { validateWidgetRequest, isKnownWidgetOrigin } from "@/lib/widget-auth";
import {
  corsHeaders as originCorsHeaders,
  pageUrlMatchesOrigin,
  stripUrlForStorage,
} from "@/lib/widget-origin";
import {
  checkRateLimit,
  reporterKey,
  siteKey,
  type RateLimitResult,
} from "@/lib/widget-rate-limit";
import {
  renderSubmissionBody,
  createWidgetLinearIssue,
  widgetMediaUrl,
} from "@/lib/widget-linear";
import { CAPTURE_SURFACES, type WidgetFeedbackResponse } from "@/lib/widget-types";
import { STORAGE_PATH_PATTERN } from "@/lib/widget-upload";
import { picksSchema, screenshotAnnotationsSchema } from "@/lib/widget-picks";

// Distributed budgets (PULSE-313): per site, then per reporter; either denies.
const SITE_BUDGET = { limit: 60, windowMs: 60_000 };
const REPORTER_BUDGET = { limit: 10, windowMs: 60_000 };

function tooManyRequests(verdict: RateLimitResult, headers: Record<string, string>) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Try again later." },
    {
      status: 429,
      headers: {
        ...headers,
        "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))),
      },
    }
  );
}

/**
 * A path's hub segment must be this site's hub and its folder must match the
 * kind it was submitted as: a ticket minted for another site — or a video key
 * passed off as a screenshot — cannot be attached here (PULSE-324).
 */
function pathBelongsToSite(
  storagePath: string,
  hubId: string,
  folder: "screenshots" | "videos"
): boolean {
  const [pathHubId, pathFolder] = storagePath.split("/");
  return (
    pathHubId.toLowerCase() === hubId.toLowerCase() && pathFolder === folder
  );
}

// CORS is only ever granted to an allowlisted origin (PULSE-392); no "*" fallback.
function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  return originCorsHeaders(origin, { allowed, methods: "POST, OPTIONS" });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  // Preflight carries no site key: allow when any active site lists this origin.
  const allowed = await isKnownWidgetOrigin(origin);
  return new NextResponse(null, {
    status: allowed ? 204 : 403,
    headers: corsHeaders(origin, allowed),
  });
}

/**
 * This endpoint is public — the site key ships in the page and Origin is
 * spoofable outside a browser — so every metadata field is bounded. Without a
 * cap, url/userAgent/timestamp and the free-form `custom` record let anyone
 * push megabytes into the widget_submissions.metadata JSONB and on into the
 * Linear issue body, once per request.
 */
const MAX_CUSTOM_KEYS = 20;

const feedbackSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().max(5000).optional(),
  type: z.enum(["bug", "feedback", "idea"]).default("bug"),
  metadata: z.object({
    url: z.string().max(2048),
    userAgent: z.string().max(500),
    viewport: z.object({ width: z.number(), height: z.number() }),
    timestamp: z.string().max(64),
    console: z
      .array(
        z.object({
          level: z.string(),
          message: z.string().max(500),
          timestamp: z.string(),
        })
      )
      .max(50)
      .default([]),
    sentry: z
      .object({
        replayId: z.string().nullable(),
        replayUrl: z.string().nullable(),
        sessionId: z.string().nullable(),
        traceId: z.string().nullable(),
      })
      .nullable()
      .default(null),
    custom: z
      .record(z.string().max(100), z.string().max(500))
      .refine(
        (r) => Object.keys(r).length <= MAX_CUSTOM_KEYS,
        `custom: max ${MAX_CUSTOM_KEYS} keys`
      )
      .default({}),
    // Present only for native tab captures (PULSE-335).
    captureSurface: z.enum(CAPTURE_SURFACES).optional(),
  }),
  reporter: z.object({
    email: z.string().email("Valid email is required"),
    name: z.string().optional(),
  }),
  // Object keys minted by POST /api/widget/upload — bytes never come through here.
  screenshotStoragePath: z
    .string()
    .regex(STORAGE_PATH_PATTERN, "Invalid storage path")
    .optional(),
  // Screen recording (PULSE-337); .webm or .mp4 under {hubId}/videos/.
  videoStoragePath: z
    .string()
    .regex(STORAGE_PATH_PATTERN, "Invalid storage path")
    .optional(),
  // Element picks (PULSE-329); rendered into the Linear body per output_detail_level.
  picks: picksSchema,
  // Screenshot annotation rects (PULSE-333), in the captured bitmap's pixel space.
  screenshotAnnotations: screenshotAnnotationsSchema,
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // No CORS headers until the site key resolves and the origin matched its allowlist.
  let headers = corsHeaders(origin, false);

  try {
    // Validate widget key + origin
    const authResult = await validateWidgetRequest(request);
    if ("error" in authResult) {
      // 401 (bad key) on a known origin stays readable by the page; 403 never gets CORS.
      const readable =
        authResult.status !== 403 && (await isKnownWidgetOrigin(origin));
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status, headers: corsHeaders(origin, readable) }
      );
    }
    const { config } = authResult;
    headers = corsHeaders(origin, true);

    // Site budget before touching the body; reporter budget once we know who it is.
    const siteVerdict = await checkRateLimit({
      key: siteKey(config.api_key_prefix),
      ...SITE_BUDGET,
    });
    if (!siteVerdict.allowed) return tooManyRequests(siteVerdict, headers);

    // Parse + validate body
    const body = await request.json();
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }
    const data = parsed.data;

    // The schema requires reporter.email, so feedback is always budgeted per
    // reporter; upload (no reporter in the body) uses the IP instead.
    const reporterVerdict = await checkRateLimit({
      key: reporterKey(config.api_key_prefix, data.reporter.email.trim().toLowerCase()),
      ...REPORTER_BUDGET,
    });
    if (!reporterVerdict.allowed) return tooManyRequests(reporterVerdict, headers);

    // metadata.url must be on the requesting origin; strip query/hash before storage/Linear.
    if (!pageUrlMatchesOrigin(data.metadata.url, origin)) {
      return NextResponse.json(
        { error: "origin_mismatch", message: "metadata.url origin does not match the request origin" },
        { status: 422, headers }
      );
    }
    data.metadata = { ...data.metadata, url: stripUrlForStorage(data.metadata.url) };

    if (
      data.screenshotStoragePath &&
      !pathBelongsToSite(data.screenshotStoragePath, config.hub_id, "screenshots")
    ) {
      return NextResponse.json(
        { error: "screenshotStoragePath does not belong to this site" },
        { status: 400, headers }
      );
    }

    if (
      data.videoStoragePath &&
      !pathBelongsToSite(data.videoStoragePath, config.hub_id, "videos")
    ) {
      return NextResponse.json(
        { error: "videoStoragePath does not belong to this site" },
        { status: 400, headers }
      );
    }

    // Generate the id up front so the media-proxy URLs can be stored and
    // rendered into Linear in the same pass.
    const submissionId = crypto.randomUUID();
    const screenshotUrl = data.screenshotStoragePath
      ? widgetMediaUrl(submissionId, "screenshot")
      : undefined;
    const videoUrl = data.videoStoragePath
      ? widgetMediaUrl(submissionId, "video")
      : undefined;

    // Insert submission
    const { data: submission, error: insertError } = await supabaseAdmin
      .from("widget_submissions")
      .insert({
        id: submissionId,
        widget_config_id: config.id,
        hub_id: config.hub_id,
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        screenshot_url: screenshotUrl ?? null,
        screenshot_storage_path: data.screenshotStoragePath ?? null,
        video_storage_path: data.videoStoragePath ?? null,
        metadata: data.metadata,
        picks: data.picks,
        screenshot_annotations: data.screenshotAnnotations,
        reporter_email: data.reporter.email,
        reporter_name: data.reporter.name ?? null,
        page_url: data.metadata.url,
        sync_status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !submission) {
      return NextResponse.json(
        { error: "Failed to save submission" },
        { status: 500, headers }
      );
    }

    // Resolve team from hub_team_mappings
    const { data: mapping } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("linear_team_id")
      .eq("hub_id", config.hub_id)
      .eq("is_active", true)
      .limit(1)
      .single();

    let linearIssueId: string | null = null;
    let linearIssueUrl: string | null = null;
    let syncStatus: "synced" | "failed" = "failed";
    let syncError: string | null = null;

    if (mapping) {
      try {
        const description = renderSubmissionBody({
          submission: {
            description: data.description,
            reporter: data.reporter,
            metadata: data.metadata,
            screenshotUrl,
            videoUrl,
          },
          picks: data.picks,
          config,
        });

        const issue = await createWidgetLinearIssue({
          teamId: mapping.linear_team_id,
          title: data.title,
          description,
          screenshotUrl,
        });

        linearIssueId = issue.id;
        linearIssueUrl = issue.url;
        syncStatus = "synced";
      } catch (err) {
        syncError =
          err instanceof Error ? err.message : "Linear sync failed";
      }
    } else {
      syncError = "No active team mapping found for hub";
    }

    // Update submission with sync result
    await supabaseAdmin
      .from("widget_submissions")
      .update({
        linear_issue_id: linearIssueId,
        linear_issue_url: linearIssueUrl,
        sync_status: syncStatus,
        sync_error: syncError,
      })
      .eq("id", submission.id);

    const response: WidgetFeedbackResponse = {
      id: submission.id,
      linearIssueId,
      linearIssueUrl,
      status: syncStatus === "synced" ? "created" : "failed",
    };

    return NextResponse.json(response, { status: 201, headers });
  } catch (error) {
    console.error("POST /api/widget/feedback error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500, headers }
    );
  }
}
