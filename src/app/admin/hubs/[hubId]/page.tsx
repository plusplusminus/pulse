import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkspaceSetting } from "@/lib/workspace";
import Link from "next/link";
import {
  Users,
  Layers,
  Tags,
  FolderKanban,
  Settings,
  UserPlus,
  ExternalLink,
  ListOrdered,
  BarChart3,
  CheckCircle2,
  Circle,
  MessageSquare,
} from "lucide-react";
import { HubSyncButton } from "@/components/admin/hub-sync-button";

export default async function HubDashboardPage({
  params,
}: {
  params: Promise<{ hubId: string }>;
}) {
  const { hubId } = await params;

  const { data: hub } = await supabaseAdmin
    .from("client_hubs")
    .select("*, hub_team_mappings(*), hub_members(count)")
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
  }>;

  const memberCount =
    (hub.hub_members as unknown as { count: number }[])?.[0]?.count ?? 0;
  const teamCount = mappings.length;

  // Aggregate scoping counts across all teams
  const scopedProjectCount = mappings.reduce(
    (sum, m) => sum + m.visible_project_ids.length,
    0
  );
  const scopedLabelCount = mappings.reduce(
    (sum, m) => sum + m.visible_label_ids.length,
    0
  );

  // Check token status for setup checklist
  const tokenConfigured = !!(await getWorkspaceSetting("linear_api_token"));

  const isNewHub = teamCount === 0 && memberCount === 0;

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-semibold">{hub.name}</h1>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
              hub.is_active
                ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]"
                : "bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]"
            }`}
          >
            {hub.is_active ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">/{hub.slug}</p>
      </div>

      {/* Setup checklist for new hubs */}
      {isNewHub && (
        <div className="border border-border rounded-lg p-5 bg-card mb-8">
          <h2 className="text-sm font-semibold mb-3">Setup Checklist</h2>
          <div className="space-y-2.5">
            <ChecklistItem
              done={tokenConfigured}
              label="Connect Linear API token"
              href="/admin/settings/linear"
            />
            <ChecklistItem
              done={teamCount > 0}
              label="Add at least one team"
              href={`/admin/hubs/${hub.id}/settings`}
            />
            <ChecklistItem
              done={memberCount > 0}
              label="Invite client members"
              href={`/admin/hubs/${hub.id}/members`}
            />
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard
          icon={<Layers className="w-4 h-4" />}
          label="Teams"
          value={teamCount}
        />
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Members"
          value={memberCount}
        />
        <StatCard
          icon={<FolderKanban className="w-4 h-4" />}
          label="Projects"
          value={scopedProjectCount === 0 ? "All" : scopedProjectCount}
          sublabel={scopedProjectCount === 0 ? "No filter" : "scoped"}
        />
        <StatCard
          icon={<Tags className="w-4 h-4" />}
          label="Labels"
          value={scopedLabelCount === 0 ? "All" : scopedLabelCount}
          sublabel={scopedLabelCount === 0 ? "No filter" : "scoped"}
        />
      </div>

      {/* Team breakdown */}
      {teamCount > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold mb-3">Teams</h2>
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            {mappings.map((m, i) => (
              <div
                key={m.id}
                className={`flex items-center justify-between px-4 py-2.5 ${
                  i < mappings.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <span className="text-sm">{m.linear_team_name ?? m.linear_team_id}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                    {m.visible_project_ids.length === 0
                      ? "All proj"
                      : `${m.visible_project_ids.length} proj`}
                  </span>
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                    {m.visible_label_ids.length === 0
                      ? "All labels"
                      : `${m.visible_label_ids.length} labels`}
                  </span>
                  {m.hidden_label_ids.length > 0 && (
                    <span className="text-[10px] text-destructive/80 px-1.5 py-0.5 rounded bg-destructive/10">
                      {m.hidden_label_ids.length} hidden
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HubSyncButton hubId={hub.id} />
        <QuickAction
          href={`/admin/hubs/${hub.id}/members`}
          icon={<UserPlus className="w-4 h-4" />}
          label="Manage Members"
          description="Invite and manage users"
        />
        <QuickAction
          href={`/admin/hubs/${hub.id}/rankings`}
          icon={<ListOrdered className="w-4 h-4" />}
          label="Client Priority"
          description="View client rankings"
        />
        <QuickAction
          href={`/admin/hubs/${hub.id}/task-rankings`}
          icon={<BarChart3 className="w-4 h-4" />}
          label="Task Priority"
          description="View task rankings by project"
        />
        <QuickAction
          href={`/admin/hubs/${hub.id}/settings`}
          icon={<Settings className="w-4 h-4" />}
          label="Edit Settings"
          description="Name, scoping, danger zone"
        />
        <QuickAction
          href={`/admin/hubs/${hub.id}/widget`}
          icon={<MessageSquare className="w-4 h-4" />}
          label="Pulse Widget"
          description="Feedback widget config"
        />
        <QuickAction
          href={`/hub/${hub.slug}`}
          icon={<ExternalLink className="w-4 h-4" />}
          label="View as Client"
          description="See the client portal"
          external
        />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-lg font-semibold tabular-nums">{String(value)}</p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>
      )}
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
  description,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  external?: boolean;
}) {
  const Component = external ? "a" : Link;
  const extraProps = external ? { target: "_blank", rel: "noopener noreferrer" } : {};

  return (
    <Component
      href={href}
      className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors group"
      {...extraProps}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-muted-foreground group-hover:text-primary transition-colors">
          {icon}
        </span>
        <span className="text-sm font-medium group-hover:text-primary transition-colors">
          {label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </Component>
  );
}

function ChecklistItem({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 group"
    >
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-[var(--badge-green-text)] shrink-0" />
      ) : (
        <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
      <span
        className={`text-sm ${
          done
            ? "text-muted-foreground line-through"
            : "text-foreground group-hover:text-primary"
        } transition-colors`}
      >
        {label}
      </span>
    </Link>
  );
}
