import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { HubSettingsForm } from "@/components/admin/hub-settings-form";

export default async function HubSettingsPage({
  params,
}: {
  params: Promise<{ hubId: string }>;
}) {
  const { hubId } = await params;

  const { data: hub } = await supabaseAdmin
    .from("client_hubs")
    .select("*, hub_team_mappings(*)")
    .eq("id", hubId)
    .single();

  if (!hub) notFound();

  const mappings = (hub.hub_team_mappings ?? []) as Array<{
    id: string;
    linear_team_id: string;
    linear_team_name: string | null;
    visible_project_ids: string[];
    visible_initiative_ids: string[];
    visible_label_ids: string[];
    hidden_label_ids: string[];
    auto_include_projects: boolean;
    include_unassigned_issues: boolean;
    overview_only_project_ids: string[];
    task_priority_project_ids: string[];
    is_active: boolean;
  }>;

  return (
    <div className="p-6">
      <HubSettingsForm
        hub={{
          id: hub.id,
          name: hub.name,
          slug: hub.slug,
          is_active: hub.is_active,
        }}
        mappings={mappings}
      />
    </div>
  );
}
