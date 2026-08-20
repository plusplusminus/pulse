import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { fetchFormWithFields, fetchHubFormConfig } from "@/lib/form-read";

/**
 * GET: Get form with visible fields for rendering.
 * Hidden fields are excluded from the response (used server-side only).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string; formId: string }> }
) {
  try {
    const { hubId, formId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const form = await fetchFormWithFields(formId);
    if (!form || !form.is_active) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    // Fetch hub config for message overrides
    const hubConfig = await fetchHubFormConfig(hubId, formId);

    // Filter out hidden fields — those are only used server-side during submission
    const visibleFields = form.fields.filter((f) => !f.is_hidden);

    return NextResponse.json({
      id: form.id,
      name: form.name,
      type: form.type,
      description: form.description,
      confirmation_message: hubConfig?.confirmation_message ?? form.confirmation_message,
      error_message: form.error_message,
      fields: visibleFields.map((f) => ({
        id: f.id,
        field_key: f.field_key,
        field_type: f.field_type,
        linear_field: f.linear_field,
        label: f.label,
        description: f.description,
        placeholder: f.placeholder,
        is_required: f.is_required,
        options: f.options,
        default_value: f.default_value,
        display_order: f.display_order,
      })),
    });
  } catch (error) {
    console.error("GET /api/hub/[hubId]/forms/[formId] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
