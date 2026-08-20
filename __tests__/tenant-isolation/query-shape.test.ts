/**
 * Query Shape Guard
 *
 * Static checks that the hot read paths fixed in the 2026-08-20 perf audit
 * (docs/perf-audit-2026-08-20.md) keep their shape. These patterns caused
 * Postgres statement timeouts and 504s in production:
 *   - fetching the full `data` JSONB of every issue and aggregating in JS
 *   - count: "exact" + full read list for the unread badge
 *   - polling endpoints every 30s
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf-8");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("Query shape guard", () => {
  const hubRead = read("src/lib/hub-read.ts");

  it("fetchHubCycleStats aggregates in SQL via get_cycle_stats, not by fetching issue JSONB", () => {
    const body = functionBody(hubRead, "fetchHubCycleStats");
    expect(body).toContain('.rpc("get_cycle_stats"');
    expect(body).not.toMatch(/\.select\(\s*["']data["']\s*\)/);
    expect(body).not.toContain('.from("synced_issues")');
  });

  it("getHubMappings is memoised per request (React.cache)", () => {
    expect(hubRead).toMatch(/const getHubMappings = cache\(/);
  });

  it("completed-state checks accept Linear's 'canceled' spelling", () => {
    const sets = hubRead.match(/new Set\(\[[^\]]*"completed"[^\]]*\]\)/g) || [];
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) expect(s).toContain('"canceled"');
  });

  it("getUnreadCount is a single RPC, not count:exact + read list", () => {
    const body = functionBody(read("src/lib/notification-read.ts"), "getUnreadCount");
    expect(body).toContain('.rpc("notification_unread_count"');
    expect(body).not.toContain('count: "exact"');
    expect(body).not.toContain('.from("notification_reads")');
  });

  it("hub-auth memoises hub, admin and membership lookups per request", () => {
    const hubAuth = read("src/lib/hub-auth.ts");
    expect(hubAuth).toMatch(/export const resolveHubBySlug = cache\(/);
    expect(hubAuth).toContain("cache(isPPMAdmin)");
    expect(hubAuth).toContain("getHubMembershipCached");
  });

  it("top bar polls the merged /status endpoint at >= 60s and the bell does not poll on its own", () => {
    const hook = read("src/hooks/use-hub-status.ts");
    const pollMs = Number(hook.match(/HUB_STATUS_POLL_MS = ([\d_]+)/)?.[1].replace(/_/g, ""));
    expect(pollMs).toBeGreaterThanOrEqual(60_000);
    expect(hook).toContain("/status");
    expect(hook).toContain("visibilitychange");

    const bell = read("src/components/hub/notification-bell.tsx");
    expect(bell).not.toContain("setInterval");
    expect(bell).not.toContain("/notifications/unread-count");

    const topbar = read("src/components/hub/hub-topbar.tsx");
    expect(topbar).not.toContain("/last-sync");
  });
});
