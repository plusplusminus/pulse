/**
 * Shared authorisation for the Pulse media proxy (PULSE-324/403).
 *
 * Two routes serve widget media and both must answer identically:
 *   GET /api/widget/media/:submissionId/:kind  — the original URL shape, already
 *     written into Linear issue bodies that exist today; resolves to the first
 *     asset of the kind by position.
 *   GET /api/widget/media/asset/:assetId       — one specific attachment.
 *
 * Fail closed: anything we cannot positively resolve is a 404, never a hint
 * that the submission exists. Authorisation always runs BEFORE the 410/404
 * distinction, so a stranger cannot probe whether a submission was ever
 * attached to, or whether its media has been purged.
 *
 * Next.js only lets a route file export HTTP handlers, which is why this lives
 * in lib rather than beside the routes.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withHubAuth } from "@/lib/hub-auth";

export const MEDIA_NO_STORE = { "Cache-Control": "private, no-store" };

export const MEDIA_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "No such thing" — also the answer for a viewer who may not know. */
export function mediaNotFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: MEDIA_NO_STORE }
  );
}

/** "It existed and retention deleted it" — only ever shown to an authorised viewer. */
export function mediaGone(): NextResponse {
  return NextResponse.json(
    { error: "Media no longer available" },
    { status: 410, headers: MEDIA_NO_STORE }
  );
}

/**
 * Null when the viewer may see this hub's media; otherwise the response to
 * return. PPM admins pass `withHubAuth` for any hub (synthetic "admin" role);
 * a signed-out viewer is sent to the hub's login page; a member of another hub
 * gets the same answer as "no such thing".
 */
export async function denyMediaAccess(
  request: Request,
  hubId: string
): Promise<NextResponse | null> {
  const auth = await withHubAuth(hubId);
  if (!("error" in auth)) return null;

  if (auth.status === 401) {
    const { data: hub } = await supabaseAdmin
      .from("client_hubs")
      .select("slug")
      .eq("id", hubId)
      .single();
    const loginPath = hub?.slug ? `/hub/${hub.slug}/login` : "/";
    return NextResponse.redirect(new URL(loginPath, request.url), {
      status: 302,
      headers: MEDIA_NO_STORE,
    });
  }

  return mediaNotFound();
}
