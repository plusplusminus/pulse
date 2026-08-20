import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import { canActivate, invalidOrigins, normaliseOrigins } from "@/lib/widget-origin";
import { isOutputDetailLevel } from "@/lib/widget-picks";

async function getConfigHubId(configId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("widget_configs")
    .select("hub_id")
    .eq("id", configId)
    .single();
  return data?.hub_id ?? null;
}

async function getConfigState(
  configId: string
): Promise<{ is_active: boolean; allowed_origins: string[] } | null> {
  const { data } = await supabaseAdmin
    .from("widget_configs")
    .select("is_active, allowed_origins")
    .eq("id", configId)
    .single();
  return data ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  try {
    const { configId } = await params;

    const hubId = await getConfigHubId(configId);
    if (!hubId) {
      return NextResponse.json(
        { error: "Widget config not found" },
        { status: 404 }
      );
    }

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const body = await request.json();
    const { name, is_active, allowed_origins, config, output_detail_level } = body as {
      name?: string;
      is_active?: boolean;
      allowed_origins?: string[];
      config?: Record<string, unknown>;
      output_detail_level?: string;
    };

    if (output_detail_level !== undefined && !isOutputDetailLevel(output_detail_level)) {
      return NextResponse.json(
        { error: "invalid_output_detail_level", message: "Must be compact, standard, detailed or forensic" },
        { status: 400 }
      );
    }

    if (allowed_origins !== undefined) {
      const bad = invalidOrigins(allowed_origins);
      if (bad.length > 0) {
        return NextResponse.json(
          { error: "invalid_origin", message: `Not a valid origin: ${bad.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Activation requires a non-empty allowlist (evaluate the resulting state).
    const current = await getConfigState(configId);
    const resultingOrigins =
      allowed_origins !== undefined ? normaliseOrigins(allowed_origins) : normaliseOrigins(current?.allowed_origins);
    const resultingActive = is_active !== undefined ? is_active : (current?.is_active ?? false);
    if (resultingActive && !canActivate(resultingOrigins)) {
      return NextResponse.json(
        {
          error: "origins_required",
          message: "Add at least one allowed origin before activating this site key",
        },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = name;
    if (is_active !== undefined) updates.is_active = is_active;
    if (allowed_origins !== undefined) updates.allowed_origins = resultingOrigins;
    if (config !== undefined) updates.config = config;
    if (output_detail_level !== undefined) updates.output_detail_level = output_detail_level;

    const { data, error } = await supabaseAdmin
      .from("widget_configs")
      .update(updates)
      .eq("id", configId)
      .select(
        "id, hub_id, api_key_prefix, name, is_active, config, allowed_origins, output_detail_level, created_at, updated_at"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Failed to update widget config" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("PATCH /api/widget/config/[configId] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  try {
    const { configId } = await params;

    const hubId = await getConfigHubId(configId);
    if (!hubId) {
      return NextResponse.json(
        { error: "Widget config not found" },
        { status: 404 }
      );
    }

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { error } = await supabaseAdmin
      .from("widget_configs")
      .delete()
      .eq("id", configId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete widget config" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/widget/config/[configId] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
