import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  WIDGET_MEDIA_KINDS,
  signWidgetRead,
  type WidgetMediaKind,
} from "@/lib/widget-upload";
import {
  firstAssetOfKind,
  resolveSubmissionAssets,
  type LegacySubmissionMedia,
  type WidgetSubmissionAsset,
} from "@/lib/widget-assets";
import {
  MEDIA_NO_STORE,
  MEDIA_UUID_PATTERN,
  denyMediaAccess,
  mediaGone,
  mediaNotFound,
} from "@/lib/widget-media-access";

/**
 * Pulse media proxy (PULSE-324). The Linear issue body and the admin detail
 * view link here; we authorise the viewer and 302 to a 10-minute signed read
 * URL on the private widget-media bucket. Fail closed: anything we cannot
 * positively resolve is a 404, never a hint that the submission exists.
 *
 * THIS URL SHAPE IS LOAD-BEARING. Issues filed before PULSE-403 carry
 * /api/widget/media/:submissionId/:kind in their bodies, and those links must
 * not rot. A submission can now hold several attachments of a kind, so this
 * route resolves to the FIRST by position; /api/widget/media/asset/:assetId
 * addresses a specific one.
 */

const ASSET_COLUMNS =
  "id, submission_id, kind, storage_path, content_type, size_bytes, width, height, duration_ms, annotations, position, purged_at, created_at";

type SubmissionMediaRow = LegacySubmissionMedia & {
  id: string;
  hub_id: string;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string; kind: string }> }
) {
  const { submissionId, kind } = await params;

  try {
    if (
      !(WIDGET_MEDIA_KINDS as readonly string[]).includes(kind) ||
      !MEDIA_UUID_PATTERN.test(submissionId)
    ) {
      return mediaNotFound();
    }
    const mediaKind = kind as WidgetMediaKind;

    const { data } = await supabaseAdmin
      .from("widget_submissions")
      .select(
        "id, hub_id, screenshot_storage_path, video_storage_path, replay_storage_path, screenshot_annotations, media_purged_at"
      )
      .eq("id", submissionId)
      .single();
    const submission = data as SubmissionMediaRow | null;
    if (!submission) return mediaNotFound();

    const denied = await denyMediaAccess(request, submission.hub_id);
    if (denied) return denied;

    // Dual-read (PULSE-403). An asset query that fails — the table missing
    // mid-rollout, say — falls through to the legacy columns rather than
    // 404ing a link that used to work.
    const { data: assetRows, error: assetError } = await supabaseAdmin
      .from("widget_submission_assets")
      .select(ASSET_COLUMNS)
      .eq("submission_id", submissionId)
      .eq("kind", mediaKind)
      .order("position", { ascending: true })
      .order("id", { ascending: true });

    if (assetError) {
      console.warn(
        `GET /api/widget/media/${submissionId}/${kind}: asset lookup failed, falling back to legacy columns:`,
        assetError.message
      );
    }

    const resolved = resolveSubmissionAssets({
      assets: (assetRows ?? null) as WidgetSubmissionAsset[] | null,
      submission,
    });
    const asset = firstAssetOfKind(resolved, mediaKind);

    if (!asset) {
      // Retention nulls the path and stamps media_purged_at, which is the only
      // way to tell "we deleted it" from "it never had one".
      return submission.media_purged_at ? mediaGone() : mediaNotFound();
    }
    if (asset.purgedAt) return mediaGone();

    const { url } = await signWidgetRead({ storagePath: asset.storagePath });
    return NextResponse.redirect(url, { status: 302, headers: MEDIA_NO_STORE });
  } catch (error) {
    console.error("GET /api/widget/media/[submissionId]/[kind] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: MEDIA_NO_STORE }
    );
  }
}
