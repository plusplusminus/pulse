import { supabaseAdmin } from "@/lib/supabase";
import type { WidgetConfig } from "@/lib/widget-types";
import { isOriginAllowed, normaliseOrigin } from "@/lib/widget-origin";

/** Header the widget sends its site key in. `X-Widget-Key` is accepted for pre-rename embeds. */
export const SITE_KEY_HEADER = "X-Site-Key";
const LEGACY_SITE_KEY_HEADER = "X-Widget-Key";

/** Public site identifier (sk_ + 32 hex). Hashed at rest; only the prefix is stored in clear. */
export function generateWidgetApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sk_${hex}`;
}

export function widgetApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 10);
}

export function readSiteKey(request: Request): string | null {
  return (
    request.headers.get(SITE_KEY_HEADER) ??
    request.headers.get(LEGACY_SITE_KEY_HEADER)
  );
}

export async function hashWidgetApiKey(apiKey: string): Promise<string> {
  const encoded = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateWidgetKey(
  apiKey: string
): Promise<WidgetConfig | null> {
  const hash = await hashWidgetApiKey(apiKey);

  const { data, error } = await supabaseAdmin
    .from("widget_configs")
    .select("*")
    .eq("api_key_hash", hash)
    .single();

  if (error || !data) return null;
  if (!data.is_active) return null;

  return data as WidgetConfig;
}

export async function validateWidgetRequest(
  request: Request
): Promise<{ config: WidgetConfig } | { error: string; status: number }> {
  const apiKey = readSiteKey(request);
  if (!apiKey) {
    return { error: `Missing ${SITE_KEY_HEADER} header`, status: 401 };
  }

  const config = await validateWidgetKey(apiKey);
  if (!config) {
    return { error: "Invalid or inactive widget key", status: 401 };
  }

  // Allowlist is required; exact match after normalisation (src/lib/widget-origin.ts).
  if (!isOriginAllowed(config, request.headers.get("origin"))) {
    return { error: "Origin not allowed", status: 403 };
  }

  return { config };
}

/**
 * Preflights carry no site key, so CORS for OPTIONS (and for 401s before a key
 * resolved) is granted when the origin is allowlisted by any active site.
 */
export async function isKnownWidgetOrigin(origin: string | null): Promise<boolean> {
  const normalised = normaliseOrigin(origin);
  if (!normalised) return false;
  const { data } = await supabaseAdmin
    .from("widget_configs")
    .select("id")
    .eq("is_active", true)
    .contains("allowed_origins", [normalised])
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}
