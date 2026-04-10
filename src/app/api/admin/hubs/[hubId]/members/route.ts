import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { WorkOS } from "@workos-inc/node";
import { supabaseAdmin, type HubMemberRole } from "@/lib/supabase";

const workos = new WorkOS(process.env.WORKOS_API_KEY!);

// POST: Invite a user to a hub by email
export async function POST(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;
    const { hubId } = await params;

    const body = (await request.json()) as {
      email?: string;
      role?: HubMemberRole;
    };

    if (!body.email || typeof body.email !== "string") {
      return NextResponse.json(
        { error: "email is required" },
        { status: 400 }
      );
    }

    const email = body.email.trim().toLowerCase();
    const explicitRole = body.role === "view_only" || body.role === "default" ? body.role : undefined;
    const role: HubMemberRole = explicitRole ?? "default";

    // Verify hub exists and has a WorkOS org
    const { data: hub } = await supabaseAdmin
      .from("client_hubs")
      .select("id, name, workos_org_id, is_active")
      .eq("id", hubId)
      .single();

    if (!hub || !hub.is_active) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }

    if (!hub.workos_org_id) {
      return NextResponse.json(
        { error: "Hub has no authentication organization" },
        { status: 400 }
      );
    }

    // Check if already a member by email
    const { data: existing } = await supabaseAdmin
      .from("hub_members")
      .select("*")
      .eq("hub_id", hubId)
      .eq("email", email)
      .single();

    // If member already exists and has logged in, nothing to do
    if (existing?.user_id) {
      return NextResponse.json(existing);
    }

    // Send (or re-send) WorkOS invitation
    let invitationId: string | null = null;
    try {
      // Revoke any previous pending invitation before re-sending
      if (existing?.workos_invitation_id) {
        try {
          await workos.userManagement.revokeInvitation(
            existing.workos_invitation_id
          );
        } catch {
          // Non-fatal — invitation may have already expired
        }
      }

      const invitation = await workos.userManagement.sendInvitation({
        email,
        organizationId: hub.workos_org_id,
        inviterUserId: user.id,
        expiresInDays: 30,
      });
      invitationId = invitation.id;
    } catch (error) {
      console.error("WorkOS sendInvitation error:", error);
      return NextResponse.json(
        { error: "Failed to send invitation" },
        { status: 500 }
      );
    }

    // Update existing member row or create a new one
    if (existing) {
      const { data: updated, error } = await supabaseAdmin
        .from("hub_members")
        .update({
          workos_invitation_id: invitationId,
          ...(explicitRole ? { role: explicitRole } : {}),
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) {
        console.error("POST /api/admin/hubs/[hubId]/members update error:", error);
        return NextResponse.json(
          { error: "Failed to update member record" },
          { status: 500 }
        );
      }

      return NextResponse.json(updated);
    }

    const { data: member, error } = await supabaseAdmin
      .from("hub_members")
      .insert({
        hub_id: hubId,
        email,
        role,
        invited_by: user.id,
        workos_invitation_id: invitationId,
      })
      .select()
      .single();

    if (error) {
      console.error("POST /api/admin/hubs/[hubId]/members insert error:", error);
      return NextResponse.json(
        { error: "Failed to create member record" },
        { status: 500 }
      );
    }

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/hubs/[hubId]/members error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: List all members of a hub
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

    const { data: members, error } = await supabaseAdmin
      .from("hub_members")
      .select("*")
      .eq("hub_id", hubId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET /api/admin/hubs/[hubId]/members error:", error);
      return NextResponse.json(
        { error: "Failed to fetch members" },
        { status: 500 }
      );
    }

    // Enrich with status
    const enriched = (members ?? []).map((m) => ({
      ...m,
      status: m.user_id ? "active" : "invited",
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("GET /api/admin/hubs/[hubId]/members error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
