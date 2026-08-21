import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { signWidgetRead } from "@/lib/widget-upload";
import {
  MEDIA_NO_STORE,
  MEDIA_UUID_PATTERN,
  denyMediaAccess,
  mediaGone,
  mediaNotFound,
} from "@/lib/widget-media-access";

/**
 * Address one specific attachment (PULSE-403). A submission can hold several
 * screenshots, so `/api/widget/media/:submissionId/:kind` — which resolves to
 * the first by position and must keep doing so for links already written into
 * Linear — cannot name the others. New Linear bodies and the admin gallery use
 * this route instead.
 *
 * The static `asset` segment wins over `[submissionId]` in Next.js routing, and
 * a submission id is always a UUID, so the two never collide.
 *
 * Same posture as the legacy route: authorise first, then 404 for "no such
 * thing" and 410 for "retention deleted it".
 */

type AssetRow = {
  id: string;
  submission_id: string;
  storage_path: string | null;
  purged_at: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;

  try {
    if (!MEDIA_UUID_PATTERN.test(assetId)) return mediaNotFound();

    const { data } = await supabaseAdmin
      .from("widget_submission_assets")
      .select("id, submission_id, storage_path, purged_at")
      .eq("id", assetId)
      .single();
    const asset = data as AssetRow | null;
    if (!asset) return mediaNotFound();

    // The hub lives on the submission; the asset row inherits its tenancy
    // through the foreign key rather than duplicating it.
    const { data: submission } = await supabaseAdmin
      .from("widget_submissions")
      .select("id, hub_id")
      .eq("id", asset.submission_id)
      .single();
    if (!submission) return mediaNotFound();

    const denied = await denyMediaAccess(
      request,
      (submission as { hub_id: string }).hub_id
    );
    if (denied) return denied;

    if (asset.purged_at) return mediaGone();
    if (!asset.storage_path) return mediaNotFound();

    const { url } = await signWidgetRead({ storagePath: asset.storage_path });
    return NextResponse.redirect(url, { status: 302, headers: MEDIA_NO_STORE });
  } catch (error) {
    console.error("GET /api/widget/media/asset/[assetId] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: MEDIA_NO_STORE }
    );
  }
}
