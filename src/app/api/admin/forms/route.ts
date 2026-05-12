import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllGlobalForms } from "@/lib/form-read";
import { fetchAllowedTeamLabelIds } from "@/lib/linear-label-validation";

/**
 * GET: List all global forms (active and inactive).
 */
export async function GET() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const forms = await fetchAllGlobalForms();

    // Fetch field counts
    const formIds = forms.map((f) => f.id);
    const fieldCounts = new Map<string, number>();

    if (formIds.length > 0) {
      const { data: fields } = await supabaseAdmin
        .from("form_fields")
        .select("form_id")
        .in("form_id", formIds);

      for (const f of fields ?? []) {
        fieldCounts.set(f.form_id, (fieldCounts.get(f.form_id) ?? 0) + 1);
      }
    }

    const result = forms.map((f) => ({
      ...f,
      field_count: fieldCounts.get(f.id) ?? 0,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/admin/forms error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST: Create a new global form template.
 */
export async function POST(request: Request) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    type FieldPayload = {
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
      type?: string;
      name?: string;
      description?: string;
      button_label?: string;
      button_icon?: string;
      target_team_id?: string;
      target_project_id?: string;
      target_cycle_id?: string;
      target_label_ids?: string[];
      target_priority?: number;
      confirmation_message?: string;
      error_message?: string;
      fields?: FieldPayload[];
    };

    if (!body.name?.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Same save-time label validation as the PATCH route — keep stale IDs
    // out of new form templates.
    if (
      Array.isArray(body.target_label_ids) &&
      body.target_label_ids.length > 0 &&
      body.target_team_id
    ) {
      const allowed = await fetchAllowedTeamLabelIds(body.target_team_id);
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

    if (!body.type || !["bug", "feature", "custom"].includes(body.type)) {
      return NextResponse.json(
        { error: "type must be bug, feature, or custom" },
        { status: 400 }
      );
    }

    // Get max display_order
    const { data: maxOrder } = await supabaseAdmin
      .from("form_templates")
      .select("display_order")
      .is("hub_id", null)
      .order("display_order", { ascending: false })
      .limit(1)
      .single();

    const displayOrder = (maxOrder?.display_order ?? -1) + 1;

    const { data: form, error } = await supabaseAdmin
      .from("form_templates")
      .insert({
        hub_id: null,
        type: body.type,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        button_label: body.button_label?.trim() || null,
        button_icon: body.button_icon || null,
        target_team_id: body.target_team_id || null,
        target_project_id: body.target_project_id || null,
        target_cycle_id: body.target_cycle_id || null,
        target_label_ids: body.target_label_ids ?? [],
        target_priority: body.target_priority ?? null,
        confirmation_message:
          body.confirmation_message?.trim() ||
          "Your request has been submitted successfully.",
        error_message:
          body.error_message?.trim() ||
          "Something went wrong submitting your request. Please try again.",
        display_order: displayOrder,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create form: ${error.message}`);
    }

    // Insert fields: use provided fields or create default title/description
    if (body.fields && body.fields.length > 0) {
      const fieldRows = body.fields.map((f, i) => ({
        form_id: form.id,
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
        display_order: f.display_order ?? i,
      }));
      await supabaseAdmin.from("form_fields").insert(fieldRows);
    } else {
      await supabaseAdmin.from("form_fields").insert([
        {
          form_id: form.id,
          field_key: "title",
          field_type: "text",
          label: "Title",
          placeholder: "Brief summary",
          is_required: true,
          is_removable: false,
          linear_field: "title",
          display_order: 0,
        },
        {
          form_id: form.id,
          field_key: "description",
          field_type: "textarea",
          label: "Description",
          placeholder: "Provide details...",
          is_required: true,
          is_removable: false,
          linear_field: "description",
          display_order: 1,
        },
      ]);
    }

    return NextResponse.json(form, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/forms error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
