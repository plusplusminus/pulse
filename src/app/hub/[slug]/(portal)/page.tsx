import { resolveHubBySlug } from "@/lib/hub-auth";
import { fetchHubTeams, fetchHubTeamStats } from "@/lib/hub-read";
import { redirect } from "next/navigation";
import { HubTabs } from "@/components/hub/hub-tabs";
import { HubWelcome } from "@/components/hub/hub-welcome";

export default async function HubLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  const [teams, stats] = await Promise.all([
    fetchHubTeams(hub.id),
    fetchHubTeamStats(hub.id),
  ]);

  const teamCards = teams.map((team) => {
    const teamStats = stats.get(team.id);
    return {
      id: team.id,
      name: team.name,
      key: team.key,
      projectCount: teamStats?.projectCount ?? 0,
      openIssueCount: teamStats?.openIssueCount ?? 0,
      lastActivity: teamStats?.lastActivity ?? null,
    };
  });

  // Aggregate stats for the welcome header
  const welcomeStats = {
    epicCount: teamCards.reduce((sum, t) => sum + t.projectCount, 0),
    openTaskCount: teamCards.reduce((sum, t) => sum + t.openIssueCount, 0),
    lastActivity: teamCards.reduce<string | null>((latest, t) => {
      if (!t.lastActivity) return latest;
      if (!latest) return t.lastActivity;
      return t.lastActivity > latest ? t.lastActivity : latest;
    }, null),
  };

  return (
    <div className="p-6 max-w-6xl">
      <HubWelcome stats={welcomeStats} />
      <HubTabs teams={teamCards} hubId={hub.id} hubSlug={slug} />
    </div>
  );
}
