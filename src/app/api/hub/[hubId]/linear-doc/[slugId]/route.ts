import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import { getWorkspaceToken } from "@/lib/workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string; slugId: string }> }
) {
  try {
    const { hubId, slugId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const token = await getWorkspaceToken();

    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token.trim(),
      },
      body: JSON.stringify({
        query: `query GetDocument($slugId: String!) {
          document(id: $slugId) {
            id
            title
            content
            icon
            color
            updatedAt
            creator { name }
          }
        }`,
        variables: { slugId },
      }),
    });

    if (!res.ok) {
      console.error(`Linear API returned ${res.status} for document ${slugId}`);
      return NextResponse.json(
        { error: "Failed to fetch document from Linear" },
        { status: 502 }
      );
    }

    const json = (await res.json()) as { data?: { document?: Record<string, unknown> } };
    const doc = json?.data?.document;

    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        title: doc.title,
        content: doc.content,
        icon: doc.icon,
        color: doc.color,
        updatedAt: doc.updatedAt,
        creatorName: (doc.creator as { name?: string } | undefined)?.name ?? null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=300",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("No Linear API token configured")) {
      return NextResponse.json(
        { error: "Workspace Linear token not configured" },
        { status: 503 }
      );
    }
    console.error("Linear doc proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
