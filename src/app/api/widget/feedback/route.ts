import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
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
  widgetScreenshotUrls,
} from "@/lib/widget-linear";
import { CAPTURE_SURFACES, type WidgetFeedbackResponse } from "@/lib/widget-types";
import { STORAGE_PATH_PATTERN } from "@/lib/widget-upload";
import { picksSchema, screenshotAnnotationsSchema } from "@/lib/widget-picks";
import {
  legacyAnnotations,
  legacyPathColumns,
  normalizeSubmissionAssets,
} from "@/lib/widget-assets";

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

/**
 * Upper bound on the submitted `assets` array. Deliberately looser than the
 * per-kind caps (6 screenshots / 1 video / 1 replay, WIDGET_ASSET_CAPS) so a
 * payload just over the cap gets the cap message from normalizeSubmissionAssets
 * rather than an opaque "Validation failed"; this bound only exists to stop a
 * caller pushing an unbounded array through zod.
 */
const MAX_SUBMITTED_ASSETS = 64;

/**
 * One attachment (PULSE-403). Object keys are minted by POST /api/widget/upload
 * — bytes never come through here. Everything past the shape check (hub
 * ownership, folder-matches-kind, MIME allowlist, size cap, per-kind caps) is
 * normalizeSubmissionAssets' job.
 */
const assetInputSchema = z.object({
  kind: z.enum(["screenshot", "video", "replay"]),
  storagePath: z.string().regex(STORAGE_PATH_PATTERN, "Invalid storage path"),
  contentType: z.string().max(200).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  annotations: screenshotAnnotationsSchema.optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

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
  // Every attachment on the submission (PULSE-403), in the reporter's order.
  assets: z.array(assetInputSchema).max(MAX_SUBMITTED_ASSETS).optional(),
  // Pre-PULSE-403 single-attachment fields. Still accepted for one release so
  // an embed already in the wild keeps working; mapped onto `assets` below.
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

    // Merge the modern `assets` list with the legacy single-path fields, then
    // validate each attachment: hub ownership, folder-matches-kind, MIME
    // allowlist, per-kind size cap and the per-submission caps. The endpoint is
    // public, so a client-side cap is not a cap.
    const normalized = normalizeSubmissionAssets({
      assets: data.assets,
      screenshotStoragePath: data.screenshotStoragePath,
      videoStoragePath: data.videoStoragePath,
      screenshotAnnotations: data.screenshotAnnotations,
      hubId: config.hub_id,
    });
    if (!normalized.ok) {
      return NextResponse.json(
        { error: normalized.error },
        { status: 400, headers }
      );
    }
    const assets = normalized.assets;

    // The legacy columns keep being written from the first asset of each kind:
    // retention's `media_purged_at`, the admin table and the media proxy's
    // fallback all still read them until a later migration drops them.
    const legacyPaths = legacyPathColumns(assets);

    // Generate the id up front so the media-proxy URLs can be stored and
    // rendered into Linear in the same pass.
    const submissionId = crypto.randomUUID();
    const screenshotUrl = legacyPaths.screenshot_storage_path
      ? widgetMediaUrl(submissionId, "screenshot")
      : undefined;
    const videoUrl = legacyPaths.video_storage_path
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
        screenshot_storage_path: legacyPaths.screenshot_storage_path,
        video_storage_path: legacyPaths.video_storage_path,
        replay_storage_path: legacyPaths.replay_storage_path,
        metadata: data.metadata,
        picks: data.picks,
        // In step with the screenshot the legacy proxy URL resolves to; the
        // authoritative per-screenshot copy lives on the asset row.
        screenshot_annotations: legacyAnnotations(assets),
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

    // One row per attachment (PULSE-403). A failure here is not fatal to the
    // report: the submission is already saved and its legacy columns still hold
    // the first screenshot and video, so what is lost is the second and later
    // attachments — worth an alert, not worth discarding the whole report.
    // Ids are minted here rather than by the database so the Linear body can
    // name each attachment by its own /media/asset/:assetId URL in this same
    // pass, exactly as submissionId is minted above.
    const assetIds = assets.map(() => crypto.randomUUID());
    let assetsStored = false;

    if (assets.length > 0) {
      const { error: assetError } = await supabaseAdmin
        .from("widget_submission_assets")
        .insert(
          assets.map((asset, index) => ({
            id: assetIds[index],
            submission_id: submissionId,
            kind: asset.kind,
            storage_path: asset.storagePath,
            content_type: asset.contentType,
            size_bytes: asset.sizeBytes,
            annotations: asset.annotations,
            position: asset.position,
          }))
        );
      assetsStored = !assetError;

      if (assetError) {
        console.error(
          `POST /api/widget/feedback: failed to insert ${assets.length} assets for ${submissionId}:`,
          assetError
        );
        Sentry.captureException(
          new Error(`Failed to insert widget submission assets: ${assetError.message}`),
          {
            tags: { area: "widget" },
            extra: { submissionId, assetCount: assets.length },
          }
        );
      }
    }

    // A body may only name asset URLs that were actually written. If the asset
    // insert failed, the legacy columns are all that survived, so the body
    // falls back to the single embedded screenshot they still address.
    const screenshotUrls = assetsStored
      ? widgetScreenshotUrls(
          submissionId,
          assets.flatMap((asset, index) =>
            asset.kind === "screenshot" ? [{ id: assetIds[index] }] : []
          )
        )
      : screenshotUrl
        ? [screenshotUrl]
        : [];

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
            screenshotUrls,
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
    // Public endpoint: the detail goes to the log, never to the caller. The
    // reachable messages include Postgres error text, storage paths and Linear
    // API errors carrying team IDs.
    console.error("POST /api/widget/feedback error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
