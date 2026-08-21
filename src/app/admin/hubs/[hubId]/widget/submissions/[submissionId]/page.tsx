import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { SubmissionDetail } from "@/components/admin/submission-detail";
import {
  resolveSubmissionAssets,
  type ResolvedAsset,
  type WidgetSubmissionAsset,
} from "@/lib/widget-assets";
import type { WidgetSubmission } from "@/lib/widget-types";

const ASSET_COLUMNS =
  "id, submission_id, kind, storage_path, content_type, size_bytes, width, height, duration_ms, annotations, position, purged_at, created_at";

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

/**
 * Dual-read (PULSE-403): asset rows where they exist, the submission's legacy
 * columns per kind where they do not. A failed asset query degrades to the
 * legacy columns rather than blanking a page that used to render.
 */
async function getAssets(submission: WidgetSubmission): Promise<ResolvedAsset[]> {
  const { data, error } = await supabaseAdmin
    .from("widget_submission_assets")
    .select(ASSET_COLUMNS)
    .eq("submission_id", submission.id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.warn(
      `Submission ${submission.id}: asset lookup failed, falling back to legacy columns:`,
      error.message
    );
  }

  return resolveSubmissionAssets({
    assets: (data ?? null) as WidgetSubmissionAsset[] | null,
    submission,
  });
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

  const assets = await getAssets(submission);

  return (
    <SubmissionDetail hubId={hubId} submission={submission} assets={assets} />
  );
}
