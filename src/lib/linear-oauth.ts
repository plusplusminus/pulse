import { supabaseAdmin } from "@/lib/supabase";
import { encryptToken, decryptToken } from "@/lib/encryption";
import { getWorkspaceToken } from "./workspace";

const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Thrown for OAuth credential validation failures (invalid client ID/secret,
 * token acquisition failures, etc). Callers can check `instanceof` to
 * distinguish user-facing 400 errors from unexpected 500 errors.
 */
export class LinearOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearOAuthError";
  }
}

type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

type CachedToken = {
  token: string;
  expiresAt: number; // Unix timestamp in ms
};

// In-memory cache to avoid DB reads on every request.
// NOTE: This won't persist across serverless cold starts. The DB-cached token
// (in workspace_settings) is the primary persistent cache; this is just an
// optimization for hot paths within a single invocation lifecycle.
let tokenCache: CachedToken | null = null;

/**
 * Fetch with a timeout to avoid hanging on unresponsive endpoints.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new LinearOAuthError(
        `Linear API request timed out after ${timeoutMs}ms`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read OAuth app credentials from workspace_settings.
 * Returns null if not configured.
 */
export async function getOAuthCredentials(): Promise<OAuthCredentials | null> {
  const [clientIdRow, clientSecretRow] = await Promise.all([
    supabaseAdmin
      .from("workspace_settings")
      .select("value")
      .eq("key", "linear_oauth_client_id")
      .single(),
    supabaseAdmin
      .from("workspace_settings")
      .select("value")
      .eq("key", "linear_oauth_client_secret")
      .single(),
  ]);

  // PGRST116 = "not found" from .single() — expected when OAuth isn't configured.
  // Any other error is unexpected and should surface.
  for (const row of [clientIdRow, clientSecretRow]) {
    if (row.error && row.error.code !== "PGRST116") {
      throw new Error(`Failed to read OAuth credentials: ${row.error.message}`);
    }
  }

  const clientId = clientIdRow.data?.value;
  const encryptedSecret = clientSecretRow.data?.value;

  if (!clientId || !encryptedSecret) return null;

  return {
    clientId,
    clientSecret: decryptToken(encryptedSecret),
  };
}

/**
 * Store OAuth app credentials (client_secret is encrypted).
 */
export async function setOAuthCredentials(
  clientId: string,
  clientSecret: string,
  updatedBy: string
): Promise<void> {
  const encrypted = encryptToken(clientSecret);
  const now = new Date().toISOString();

  const upserts = [
    { key: "linear_oauth_client_id", value: clientId, updated_by: updatedBy, updated_at: now },
    { key: "linear_oauth_client_secret", value: encrypted, updated_by: updatedBy, updated_at: now },
  ];

  for (const row of upserts) {
    const { error } = await supabaseAdmin
      .from("workspace_settings")
      .upsert(row, { onConflict: "key" });
    if (error) {
      throw new Error(`Failed to store OAuth credential '${row.key}': ${error.message}`);
    }
  }

  // Clear cached token so next request acquires a fresh one
  tokenCache = null;
}

/**
 * Remove OAuth app credentials and cached token.
 */
export async function clearOAuthCredentials(): Promise<void> {
  const keys = [
    "linear_oauth_client_id",
    "linear_oauth_client_secret",
    "linear_oauth_token",
    "linear_oauth_token_expires_at",
    "linear_oauth_app_name",
    "linear_oauth_connected_at",
  ];

  for (const key of keys) {
    const { error } = await supabaseAdmin
      .from("workspace_settings")
      .delete()
      .eq("key", key);
    if (error) {
      throw new Error(`Failed to delete OAuth setting '${key}': ${error.message}`);
    }
  }

  tokenCache = null;
}

/**
 * Acquire a new token via client_credentials grant.
 */
async function acquireClientCredentialsToken(
  credentials: OAuthCredentials
): Promise<{ token: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: "read,write",
  });

  const res = await fetchWithTimeout(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new LinearOAuthError(`Linear OAuth token request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    error?: string;
    error_description?: string;
  };

  if (json.error) {
    throw new LinearOAuthError(`Linear OAuth error: ${json.error_description || json.error}`);
  }

  return { token: json.access_token, expiresIn: json.expires_in };
}

/**
 * Get a valid OAuth app token. Acquires a new one if expired or not cached.
 * Returns null if OAuth credentials are not configured.
 */
export async function getOAuthAppToken(): Promise<string | null> {
  const credentials = await getOAuthCredentials();
  if (!credentials) return null;

  // Check in-memory cache first
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  // Check DB cache
  const [tokenRow, expiresRow] = await Promise.all([
    supabaseAdmin
      .from("workspace_settings")
      .select("value")
      .eq("key", "linear_oauth_token")
      .single(),
    supabaseAdmin
      .from("workspace_settings")
      .select("value")
      .eq("key", "linear_oauth_token_expires_at")
      .single(),
  ]);

  if (tokenRow.data?.value && expiresRow.data?.value) {
    const expiresAt = parseInt(expiresRow.data.value, 10);
    // Use cached token if it has more than 1 minute of life left
    if (Date.now() < expiresAt - 60_000) {
      const decrypted = decryptToken(tokenRow.data.value);
      tokenCache = { token: decrypted, expiresAt };
      return decrypted;
    }
  }

  // Acquire a new token
  const { token, expiresIn } = await acquireClientCredentialsToken(credentials);
  const expiresAt = Date.now() + expiresIn * 1000;

  // Cache in DB (encrypted)
  const encrypted = encryptToken(token);
  const now = new Date().toISOString();

  const tokenUpsert = await supabaseAdmin.from("workspace_settings").upsert(
    { key: "linear_oauth_token", value: encrypted, updated_at: now },
    { onConflict: "key" }
  );
  if (tokenUpsert.error) {
    console.error("Failed to cache OAuth token:", tokenUpsert.error);
  }

  const expiryUpsert = await supabaseAdmin.from("workspace_settings").upsert(
    { key: "linear_oauth_token_expires_at", value: String(expiresAt), updated_at: now },
    { onConflict: "key" }
  );
  if (expiryUpsert.error) {
    console.error("Failed to cache OAuth token expiry:", expiryUpsert.error);
  }

  // Cache in memory regardless — the token is valid even if DB persistence failed
  tokenCache = { token, expiresAt };

  return token;
}

/**
 * Resolve the appropriate token for write operations.
 * When author info is available, prefers the OAuth app token
 * (which supports createAsUser attribution). Falls back to the
 * personal workspace token.
 *
 * Returns { token, isOAuthApp } so callers know whether to use createAsUser.
 */
export async function getWriteToken(): Promise<{
  token: string;
  isOAuthApp: boolean;
}> {
  try {
    const oauthToken = await getOAuthAppToken();
    if (oauthToken) {
      return { token: oauthToken, isOAuthApp: true };
    }
  } catch (err) {
    console.warn("OAuth app token acquisition failed, falling back to personal token:", err);
  }

  // Fall back to personal workspace token
  const personalToken = await getWorkspaceToken();
  return { token: personalToken, isOAuthApp: false };
}

/**
 * Validate OAuth credentials by acquiring a test token and checking the viewer.
 * Returns app info on success.
 */
export async function validateOAuthCredentials(
  clientId: string,
  clientSecret: string
): Promise<{ appName: string }> {
  const { token } = await acquireClientCredentialsToken({ clientId, clientSecret });

  // Use the token to get app info
  const res = await fetchWithTimeout("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `query { viewer { id name } }`,
    }),
  });

  const json = (await res.json()) as {
    data?: { viewer: { id: string; name: string } };
    errors?: Array<{ message: string }>;
  };

  if (json.errors || !json.data?.viewer) {
    throw new LinearOAuthError(
      "Token acquired but viewer query failed: " +
        (json.errors?.map((e) => e.message).join(", ") || "unknown error")
    );
  }

  return { appName: json.data.viewer.name };
}
