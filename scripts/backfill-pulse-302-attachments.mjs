// Drive the PULSE-302 attachment backfill by looping POSTs to
// /api/cron/backfill-attachments until every synced issue is processed.
//
// Usage:
//   CRON_SECRET=... BASE_URL=https://pulse.plusplusminus.co.za \
//     node scripts/backfill-pulse-302-attachments.mjs

const BASE_URL = process.env.BASE_URL ?? "https://pulse.plusplusminus.co.za";
const CRON_SECRET = process.env.CRON_SECRET;
const LIMIT = Number(process.env.LIMIT ?? 50);

if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET env var");
  process.exit(1);
}

let cursor = null;
let totalProcessed = 0;
let totalSkipped = 0;
let batches = 0;
const startedAt = Date.now();

while (true) {
  const url = new URL("/api/cron/backfill-attachments", BASE_URL);
  url.searchParams.set("limit", String(LIMIT));
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

  if (!res.ok) {
    console.error(`Batch ${batches + 1} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const body = await res.json();
  batches++;
  totalProcessed += body.processed ?? 0;
  totalSkipped += body.skipped ?? 0;

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `batch=${batches} size=${body.batchSize} processed=${body.processed} skipped=${body.skipped} cursor=${body.nextCursor ?? "∅"} elapsed=${elapsed}s`
  );

  if (!body.nextCursor) break;
  cursor = body.nextCursor;
}

console.log(
  `\nDone. batches=${batches} processed=${totalProcessed} skipped=${totalSkipped} elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s`
);
