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
  renderSubmissionBody,
  createWidgetLinearIssue,
  widgetMediaUrl,
} from "@/lib/widget-linear";
import type { WidgetFeedbackResponse } from "@/lib/widget-types";
import { STORAGE_PATH_PATTERN } from "@/lib/widget-upload";
import { picksSchema } from "@/lib/widget-picks";

// In-memory rate limiter: apiKeyPrefix -> timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(keyPrefix: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(keyPrefix) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(keyPrefix, recent);
    return true;
  }
  recent.push(now);
  rateLimitMap.set(keyPrefix, recent);
  return false;
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

const feedbackSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().max(5000).optional(),
  type: z.enum(["bug", "feedback", "idea"]).default("bug"),
  metadata: z.object({
    url: z.string(),
    userAgent: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
    timestamp: z.string(),
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
    custom: z.record(z.string(), z.string()).default({}),
  }),
  reporter: z.object({
    email: z.string().email("Valid email is required"),
    name: z.string().optional(),
  }),
  // Object key minted by POST /api/widget/upload — bytes never come through here.
  screenshotStoragePath: z
    .string()
    .regex(STORAGE_PATH_PATTERN, "Invalid storage path")
    .optional(),
  // Element picks (PULSE-329); rendered into the Linear body per output_detail_level.
  picks: picksSchema,
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

    // Rate limit
    if (isRateLimited(config.api_key_prefix)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429, headers }
      );
    }

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

    // metadata.url must be on the requesting origin; strip query/hash before storage/Linear.
    if (!pageUrlMatchesOrigin(data.metadata.url, origin)) {
      return NextResponse.json(
        { error: "origin_mismatch", message: "metadata.url origin does not match the request origin" },
        { status: 422, headers }
      );
    }
    data.metadata = { ...data.metadata, url: stripUrlForStorage(data.metadata.url) };

    // The path's hub segment must be this site's hub: a ticket minted for
    // another site cannot be attached here (PULSE-324).
    if (data.screenshotStoragePath) {
      const [pathHubId, folder] = data.screenshotStoragePath.split("/");
      if (
        pathHubId.toLowerCase() !== config.hub_id.toLowerCase() ||
        folder !== "screenshots"
      ) {
        return NextResponse.json(
          { error: "screenshotStoragePath does not belong to this site" },
          { status: 400, headers }
        );
      }
    }

    // Generate the id up front so the media-proxy URL can be stored and
    // rendered into Linear in the same pass.
    const submissionId = crypto.randomUUID();
    const screenshotUrl = data.screenshotStoragePath
      ? widgetMediaUrl(submissionId, "screenshot")
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
        metadata: data.metadata,
        picks: data.picks,
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
