import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";
import {
  fetchHubTeams,
  fetchHubCycles,
  fetchHubCycleIssues,
  fetchHubMetadata,
  fetchHubProjects,
  fetchOverviewOnlyProjectIds,
} from "@/lib/hub-read";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { IterationCw } from "lucide-react";
import { ProjectIssueList } from "@/components/hub/project-issue-list";
import { CycleDocumentsLinks } from "@/components/hub/cycle-documents-links";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; teamKey: string; cycleId: string }>;
}): Promise<Metadata> {
  const { slug, cycleId } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) return { title: "Cycle" };
  const cycles = await fetchHubCycles(hub.id);
  const cycle = cycles.find((c) => c.id === cycleId);
  return { title: cycle ? (cycle.name || `Cycle ${cycle.number}`) : "Cycle" };
}

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ slug: string; teamKey: string; cycleId: string }>;
}) {
  const { slug, teamKey, cycleId } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  const teams = await fetchHubTeams(hub.id);
  const team = teams.find((t) => t.key === teamKey);
  if (!team) notFound();

  const cycles = await fetchHubCycles(hub.id, { teamId: team.id });
  const cycle = cycles.find((c) => c.id === cycleId);
  if (!cycle) notFound();

  const [issues, metadata, allProjects, overviewOnlyIds] = await Promise.all([
    fetchHubCycleIssues(hub.id, cycleId),
    fetchHubMetadata(hub.id, { teamId: team.id }),
    fetchHubProjects(hub.id),
    fetchOverviewOnlyProjectIds(hub.id),
  ]);

  const visibleProjects = allProjects
    .filter((p) => p.teams.some((t) => t.id === team.id))
    .filter((p) => !overviewOnlyIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, color: p.color }));

  const cycleName = cycle.name || `Cycle ${cycle.number}`;

  const completedCount = issues.filter(
    (i) => i.state.type === "completed" || i.state.type === "cancelled"
  ).length;
  const progressPct =
    issues.length > 0 ? Math.round((completedCount / issues.length) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-6 pt-4 pb-2">
        <Link
          href={`/hub/${slug}`}
          className="hover:text-foreground transition-colors"
        >
          {hub.name}
        </Link>
        <span>/</span>
        <Link
          href={`/hub/${slug}/${teamKey}`}
          className="hover:text-foreground transition-colors"
        >
          {team.name}
        </Link>
        <span>/</span>
        <Link
          href={`/hub/${slug}/${teamKey}?tab=cycles`}
          className="hover:text-foreground transition-colors"
        >
          Cycles
        </Link>
        <span>/</span>
        <span className="text-foreground">{cycleName}</span>
      </div>

      {/* Cycle header */}
      <div className="px-6 pb-4 border-b border-border">
        <div className="flex items-center gap-3 mb-2">
          <IterationCw
            className={`w-4 h-4 shrink-0 ${
              cycle.isCurrent ? "text-primary/70" : "text-muted-foreground"
            }`}
          />
          <h1 className="text-lg font-semibold">{cycleName}</h1>
          {cycle.isCurrent && (
            <span className="text-[10px] font-medium text-primary/80 px-1.5 py-0.5 rounded bg-primary/10">
              Current
            </span>
          )}
          {cycle.isUpcoming && (
            <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
              Upcoming
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: cycle.isCurrent
                    ? "var(--primary)"
                    : "var(--muted-foreground)",
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {progressPct}%
            </span>
          </div>

          {cycle.startsAt && cycle.endsAt && (
            <span className="text-[10px] text-muted-foreground">
              {formatDate(cycle.startsAt)} – {formatDate(cycle.endsAt)}
            </span>
          )}

          <span className="text-[10px] text-muted-foreground">
            {completedCount} / {issues.length} tasks completed
          </span>
        </div>
      </div>

      {/* Documents & Links */}
      <CycleDocumentsLinks
        documents={cycle.documents ?? []}
        links={cycle.links ?? []}
      />

      {/* Issue list */}
      <ProjectIssueList
        issues={issues}
        states={metadata.states}
        labels={metadata.labels}
        cycles={metadata.cycles}
        projects={visibleProjects}
        hubSlug={slug}
        teamKey={teamKey}
        teamId={team.id}
        hubId={hub.id}
        isCycleView
      />
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}
