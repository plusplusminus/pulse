import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkspaceToken } from "@/lib/workspace";
import {
  fetchAllIssues,
  fetchAllTeams,
  fetchAllProjects,
  fetchAllInitiatives,
  fetchAllCycles,
  fetchCommentsForIssue,
  fetchIssueChecksums,
  fetchProjectChecksums,
  fetchCycleChecksums,
  fetchInitiativeChecksums,
  fetchIssuesByIds,
  fetchProjectsByIds,
  fetchCyclesByIds,
  fetchInitiativesByIds,
  diffEntities,
  mapIssueToRow,
  mapTeamToRow,
  mapProjectToRow,
  mapInitiativeToRow,
  mapCycleToRow,
  mapCommentToRow,
  batchUpsert,
  fetchProjectUpdatesForProject,
  mapProjectUpdateToRow,
} from "@/lib/initial-sync";
import { startSyncRun, completeSyncRun, pruneSyncLogs } from "@/lib/sync-logger";
import { LinearRateLimiter } from "@/lib/linear-rate-limiter";
import { getWatermark, setWatermark } from "@/lib/sync-watermarks";

const WORKSPACE_USER_ID = "workspace";

/** Skip per-issue comment fetching during reconciliation.
 *  Comments are reliably synced via webhooks — this avoids N+1 API calls.
 *  Toggle via SKIP_COMMENT_RECONCILE env var (defaults to true). */
const SKIP_COMMENT_RECONCILE = process.env.SKIP_COMMENT_RECONCILE !== "false";

/** When true, reconciliation uses lightweight diff-check: fetches only
 *  id + updatedAt from Linear, compares against local timestamps,
 *  and only fetches full payloads for stale/missing entities.
 *  Toggle via DIFF_CHECK_MODE env var (defaults to true). */
const DIFF_CHECK_MODE = process.env.DIFF_CHECK_MODE !== "false";

type HubReconcileResult = {
  hubsReconciled: number;
  teamsReconciled: number;
  issuesUpserted: number;
  issuesMoved: number;
  issuesDeleted: number;
  commentsUpserted: number;
  teamsUpserted: number;
  projectsUpserted: number;
  cyclesUpserted: number;
  cyclesDeleted: number;
  initiativesUpserted: number;
  errors: number;
};

// POST: Manual reconciliation (triggers full hub reconciliation)
export async function POST() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const startedAt = Date.now();
    const runId = await startSyncRun({ runType: "reconcile", trigger: "manual" });

    const result = await reconcileAllHubs();

    await completeSyncRun({
      runId,
      status: result.errors > 0 ? "failed" : "completed",
      entitiesProcessed: {
        issues: result.issuesUpserted,
        comments: result.commentsUpserted,
        teams: result.teamsUpserted,
        projects: result.projectsUpserted,
        cycles: result.cyclesUpserted,
        initiatives: result.initiativesUpserted,
      },
      errorsCount: result.errors,
      startedAt,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "sync" } });
    console.error("POST /api/sync/reconcile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET: Cron-triggered reconciliation for all active hubs
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "sync-reconcile", status: "in_progress" },
    {
      schedule: { type: "crontab", value: "*/30 * * * *" },
      checkinMargin: 2,
      maxRuntime: 10,
      failureIssueThreshold: 3,
      recoveryThreshold: 1,
    }
  );

  try {
    const { data: hubs } = await supabaseAdmin
      .from("client_hubs")
      .select("id")
      .eq("is_active", true);

    if (!hubs || hubs.length === 0) {
      Sentry.captureCheckIn({ checkInId, monitorSlug: "sync-reconcile", status: "ok" });
      return NextResponse.json({ success: true, message: "No active hubs" });
    }

    const startedAt = Date.now();
    const runId = await startSyncRun({ runType: "reconcile", trigger: "cron" });

    const result = await Sentry.startSpan(
      { name: "reconcileAllHubs", op: "sync.reconcile" },
      () => reconcileAllHubs()
    );

    await completeSyncRun({
      runId,
      status: result.errors > 0 ? "failed" : "completed",
      entitiesProcessed: {
        issues: result.issuesUpserted,
        comments: result.commentsUpserted,
        teams: result.teamsUpserted,
        projects: result.projectsUpserted,
        cycles: result.cyclesUpserted,
        initiatives: result.initiativesUpserted,
      },
      errorsCount: result.errors,
      startedAt,
    });

    // Prune old logs (fire-and-forget, piggybacks on cron)
    void pruneSyncLogs();

    const checkInStatus = result.errors > 0 ? "error" : "ok";
    Sentry.captureCheckIn({ checkInId, monitorSlug: "sync-reconcile", status: checkInStatus });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: "sync-reconcile", status: "error" });
    Sentry.captureException(error, { tags: { area: "sync" } });
    console.error("GET /api/sync/reconcile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Compute the maximum `updatedAt` from a list of Linear entities.
 *  Returns a Date or null if the list is empty. */
function maxRemoteUpdatedAt(entities: Array<{ updatedAt: string }>): Date | null {
  if (entities.length === 0) return null;
  let max = entities[0].updatedAt;
  for (let i = 1; i < entities.length; i++) {
    if (entities[i].updatedAt > max) max = entities[i].updatedAt;
  }
  return new Date(max);
}

/**
 * Fetch + upsert project health updates for the given projects. Reconcile
 * safety-net for the ProjectUpdate webhook — scoped to the projects already
 * fetched this pass (changed projects), mirroring how comments are reconciled
 * only for fetched issues. Upsert-only: deletions are handled by the webhook.
 */
async function reconcileProjectUpdates(
  apiToken: string,
  projects: Array<{ id: string }>,
  rateLimiter: LinearRateLimiter
): Promise<void> {
  for (const project of projects) {
    if (!rateLimiter.canProceed()) {
      console.warn(
        `[rate-limit] Reconcile: skipping remaining project-update fetches`,
        rateLimiter.getStatus()
      );
      break;
    }
    try {
      const updates = await fetchProjectUpdatesForProject(
        apiToken,
        project.id,
        rateLimiter
      );
      if (updates.length > 0) {
        await batchUpsert(
          "synced_project_updates",
          updates.map((u) =>
            mapProjectUpdateToRow(u, project.id, WORKSPACE_USER_ID)
          ),
          "user_id,linear_id"
        );
      }
    } catch (err) {
      console.error(`Reconcile: project updates for ${project.id} failed:`, err);
    }
  }
}

/**
 * Reconcile all active hubs. Org-level entities (teams, initiatives) are
 * fetched once. Per-team entities are deduplicated across hubs.
 *
 * When DIFF_CHECK_MODE is true, uses lightweight checksums to detect
 * stale/missing entities and only fetches full payloads for those.
 */
async function reconcileAllHubs(): Promise<HubReconcileResult> {
  const result: HubReconcileResult = {
    hubsReconciled: 0,
    teamsReconciled: 0,
    issuesUpserted: 0,
    issuesMoved: 0,
    issuesDeleted: 0,
    commentsUpserted: 0,
    teamsUpserted: 0,
    projectsUpserted: 0,
    cyclesUpserted: 0,
    cyclesDeleted: 0,
    initiativesUpserted: 0,
    errors: 0,
  };

  // Collect deleted entity IDs across all teams, then resolve after the team loop.
  // This avoids order-dependent results when issues move between teams.
  const allDeletedIssueIds = new Set<string>();
  const allDeletedCycleIds = new Set<string>();

  const apiToken = await getWorkspaceToken();
  const rateLimiter = new LinearRateLimiter();

  // 1. Org-level: teams (always full fetch — small dataset, no diff needed)
  try {
    const teams = await fetchAllTeams(apiToken, rateLimiter);
    if (teams.length > 0) {
      await batchUpsert(
        "synced_teams",
        teams.map((t) => mapTeamToRow(t, WORKSPACE_USER_ID)),
        "user_id,linear_id"
      );
    }
    result.teamsUpserted = teams.length;
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "sync", "sync.entity": "teams" } });
    console.error("Reconcile: teams failed:", error);
    result.errors++;
  }

  // 2. Org-level: initiatives
  try {
    if (DIFF_CHECK_MODE) {
      const checksums = await fetchInitiativeChecksums(apiToken, rateLimiter);
      const diff = await diffEntities("synced_initiatives", checksums);
      const needFetch = [...diff.stale, ...diff.missing];

      if (diff.deleted.length > 0) {
        console.warn(`[diff-check] initiatives: ${diff.deleted.length} entities in local DB but not in remote:`, diff.deleted);
      }
      console.log(`[diff-check] initiatives: ${checksums.length} checked, ${diff.stale.length} stale, ${diff.missing.length} missing, ${diff.deleted.length} deleted, ${needFetch.length} to fetch`);

      if (needFetch.length > 0) {
        const initiatives = await fetchInitiativesByIds(needFetch, apiToken, rateLimiter);
        if (initiatives.length > 0) {
          await batchUpsert(
            "synced_initiatives",
            initiatives.map((i) => mapInitiativeToRow(i, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
        }
        result.initiativesUpserted = initiatives.length;
      }
    } else {
      const initiativeWatermark = await getWatermark("_org", "initiatives");
      const initiatives = await fetchAllInitiatives(apiToken, rateLimiter, initiativeWatermark ?? undefined);
      if (initiatives.length > 0) {
        await batchUpsert(
          "synced_initiatives",
          initiatives.map((i) => mapInitiativeToRow(i, WORKSPACE_USER_ID)),
          "user_id,linear_id"
        );
        const maxUpdatedAt = maxRemoteUpdatedAt(initiatives);
        if (maxUpdatedAt) await setWatermark("_org", "initiatives", maxUpdatedAt);
      }
      result.initiativesUpserted = initiatives.length;
      console.log(`Reconcile: initiatives — ${initiativeWatermark ? "incremental" : "full"} — ${initiatives.length} fetched`);
    }
  } catch (error) {
    // Don't update watermark on failure — next run retries from same point
    console.warn("Reconcile: initiatives failed (may lack org scope):", error);
  }

  // 3. Collect all unique team IDs across active hubs
  const { data: mappings } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("hub_id, linear_team_id")
    .eq("is_active", true);

  if (!mappings || mappings.length === 0) {
    console.log("Reconcile: no team mappings found");
    return result;
  }

  // Deduplicate: sync each team only once
  const syncedTeamIds = new Set<string>();
  const hubIds = new Set<string>();

  for (const mapping of mappings) {
    hubIds.add(mapping.hub_id);

    if (syncedTeamIds.has(mapping.linear_team_id)) continue;
    syncedTeamIds.add(mapping.linear_team_id);

    // Check rate limit before processing next team
    if (!rateLimiter.canProceed()) {
      console.warn(`[rate-limit] Reconcile deferred — stopping before team ${mapping.linear_team_id}`, rateLimiter.getStatus());
      break;
    }

    try {
      const teamId = mapping.linear_team_id;

      if (DIFF_CHECK_MODE) {
        // --- Diff-check mode: lightweight checksums then targeted fetches ---

        // Projects — diff without teamId scope since projects are shared across teams.
        // Deletion detection is skipped: per-team checksums can't reliably detect
        // deleted projects (a project absent from team A's list may belong to team B).
        const projectChecksums = await fetchProjectChecksums(teamId, apiToken, rateLimiter);
        const projectDiff = await diffEntities("synced_projects", projectChecksums);
        const projectsToFetch = [...projectDiff.stale, ...projectDiff.missing];
        // Note: projectDiff.deleted is ignored here — see comment above
        if (projectsToFetch.length > 0) {
          const projects = await fetchProjectsByIds(projectsToFetch, apiToken, rateLimiter);
          if (projects.length > 0) {
            await batchUpsert(
              "synced_projects",
              projects.map((p) => mapProjectToRow(p, WORKSPACE_USER_ID)),
              "user_id,linear_id"
            );
          }
          result.projectsUpserted += projects.length;
          await reconcileProjectUpdates(apiToken, projects, rateLimiter);
        }
        console.log(`[diff-check] team ${teamId} projects: ${projectChecksums.length} checked, ${projectDiff.stale.length} stale, ${projectDiff.missing.length} missing, ${projectsToFetch.length} fetched`);

        // Cycles
        const cycleChecksums = await fetchCycleChecksums(teamId, apiToken, rateLimiter);
        const cycleDiff = await diffEntities("synced_cycles", cycleChecksums, teamId);
        const cyclesToFetch = [...cycleDiff.stale, ...cycleDiff.missing];
        for (const id of cycleDiff.deleted) allDeletedCycleIds.add(id);
        if (cyclesToFetch.length > 0) {
          const cycles = await fetchCyclesByIds(cyclesToFetch, apiToken, rateLimiter);
          if (cycles.length > 0) {
            await batchUpsert(
              "synced_cycles",
              cycles.map((c) => mapCycleToRow(c, WORKSPACE_USER_ID)),
              "user_id,linear_id"
            );
          }
          result.cyclesUpserted += cycles.length;
        }
        console.log(`[diff-check] team ${teamId} cycles: ${cycleChecksums.length} checked, ${cycleDiff.stale.length} stale, ${cycleDiff.missing.length} missing, ${cycleDiff.deleted.length} gone, ${cyclesToFetch.length} fetched`);

        // Issues
        const issueChecksums = await fetchIssueChecksums(teamId, apiToken, rateLimiter);
        const issueDiff = await diffEntities("synced_issues", issueChecksums, teamId);
        const issuesToFetch = [...issueDiff.stale, ...issueDiff.missing];
        for (const id of issueDiff.deleted) allDeletedIssueIds.add(id);
        if (issuesToFetch.length > 0) {
          const issues = await fetchIssuesByIds(issuesToFetch, apiToken, rateLimiter);
          if (issues.length > 0) {
            await batchUpsert(
              "synced_issues",
              issues.map((issue) => mapIssueToRow(issue, WORKSPACE_USER_ID)),
              "user_id,linear_id"
            );
          }
          result.issuesUpserted += issues.length;

          // Comments for fetched issues only (if enabled)
          if (!SKIP_COMMENT_RECONCILE) {
            for (const issue of issues) {
              try {
                const comments = await fetchCommentsForIssue(apiToken, issue.id, rateLimiter);
                if (comments.length > 0) {
                  await batchUpsert(
                    "synced_comments",
                    comments.map((c) => mapCommentToRow(c, issue.id, WORKSPACE_USER_ID)),
                    "user_id,linear_id"
                  );
                  result.commentsUpserted += comments.length;
                }
              } catch (commentError) {
                console.error(`Reconcile: comments for issue ${issue.id} failed:`, commentError);
              }
            }
          }
        }
        console.log(`[diff-check] team ${teamId} issues: ${issueChecksums.length} checked, ${issueDiff.stale.length} stale, ${issueDiff.missing.length} missing, ${issueDiff.deleted.length} gone, ${issuesToFetch.length} fetched`);

      } else {
        // --- Legacy full-fetch mode (watermark-based) ---

        // Projects
        const projectWatermark = await getWatermark(teamId, "projects");
        const projects = await fetchAllProjects(apiToken, teamId, rateLimiter, projectWatermark ?? undefined);
        if (projects.length > 0) {
          await batchUpsert(
            "synced_projects",
            projects.map((p) => mapProjectToRow(p, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
          const maxProjUpdated = maxRemoteUpdatedAt(projects);
          if (maxProjUpdated) await setWatermark(teamId, "projects", maxProjUpdated);
        }
        result.projectsUpserted += projects.length;
        await reconcileProjectUpdates(apiToken, projects, rateLimiter);
        console.log(`Reconcile: team ${teamId} projects — ${projectWatermark ? "incremental" : "full"} — ${projects.length} fetched`);

        // Cycles
        const cycleWatermark = await getWatermark(teamId, "cycles");
        const cycles = await fetchAllCycles(apiToken, teamId, rateLimiter, cycleWatermark ?? undefined);
        if (cycles.length > 0) {
          await batchUpsert(
            "synced_cycles",
            cycles.map((c) => mapCycleToRow(c, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
          const maxCycleUpdated = maxRemoteUpdatedAt(cycles);
          if (maxCycleUpdated) await setWatermark(teamId, "cycles", maxCycleUpdated);
        }
        result.cyclesUpserted += cycles.length;
        console.log(`Reconcile: team ${teamId} cycles — ${cycleWatermark ? "incremental" : "full"} — ${cycles.length} fetched`);

        // Issues
        const issueWatermark = await getWatermark(teamId, "issues");
        const issues = await fetchAllIssues(apiToken, teamId, rateLimiter, issueWatermark ?? undefined);
        if (issues.length > 0) {
          await batchUpsert(
            "synced_issues",
            issues.map((issue) => mapIssueToRow(issue, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
          const maxIssueUpdated = maxRemoteUpdatedAt(issues);
          if (maxIssueUpdated) await setWatermark(teamId, "issues", maxIssueUpdated);
        }
        result.issuesUpserted += issues.length;
        console.log(`Reconcile: team ${teamId} issues — ${issueWatermark ? "incremental" : "full"} — ${issues.length} fetched`);

        // Comments: fetch per issue and batch upsert
        if (!SKIP_COMMENT_RECONCILE) {
          for (const issue of issues) {
            try {
              const comments = await fetchCommentsForIssue(apiToken, issue.id, rateLimiter);
              if (comments.length > 0) {
                await batchUpsert(
                  "synced_comments",
                  comments.map((c) => mapCommentToRow(c, issue.id, WORKSPACE_USER_ID)),
                  "user_id,linear_id"
                );
                result.commentsUpserted += comments.length;
              }
            } catch (commentError) {
              console.error(`Reconcile: comments for issue ${issue.id} failed:`, commentError);
            }
          }
        }
      }

      result.teamsReconciled++;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: "sync", "sync.entity": "team", "sync.team_id": mapping.linear_team_id },
      });
      console.error(
        `Reconcile: team ${mapping.linear_team_id} failed:`,
        error
      );
      result.errors++;
    }
  }

  result.hubsReconciled = hubIds.size;

  // 4. Resolve entities that disappeared from their team's checksum query.
  //    Done after all teams so that cross-team moves don't cause order-dependent results.
  if (DIFF_CHECK_MODE) {
    // Cycles can't move teams — delete directly
    if (allDeletedCycleIds.size > 0) {
      const ids = Array.from(allDeletedCycleIds);
      const { error: delError } = await supabaseAdmin
        .from("synced_cycles")
        .delete()
        .eq("user_id", WORKSPACE_USER_ID)
        .in("linear_id", ids);

      if (delError) {
        console.error(`[diff-check] Failed to delete ${ids.length} cycles:`, delError);
      } else {
        result.cyclesDeleted = ids.length;
      }
      console.log(`[diff-check] cycles cleanup: ${ids.length} deleted`);
    }

    // Issues can move teams — re-fetch to distinguish moved vs truly deleted
    if (allDeletedIssueIds.size > 0) {
      const ids = Array.from(allDeletedIssueIds);
      try {
        const refetched = await fetchIssuesByIds(ids, apiToken, rateLimiter);
        const refetchedIds = new Set(refetched.map((i) => i.id));

        // Moved: still exists in Linear, different team — upsert updates team_id
        if (refetched.length > 0) {
          await batchUpsert(
            "synced_issues",
            refetched.map((issue) => mapIssueToRow(issue, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
          result.issuesMoved = refetched.length;
        }

        // Truly deleted: not returned by Linear at all
        const trulyDeleted = ids.filter((id) => !refetchedIds.has(id));
        if (trulyDeleted.length > 0) {
          const { error: delError } = await supabaseAdmin
            .from("synced_issues")
            .delete()
            .eq("user_id", WORKSPACE_USER_ID)
            .in("linear_id", trulyDeleted);

          if (delError) {
            console.error(`[diff-check] Failed to delete ${trulyDeleted.length} issues:`, delError);
          } else {
            result.issuesDeleted = trulyDeleted.length;
          }
        }

        console.log(`[diff-check] issues cleanup: ${ids.length} gone — ${refetched.length} moved, ${trulyDeleted.length} deleted`);
      } catch (error) {
        console.error("[diff-check] Failed to resolve deleted issues:", error);
        result.errors++;
      }
    }
  }

  const mode = DIFF_CHECK_MODE ? "diff-check" : "full-fetch";
  console.log(
    `Reconcile complete (${mode}): ${result.hubsReconciled} hubs, ${result.teamsReconciled} teams, ` +
      `${result.issuesUpserted} issues (${result.issuesMoved} moved, ${result.issuesDeleted} deleted), ` +
      `${result.commentsUpserted} comments, ${result.projectsUpserted} projects, ` +
      `${result.cyclesUpserted} cycles (${result.cyclesDeleted} deleted), ` +
      `${result.initiativesUpserted} initiatives, ${result.errors} errors`
  );

  return result;
}
