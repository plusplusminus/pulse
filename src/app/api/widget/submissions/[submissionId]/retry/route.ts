import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import {
  buildWidgetIssueDescription,
  createWidgetLinearIssue,
} from "@/lib/widget-linear";
import type { WidgetSubmission } from "@/lib/widget-types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const { submissionId } = await params;

    const { data: submission, error: fetchError } = await supabaseAdmin
      .from("widget_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (fetchError || !submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    const sub = submission as WidgetSubmission;

    const auth = await withHubAuthWrite(sub.hub_id);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    if (sub.sync_status !== "failed") {
      return NextResponse.json(
        { error: "Only failed submissions can be retried" },
        { status: 400 }
      );
    }

    // Resolve team
    const { data: mapping } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("linear_team_id")
      .eq("hub_id", sub.hub_id)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!mapping) {
      return NextResponse.json(
        { error: "No active team mapping found for hub" },
        { status: 400 }
      );
    }

    try {
      const description = buildWidgetIssueDescription({
        description: sub.description ?? undefined,
        reporter: {
          email: sub.reporter_email,
          name: sub.reporter_name ?? undefined,
        },
        metadata: sub.metadata,
        screenshotUrl: sub.screenshot_url ?? undefined,
      });

      const issue = await createWidgetLinearIssue({
        teamId: mapping.linear_team_id,
        title: sub.title,
        description,
        screenshotUrl: sub.screenshot_url ?? undefined,
      });

      const { data: updated } = await supabaseAdmin
        .from("widget_submissions")
        .update({
          linear_issue_id: issue.id,
          linear_issue_url: issue.url,
          sync_status: "synced",
          sync_error: null,
        })
        .eq("id", submissionId)
        .select("*")
        .single();

      return NextResponse.json(updated);
    } catch (err) {
      const syncError =
        err instanceof Error ? err.message : "Linear sync failed";

      await supabaseAdmin
        .from("widget_submissions")
        .update({ sync_error: syncError })
        .eq("id", submissionId);

      return NextResponse.json(
        { error: `Retry failed: ${syncError}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(
      "POST /api/widget/submissions/[submissionId]/retry error:",
      error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
