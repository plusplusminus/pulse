import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { HubRankings } from "@/components/admin/hub-rankings";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function HubRankingsPage({
  params,
}: {
  params: Promise<{ hubId: string }>;
}) {
  const { hubId } = await params;

  const { data: hub } = await supabaseAdmin
    .from("client_hubs")
    .select("id, name, slug")
    .eq("id", hubId)
    .single();

  if (!hub) notFound();

  // Fetch all synced projects for this hub's teams (no visibility filter)
  // so admin rankings can resolve names for all ranked projects
  const { data: mappings } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("linear_team_id")
    .eq("hub_id", hubId);

  const teamIds = (mappings ?? []).map((m) => m.linear_team_id);

  const { data: allProjects } = await supabaseAdmin
    .from("synced_projects")
    .select("linear_id, data")
    .eq("user_id", "workspace");

  const projectInfos = (allProjects ?? [])
    .filter((p) => {
      const teams = (p.data as Record<string, unknown>)?.teams;
      return (
        Array.isArray(teams) &&
        teams.some((t: { id?: string }) => teamIds.includes(t.id ?? ""))
      );
    })
    .map((p) => ({
      id: p.linear_id,
      name:
        ((p.data as Record<string, unknown>)?.name as string) ?? p.linear_id,
      color: (p.data as Record<string, unknown>)?.color as
        | string
        | undefined,
    }));

  return (
    <div className="max-w-4xl">
      <div className="px-6 pt-6 pb-2">
        <Link
          href={`/admin/hubs/${hubId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="w-3 h-3" />
          Back to {hub.name}
        </Link>
        <h1 className="text-xl font-semibold">Client Priority Rankings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          See how clients have ranked roadmap projects by priority
        </p>
      </div>

      <HubRankings hubId={hubId} projects={projectInfos} />
    </div>
  );
}
