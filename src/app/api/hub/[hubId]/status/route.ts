import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { getUnreadCount } from "@/lib/notification-read";
import { getLastSyncedAt } from "@/lib/sync-status";

/**
 * Single polled endpoint for the hub top bar: unread notification count and
 * last completed sync timestamp. Replaces two separate pollers
 * (/notifications/unread-count and /last-sync) so each tick costs one auth
 * pass instead of two.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const [unreadCount, lastSyncedAt] = await Promise.all([
      getUnreadCount(auth.user.id, hubId),
      getLastSyncedAt(hubId),
    ]);

    return NextResponse.json(
      { unreadCount, lastSyncedAt },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("GET /api/hub/[hubId]/status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
