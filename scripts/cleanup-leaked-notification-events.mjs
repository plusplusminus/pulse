// PULSE-370: find (and optionally delete) notification_events that leaked to a
// hub for an issue the hub can't see. Read-only by default; pass --delete to
// remove the out-of-scope rows.
//
//   node scripts/cleanup-leaked-notification-events.mjs           # audit only
//   node scripts/cleanup-leaked-notification-events.mjs --delete  # delete them
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DELETE = process.argv.includes("--delete");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Mirror of isIssueProjectVisible (src/lib/hub-visibility-rules.ts).
function isIssueProjectVisible(mappings, projectId) {
  if (!projectId) return mappings.some((m) => m.include_unassigned_issues === true);
  const autoInclude = mappings.some((m) => m.auto_include_projects === true);
  if (!autoInclude) {
    const visible = mappings.some((m) => (m.visible_project_ids ?? []).includes(projectId));
    if (!visible) return false;
  }
  return !mappings.some((m) => (m.overview_only_project_ids ?? []).includes(projectId));
}

// 1. Mappings grouped by hub.
const { data: mappingRows } = await sb
  .from("hub_team_mappings")
  .select("hub_id, linear_team_id, visible_project_ids, auto_include_projects, include_unassigned_issues, overview_only_project_ids")
  .eq("is_active", true);
const mappingsByHub = new Map();
for (const m of mappingRows ?? []) {
  if (!mappingsByHub.has(m.hub_id)) mappingsByHub.set(m.hub_id, []);
  mappingsByHub.get(m.hub_id).push(m);
}

// 2. All issue/comment events (paginate past PostgREST's 1000-row cap).
const events = [];
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await sb
    .from("notification_events")
    .select("id, hub_id, entity_type, entity_id, summary, metadata, created_at")
    .in("entity_type", ["issue", "comment"])
    .order("created_at", { ascending: true })
    .range(from, from + 999);
  if (error) { console.error("events query failed:", error.message); process.exit(1); }
  events.push(...(page ?? []));
  if (!page || page.length < 1000) break;
}

// 3. Resolve underlying issue ids and batch-load their project/team.
const issueIdOf = (e) =>
  e.entity_type === "issue" ? e.entity_id : (e.metadata?._issue_id ?? null);
const issueIds = [...new Set((events ?? []).map(issueIdOf).filter(Boolean))];
const issueById = new Map();
for (let i = 0; i < issueIds.length; i += 500) {
  const chunk = issueIds.slice(i, i + 500);
  const { data: rows } = await sb
    .from("synced_issues")
    .select("linear_id, team_id, project_id")
    .eq("user_id", "workspace")
    .in("linear_id", chunk);
  for (const r of rows ?? []) issueById.set(r.linear_id, r);
}

// 4. Classify. The PULSE-370 leak is specifically: the issue still exists and
// its team is mapped to the hub, but its project isn't visible (or it's
// unscoped and the hub doesn't include unassigned issues). Events whose issue
// is gone from synced_issues are "orphaned" — the read filter already hides
// them, and they're unrelated to this ticket, so we leave them alone.
const leaked = [];
let orphaned = 0;
for (const e of events ?? []) {
  const mappings = mappingsByHub.get(e.hub_id) ?? [];
  const issueId = issueIdOf(e);
  const issue = issueId ? issueById.get(issueId) : null;
  if (!issue) { orphaned++; continue; }
  const teamIds = new Set(mappings.map((m) => m.linear_team_id));
  if (!teamIds.has(issue.team_id)) { orphaned++; continue; }
  if (!isIssueProjectVisible(mappings, issue.project_id ?? null)) leaked.push(e);
}

// 5. Report.
const byHub = new Map();
for (const e of leaked) byHub.set(e.hub_id, (byHub.get(e.hub_id) ?? 0) + 1);
console.log(`Scanned ${events?.length ?? 0} issue/comment events.`);
console.log(`Orphaned (issue gone / team not mapped — left untouched): ${orphaned}`);
console.log(`Project-scoping leaks (deletable): ${leaked.length}\n`);
for (const [hubId, count] of byHub) {
  const { data: hub } = await sb.from("client_hubs").select("slug").eq("id", hubId).maybeSingle();
  console.log(`  hub ${hub?.slug ?? hubId}: ${count}`);
}
console.log("\nSamples:");
for (const e of leaked.slice(0, 15)) {
  const issue = issueById.get(issueIdOf(e));
  console.log(`  ${hubSlugSync(e.hub_id)} [${e.entity_type}] ${e.created_at?.slice(0, 10)} proj=${issue?.project_id ?? "none"} "${(e.summary ?? "").slice(0, 50)}"`);
}

function hubSlugSync(hubId) { return hubId.slice(0, 8); }

// 6. Delete if requested.
if (DELETE && leaked.length > 0) {
  const ids = leaked.map((e) => e.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await sb.from("notification_events").delete().in("id", chunk);
    if (error) { console.error("delete failed:", error.message); process.exit(1); }
    deleted += chunk.length;
  }
  console.log(`\nDeleted ${deleted} leaked notification_events rows.`);
} else if (leaked.length > 0) {
  console.log(`\n(dry run — re-run with --delete to remove these ${leaked.length} rows)`);
}
