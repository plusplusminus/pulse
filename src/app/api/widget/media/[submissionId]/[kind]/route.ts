import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withHubAuth } from "@/lib/hub-auth";
import {
  WIDGET_MEDIA_KINDS,
  signWidgetRead,
  type WidgetMediaKind,
} from "@/lib/widget-upload";
import { RETENTION_PATH_COLUMNS } from "@/lib/widget-retention";

/**
 * Pulse media proxy (PULSE-324). The Linear issue body and the admin detail
 * view link here; we authorise the viewer and 302 to a 10-minute signed read
 * URL on the private widget-media bucket. Fail closed: anything we cannot
 * positively resolve is a 404, never a hint that the submission exists.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { "Cache-Control": "private, no-store" };

type SubmissionMediaRow = {
  id: string;
  hub_id: string;
  screenshot_storage_path: string | null;
  video_storage_path: string | null;
  replay_storage_path: string | null;
  media_purged_at: string | null;
};

function notFound() {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: NO_STORE }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string; kind: string }> }
) {
  const { submissionId, kind } = await params;

  try {
    if (
      !(WIDGET_MEDIA_KINDS as readonly string[]).includes(kind) ||
      !UUID_PATTERN.test(submissionId)
    ) {
      return notFound();
    }

    const { data } = await supabaseAdmin
      .from("widget_submissions")
      .select(
        "id, hub_id, screenshot_storage_path, video_storage_path, replay_storage_path, media_purged_at"
      )
      .eq("id", submissionId)
      .single();
    const submission = data as SubmissionMediaRow | null;
    if (!submission) return notFound();

    // PPM admins pass withHubAuth for any hub (synthetic "admin" role).
    const auth = await withHubAuth(submission.hub_id);
    if ("error" in auth) {
      if (auth.status === 401) {
        const { data: hub } = await supabaseAdmin
          .from("client_hubs")
          .select("slug")
          .eq("id", submission.hub_id)
          .single();
        const loginPath = hub?.slug ? `/hub/${hub.slug}/login` : "/";
        return NextResponse.redirect(new URL(loginPath, request.url), {
          status: 302,
          headers: NO_STORE,
        });
      }
      // Member of another hub, or inactive hub: same answer as "no such thing".
      return notFound();
    }

    const storagePath = submission[RETENTION_PATH_COLUMNS[kind as WidgetMediaKind]];
    if (!storagePath) {
      if (submission.media_purged_at) {
        return NextResponse.json(
          { error: "Media no longer available" },
          { status: 410, headers: NO_STORE }
        );
      }
      return notFound();
    }

    const { url } = await signWidgetRead({ storagePath });
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  } catch (error) {
    console.error("GET /api/widget/media/[submissionId]/[kind] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
