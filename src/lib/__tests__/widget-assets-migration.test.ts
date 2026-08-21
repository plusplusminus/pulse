/**
 * Source-level audit of the PULSE-403 migration, in the spirit of
 * `__tests__/tenant-isolation/query-audit.test.ts`.
 *
 * There is no live database in this repo, so the migration's safety properties
 * are asserted by reading it: the backfill covers every legacy column, it is
 * re-runnable, and — the one that would cost client screenshots if it regressed
 * — it does not drop the legacy columns.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const FILE = "20260821_widget_submission_assets.sql";
const sql = readFileSync(join(MIGRATIONS, FILE), "utf8");

describe("20260821_widget_submission_assets.sql", () => {
  it("follows the YYYYMMDD_snake_case.sql convention and cites the ticket", () => {
    expect(FILE).toMatch(/^\d{8}_[a-z0-9_]+\.sql$/);
    expect(readdirSync(MIGRATIONS)).toContain(FILE);
    expect(sql.split("\n")[0]).toContain("PULSE-403");
  });

  it("creates the assets table idempotently", () => {
    expect(sql).toMatch(/create table if not exists widget_submission_assets/);
  });

  it("carries every column the design calls for", () => {
    for (const column of [
      "submission_id",
      "kind",
      "storage_path",
      "content_type",
      "size_bytes",
      "width",
      "height",
      "duration_ms",
      "annotations",
      "position",
      "purged_at",
      "created_at",
    ]) {
      expect(sql).toMatch(new RegExp(`^\\s+${column}\\s`, "m"));
    }
  });

  it("cascades from the submission so a deleted report leaves no orphans", () => {
    expect(sql).toMatch(
      /references widget_submissions\(id\) on delete cascade/
    );
  });

  it("constrains kind to the three artefact kinds", () => {
    expect(sql).toMatch(
      /check \(kind in \('screenshot', 'video', 'replay'\)\)/
    );
  });

  it("backfills all three legacy columns", () => {
    for (const column of [
      "screenshot_storage_path",
      "video_storage_path",
      "replay_storage_path",
    ]) {
      expect(sql).toMatch(
        new RegExp(`where s\\.${column} is not null`)
      );
    }
  });

  it("is re-runnable: every backfill insert is guarded by the unique path index", () => {
    const inserts = sql.match(/insert into widget_submission_assets/g) ?? [];
    const guards =
      sql.match(/on conflict \(submission_id, storage_path\) do nothing/g) ?? [];
    expect(inserts).toHaveLength(3);
    expect(guards).toHaveLength(inserts.length);
    expect(sql).toMatch(
      /create unique index if not exists idx_widget_submission_assets_unique_path/
    );
  });

  it("copies the submission's created_at so retention windows do not reset", () => {
    expect(sql.match(/s\.created_at/g) ?? []).toHaveLength(3);
  });

  it("carries the submission's annotations onto the backfilled screenshot", () => {
    expect(sql).toMatch(/coalesce\(s\.screenshot_annotations, '\[\]'::jsonb\)/);
  });

  it("does NOT drop the legacy columns (dual-read, not a cutover)", () => {
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/alter table widget_submissions/i);
  });

  it("does not touch the objects in the bucket", () => {
    expect(sql).not.toMatch(/storage\./i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
  });

  it("matches the codified RLS posture: enabled, no policies, grants revoked", () => {
    expect(sql).toMatch(
      /alter table widget_submission_assets enable row level security/
    );
    expect(sql).toMatch(
      /revoke all on public\.widget_submission_assets from anon, authenticated/
    );
    expect(sql).not.toMatch(/create policy/i);
  });

  it("indexes the proxy lookup and the retention scan", () => {
    expect(sql).toMatch(
      /create index if not exists idx_widget_submission_assets_lookup\s+on widget_submission_assets \(submission_id, kind, position\)/
    );
    expect(sql).toMatch(
      /create index if not exists idx_widget_submission_assets_retention\s+on widget_submission_assets \(id\)\s+where purged_at is null/
    );
  });
});
