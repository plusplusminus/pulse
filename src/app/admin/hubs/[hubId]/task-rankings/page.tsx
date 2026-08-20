import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchTaskPriorityProjectIds } from "@/lib/hub-task-priorities";
import { AdminTaskRankings } from "@/components/admin/admin-task-rankings";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function TaskRankingsPage({
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

  // Get task-priority-enabled project IDs
  const enabledIds = await fetchTaskPriorityProjectIds(hubId);

  // Fetch project info for enabled projects
  const { data: allProjects } = await supabaseAdmin
    .from("synced_projects")
    .select("linear_id, data")
    .eq("user_id", "workspace");

  const projects = (allProjects ?? [])
    .filter((p) => enabledIds.has(p.linear_id))
    .map((p) => ({
      id: p.linear_id,
      name:
        ((p.data as Record<string, unknown>)?.name as string) ?? p.linear_id,
      color: (p.data as Record<string, unknown>)?.color as string | undefined,
    }));

  // Fetch issues for all enabled projects so admin can resolve names
  const enabledArray = [...enabledIds];
  let issues: Array<{ id: string; title: string; identifier: string }> = [];

  if (enabledArray.length > 0) {
    const { data: issueRows } = await supabaseAdmin
      .from("synced_issues")
      .select("linear_id, data")
      .eq("user_id", "workspace");

    issues = (issueRows ?? [])
      .filter((row) => {
        const d = row.data as Record<string, unknown>;
        const proj = d?.project as Record<string, unknown> | undefined;
        return proj?.id && enabledArray.includes(proj.id as string);
      })
      .map((row) => {
        const d = row.data as Record<string, unknown>;
        return {
          id: row.linear_id,
          title: (d?.title as string) ?? row.linear_id,
          identifier: (d?.identifier as string) ?? "",
        };
      });
  }

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
        <h1 className="text-xl font-semibold">Task Priority Rankings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          See how clients have ranked tasks within priority-enabled projects
        </p>
      </div>

      <AdminTaskRankings hubId={hubId} projects={projects} issues={issues} />
    </div>
  );
}
