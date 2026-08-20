import type { WidgetConfig } from "@/lib/widget-types";

/**
 * Origin policy for the public widget surface (feedback, bootstrap, uploads).
 *
 * - A site is only usable with a non-empty allowlist; there is no "allow all".
 * - Origins are normalised to `new URL(o).origin` (lower-case scheme+host, default
 *   port dropped, no path/trailing slash) on write and on compare. Exact match only.
 * - CORS headers are emitted only for an origin that matched; otherwise none.
 */

/** `https://Acme.Example:443/path/` -> `https://acme.example`; null when not a valid http(s) origin. */
export function normaliseOrigin(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalise a stored/incoming list: drops invalid entries and duplicates, preserves order. */
export function normaliseOrigins(list: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const entry of list ?? []) {
    const origin = normaliseOrigin(entry);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Entries that are not valid http(s) origins (for 400 responses / form validation). */
export function invalidOrigins(list: readonly string[]): string[] {
  return list.filter((entry) => normaliseOrigin(entry) === null);
}

export function isOriginAllowed(
  config: Pick<WidgetConfig, "allowed_origins">,
  origin: string | null
): boolean {
  const allowed = normaliseOrigins(config.allowed_origins);
  if (allowed.length === 0) return false;
  const incoming = normaliseOrigin(origin);
  return incoming !== null && allowed.includes(incoming);
}

/** A config may be active only with at least one valid origin. */
export function canActivate(allowedOrigins: readonly string[] | null | undefined): boolean {
  return normaliseOrigins(allowedOrigins).length > 0;
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

/** True when the page URL's origin equals the request Origin (both normalised). */
export function pageUrlMatchesOrigin(pageUrl: string, requestOrigin: string | null): boolean {
  const page = normaliseOrigin(pageUrl);
  const req = normaliseOrigin(requestOrigin);
  return page !== null && req !== null && page === req;
}

/** Strip query string and hash before storage / Linear (PII lives in URLs). */
export function stripUrlForStorage(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return pageUrl.split(/[?#]/)[0];
  }
}
