import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { getOAuthCredentials } from "@/lib/linear-oauth";

export async function GET(request: Request) {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const credentials = await getOAuthCredentials();
    if (!credentials) {
      return NextResponse.json(
        { error: "OAuth app credentials not configured. Set up workspace OAuth first." },
        { status: 400 }
      );
    }

    const state = crypto.randomUUID();

    const url = new URL(request.url);
    const redirectUri = `${url.origin}/api/admin/oauth/linear/callback`;

    const authorizeUrl = new URL("https://linear.app/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", credentials.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "read,write");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "consent");

    const response = NextResponse.redirect(authorizeUrl.toString());

    response.cookies.set("linear_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 minutes
    });

    return response;
  } catch (error) {
    console.error("GET /api/admin/oauth/linear/authorize error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
