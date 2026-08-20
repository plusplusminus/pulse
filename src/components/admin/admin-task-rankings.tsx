"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type CompositeEntry = {
  issueLinearId: string;
  averageRank: number;
  rankerCount: number;
};

type CompositeRiceEntry = {
  issueLinearId: string;
  averageReach: number | null;
  averageImpact: number | null;
  averageConfidence: number | null;
  averageEffort: number | null;
  averageScore: number | null;
  scorerCount: number;
  scores: Array<{
    userId: string;
    reach: number | null;
    impact: number | null;
    confidence: number | null;
    effort: number | null;
    score: number | null;
  }>;
};

type LogEntry = {
  id: string;
  userId: string;
  issueLinearId: string;
  previousRank: number | null;
  newRank: number;
  createdAt: string;
};

type IssueInfo = {
  id: string;
  title: string;
  identifier: string;
};

type ProjectInfo = {
  id: string;
  name: string;
  color?: string;
};

type LogBatch = {
  key: string;
  userId: string;
  timestamp: string;
  entries: LogEntry[];
};

function groupIntoBatches(log: LogEntry[]): LogBatch[] {
  const batches: LogBatch[] = [];
  let current: LogBatch | null = null;

  for (const entry of log) {
    const entryTime = new Date(entry.createdAt).getTime();
    const currentTime = current
      ? new Date(current.timestamp).getTime()
      : 0;

    if (
      current &&
      current.userId === entry.userId &&
      Math.abs(entryTime - currentTime) < 5000
    ) {
      current.entries.push(entry);
    } else {
      current = {
        key: entry.id,
        userId: entry.userId,
        timestamp: entry.createdAt,
        entries: [entry],
      };
      batches.push(current);
    }
  }

  return batches;
}

function formatUserName(
  userId: string,
  members: Record<string, string>
): string {
  const email = members[userId];
  if (email) {
    const local = email.split("@")[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "Unknown user";
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AdminTaskRankings({
  hubId,
  projects,
  issues,
}: {
  hubId: string;
  projects: ProjectInfo[];
  issues: IssueInfo[];
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects[0]?.id ?? ""
  );
  const [composite, setComposite] = useState<CompositeEntry[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [riceScores, setRiceScores] = useState<CompositeRiceEntry[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<
    "rankings" | "activity" | "rice"
  >("rankings");
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"rank" | "activity">("rank");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const issueMap = useMemo(
    () => new Map(issues.map((i) => [i.id, i])),
    [issues]
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      setIsLoading(true);
      try {
        const [rankRes, logRes, riceRes] = await Promise.all([
          fetch(
            `/api/hubs/${hubId}/projects/${selectedProjectId}/task-rankings?composite=true`,
            { signal }
          ),
          fetch(
            `/api/hubs/${hubId}/projects/${selectedProjectId}/task-rankings/log?limit=50`,
            { signal }
          ),
          fetch(
            `/api/hubs/${hubId}/projects/${selectedProjectId}/task-rice-scores?composite=true`,
            { signal }
          ),
        ]);

        if (signal.aborted) return;

        if (rankRes.ok) {
          const data = (await rankRes.json()) as {
            composite: CompositeEntry[];
          };
          setComposite(data.composite);
        } else {
          setComposite([]);
        }

        if (logRes.ok) {
          const data = (await logRes.json()) as {
            log: LogEntry[];
            members: Record<string, string>;
          };
          setLog(data.log);
          setMembers(data.members ?? {});
        } else {
          setLog([]);
        }

        if (riceRes.ok) {
          const data = (await riceRes.json()) as {
            scores: CompositeRiceEntry[];
          };
          setRiceScores(data.scores);
        } else {
          setRiceScores([]);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error("AdminTaskRankings load error:", err);
      }
      if (!signal.aborted) setIsLoading(false);
    }
    load();

    return () => controller.abort();
  }, [hubId, selectedProjectId]);

  const sorted = useMemo(() => {
    const entries = [...composite];
    if (sortBy === "activity") {
      return entries.sort(
        (a, b) =>
          b.rankerCount - a.rankerCount || a.averageRank - b.averageRank
      );
    }
    return entries.sort((a, b) => a.averageRank - b.averageRank);
  }, [composite, sortBy]);

  const logByIssue = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const entry of log) {
      if (!map.has(entry.issueLinearId)) map.set(entry.issueLinearId, []);
      map.get(entry.issueLinearId)!.push(entry);
    }
    return map;
  }, [log]);

  const batches = useMemo(() => groupIntoBatches(log), [log]);

  const sortedRice = useMemo(() => {
    return [...riceScores].sort((a, b) => {
      if (a.averageScore == null && b.averageScore == null) return 0;
      if (a.averageScore == null) return 1;
      if (b.averageScore == null) return -1;
      return b.averageScore - a.averageScore;
    });
  }, [riceScores]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (projects.length === 0) {
    return (
      <div className="p-6">
        <div className="border border-border rounded-lg p-8 text-center bg-card">
          <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No projects have task prioritisation enabled
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Enable task prioritisation in the scoping editor for specific
            projects
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Project selector */}
      <div className="mb-4">
        <select
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setExpanded(new Set());
          }}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-card text-foreground"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          Loading task ranking data...
        </div>
      ) : composite.length === 0 &&
        log.length === 0 &&
        riceScores.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center bg-card">
          <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No clients have ranked tasks in this project yet
          </p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => setActiveTab("rankings")}
              className={cn(
                "text-sm font-medium pb-1 border-b-2 transition-colors",
                activeTab === "rankings"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Composite Rankings
            </button>
            <button
              onClick={() => setActiveTab("activity")}
              className={cn(
                "text-sm font-medium pb-1 border-b-2 transition-colors",
                activeTab === "activity"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Activity Log
              {log.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-muted text-[10px] tabular-nums">
                  {batches.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("rice")}
              className={cn(
                "text-sm font-medium pb-1 border-b-2 transition-colors",
                activeTab === "rice"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              RICE Scores
              {riceScores.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-muted text-[10px] tabular-nums">
                  {riceScores.length}
                </span>
              )}
            </button>

            {activeTab === "rankings" && (
              <div className="ml-auto">
                <button
                  onClick={() =>
                    setSortBy((s) => (s === "rank" ? "activity" : "rank"))
                  }
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  {sortBy === "rank" ? "By rank" : "By activity"}
                </button>
              </div>
            )}
          </div>

          {activeTab === "rankings" && (
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              <div className="grid grid-cols-[40px_1fr_80px_80px_60px] gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <span>#</span>
                <span>Task</span>
                <span className="text-right">Avg Rank</span>
                <span className="text-right">Rankers</span>
                <span />
              </div>

              {sorted.map((entry, index) => {
                const issue = issueMap.get(entry.issueLinearId);
                const isExpanded = expanded.has(entry.issueLinearId);

                return (
                  <div
                    key={entry.issueLinearId}
                    className={cn(
                      index < sorted.length - 1 && "border-b border-border"
                    )}
                  >
                    <button
                      onClick={() => toggleExpand(entry.issueLinearId)}
                      className="grid grid-cols-[40px_1fr_80px_80px_60px] gap-2 px-4 py-2.5 w-full text-left hover:bg-accent/30 transition-colors"
                    >
                      <span className="text-sm font-medium tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="flex items-center gap-2 min-w-0">
                        {issue && (
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {issue.identifier}
                          </span>
                        )}
                        <span className="text-sm truncate">
                          {issue?.title ?? entry.issueLinearId}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums text-right">
                        {entry.averageRank.toFixed(1)}
                      </span>
                      <span className="text-sm tabular-nums text-right text-muted-foreground">
                        {entry.rankerCount}
                      </span>
                      <span className="flex justify-end">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-3 pl-14">
                        <div className="text-xs text-muted-foreground space-y-1">
                          {(logByIssue.get(entry.issueLinearId) ?? []).slice(0, 5).map((l) => (
                            <div
                              key={l.id}
                              className="flex items-center gap-2"
                            >
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>
                                {formatUserName(l.userId, members)} moved
                                from {l.previousRank ?? "—"} → {l.newRank}
                              </span>
                              <span className="ml-auto text-[10px]">
                                {formatRelativeTime(l.createdAt)}
                              </span>
                            </div>
                          ))}
                          {(logByIssue.get(entry.issueLinearId) ?? []).length === 0 && (
                            <span className="text-[10px]">
                              No ranking changes recorded
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "activity" && (
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              {batches.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No ranking activity yet
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {batches.map((batch) => {
                    const userName = formatUserName(batch.userId, members);
                    const email = members[batch.userId];
                    const isExpanded = expanded.has(batch.key);

                    return (
                      <div key={batch.key}>
                        <button
                          onClick={() => toggleExpand(batch.key)}
                          className="flex items-center gap-3 px-4 py-2.5 w-full text-left hover:bg-accent/30 transition-colors"
                        >
                          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                            <span className="text-xs font-medium text-foreground">
                              {userName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className="font-medium">{userName}</span>
                              <span className="text-muted-foreground">
                                {" "}
                                reranked{" "}
                                {batch.entries.length === 1
                                  ? "1 task"
                                  : `${batch.entries.length} tasks`}
                              </span>
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {email ?? batch.userId} ·{" "}
                              {formatRelativeTime(batch.timestamp)}
                            </p>
                          </div>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {batch.entries.length}
                            </span>
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 pl-14 space-y-1">
                            {batch.entries.map((entry) => {
                              const issue = issueMap.get(entry.issueLinearId);
                              return (
                                <div
                                  key={entry.id}
                                  className="flex items-center gap-2 text-xs text-muted-foreground"
                                >
                                  {issue && (
                                    <span className="text-[10px] font-mono shrink-0">
                                      {issue.identifier}
                                    </span>
                                  )}
                                  <span className="truncate">
                                    {issue?.title ?? entry.issueLinearId}
                                  </span>
                                  <span className="font-mono shrink-0">
                                    #{entry.previousRank ?? "—"} →{" "}
                                    #{entry.newRank}
                                  </span>
                                  {entry.previousRank !== null &&
                                    entry.newRank < entry.previousRank && (
                                      <span className="text-[10px] px-1 rounded bg-emerald-500/10 text-emerald-600">
                                        ↑{entry.previousRank - entry.newRank}
                                      </span>
                                    )}
                                  {entry.previousRank !== null &&
                                    entry.newRank > entry.previousRank && (
                                      <span className="text-[10px] px-1 rounded bg-red-500/10 text-red-600">
                                        ↓{entry.newRank - entry.previousRank}
                                      </span>
                                    )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "rice" && (
            <div className="border border-border rounded-lg overflow-x-auto bg-card">
              {sortedRice.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No RICE scores submitted yet
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[40px_1fr_70px_70px_80px_70px_70px_60px_40px] gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    <span>#</span>
                    <span>Task</span>
                    <span className="text-right">Reach</span>
                    <span className="text-right">Impact</span>
                    <span className="text-right">Confidence</span>
                    <span className="text-right">Effort</span>
                    <span className="text-right">Score</span>
                    <span className="text-right">Scorers</span>
                    <span />
                  </div>

                  {sortedRice.map((entry, index) => {
                    const issue = issueMap.get(entry.issueLinearId);
                    const isExpanded = expanded.has(
                      `rice-${entry.issueLinearId}`
                    );

                    return (
                      <div
                        key={entry.issueLinearId}
                        className={cn(
                          index < sortedRice.length - 1 &&
                            "border-b border-border"
                        )}
                      >
                        <button
                          onClick={() =>
                            toggleExpand(`rice-${entry.issueLinearId}`)
                          }
                          className="grid grid-cols-[40px_1fr_70px_70px_80px_70px_70px_60px_40px] gap-2 px-4 py-2.5 w-full text-left hover:bg-accent/30 transition-colors"
                        >
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            {index + 1}
                          </span>
                          <span className="flex items-center gap-2 min-w-0">
                            {issue && (
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                {issue.identifier}
                              </span>
                            )}
                            <span className="text-sm truncate">
                              {issue?.title ?? "Unknown task"}
                            </span>
                          </span>
                          <span className="text-sm tabular-nums text-right">
                            {entry.averageReach != null
                              ? entry.averageReach.toFixed(1)
                              : "—"}
                          </span>
                          <span className="text-sm tabular-nums text-right">
                            {entry.averageImpact != null
                              ? entry.averageImpact.toFixed(1)
                              : "—"}
                          </span>
                          <span className="text-sm tabular-nums text-right">
                            {entry.averageConfidence != null
                              ? `${Math.round(entry.averageConfidence)}%`
                              : "—"}
                          </span>
                          <span className="text-sm tabular-nums text-right">
                            {entry.averageEffort != null
                              ? `${entry.averageEffort.toFixed(1)}d`
                              : "—"}
                          </span>
                          <span
                            className={cn(
                              "text-sm tabular-nums text-right font-medium",
                              entry.averageScore != null &&
                                entry.averageScore >= 5
                                ? "text-emerald-500"
                                : entry.averageScore != null &&
                                    entry.averageScore >= 2
                                  ? "text-orange-500"
                                  : "text-muted-foreground"
                            )}
                          >
                            {entry.averageScore != null
                              ? entry.averageScore.toFixed(1)
                              : "—"}
                          </span>
                          <span className="text-sm tabular-nums text-right text-muted-foreground">
                            {entry.scorerCount}
                          </span>
                          <span className="flex justify-end">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 pl-14">
                            <div className="text-xs text-muted-foreground space-y-1">
                              {entry.scores.map((s) => (
                                <div
                                  key={s.userId}
                                  className="flex items-center gap-3"
                                >
                                  <span className="w-24 truncate">
                                    {formatUserName(s.userId, members)}
                                  </span>
                                  <span className="tabular-nums w-10 text-right">
                                    {s.reach ?? "—"}
                                  </span>
                                  <span className="tabular-nums w-10 text-right">
                                    {s.impact ?? "—"}
                                  </span>
                                  <span className="tabular-nums w-14 text-right">
                                    {s.confidence != null
                                      ? `${s.confidence}%`
                                      : "—"}
                                  </span>
                                  <span className="tabular-nums w-12 text-right">
                                    {s.effort != null
                                      ? `${s.effort}d`
                                      : "—"}
                                  </span>
                                  <span className="tabular-nums w-12 text-right font-medium">
                                    {s.score != null
                                      ? s.score.toFixed(1)
                                      : "—"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
