import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import {
  validateOAuthCredentials,
  setOAuthCredentials,
  clearOAuthCredentials,
  getOAuthCredentials,
  LinearOAuthError,
} from "@/lib/linear-oauth";
import { getWorkspaceSetting, setWorkspaceSetting } from "@/lib/workspace";

// POST: Validate and store OAuth app credentials
export async function POST(request: Request) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    let body: { clientId?: string; clientSecret?: string };
    try {
      body = (await request.json()) as { clientId?: string; clientSecret?: string };
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400 }
      );
    }

    if (!body.clientId || !body.clientSecret) {
      return NextResponse.json(
        { error: "Both clientId and clientSecret are required" },
        { status: 400 }
      );
    }

    // Validate by acquiring a test token
    const { appName } = await validateOAuthCredentials(
      body.clientId,
      body.clientSecret
    );

    // Store credentials + metadata. If metadata writes fail after credentials
    // are stored, roll back to avoid partial state.
    await setOAuthCredentials(body.clientId, body.clientSecret, user.id);
    try {
      await setWorkspaceSetting("linear_oauth_app_name", appName, user.id);
      await setWorkspaceSetting(
        "linear_oauth_connected_at",
        new Date().toISOString(),
        user.id
      );
    } catch (metadataError) {
      console.error("Metadata write failed, rolling back credentials:", metadataError);
      await clearOAuthCredentials();
      throw new Error("Failed to store OAuth app metadata");
    }

    return NextResponse.json({
      success: true,
      app: { name: appName },
    });
  } catch (error) {
    if (error instanceof LinearOAuthError) {
      console.error("POST /api/admin/workspace/oauth validation error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST /api/admin/workspace/oauth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET: Check OAuth app configuration status
export async function GET() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const credentials = await getOAuthCredentials();
    if (!credentials) {
      return NextResponse.json({ configured: false });
    }

    const appName = await getWorkspaceSetting("linear_oauth_app_name");
    const connectedAt = await getWorkspaceSetting("linear_oauth_connected_at");

    return NextResponse.json({
      configured: true,
      app: { name: appName },
      clientId: credentials.clientId,
      connectedAt,
    });
  } catch (error) {
    console.error("GET /api/admin/workspace/oauth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: Remove OAuth app credentials
export async function DELETE() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    await clearOAuthCredentials();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/workspace/oauth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
