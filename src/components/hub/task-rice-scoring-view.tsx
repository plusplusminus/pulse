"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertCircle, CircleDot, HelpCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHub } from "@/contexts/hub-context";
import { useCanInteract } from "@/hooks/use-can-interact";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

type Task = {
  id: string;
  title: string;
  identifier: string;
  status: { name: string; color: string; type: string };
  labels: Array<{ id: string; name: string; color: string }>;
};

type TaskScore = {
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
  score: number | null;
};

type RiceScoreResponse = {
  issueLinearId: string;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
  score: number | null;
  updatedAt: string | null;
};

const IMPACT_OPTIONS = [
  { value: 0.25, label: "Minimal" },
  { value: 0.5, label: "Low" },
  { value: 1, label: "Medium" },
  { value: 2, label: "High" },
  { value: 3, label: "Massive" },
] as const;

function calculateScore(s: TaskScore): number | null {
  if (
    s.reach == null ||
    s.impact == null ||
    s.confidence == null ||
    s.effort == null
  )
    return null;
  if (s.effort === 0) return null;
  return (s.reach * s.impact * (s.confidence / 100)) / s.effort;
}

function isComplete(s: TaskScore): boolean {
  return (
    s.reach != null &&
    s.impact != null &&
    s.confidence != null &&
    s.effort != null
  );
}

function scoreColor(score: number | null): string {
  if (score == null) return "";
  const clamped = Math.min(Math.max(score, 0), 30);
  const ratio = clamped / 30;
  if (ratio > 0.6) return "bg-emerald-500/15 text-emerald-400";
  if (ratio > 0.3) return "bg-emerald-500/8 text-emerald-300/80";
  if (ratio > 0.1) return "bg-muted/40 text-muted-foreground";
  return "bg-muted/20 text-muted-foreground";
}

const COLUMN_INFO: Record<string, { label: string; description: string; scale: string }> = {
  reach: {
    label: "Reach",
    description: "How many people will this impact in a given time period?",
    scale: "1 (few) – 10 (everyone)",
  },
  impact: {
    label: "Impact",
    description: "How much will this impact each person affected?",
    scale: "0.25 Minimal · 0.5 Low · 1 Medium · 2 High · 3 Massive",
  },
  confidence: {
    label: "Confidence",
    description: "How confident are you in your Reach, Impact, and Effort estimates?",
    scale: "0% (pure guess) – 100% (backed by data)",
  },
  effort: {
    label: "Effort",
    description: "How many person-days of work will this task take to complete?",
    scale: "0.5+ days (lower = easier)",
  },
  score: {
    label: "Score",
    description: "Calculated as (Reach × Impact × Confidence%) ÷ Effort. Higher is better.",
    scale: "Auto-calculated",
  },
};

function ColumnHeader({ id, align = "right", className }: { id: string; align?: "left" | "right"; className?: string }) {
  const info = COLUMN_INFO[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!info) return null;

  return (
    <th ref={ref} className={cn("text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 relative", align === "right" ? "text-right" : "text-left", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {info.label}
        <HelpCircle className="w-2.5 h-2.5 opacity-40 hover:opacity-100 transition-opacity" />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 w-56 rounded-md border border-border bg-popover p-3 shadow-md text-left normal-case tracking-normal">
          <p className="text-xs text-foreground font-medium mb-1">{info.label}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{info.description}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1.5 font-mono">{info.scale}</p>
        </div>
      )}
    </th>
  );
}

function EffortInput({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setDraft(value != null ? String(value) : "");
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
          setDraft(raw);
        }
      }}
      onBlur={() => {
        if (draft === "" || draft === ".") {
          onChange(null);
          setDraft("");
          return;
        }
        const v = parseFloat(draft);
        if (Number.isNaN(v) || v < 0.5) {
          setDraft(value != null ? String(value) : "");
          return;
        }
        onChange(v);
        setDraft(String(v));
      }}
      placeholder="—"
      className={cn(
        "w-12 tabular-nums text-right text-sm bg-transparent border-none outline-none",
        "focus:ring-1 focus:ring-primary/50 rounded px-1 py-1 min-h-[44px]",
        "placeholder:text-muted-foreground/40",
        !disabled ? "" : "cursor-default opacity-60"
      )}
    />
  );
}

export function TaskRiceScoringView({
  tasks,
  projectId,
}: {
  tasks: Task[];
  projectId: string;
}) {
  const { hubId } = useHub();
  const canInteract = useCanInteract();
  const [scores, setScores] = useState<Map<string, TaskScore>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  // Load scores on mount / project change
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setIsLoading(true);
    setScores(new Map());

    async function load() {
      try {
        const res = await fetch(
          `/api/hubs/${hubId}/projects/${projectId}/task-rice-scores`,
          { signal }
        );
        if (signal.aborted) return;

        if (!res.ok) {
          setIsLoading(false);
          return;
        }
        const data = (await res.json()) as { scores: RiceScoreResponse[] };

        if (signal.aborted) return;

        const map = new Map<string, TaskScore>();
        for (const s of data.scores) {
          map.set(s.issueLinearId, {
            reach: s.reach,
            impact: s.impact,
            confidence: s.confidence,
            effort: s.effort,
            score: s.score,
          });
        }
        setScores(map);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Silent — empty state is fine
      }
      if (!signal.aborted) setIsLoading(false);
    }
    load();

    return () => controller.abort();
  }, [hubId, projectId]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of debounceRefs.current.values()) {
        clearTimeout(timer);
      }
      for (const controller of abortRefs.current.values()) {
        controller.abort();
      }
    };
  }, []);

  const saveScore = useCallback(
    (issueId: string, updated: TaskScore, previous: TaskScore) => {
      const existing = debounceRefs.current.get(issueId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        const prev = abortRefs.current.get(issueId);
        if (prev) prev.abort();

        const controller = new AbortController();
        abortRefs.current.set(issueId, controller);
        setSavingIds((prev) => new Set(prev).add(issueId));

        try {
          const res = await fetch(
            `/api/hubs/${hubId}/projects/${projectId}/task-rice-scores`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                issueLinearId: issueId,
                reach: updated.reach,
                impact: updated.impact,
                confidence: updated.confidence,
                effort: updated.effort,
              }),
              signal: controller.signal,
            }
          );
          if (res.ok) {
            try {
              captureEvent(POSTHOG_EVENTS.task_rice_score_updated, {
                hubId,
                projectId,
                issueLinearId: issueId,
                score: updated.score,
              });
            } catch {
              /* best-effort */
            }
          } else {
            // Revert to previous state on server error
            setScores((prev) => {
              const next = new Map(prev);
              next.set(issueId, previous);
              return next;
            });
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            // Network error — rollback optimistic update
            setScores((prev) => {
              const next = new Map(prev);
              next.set(issueId, previous);
              return next;
            });
          }
        } finally {
          setSavingIds((prev) => {
            const next = new Set(prev);
            next.delete(issueId);
            return next;
          });
        }
      }, 2000);

      debounceRefs.current.set(issueId, timer);
    },
    [hubId, projectId]
  );

  const updateField = useCallback(
    (issueId: string, field: keyof Omit<TaskScore, "score">, value: number | null) => {
      setScores((prev) => {
        const next = new Map(prev);
        const current = next.get(issueId) || {
          reach: null,
          impact: null,
          confidence: null,
          effort: null,
          score: null,
        };
        const updated = { ...current, [field]: value };
        updated.score = calculateScore(updated);
        next.set(issueId, updated);
        saveScore(issueId, updated, current);
        return next;
      });
    },
    [saveScore]
  );

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const sa = scores.get(a.id);
      const sb = scores.get(b.id);
      const scoreA = sa?.score ?? null;
      const scoreB = sb?.score ?? null;

      if (scoreA != null && scoreB != null) return scoreB - scoreA;
      if (scoreA != null) return -1;
      if (scoreB != null) return 1;
      return 0;
    });
  }, [tasks, scores]);

  if (isLoading) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Loading RICE scores...
        </p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="max-w-md space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            No tasks to score
          </h3>
          <div className="text-sm text-muted-foreground space-y-2 text-left">
            <p>
              RICE scoring helps prioritize by evaluating each task on:
            </p>
            <ul className="space-y-1 ml-1">
              <li>
                <span className="text-foreground/70 font-medium">Reach</span>{" "}
                — How many people will this impact? (1-10)
              </li>
              <li>
                <span className="text-foreground/70 font-medium">Impact</span>{" "}
                — How much will it impact each person? (0.25-3)
              </li>
              <li>
                <span className="text-foreground/70 font-medium">
                  Confidence
                </span>{" "}
                — How confident are you in these estimates? (0-100%)
              </li>
              <li>
                <span className="text-foreground/70 font-medium">Effort</span>{" "}
                — How many person-days will this take? (0.5+)
              </li>
            </ul>
            <p className="pt-2 text-xs font-mono text-muted-foreground/70">
              Score = (Reach x Impact x Confidence%) / Effort
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden p-4 sm:p-6">
      <div className="border border-border rounded-lg overflow-x-auto bg-card">
        <table className="w-full min-w-[650px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 w-[40%]">
                Task
              </th>
              <ColumnHeader id="reach" className="w-[12%]" />
              <ColumnHeader id="impact" className="w-[14%]" />
              <ColumnHeader id="confidence" className="w-[12%]" />
              <ColumnHeader id="effort" className="w-[12%]" />
              <ColumnHeader id="score" className="w-[10%]" />
            </tr>
          </thead>
          <tbody>
            {sortedTasks.map((task) => {
              const ts = scores.get(task.id) || {
                reach: null,
                impact: null,
                confidence: null,
                effort: null,
                score: null,
              };
              const isSaving = savingIds.has(task.id);
              const complete = isComplete(ts);
              const showIncomplete = !complete &&
                [ts.reach, ts.impact, ts.confidence, ts.effort].some((v) => v != null);

              return (
                <tr
                  key={task.id}
                  className="border-b border-border/40 last:border-b-0 hover:bg-accent/30 transition-colors group"
                >
                  {/* Task name */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CircleDot
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: task.status.color }}
                      />
                      <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                        {task.identifier}
                      </span>
                      <span className="text-sm font-medium text-foreground truncate">
                        {task.title}
                      </span>
                      {isSaving && (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50 shrink-0" />
                      )}
                      {showIncomplete && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500/80 shrink-0">
                          <AlertCircle className="w-2.5 h-2.5" />
                          Incomplete
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Reach (1-10) */}
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={ts.reach ?? ""}
                      disabled={!canInteract}
                      onChange={(e) => {
                        const v =
                          e.target.value === ""
                            ? null
                            : parseInt(e.target.value, 10);
                        if (v != null && (v < 1 || v > 10)) return;
                        updateField(task.id, "reach", v);
                      }}
                      placeholder="—"
                      className={cn(
                        "w-full tabular-nums text-right text-sm bg-transparent border-none outline-none",
                        "focus:ring-1 focus:ring-primary/50 rounded px-1 py-1 min-h-[44px]",
                        "placeholder:text-muted-foreground/40",
                        !canInteract && "cursor-default opacity-60"
                      )}
                    />
                  </td>

                  {/* Impact (select) */}
                  <td className="px-3 py-2">
                    <select
                      value={ts.impact ?? ""}
                      disabled={!canInteract}
                      onChange={(e) => {
                        const v =
                          e.target.value === ""
                            ? null
                            : parseFloat(e.target.value);
                        updateField(task.id, "impact", v);
                      }}
                      className={cn(
                        "w-full tabular-nums text-right text-sm bg-transparent border-none outline-none appearance-none",
                        "focus:ring-1 focus:ring-primary/50 rounded px-1 py-1 min-h-[44px] cursor-pointer",
                        !ts.impact && "text-muted-foreground/40",
                        !canInteract && "cursor-default opacity-60"
                      )}
                    >
                      <option value="">—</option>
                      {IMPACT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.value} — {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Confidence (0-100%) */}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={ts.confidence ?? ""}
                        disabled={!canInteract}
                        onChange={(e) => {
                          const v =
                            e.target.value === ""
                              ? null
                              : parseInt(e.target.value, 10);
                          if (v != null && (v < 0 || v > 100)) return;
                          updateField(task.id, "confidence", v);
                        }}
                        placeholder="—"
                        className={cn(
                          "w-12 tabular-nums text-right text-sm bg-transparent border-none outline-none",
                          "focus:ring-1 focus:ring-primary/50 rounded px-1 py-1 min-h-[44px]",
                          "placeholder:text-muted-foreground/40",
                          !canInteract && "cursor-default opacity-60"
                        )}
                      />
                      {ts.confidence != null && (
                        <span className="text-[10px] text-muted-foreground">
                          %
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Effort (days) */}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <EffortInput
                        value={ts.effort}
                        disabled={!canInteract}
                        onChange={(v) => updateField(task.id, "effort", v)}
                      />
                      {ts.effort != null && (
                        <span className="text-[10px] text-muted-foreground">
                          d
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Score */}
                  <td className="px-3 py-2">
                    <div
                      className={cn(
                        "text-sm tabular-nums text-right font-medium rounded px-2 py-0.5",
                        ts.score != null
                          ? scoreColor(ts.score)
                          : "text-muted-foreground/40"
                      )}
                    >
                      {ts.score != null ? ts.score.toFixed(1) : "—"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
