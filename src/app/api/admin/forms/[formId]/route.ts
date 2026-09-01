import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchFormWithFields } from "@/lib/form-read";
import { fetchAllowedTeamLabelIds } from "@/lib/linear-label-validation";

/**
 * GET: Get form with all fields.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { formId } = await params;
    const form = await fetchFormWithFields(formId);

    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    return NextResponse.json(form);
  } catch (error) {
    console.error("GET /api/admin/forms/[formId] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Update form metadata and routing.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { formId } = await params;

    type FieldPayload = {
      id?: string;
      field_key: string;
      field_type: string;
      label: string;
      description?: string | null;
      placeholder?: string | null;
      is_required?: boolean;
      is_removable?: boolean;
      is_hidden?: boolean;
      linear_field?: string | null;
      options?: Array<{ value: string; label: string }>;
      default_value?: string | null;
      display_order?: number;
    };

    const body = (await request.json()) as {
      name?: string;
      type?: string;
      description?: string;
      is_active?: boolean;
      button_label?: string | null;
      button_icon?: string | null;
      target_team_id?: string | null;
      target_project_id?: string | null;
      target_cycle_id?: string | null;
      target_label_ids?: string[];
      target_priority?: number | null;
      confirmation_message?: string;
      error_message?: string;
      fields?: FieldPayload[];
    };

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      if (!body.name?.trim()) {
        return NextResponse.json(
          { error: "name must be non-empty" },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if (body.type !== undefined) {
      if (!["bug", "feature", "custom"].includes(body.type)) {
        return NextResponse.json(
          { error: "type must be bug, feature, or custom" },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }
    if (body.description !== undefined)
      updates.description = body.description?.trim() || null;
    if (body.is_active !== undefined) updates.is_active = body.is_active;
    if (body.button_label !== undefined)
      updates.button_label = body.button_label?.trim() || null;
    if (body.button_icon !== undefined)
      updates.button_icon = body.button_icon || null;
    if (body.target_team_id !== undefined)
      updates.target_team_id = body.target_team_id || null;
    if (body.target_project_id !== undefined)
      updates.target_project_id = body.target_project_id || null;
    if (body.target_cycle_id !== undefined)
      updates.target_cycle_id = body.target_cycle_id || null;
    if (body.target_label_ids !== undefined) {
      // Validate label IDs against Linear before persisting. Use the team from
      // this same PATCH if provided, otherwise the form's existing team.
      // Skip when the form is team-less (no team context to validate against).
      if (body.target_label_ids.length > 0) {
        let teamForValidation = body.target_team_id ?? null;
        if (teamForValidation === null && body.target_team_id === undefined) {
          const { data: existing } = await supabaseAdmin
            .from("form_templates")
            .select("target_team_id")
            .eq("id", formId)
            .maybeSingle();
          teamForValidation = existing?.target_team_id ?? null;
        }
        if (teamForValidation) {
          const allowed = await fetchAllowedTeamLabelIds(teamForValidation);
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
      updates.target_label_ids = body.target_label_ids;
    }
    if (body.target_priority !== undefined)
      updates.target_priority = body.target_priority;
    if (body.confirmation_message !== undefined)
      updates.confirmation_message = body.confirmation_message.trim();
    if (body.error_message !== undefined)
      updates.error_message = body.error_message.trim();

    const { data: form, error } = await supabaseAdmin
      .from("form_templates")
      .update(updates)
      .eq("id", formId)
      .select()
      .single();

    if (error || !form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    // Sync fields if provided (bulk upsert + delete removed)
    if (body.fields) {
      const incomingIds = body.fields
        .filter((f) => f.id && !f.id.startsWith("new-"))
        .map((f) => f.id!);

      // Delete fields not in the incoming list (except non-removable ones)
      if (incomingIds.length > 0) {
        await supabaseAdmin
          .from("form_fields")
          .delete()
          .eq("form_id", formId)
          .eq("is_removable", true)
          .not("id", "in", `(${incomingIds.join(",")})`);
      }

      // Upsert each field
      for (const f of body.fields) {
        const fieldData = {
          form_id: formId,
          field_key: f.field_key,
          field_type: f.field_type,
          label: f.label,
          description: f.description ?? null,
          placeholder: f.placeholder ?? null,
          is_required: f.is_required ?? false,
          is_removable: f.is_removable ?? true,
          is_hidden: f.is_hidden ?? false,
          linear_field: f.linear_field ?? null,
          options: f.options ?? [],
          default_value: f.default_value ?? null,
          display_order: f.display_order ?? 0,
          updated_at: new Date().toISOString(),
        };

        if (f.id && !f.id.startsWith("new-")) {
          // Update existing
          await supabaseAdmin
            .from("form_fields")
            .update(fieldData)
            .eq("id", f.id)
            .eq("form_id", formId);
        } else {
          // Insert new
          await supabaseAdmin.from("form_fields").insert(fieldData);
        }
      }
    }

    return NextResponse.json(form);
  } catch (error) {
    console.error("PATCH /api/admin/forms/[formId] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Soft delete (set is_active=false).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { formId } = await params;

    const { error } = await supabaseAdmin
      .from("form_templates")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", formId);

    if (error) {
      throw new Error(`Failed to deactivate form: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/forms/[formId] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
