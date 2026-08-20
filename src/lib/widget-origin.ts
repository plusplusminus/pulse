import type { WidgetConfig } from "@/lib/widget-types";

/**
 * Origin policy for the public widget surface (feedback, bootstrap, uploads).
 * Exact match against the site's allowlist; CORS headers are only ever emitted
 * for an origin that matched.
 */
export function isOriginAllowed(
  config: Pick<WidgetConfig, "allowed_origins">,
  origin: string | null
): boolean {
  const allowed = config.allowed_origins ?? [];
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin);
}

export function corsHeaders(
  origin: string | null,
  options: { methods?: string; allowed: boolean }
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!options.allowed || !origin) return headers;
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": options.methods ?? "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Site-Key, X-Widget-Key",
    "Access-Control-Max-Age": "86400",
  };
}
