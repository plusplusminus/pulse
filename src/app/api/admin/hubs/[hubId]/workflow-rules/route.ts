import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import type { WorkflowTriggerType, WorkflowActionType } from "@/lib/supabase";

const VALID_TRIGGERS: WorkflowTriggerType[] = [
  "label_added",
  "label_removed",
  "label_changed",
];
const VALID_ACTIONS: WorkflowActionType[] = ["set_status"];

// GET: Fetch all workflow rules for a hub
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { hubId } = await params;

    // Get all mapping IDs for this hub
    const { data: mappings } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("id")
      .eq("hub_id", hubId);

    if (!mappings || mappings.length === 0) {
      return NextResponse.json({ rules: [] });
    }

    const mappingIds = mappings.map((m) => m.id);

    const { data: rules, error } = await supabaseAdmin
      .from("hub_workflow_rules")
      .select("*")
      .in("mapping_id", mappingIds)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET workflow-rules error:", error);
      return NextResponse.json(
        { error: "Failed to fetch workflow rules" },
        { status: 500 }
      );
    }

    return NextResponse.json({ rules: rules ?? [] });
  } catch (error) {
    console.error("GET /api/admin/hubs/[hubId]/workflow-rules error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create a new workflow rule
export async function POST(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { hubId } = await params;
    const body = (await request.json()) as {
      mapping_id?: string;
      trigger_type?: string;
      trigger_label_id?: string;
      trigger_from_label_id?: string;
      condition_state_ids?: string[] | null;
      action_type?: string;
      action_config?: Record<string, unknown>;
    };

    if (!body.mapping_id || !body.trigger_type || !body.trigger_label_id || !body.action_type) {
      return NextResponse.json(
        { error: "mapping_id, trigger_type, trigger_label_id, and action_type are required" },
        { status: 400 }
      );
    }

    if (!VALID_TRIGGERS.includes(body.trigger_type as WorkflowTriggerType)) {
      return NextResponse.json(
        { error: `Invalid trigger_type. Must be one of: ${VALID_TRIGGERS.join(", ")}` },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.includes(body.action_type as WorkflowActionType)) {
      return NextResponse.json(
        { error: `Invalid action_type. Must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    if (body.trigger_type === "label_changed" && !body.trigger_from_label_id) {
      return NextResponse.json(
        { error: "trigger_from_label_id is required for label_changed trigger" },
        { status: 400 }
      );
    }

    // Verify mapping belongs to this hub
    const { data: mapping } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("id")
      .eq("id", body.mapping_id)
      .eq("hub_id", hubId)
      .single();

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found or does not belong to this hub" },
        { status: 404 }
      );
    }

    // Validate condition_state_ids if provided
    if (body.condition_state_ids !== undefined && body.condition_state_ids !== null) {
      if (!Array.isArray(body.condition_state_ids) || body.condition_state_ids.some((id) => typeof id !== "string" || !id)) {
        return NextResponse.json(
          { error: "condition_state_ids must be null or an array of non-empty strings" },
          { status: 400 }
        );
      }
    }

    const { data: rule, error } = await supabaseAdmin
      .from("hub_workflow_rules")
      .insert({
        mapping_id: body.mapping_id,
        trigger_type: body.trigger_type as WorkflowTriggerType,
        trigger_label_id: body.trigger_label_id,
        trigger_from_label_id: body.trigger_from_label_id ?? null,
        condition_state_ids: body.condition_state_ids ?? null,
        action_type: body.action_type as WorkflowActionType,
        action_config: body.action_config ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error("POST workflow-rules insert error:", error);
      return NextResponse.json(
        { error: "Failed to create workflow rule" },
        { status: 500 }
      );
    }

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/hubs/[hubId]/workflow-rules error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT: Update an existing workflow rule
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { hubId } = await params;
    const body = (await request.json()) as {
      id?: string;
      trigger_type?: string;
      trigger_label_id?: string;
      trigger_from_label_id?: string | null;
      condition_state_ids?: string[] | null;
      action_type?: string;
      action_config?: Record<string, unknown>;
    };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Verify rule belongs to this hub via its mapping
    const { data: existing } = await supabaseAdmin
      .from("hub_workflow_rules")
      .select("id, mapping_id, hub_team_mappings!inner(hub_id)")
      .eq("id", body.id)
      .single();

    if (
      !existing ||
      (existing.hub_team_mappings as unknown as { hub_id: string }).hub_id !== hubId
    ) {
      return NextResponse.json(
        { error: "Rule not found or does not belong to this hub" },
        { status: 404 }
      );
    }

    if (body.trigger_type && !VALID_TRIGGERS.includes(body.trigger_type as WorkflowTriggerType)) {
      return NextResponse.json(
        { error: `Invalid trigger_type` },
        { status: 400 }
      );
    }

    if (body.action_type && !VALID_ACTIONS.includes(body.action_type as WorkflowActionType)) {
      return NextResponse.json(
        { error: `Invalid action_type` },
        { status: 400 }
      );
    }

    const triggerType = (body.trigger_type as WorkflowTriggerType) ?? undefined;
    if (triggerType === "label_changed" && !body.trigger_from_label_id) {
      return NextResponse.json(
        { error: "trigger_from_label_id is required for label_changed trigger" },
        { status: 400 }
      );
    }

    // Validate condition_state_ids if provided
    if (body.condition_state_ids !== undefined && body.condition_state_ids !== null) {
      if (!Array.isArray(body.condition_state_ids) || body.condition_state_ids.some((id) => typeof id !== "string" || !id)) {
        return NextResponse.json(
          { error: "condition_state_ids must be null or an array of non-empty strings" },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.trigger_type) updates.trigger_type = body.trigger_type;
    if (body.trigger_label_id) updates.trigger_label_id = body.trigger_label_id;
    if (body.trigger_from_label_id !== undefined)
      updates.trigger_from_label_id = body.trigger_from_label_id;
    if (body.condition_state_ids !== undefined)
      updates.condition_state_ids = body.condition_state_ids;
    if (body.action_type) updates.action_type = body.action_type;
    if (body.action_config) updates.action_config = body.action_config;

    const { data: rule, error } = await supabaseAdmin
      .from("hub_workflow_rules")
      .update(updates)
      .eq("id", body.id)
      .select()
      .single();

    if (error) {
      console.error("PUT workflow-rules update error:", error);
      return NextResponse.json(
        { error: "Failed to update workflow rule" },
        { status: 500 }
      );
    }

    return NextResponse.json(rule);
  } catch (error) {
    console.error("PUT /api/admin/hubs/[hubId]/workflow-rules error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Delete a workflow rule
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { hubId } = await params;
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get("id");

    if (!ruleId) {
      return NextResponse.json(
        { error: "id query parameter is required" },
        { status: 400 }
      );
    }

    // Verify rule belongs to this hub via its mapping
    const { data: existing } = await supabaseAdmin
      .from("hub_workflow_rules")
      .select("id, mapping_id, hub_team_mappings!inner(hub_id)")
      .eq("id", ruleId)
      .single();

    if (
      !existing ||
      (existing.hub_team_mappings as unknown as { hub_id: string }).hub_id !== hubId
    ) {
      return NextResponse.json(
        { error: "Rule not found or does not belong to this hub" },
        { status: 404 }
      );
    }

    const { error } = await supabaseAdmin
      .from("hub_workflow_rules")
      .delete()
      .eq("id", ruleId);

    if (error) {
      console.error("DELETE workflow-rules error:", error);
      return NextResponse.json(
        { error: "Failed to delete workflow rule" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/hubs/[hubId]/workflow-rules error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
