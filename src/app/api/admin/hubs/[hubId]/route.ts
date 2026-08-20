import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  updateHubOrganization,
  deleteHubOrganization,
} from "@/lib/workos-org";

// GET: Get hub with full team mappings and members
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

    const { data: hub, error } = await supabaseAdmin
      .from("client_hubs")
      .select("*, hub_team_mappings(*), hub_members(*)")
      .eq("id", hubId)
      .single();

    if (error || !hub) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }

    return NextResponse.json(hub);
  } catch (error) {
    console.error("GET /api/admin/hubs/[hubId] error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: Update hub metadata
export async function PATCH(
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
      name?: string;
      is_active?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { error: "name must be a non-empty string" },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json(
          { error: "is_active must be a boolean" },
          { status: 400 }
        );
      }
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data: hub, error } = await supabaseAdmin
      .from("client_hubs")
      .update(updates)
      .eq("id", hubId)
      .select()
      .single();

    if (error || !hub) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }

    // Sync name change to WorkOS Organization
    if (updates.name && hub.workos_org_id) {
      try {
        await updateHubOrganization(hub.workos_org_id, updates.name as string);
      } catch (err) {
        console.error("Failed to update WorkOS org name:", err);
        // Non-fatal — hub update succeeded, WorkOS sync can be retried
      }
    }

    return NextResponse.json(hub);
  } catch (error) {
    console.error("PATCH /api/admin/hubs/[hubId] error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Delete hub (cascades via ON DELETE CASCADE)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { hubId } = await params;

    // Fetch the hub first to get WorkOS org ID for cleanup
    const { data: hub } = await supabaseAdmin
      .from("client_hubs")
      .select("workos_org_id")
      .eq("id", hubId)
      .single();

    if (!hub) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from("client_hubs")
      .delete()
      .eq("id", hubId);

    if (error) {
      console.error("DELETE /api/admin/hubs/[hubId] error:", error);
      return NextResponse.json(
        { error: "Failed to delete hub" },
        { status: 500 }
      );
    }

    // Clean up WorkOS Organization
    if (hub.workos_org_id) {
      await deleteHubOrganization(hub.workos_org_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/hubs/[hubId] error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
