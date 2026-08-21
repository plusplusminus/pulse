import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source audit, in the same spirit as __tests__/tenant-isolation/query-audit.ts:
 * the migrations are the only description of the schema a rebuilt project gets.
 *
 * RLS was once enabled by hand on production and never written down, so a
 * project restored from these files came up with RLS off and Supabase's default
 * `GRANT ALL ... TO anon` intact -- the browser key could then read every hub's
 * data. Production was never exposed, but a fresh staging project or a DR
 * restore would have been. This test fails if that description drifts back.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Must never be reachable with the public anon key, in any environment. */
const MUST_BE_LOCKED = [
  "widget_configs",
  "widget_submissions",
  "client_hubs",
  "hub_members",
  "hub_team_mappings",
  "admin_linear_tokens",
  "workspace_settings",
  "ppm_admins",
] as const;

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

describe("RLS is codified in the migrations, not just in the live database", () => {
  const sql = allMigrationSql().toLowerCase();

  it("enables row level security across the public schema", () => {
    // The blanket enable loop, or an explicit per-table enable, must be present.
    const hasBlanketEnable =
      /enable row level security/.test(sql) && /not c\.relrowsecurity/.test(sql);
    expect(
      hasBlanketEnable,
      "no migration enables RLS across public; a rebuilt project would come up with RLS off"
    ).toBe(true);
  });

  it.each(MUST_BE_LOCKED)("revokes default anon grants on %s", (table) => {
    const revoked =
      new RegExp(`revoke all on public\\.%i from anon`).test(sql) &&
      sql.includes(`'${table}'`);
    expect(
      revoked,
      `${table} is not in the revoke list; Supabase grants ALL to anon by default`
    ).toBe(true);
  });

  it("does not claim RLS is off in the client factory", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "supabase.ts"),
      "utf8"
    );
    expect(
      /rls is off/i.test(src),
      "src/lib/supabase.ts claims RLS is off; that comment talked a reviewer into a false conclusion once already"
    ).toBe(false);
  });
});
