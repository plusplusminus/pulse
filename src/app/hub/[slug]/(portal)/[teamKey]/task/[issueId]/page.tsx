import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";
import { fetchHubTeams, fetchHubIssueDetail } from "@/lib/hub-read";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { IssueFullView } from "@/components/hub/issue-full-view";
import { TaskSubscriptionControl } from "@/components/hub/task-subscription-control";

type Params = { slug: string; teamKey: string; issueId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug, issueId } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) return { title: "Task" };
  const issue = await fetchHubIssueDetail(hub.id, issueId);
  return { title: issue?.title ?? "Task" };
}

export default async function TaskViewPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, teamKey, issueId } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  const teams = await fetchHubTeams(hub.id);
  const team = teams.find((t) => t.key === teamKey);
  if (!team) notFound();

  const issue = await fetchHubIssueDetail(hub.id, issueId);
  if (!issue || issue.teamId !== team.id) notFound();

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + per-task notification control */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
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
          <span className="text-foreground font-mono">{issue.identifier}</span>
        </div>
        <div className="ml-auto shrink-0">
          <TaskSubscriptionControl hubId={hub.id} issueId={issueId} />
        </div>
      </div>

      {/* Full-page task view */}
      <IssueFullView issueId={issueId} hubId={hub.id} />
    </div>
  );
}
