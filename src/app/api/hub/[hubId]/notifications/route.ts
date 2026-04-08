import { NextResponse } from "next/server"
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { isClientFacing } from "@/lib/hub-read"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params

    const auth = await withHubAuth(hubId)
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      )
    }

    const { user } = auth
    const url = new URL(request.url)
    const teamId = url.searchParams.get("team_id")
    const cursor = url.searchParams.get("cursor")
    const limitParam = url.searchParams.get("limit")
    const limit = Math.min(Math.max(parseInt(limitParam || "20", 10) || 20, 1), 50)

    let query = supabaseAdmin
      .from("notification_events")
      .select("id, hub_id, team_id, event_type, entity_type, entity_id, actor_name, summary, metadata, created_at")
      .eq("hub_id", hubId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1) // fetch one extra to determine if there's a next page

    if (teamId) {
      query = query.eq("team_id", teamId)
    }

    // Cursor-based pagination: decode base64 cursor into created_at + id
    if (cursor) {
      const decoded = decodeCursor(cursor)
      if (decoded) {
        // Get events before this cursor position
        query = query.or(
          `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`
        )
      }
    }

    const { data: events, error } = await query

    if (error) {
      console.error("GET notifications error:", error)
      return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
    }

    // Defensive filter: drop comment events whose underlying Linear comment
    // is not client-facing (missing the heyclient/pulse prefix). Emit-time
    // filtering already excludes these going forward; this guards against
    // stale rows written before that filter existed.
    const filtered = await filterClientFacingCommentEvents(events || [])

    const hasMore = filtered.length > limit
    const page = filtered.slice(0, limit)

    // Fetch read status for this user
    const eventIds = page.map((e) => e.id)
    const readSet = new Set<string>()

    if (eventIds.length > 0) {
      const { data: reads } = await supabaseAdmin
        .from("notification_reads")
        .select("notification_event_id")
        .eq("user_id", user.id)
        .in("notification_event_id", eventIds)

      for (const r of reads || []) {
        readSet.add(r.notification_event_id)
      }
    }

    const enriched = page.map((e) => ({
      ...e,
      read: readSet.has(e.id),
    }))

    const lastEvent = page[page.length - 1]
    const nextCursor = hasMore && lastEvent
      ? encodeCursor(lastEvent.created_at, lastEvent.id)
      : null

    return NextResponse.json({ events: enriched, nextCursor })
  } catch (error) {
    console.error("GET /api/hub/[hubId]/notifications error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

type NotificationEventRow = {
  id: string
  hub_id: string
  team_id: string | null
  event_type: string
  entity_type: string
  entity_id: string
  actor_name: string | null
  summary: string
  metadata: Record<string, unknown> | null
  created_at: string
}

async function filterClientFacingCommentEvents(
  events: NotificationEventRow[]
): Promise<NotificationEventRow[]> {
  const commentIds = events
    .filter((e) => e.entity_type === "comment")
    .map((e) => e.entity_id)

  if (commentIds.length === 0) return events

  const { data: rows } = await supabaseAdmin
    .from("synced_comments")
    .select("linear_id, data")
    .in("linear_id", commentIds)

  const clientFacing = new Set<string>()
  for (const row of rows || []) {
    const body = ((row.data as { body?: string } | null)?.body) ?? ""
    if (isClientFacing(body)) {
      clientFacing.add(row.linear_id as string)
    }
  }

  return events.filter((e) => {
    if (e.entity_type !== "comment") return true
    return clientFacing.has(e.entity_id)
  })
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}_${id}`).toString("base64url")
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString()
    const sepIndex = decoded.lastIndexOf("_")
    if (sepIndex === -1) return null
    return {
      createdAt: decoded.slice(0, sepIndex),
      id: decoded.slice(sepIndex + 1),
    }
  } catch {
    return null
  }
}
