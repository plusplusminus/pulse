// Read-only diagnostic for PULSE-301
// Uses service role key from .env.local
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);

const TFGJ3_ID = "59b475ef-ce00-4c0c-a131-09a682ec02f4";
const PROJECT_A = "7681c763-a006-461a-b1fe-c232b4f521dd"; // DDP Matchmaker
const PROJECT_B = "83b879b3-9c87-437e-839b-e8af0e8d765f"; // Sterns 130 Years

const log = (label, data) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
};

// 1. Do the two projects exist in synced_projects? What team info do they have?
{
  const { data, error } = await supabase
    .from("synced_projects")
    .select("linear_id, name, status_name, updated_at, user_id, data")
    .in("linear_id", [PROJECT_A, PROJECT_B]);
  const summary = data?.map((p) => ({
    linear_id: p.linear_id,
    name: p.name,
    dataKeys: Object.keys(p.data ?? {}),
  }));
  log("synced_projects rows — keys in data blob", { summary, error });

  // Also: compare vs a known-visible project on the same team
  const { data: visible } = await supabase
    .from("synced_projects")
    .select("linear_id, name, data")
    .eq("linear_id", "f13b730a-c9de-45fd-ab25-3d818363721b"); // TFGJ: SLA (in whitelist, visible in admin UI)
  log("shape of a known-visible project (TFGJ: SLA)", {
    linear_id: visible?.[0]?.linear_id,
    name: visible?.[0]?.name,
    dataTeams: visible?.[0]?.data?.teams,
    dataTeam: visible?.[0]?.data?.team,
  });
}

// 2. All hub_team_mappings referencing TFGJ3
{
  const { data, error } = await supabase
    .from("hub_team_mappings")
    .select(
      "id, hub_id, linear_team_id, is_active, auto_include_projects, visible_project_ids, overview_only_project_ids",
    )
    .eq("linear_team_id", TFGJ3_ID);
  log("hub_team_mappings for TFGJ3", { data, error });
}

// 3. Any hub_team_mappings for any team whose name/id looks like TFGJ (sibling teams)
//    We don't store team name here, so list all mappings then filter by hub.
{
  const { data, error } = await supabase
    .from("hub_team_mappings")
    .select(
      "id, hub_id, linear_team_id, is_active, auto_include_projects, visible_project_ids",
    );
  const tfgjHubIds = new Set(
    (data ?? [])
      .filter((m) => m.linear_team_id === TFGJ3_ID)
      .map((m) => m.hub_id),
  );
  const siblingMappings = (data ?? []).filter(
    (m) => tfgjHubIds.has(m.hub_id) && m.linear_team_id !== TFGJ3_ID,
  );
  log("sibling team mappings in the same hub(s) as TFGJ3", {
    siblingMappings,
    error,
  });
}

// 4. The hub(s) that contain TFGJ3 (if any) — get the slug
{
  const { data: mappings } = await supabase
    .from("hub_team_mappings")
    .select("hub_id")
    .eq("linear_team_id", TFGJ3_ID);
  const hubIds = [...new Set((mappings ?? []).map((m) => m.hub_id))];
  if (hubIds.length) {
    const { data, error } = await supabase
      .from("client_hubs")
      .select("id, slug, name, is_active")
      .in("id", hubIds);
    log("hub(s) that include TFGJ3", { data, error });
  } else {
    log("hub(s) that include TFGJ3", "none — TFGJ3 is not mapped to any hub");
  }
}

// 5. Look for any hub that is clearly the "TFGJ" hub (by slug/name) to see if TFGJ3 is simply missing
{
  const { data, error } = await supabase
    .from("client_hubs")
    .select("id, slug, name, is_active")
    .or("slug.ilike.%tfgj%,name.ilike.%tfgj%");
  log("hubs matching 'tfgj' in slug/name", { data, error });

  if (data?.length) {
    const { data: maps } = await supabase
      .from("hub_team_mappings")
      .select(
        "hub_id, linear_team_id, is_active, auto_include_projects, visible_project_ids",
      )
      .in(
        "hub_id",
        data.map((h) => h.id),
      );
    log("all mappings for tfgj-named hubs", maps);
  }
}
