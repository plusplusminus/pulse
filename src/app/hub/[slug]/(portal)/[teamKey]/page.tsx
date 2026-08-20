import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";
import {
  fetchHubTeams,
  fetchHubProjects,
  fetchHubInitiatives,
  fetchHubRoadmapIssues,
  fetchHubMetadata,
  fetchHubCycles,
  fetchHubCycleStats,
  fetchOverviewOnlyProjectIds,
} from "@/lib/hub-read";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TeamTabs } from "@/components/hub/team-tabs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; teamKey: string }>;
}): Promise<Metadata> {
  const { slug, teamKey } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) return { title: teamKey };
  const teams = await fetchHubTeams(hub.id);
  const team = teams.find((t) => t.key === teamKey);
  return { title: team?.name ?? teamKey };
}

export default async function TeamDashboardPage({
  params,
}: {
  params: Promise<{ slug: string; teamKey: string }>;
}) {
  const { slug, teamKey } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  const teams = await fetchHubTeams(hub.id);
  const team = teams.find((t) => t.key === teamKey);
  if (!team) notFound();

  const [allProjects, allInitiatives, allCycles] = await Promise.all([
    fetchHubProjects(hub.id),
    fetchHubInitiatives(hub.id),
    fetchHubCycles(hub.id, { teamId: team.id }),
  ]);

  // Filter projects to this team
  const projects = allProjects.filter((p) =>
    p.teams.some((t) => t.id === team.id)
  );

  // Filter initiatives that have at least one project in this team's visible projects
  const projectIds = new Set(projects.map((p) => p.id));
  const initiatives = allInitiatives.filter((init) =>
    init.projects.some((p) => projectIds.has(p.id))
  );

  // Extract milestones from projects
  const milestones = projects
    .flatMap((p) =>
      p.milestones.map((m) => ({
        ...m,
        projectName: p.name,
        projectColor: p.color,
      }))
    )
    .sort((a, b) => {
      if (!a.targetDate) return 1;
      if (!b.targetDate) return -1;
      return a.targetDate.localeCompare(b.targetDate);
    });

  // Fetch cycle stats
  const cycleIds = allCycles.map((c) => c.id);
  const cycleStats = cycleIds.length > 0
    ? await fetchHubCycleStats(hub.id, cycleIds)
    : {};

  const cycleDetails = allCycles.map((c) => ({
    id: c.id,
    name: c.name,
    number: c.number,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    isCurrent: c.isCurrent,
    isUpcoming: c.isUpcoming,
    stats: cycleStats[c.id],
    documents: c.documents,
    links: c.links,
  }));

  // Fetch issues and metadata for the Issues tab, excluding overview-only projects
  const overviewOnlyIds = await fetchOverviewOnlyProjectIds(hub.id);
  const projectIdList = projects
    .filter((p) => !overviewOnlyIds.has(p.id))
    .map((p) => p.id);
  const [issues, metadata] = await Promise.all([
    fetchHubRoadmapIssues(hub.id, projectIdList),
    fetchHubMetadata(hub.id, { teamId: team.id }),
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
          <Link
            href={`/hub/${slug}`}
            className="hover:text-foreground transition-colors"
          >
            {hub.name}
          </Link>
          <span>/</span>
          <span className="text-foreground">{team.name}</span>
        </div>

        {/* Team header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{team.name}</h1>
            <span className="text-[10px] font-mono text-muted-foreground">
              {team.key}
            </span>
          </div>
        </div>
      </div>

      {/* Tabbed content */}
      <TeamTabs
        issues={issues}
        states={metadata.states}
        labels={metadata.labels}
        cycles={metadata.cycles}
        cycleDetails={cycleDetails}
        projects={projects}
        overviewOnlyProjectIds={Array.from(overviewOnlyIds)}
        initiatives={initiatives}
        milestones={milestones}
        hubSlug={slug}
        teamKey={teamKey}
        teamId={team.id}
        hubId={hub.id}
      />
    </div>
  );
}

