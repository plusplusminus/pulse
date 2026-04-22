import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkspaceToken } from "@/lib/workspace";

// GET: List projects for a specific team — from synced data, or Linear API if no sync exists
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { teamId } = await params;

    // Try synced data first
    const { data: projects, error } = await supabaseAdmin
      .from("synced_projects")
      .select("*")
      .eq("user_id", "workspace")
      .order("name", { ascending: true });

    if (error) {
      console.error(
        "GET /api/admin/linear/teams/[teamId]/projects error:",
        error
      );
      return NextResponse.json(
        { error: "Failed to fetch projects" },
        { status: 500 }
      );
    }

    // Filter projects that belong to the given team.
    // Two shapes exist in synced_projects.data:
    //   - Initial-sync / reconcile: data.teams = [{id, name, key}, ...]
    //   - Webhook-created rows:     data.teamIds = ["<uuid>", ...]
    // We check both so newly-created projects appear before reconcile runs.
    const filtered = (projects ?? []).filter((p) => {
      const data = p.data as Record<string, unknown>;
      if (Array.isArray(data?.teams)) {
        return (data.teams as Array<{ id?: string }>).some(
          (t) => t.id === teamId
        );
      }
      if (Array.isArray(data?.teamIds)) {
        return (data.teamIds as string[]).includes(teamId);
      }
      if (data?.team && typeof data.team === "object") {
        return (data.team as { id?: string }).id === teamId;
      }
      return false;
    });

    // If we have synced projects for this team, return them
    if (filtered.length > 0) {
      return NextResponse.json(filtered);
    }

    // No synced projects — fetch directly from Linear API
    let token: string;
    try {
      token = await getWorkspaceToken();
    } catch {
      return NextResponse.json([]);
    }

    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({
        query: `query($teamId: String!) {
          team(id: $teamId) {
            projects {
              nodes {
                id
                name
                color
                icon
                state
                teams {
                  nodes { id }
                }
              }
            }
          }
        }`,
        variables: { teamId },
      }),
    });

    const result = (await res.json()) as {
      data?: {
        team?: {
          projects: {
            nodes: Array<{
              id: string;
              name: string;
              color?: string;
              icon?: string;
              state?: string;
            }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (result.errors || !result.data?.team) {
      return NextResponse.json([]);
    }

    const liveProjects = result.data.team.projects.nodes.map((p) => ({
      linear_id: p.id,
      name: p.name,
      status_name: p.state ?? null,
      data: { id: p.id, name: p.name, color: p.color, icon: p.icon, status: { name: p.state } },
    }));

    return NextResponse.json(liveProjects);
  } catch (error) {
    console.error(
      "GET /api/admin/linear/teams/[teamId]/projects error:",
      error
    );
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
