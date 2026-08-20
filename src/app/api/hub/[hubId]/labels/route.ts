import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkspaceToken } from "@/lib/workspace";

/**
 * GET: Fetch labels for the hub's team(s) from Linear.
 * Returns workspace + team labels for the first active team mapping.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    // Get the hub's first active team mapping
    const { data: mapping } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("linear_team_id")
      .eq("hub_id", hubId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!mapping?.linear_team_id) {
      return NextResponse.json([]);
    }

    const token = await getWorkspaceToken();

    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({
        query: `
          query TeamLabels($teamId: String!) {
            team(id: $teamId) {
              labels(first: 250) {
                nodes {
                  id
                  name
                  color
                  parent { id name }
                }
              }
            }
          }
        `,
        variables: { teamId: mapping.linear_team_id },
      }),
    });

    const result = (await res.json()) as {
      data?: {
        team?: {
          labels: {
            nodes: Array<{
              id: string;
              name: string;
              color: string;
              parent?: { id: string; name: string } | null;
            }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (result.errors || !result.data?.team) {
      console.error("Hub labels query error:", result.errors);
      return NextResponse.json(
        { error: "Failed to fetch labels" },
        { status: 502 }
      );
    }

    return NextResponse.json(result.data.team.labels.nodes);
  } catch (error) {
    console.error("GET /api/hub/[hubId]/labels error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
