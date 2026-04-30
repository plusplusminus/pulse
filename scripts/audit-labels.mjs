// Survey: which label names are actually in use in Pulse-tracked issues?
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data, error } = await sb
  .from("synced_issues")
  .select("data")
  .limit(10000);
if (error) { console.error(error); process.exit(1); }

const counts = new Map();
let total = 0;
for (const row of data) {
  const labels = row.data?.labels ?? [];
  total++;
  for (const l of labels) {
    if (!l?.name) continue;
    counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  }
}

console.log(`Surveyed ${total} issues, ${counts.size} distinct label names.\n`);
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
for (const [name, n] of sorted) {
  console.log(`  ${n.toString().padStart(5)}  ${name}`);
}
