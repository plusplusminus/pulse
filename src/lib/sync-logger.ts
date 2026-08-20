import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "./supabase";

// -- Types -------------------------------------------------------------------

export type SyncEventStatus = "success" | "error" | "skipped";

export type SyncEventInput = {
  eventType: string;
  action: string;
  entityId: string;
  teamId?: string | null;
  status: SyncEventStatus;
  errorMessage?: string;
  processingTimeMs?: number;
  payloadSummary?: Record<string, unknown>;
};

export type SyncRunType = "initial_sync" | "reconcile" | "hub_sync";
export type SyncRunTrigger = "manual" | "cron" | "api";
export type SyncRunStatus = "running" | "completed" | "failed";

export type EntitiesProcessed = {
  issues?: number;
  comments?: number;
  teams?: number;
  projects?: number;
  cycles?: number;
  initiatives?: number;
};

export type SyncRunErrorDetail = {
  teamId?: string;
  entityType?: string;
  message: string;
};

// -- Fire-and-forget event logging -------------------------------------------

/**
 * Log a webhook event to sync_events. Fire-and-forget — never throws.
 * Use `void logSyncEvent(...)` in webhook hot paths.
 */
export async function logSyncEvent(input: SyncEventInput): Promise<void> {
  try {
    Sentry.addBreadcrumb({
      category: "sync",
      message: `${input.eventType}.${input.action} → ${input.status}`,
      level: input.status === "error" ? "error" : "info",
      data: {
        entityId: input.entityId,
        teamId: input.teamId,
        processingTimeMs: input.processingTimeMs,
      },
    });

    const { error } = await supabaseAdmin.from("sync_events").insert({
      event_type: input.eventType,
      action: input.action,
      entity_id: input.entityId,
      team_id: input.teamId ?? null,
      status: input.status,
      error_message: input.errorMessage ?? null,
      processing_time_ms: input.processingTimeMs ?? null,
      payload_summary: input.payloadSummary ?? null,
    });
    if (error) {
      console.warn("sync-logger: failed to log event", error);
    }
  } catch (e) {
    // Transient network errors (ECONNRESET etc.) — don't escalate to Sentry
    console.warn("sync-logger: failed to log event", e);
  }
}

// -- Sync run tracking -------------------------------------------------------

/**
 * Start tracking a sync run. Returns the run ID for later completion.
 * Awaitable — sync runs are already long-running, so the overhead is fine.
 */
export async function startSyncRun(opts: {
  runType: SyncRunType;
  trigger: SyncRunTrigger;
  hubId?: string | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("sync_runs")
      .insert({
        run_type: opts.runType,
        trigger: opts.trigger,
        hub_id: opts.hubId ?? null,
        status: "running" as SyncRunStatus,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.warn("sync-logger: failed to start run", error);
      return null;
    }

    return data.id;
  } catch (e) {
    console.warn("sync-logger: failed to start run", e);
    return null;
  }
}

/**
 * Complete a sync run with results. Never throws.
 */
export async function completeSyncRun(opts: {
  runId: string | null;
  status: "completed" | "failed";
  entitiesProcessed?: EntitiesProcessed;
  errorsCount?: number;
  errorDetails?: SyncRunErrorDetail[];
  startedAt: number; // Date.now() from when the run started
}): Promise<void> {
  if (!opts.runId) return;

  try {
    const now = Date.now();
    const durationMs = now - opts.startedAt;

    if (opts.status === "failed") {
      Sentry.captureMessage("Sync run failed", {
        level: "error",
        tags: { area: "sync", "sync.run_id": opts.runId },
        contexts: {
          sync_run: {
            runId: opts.runId,
            durationMs,
            errorsCount: opts.errorsCount,
            errorDetails: opts.errorDetails,
          },
        },
      });
    }

    const { error } = await supabaseAdmin
      .from("sync_runs")
      .update({
        status: opts.status,
        completed_at: new Date().toISOString(),
        entities_processed: opts.entitiesProcessed ?? {},
        errors_count: opts.errorsCount ?? 0,
        error_details: opts.errorDetails ?? null,
        duration_ms: durationMs,
      })
      .eq("id", opts.runId);
    if (error) {
      Sentry.captureException(error, { tags: { area: "sync-logger" } });
      console.warn("sync-logger: failed to complete run", error);
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "sync-logger" } });
    console.warn("sync-logger: failed to complete run", e);
  }
}

// -- Auto-prune --------------------------------------------------------------

/**
 * Delete sync_events and sync_runs older than 30 days.
 * Call this from the reconcile cron. Never throws.
 */
export async function pruneSyncLogs(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString();

    await supabaseAdmin
      .from("sync_events")
      .delete()
      .lt("created_at", cutoffISO);

    await supabaseAdmin
      .from("sync_runs")
      .delete()
      .lt("created_at", cutoffISO);
  } catch (e) {
    console.warn("sync-logger: failed to prune logs", e);
  }
}
