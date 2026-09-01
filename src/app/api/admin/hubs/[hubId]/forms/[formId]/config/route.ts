import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllowedTeamLabelIds } from "@/lib/linear-label-validation";

async function resolveTeamIdForValidation(
  hubId: string,
  bodyTeamId: string | null | undefined
): Promise<string | null> {
  if (bodyTeamId) return bodyTeamId;
  const { data } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("linear_team_id")
    .eq("hub_id", hubId)
    .eq("is_active", true)
    .limit(1)
    .single();
  return data?.linear_team_id ?? null;
}

/**
 * PATCH: Update or create hub override for a global form.
 */
export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ hubId: string; formId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { hubId, formId } = await params;

    const body = (await request.json()) as {
      is_enabled?: boolean;
      target_team_id?: string | null;
      target_project_id?: string | null;
      target_cycle_id?: string | null;
      target_label_ids?: string[] | null;
      target_priority?: number | null;
      confirmation_message?: string | null;
    };

    // Validate target_label_ids against Linear before persisting so we don't
    // store stale references that silently break submissions later. Only
    // runs when the caller is actually setting label IDs. Lookup failures
    // are non-fatal — we'd rather accept the save than block an admin
    // because Linear is briefly unreachable.
    if (Array.isArray(body.target_label_ids) && body.target_label_ids.length > 0) {
      const teamId = await resolveTeamIdForValidation(hubId, body.target_team_id);
      if (teamId) {
        const allowed = await fetchAllowedTeamLabelIds(teamId);
        if (allowed) {
          const invalid = body.target_label_ids.filter((id) => !allowed.has(id));
          if (invalid.length > 0) {
            return NextResponse.json(
              {
                error: `These label IDs no longer exist in Linear for the selected team: ${invalid.join(", ")}`,
                invalidLabelIds: invalid,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    // Upsert the hub form config
    const configData: Record<string, unknown> = {
      hub_id: hubId,
      form_id: formId,
      updated_at: new Date().toISOString(),
    };

    if (body.is_enabled !== undefined) configData.is_enabled = body.is_enabled;
    if (body.target_team_id !== undefined)
      configData.target_team_id = body.target_team_id;
    if (body.target_project_id !== undefined)
      configData.target_project_id = body.target_project_id;
    if (body.target_cycle_id !== undefined)
      configData.target_cycle_id = body.target_cycle_id;
    if (body.target_label_ids !== undefined)
      configData.target_label_ids = body.target_label_ids;
    if (body.target_priority !== undefined)
      configData.target_priority = body.target_priority;
    if (body.confirmation_message !== undefined)
      configData.confirmation_message = body.confirmation_message;

    const { data: existing } = await supabaseAdmin
      .from("hub_form_config")
      .select("id")
      .eq("hub_id", hubId)
      .eq("form_id", formId)
      .maybeSingle();

    let config;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("hub_form_config")
        .update(configData)
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update config: ${error.message}`);
      config = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("hub_form_config")
        .insert(configData)
        .select()
        .single();

      if (error) throw new Error(`Failed to create config: ${error.message}`);
      config = data;
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error(
      "PATCH /api/admin/hubs/[hubId]/forms/[formId]/config error:",
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
