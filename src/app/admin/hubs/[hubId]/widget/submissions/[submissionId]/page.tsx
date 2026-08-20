import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { SubmissionDetail } from "@/components/admin/submission-detail";
import type { WidgetSubmission } from "@/lib/widget-types";

/**
 * PULSE-347 — admin submission detail. `src/app/admin/layout.tsx` already
 * guards the whole subtree with `withAuth()` + `isPPMAdmin`; the extra
 * `hub_id` filter keeps a submission from being reachable under the wrong hub.
 */
async function getSubmission(hubId: string, submissionId: string) {
  const { data } = await supabaseAdmin
    .from("widget_submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("hub_id", hubId)
    .maybeSingle();

  return (data as WidgetSubmission | null) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hubId: string; submissionId: string }>;
}) {
  const { hubId, submissionId } = await params;
  const submission = await getSubmission(hubId, submissionId);
  return { title: submission?.title ?? "Submission" };
}

export default async function WidgetSubmissionDetailPage({
  params,
}: {
  params: Promise<{ hubId: string; submissionId: string }>;
}) {
  const { hubId, submissionId } = await params;

  const submission = await getSubmission(hubId, submissionId);
  if (!submission) notFound();

  return <SubmissionDetail hubId={hubId} submission={submission} />;
}
