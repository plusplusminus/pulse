import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  issueContextFromData,
  syncIssueAttachments,
} from "@/lib/attachment-sync";

// One-off backfill for PULSE-302. Protected by CRON_SECRET so a simple
// authenticated curl loop can drive it to completion without session cookies.
//
// POST /api/cron/backfill-attachments?cursor=<linear_id>&limit=50
//   Authorization: Bearer <CRON_SECRET>
//
// Processes up to `limit` synced_issues rows starting after `cursor`
// (ordered by linear_id). Returns the next cursor — call repeatedly
// until `nextCursor` is null.

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200
  );
  const cursor = url.searchParams.get("cursor") ?? null;

  let query = supabaseAdmin
    .from("synced_issues")
    .select("linear_id, data")
    .eq("user_id", "workspace")
    .order("linear_id", { ascending: true })
    .limit(limit);

  if (cursor) query = query.gt("linear_id", cursor);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let processed = 0;
  let skipped = 0;
  for (const row of data ?? []) {
    const ctx = await issueContextFromData(row.data as Record<string, unknown>);
    if (!ctx) {
      skipped++;
      continue;
    }
    await syncIssueAttachments(ctx);
    processed++;
  }

  const batchSize = data?.length ?? 0;
  const nextCursor =
    batchSize === limit && batchSize > 0
      ? (data![batchSize - 1].linear_id as string)
      : null;

  return NextResponse.json({
    batchSize,
    processed,
    skipped,
    nextCursor,
  });
}
