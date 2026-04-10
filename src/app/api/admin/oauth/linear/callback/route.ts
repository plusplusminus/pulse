import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withAdminAuth } from "@/lib/admin-auth";
import { getOAuthCredentials } from "@/lib/linear-oauth";
import { storeAdminLinearToken } from "@/lib/admin-linear-oauth";

const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const SETTINGS_PATH = "/admin/settings/linear";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  function errorRedirect(message: string) {
    const target = new URL(SETTINGS_PATH, origin);
    target.searchParams.set("linear_error", message);
    return NextResponse.redirect(target.toString());
  }

  function clearStateCookie(response: NextResponse) {
    response.cookies.set("linear_oauth_state", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return clearStateCookie(errorRedirect("Authentication required"));
    }
    const { user } = auth;

    // Check for OAuth error response from Linear
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      const description = url.searchParams.get("error_description") || oauthError;
      console.error("Linear OAuth error response:", oauthError, description);
      return clearStateCookie(errorRedirect(description));
    }

    // Validate required params
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");

    if (!state || !code) {
      return clearStateCookie(errorRedirect("Missing state or code parameter"));
    }

    // Validate state against cookie
    const cookieStore = await cookies();
    const storedState = cookieStore.get("linear_oauth_state")?.value;

    if (!storedState || storedState !== state) {
      return clearStateCookie(errorRedirect("Invalid state parameter. Please try again."));
    }

    // Get OAuth credentials
    const credentials = await getOAuthCredentials();
    if (!credentials) {
      return clearStateCookie(errorRedirect("OAuth app credentials not configured"));
    }

    const redirectUri = `${origin}/api/admin/oauth/linear/callback`;

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch(LINEAR_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error("Linear token exchange failed:", tokenRes.status, text);
      return clearStateCookie(errorRedirect("Failed to exchange authorization code"));
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenJson.error) {
      console.error("Linear token error:", tokenJson.error, tokenJson.error_description);
      return clearStateCookie(
        errorRedirect(tokenJson.error_description || tokenJson.error)
      );
    }

    // Query Linear for the user's identity
    const viewerRes = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
      body: JSON.stringify({
        query: `query { viewer { id name email } }`,
      }),
    });

    let linearUserId: string | undefined;
    let linearUserName: string | undefined;
    let linearUserEmail: string | undefined;

    if (viewerRes.ok) {
      const viewerJson = (await viewerRes.json()) as {
        data?: { viewer: { id: string; name: string; email: string } };
        errors?: Array<{ message: string }>;
      };

      if (viewerJson.data?.viewer) {
        linearUserId = viewerJson.data.viewer.id;
        linearUserName = viewerJson.data.viewer.name;
        linearUserEmail = viewerJson.data.viewer.email;
      } else {
        console.warn(
          "Linear viewer query returned no data:",
          viewerJson.errors?.map((e) => e.message).join(", ")
        );
      }
    } else {
      console.warn("Linear viewer query failed:", viewerRes.status);
    }

    // Store the token
    await storeAdminLinearToken({
      userId: user.id,
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token ?? null,
      expiresIn: tokenJson.expires_in,
      linearUserId,
      linearUserName,
      linearUserEmail,
    });

    // Success redirect
    const successUrl = new URL(SETTINGS_PATH, origin);
    successUrl.searchParams.set("linear_connected", "true");
    return clearStateCookie(NextResponse.redirect(successUrl.toString()));
  } catch (error) {
    console.error("GET /api/admin/oauth/linear/callback error:", error);
    return clearStateCookie(errorRedirect("An unexpected error occurred"));
  }
}
