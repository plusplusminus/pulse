import { supabaseAdmin } from "@/lib/supabase";
import { encryptToken, decryptToken } from "@/lib/encryption";
import { getOAuthCredentials } from "@/lib/linear-oauth";

const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const TOKEN_EXPIRY_BUFFER_MS = 60_000; // Refresh 60s before actual expiry

// In-memory lock to prevent concurrent refresh attempts per user
const refreshLocks = new Map<string, Promise<string | null>>();

type AdminLinearToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  linearUserId: string | null;
  linearUserName: string | null;
  linearUserEmail: string | null;
  connectedAt: Date;
};

type StoreTokenParams = {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number; // seconds
  linearUserId?: string;
  linearUserName?: string;
  linearUserEmail?: string;
};

/**
 * Get a PPM admin's decrypted Linear OAuth token.
 * Returns null if no token exists.
 * If expired but has a refresh_token, still returns it (caller handles refresh).
 */
export async function getAdminLinearToken(
  userId: string
): Promise<AdminLinearToken | null> {
  const { data, error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    // PGRST116 = row not found from .single()
    if (error.code === "PGRST116") return null;
    throw new Error(
      `Failed to read admin Linear token: ${error.message}`
    );
  }

  if (!data) return null;

  const accessToken = decryptToken(data.access_token);
  const refreshToken = data.refresh_token
    ? decryptToken(data.refresh_token)
    : null;
  const expiresAt = new Date(data.expires_at);

  // If expired (or within buffer) and has a refresh token, auto-refresh
  const isExpired =
    expiresAt.getTime() < Date.now() + TOKEN_EXPIRY_BUFFER_MS;

  if (isExpired && refreshToken) {
    const newAccessToken = await refreshAdminLinearToken(userId);
    if (!newAccessToken) {
      // Refresh failed — token was revoked/cleaned up
      return null;
    }
    return {
      accessToken: newAccessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // approximate, actual stored in DB
      linearUserId: data.linear_user_id,
      linearUserName: data.linear_user_name,
      linearUserEmail: data.linear_user_email,
      connectedAt: new Date(data.connected_at),
    };
  }

  // If expired and no refresh token, treat as disconnected
  if (isExpired && !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    linearUserId: data.linear_user_id,
    linearUserName: data.linear_user_name,
    linearUserEmail: data.linear_user_email,
    connectedAt: new Date(data.connected_at),
  };
}

/**
 * Store (upsert) a PPM admin's Linear OAuth token.
 * Encrypts tokens before storage.
 */
export async function storeAdminLinearToken(
  params: StoreTokenParams
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + params.expiresIn * 1000
  ).toISOString();
  const now = new Date().toISOString();

  const encryptedAccessToken = encryptToken(params.accessToken);
  const encryptedRefreshToken = params.refreshToken
    ? encryptToken(params.refreshToken)
    : null;

  const { error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .upsert(
      {
        user_id: params.userId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: expiresAt,
        linear_user_id: params.linearUserId ?? null,
        linear_user_name: params.linearUserName ?? null,
        linear_user_email: params.linearUserEmail ?? null,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw new Error(
      `Failed to store admin Linear token: ${error.message}`
    );
  }
}

/**
 * Update just the access token and expiry after a refresh.
 */
export async function updateAdminTokenAfterRefresh(
  userId: string,
  accessToken: string,
  expiresIn: number
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + expiresIn * 1000
  ).toISOString();
  const encryptedAccessToken = encryptToken(accessToken);

  const { error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .update({
      access_token: encryptedAccessToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw new Error(
      `Failed to update admin Linear token after refresh: ${error.message}`
    );
  }
}

/**
 * Refresh an admin's Linear OAuth token using their refresh_token.
 * Returns the new access token on success, null on failure.
 * On failure, revokes the token row so the admin must reconnect.
 * Uses an in-memory lock to prevent concurrent refreshes for the same user.
 */
export async function refreshAdminLinearToken(
  userId: string
): Promise<string | null> {
  // Prevent concurrent refresh attempts for the same user
  const existing = refreshLocks.get(userId);
  if (existing) return existing;

  const refreshPromise = _doRefresh(userId);
  refreshLocks.set(userId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    refreshLocks.delete(userId);
  }
}

async function _doRefresh(userId: string): Promise<string | null> {
  // Get the current token row (need refresh_token)
  const { data, error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .single();

  if (error || !data?.refresh_token) {
    console.warn(
      `[admin-oauth] No refresh token found for user ${userId}`
    );
    return null;
  }

  const refreshToken = decryptToken(data.refresh_token);

  // Get OAuth app credentials (same app used for workspace + per-user)
  const credentials = await getOAuthCredentials();
  if (!credentials) {
    console.warn(
      "[admin-oauth] Cannot refresh: no OAuth app credentials configured"
    );
    return null;
  }

  try {
    const response = await fetch(LINEAR_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `[admin-oauth] Token refresh failed for user ${userId}: ${response.status} ${body}`
      );
      // Token is invalid/revoked — clean up so admin can reconnect
      await revokeAdminLinearToken(userId);
      return null;
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    const newAccessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in;

    await updateAdminTokenAfterRefresh(userId, newAccessToken, expiresIn);

    console.log(
      `[admin-oauth] Token refreshed successfully for user ${userId}`
    );
    return newAccessToken;
  } catch (err) {
    console.error(
      `[admin-oauth] Token refresh network error for user ${userId}:`,
      err
    );
    return null;
  }
}

/**
 * Revoke (delete) a PPM admin's Linear OAuth token.
 */
export async function revokeAdminLinearToken(
  userId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(
      `Failed to revoke admin Linear token: ${error.message}`
    );
  }
}

/**
 * Check if a PPM admin has a connected Linear account.
 * Returns true if they have a token row (even if expired — refresh will handle it).
 */
export async function isAdminLinearConnected(
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return false;
    throw new Error(
      `Failed to check admin Linear connection: ${error.message}`
    );
  }

  return !!data;
}

/**
 * Get connection status info for display in admin settings UI.
 */
export async function getAdminLinearConnectionStatus(
  userId: string
): Promise<{
  connected: boolean;
  linearUserName: string | null;
  linearUserEmail: string | null;
  connectedAt: Date | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("admin_linear_tokens")
    .select(
      "linear_user_name, linear_user_email, connected_at"
    )
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return {
        connected: false,
        linearUserName: null,
        linearUserEmail: null,
        connectedAt: null,
      };
    }
    throw new Error(
      `Failed to get admin Linear connection status: ${error.message}`
    );
  }

  return {
    connected: true,
    linearUserName: data.linear_user_name,
    linearUserEmail: data.linear_user_email,
    connectedAt: data.connected_at
      ? new Date(data.connected_at)
      : null,
  };
}
