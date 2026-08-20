import { NextResponse } from "next/server";
import { withHubAuth, withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import {
  fetchHubIssueDetail,
  fetchHubComments,
  fetchHubTeamLabels,
  getHubVisibleLabelIds,
} from "@/lib/hub-read";
import { supabaseAdmin, type HubWorkflowRule } from "@/lib/supabase";
import { updateIssueLabels } from "@/lib/linear-push";
import {
  buildLabelChangeContext,
  evaluateWorkflowRules,
  executeWorkflowActions,
  logWorkflowExecution,
  type WorkflowExecutionResult,
} from "@/lib/hub-workflows";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string; linearId: string }> }
) {
  try {
    const { hubId, linearId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const [issue, comments] = await Promise.all([
      fetchHubIssueDetail(hubId, linearId),
      fetchHubComments(hubId, linearId),
    ]);

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    // Fetch label definitions from Linear, scoped to the issue's team
    const hubLabels = await fetchHubTeamLabels(hubId, issue.teamId);

    // Fetch workflow rules to expose which labels have automation attached
    let workflowLabelIds: string[] = [];
    let workflowRules: Array<{
      labelId: string;
      triggerType: string;
      conditionStateIds: string[] | null;
      description: string;
    }> = [];
    try {
      const { data: mapping } = await supabaseAdmin
        .from("hub_team_mappings")
        .select("id")
        .eq("hub_id", hubId)
        .eq("linear_team_id", issue.teamId)
        .eq("is_active", true)
        .single();

      if (mapping) {
        const { data: rules } = await supabaseAdmin
          .from("hub_workflow_rules")
          .select("trigger_label_id, trigger_type, action_type, action_config, condition_state_ids")
          .eq("mapping_id", mapping.id);

        if (rules && rules.length > 0) {
          workflowRules = rules.map((r) => {
            const conditionStateIds = (r.condition_state_ids as string[] | null) ?? null;
            let description: string;
            switch (r.trigger_type) {
              case "label_added":
                description = "Adding this label will update the issue status";
                break;
              case "label_removed":
                description = "Removing this label will update the issue status";
                break;
              case "label_changed":
                description = "Swapping to this label will update the issue status";
                break;
              default:
                description = "This label has an automation rule attached";
            }
            return {
              labelId: r.trigger_label_id,
              triggerType: r.trigger_type,
              conditionStateIds,
              description,
            };
          });
          workflowLabelIds = [...new Set(workflowRules.map((r) => r.labelId))];
        }
      }
    } catch (err) {
      console.error("[hub-workflows] Failed to fetch workflow rules for GET:", err);
    }

    return NextResponse.json({
      issue,
      comments,
      hubLabels,
      workflowLabelIds,
      workflowRules,
    });
  } catch (error) {
    console.error("GET /api/hub/[hubId]/issues/[linearId] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: Add or remove a label on the issue
export async function POST(
  request: Request,
  { params }: { params: Promise<{ hubId: string; linearId: string }> }
) {
  try {
    const { hubId, linearId } = await params;

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { action, labelId } = (await request.json()) as {
      action?: "add" | "remove";
      labelId?: string;
    };

    if (!action || !labelId) {
      return NextResponse.json(
        { error: "action and labelId are required" },
        { status: 400 }
      );
    }

    // Look up the issue's team_id for per-team label scoping
    const { data: issueRow } = await supabaseAdmin
      .from("synced_issues")
      .select("data, team_id")
      .eq("user_id", "workspace")
      .eq("linear_id", linearId)
      .single();

    if (!issueRow) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const issueTeamId = issueRow.team_id as string;

    // Verify the label is visible for this issue's team
    const allowedLabelIds = await getHubVisibleLabelIds(hubId, issueTeamId);
    if (allowedLabelIds && !allowedLabelIds.includes(labelId)) {
      return NextResponse.json(
        { error: "Label not visible in this hub" },
        { status: 403 }
      );
    }

    const issueData = issueRow.data as Record<string, unknown>;
    const currentLabels = (issueData.labels as Array<{ id: string }>) ?? [];
    const currentLabelIds = currentLabels.map((l) => l.id);

    // Extract current state for status-aware workflow evaluation
    const issueState = issueData.state as { id: string; name: string } | undefined;

    let newLabelIds: string[];
    if (action === "add") {
      if (currentLabelIds.includes(labelId)) {
        return NextResponse.json({ error: "Label already applied" }, { status: 400 });
      }
      newLabelIds = [...currentLabelIds, labelId];
    } else {
      if (!currentLabelIds.includes(labelId)) {
        return NextResponse.json({ error: "Label not on issue" }, { status: 400 });
      }
      newLabelIds = currentLabelIds.filter((id) => id !== labelId);
    }

    // Push to Linear
    const updatedLabels = await updateIssueLabels(linearId, newLabelIds);

    // Update local synced data
    await supabaseAdmin
      .from("synced_issues")
      .update({
        data: { ...issueData, labels: updatedLabels },
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", "workspace")
      .eq("linear_id", linearId);

    // Filter to hub-visible labels for response
    const visibleLabels = allowedLabelIds
      ? updatedLabels.filter((l) => allowedLabelIds.includes(l.id))
      : updatedLabels;

    // -- Workflow evaluation (fire-and-forget, never blocks the response) -----
    let workflowResults: WorkflowExecutionResult[] = [];
    try {
      // Look up the hub_team_mapping for this issue's team
      const { data: mapping } = await supabaseAdmin
        .from("hub_team_mappings")
        .select("id")
        .eq("hub_id", hubId)
        .eq("linear_team_id", issueTeamId)
        .eq("is_active", true)
        .single();

      if (mapping) {
        // Fetch workflow rules for this mapping
        const { data: rules } = await supabaseAdmin
          .from("hub_workflow_rules")
          .select("*")
          .eq("mapping_id", mapping.id);

        if (rules && rules.length > 0) {
          const typedRules = rules as HubWorkflowRule[];
          const context = buildLabelChangeContext(currentLabelIds, newLabelIds, issueState);
          const actions = evaluateWorkflowRules(context, typedRules);

          if (actions.length > 0) {
            // Fire-and-forget: execute but don't let failures affect the response
            workflowResults = await executeWorkflowActions(actions, linearId);

            // Optimistically update local synced_issues with the new status
            for (const result of workflowResults) {
              if (result.success && result.action === "set_status" && result.details) {
                const { stateId, stateName } = result.details as { stateId?: string; stateName?: string };
                if (stateId) {
                  supabaseAdmin
                    .from("synced_issues")
                    .update({
                      data: {
                        ...issueData,
                        labels: updatedLabels,
                        state: { id: stateId, name: stateName ?? stateId },
                      },
                      updated_at: new Date().toISOString(),
                    })
                    .eq("user_id", "workspace")
                    .eq("linear_id", linearId)
                    .then(({ error: updateErr }) => {
                      if (updateErr) console.error("[hub-workflows] Failed to optimistically update status:", updateErr);
                    });
                }
              }
            }

            // Log workflow execution for the activity trail
            logWorkflowExecution(
              hubId,
              linearId,
              workflowResults,
              auth.user.id,
              typedRules,
              issueState
            ).catch((logErr) =>
              console.error("[hub-workflows] Failed to log execution:", logErr)
            );
          }
        }
      }
    } catch (workflowError) {
      console.error(
        "[hub-workflows] Workflow evaluation failed (non-blocking):",
        workflowError
      );
    }

    return NextResponse.json({ labels: visibleLabels, workflowResults });
  } catch (error) {
    console.error("POST /api/hub/[hubId]/issues/[linearId] labels error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update labels" },
      { status: 500 }
    );
  }
}
