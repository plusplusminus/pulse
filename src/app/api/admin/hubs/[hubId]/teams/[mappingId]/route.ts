import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { invalidateTeamHubCache } from "@/lib/hub-team-lookup";

type RouteParams = { params: Promise<{ hubId: string; mappingId: string }> };

// PATCH: Update visibility arrays on a team mapping
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { hubId, mappingId } = await params;

    const body = (await request.json()) as {
      visible_project_ids?: string[];
      visible_initiative_ids?: string[];
      visible_label_ids?: string[];
      hidden_label_ids?: string[];
      auto_include_projects?: boolean;
      overview_only_project_ids?: string[];
      task_priority_project_ids?: string[];
      include_unassigned_issues?: boolean;
      is_active?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if (body.auto_include_projects !== undefined) {
      updates.auto_include_projects = body.auto_include_projects;
      // When enabling auto-include, clear visible_project_ids to avoid stale data
      if (body.auto_include_projects) {
        updates.visible_project_ids = [];
      }
    }
    if (body.visible_project_ids !== undefined && body.auto_include_projects !== true) {
      updates.visible_project_ids = body.visible_project_ids;
    }
    if (body.visible_initiative_ids !== undefined) {
      updates.visible_initiative_ids = body.visible_initiative_ids;
    }
    if (body.visible_label_ids !== undefined) {
      updates.visible_label_ids = body.visible_label_ids;
    }
    if (body.hidden_label_ids !== undefined) {
      updates.hidden_label_ids = body.hidden_label_ids;
    }
    // Mutual exclusion: overview-only and task-priority cannot overlap.
    // Load current mapping once if either field needs cross-validation.
    const needsCrossValidation =
      (body.overview_only_project_ids !== undefined && body.task_priority_project_ids === undefined) ||
      (body.task_priority_project_ids !== undefined && body.overview_only_project_ids === undefined);

    type MappingFields = { overview_only_project_ids: string[]; task_priority_project_ids: string[] };
    let existingMapping: MappingFields | null = null;
    if (needsCrossValidation) {
      const { data, error: fetchError } = await supabaseAdmin
        .from("hub_team_mappings")
        .select("overview_only_project_ids, task_priority_project_ids")
        .eq("id", mappingId)
        .eq("hub_id", hubId)
        .single();
      if (fetchError || !data) {
        return NextResponse.json(
          { error: "Team mapping not found" },
          { status: 404 }
        );
      }
      existingMapping = {
        overview_only_project_ids: (data.overview_only_project_ids ?? []) as string[],
        task_priority_project_ids: (data.task_priority_project_ids ?? []) as string[],
      };
    }

    if (body.overview_only_project_ids !== undefined) {
      updates.overview_only_project_ids = body.overview_only_project_ids;
      // Auto-clean task priority when overview-only changes (only if not explicitly set)
      if (body.task_priority_project_ids === undefined) {
        const currentTaskPriorityIds = existingMapping!.task_priority_project_ids ?? [];
        const overviewSet = new Set(body.overview_only_project_ids);
        const filtered = currentTaskPriorityIds.filter((id) => !overviewSet.has(id));
        if (filtered.length !== currentTaskPriorityIds.length) {
          updates.task_priority_project_ids = filtered;
        }
      }
    }
    if (body.task_priority_project_ids !== undefined) {
      const effectiveOverview = new Set(
        body.overview_only_project_ids ?? existingMapping!.overview_only_project_ids ?? []
      );
      updates.task_priority_project_ids =
        body.task_priority_project_ids.filter((id) => !effectiveOverview.has(id));
    }
    if (body.include_unassigned_issues !== undefined) {
      updates.include_unassigned_issues = body.include_unassigned_issues;
    }
    if (body.is_active !== undefined) {
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data: mapping, error } = await supabaseAdmin
      .from("hub_team_mappings")
      .update(updates)
      .eq("id", mappingId)
      .eq("hub_id", hubId)
      .select()
      .single();

    if (error || !mapping) {
      return NextResponse.json(
        { error: "Team mapping not found" },
        { status: 404 }
      );
    }

    invalidateTeamHubCache();

    return NextResponse.json(mapping);
  } catch (error) {
    console.error(
      "PATCH /api/admin/hubs/[hubId]/teams/[mappingId] error:",
      error
    );
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove a team mapping from a hub
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { hubId, mappingId } = await params;

    const { error, count } = await supabaseAdmin
      .from("hub_team_mappings")
      .delete({ count: "exact" })
      .eq("id", mappingId)
      .eq("hub_id", hubId);

    if (error) {
      console.error(
        "DELETE /api/admin/hubs/[hubId]/teams/[mappingId] error:",
        error
      );
      return NextResponse.json(
        { error: "Failed to delete team mapping" },
        { status: 500 }
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { error: "Team mapping not found" },
        { status: 404 }
      );
    }

    invalidateTeamHubCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "DELETE /api/admin/hubs/[hubId]/teams/[mappingId] error:",
      error
    );
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
