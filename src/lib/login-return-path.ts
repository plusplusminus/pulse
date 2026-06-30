// Resolve the post-login destination for a hub login page (PULSE-306).
//
// "View in Pulse" links from Linear point at deep URLs like
// /hub/{slug}/{teamKey}?issue={id}. When a logged-out user hits one, the
// middleware redirects to /hub/{slug}/login?next={original URL} and this
// helper decides whether that `next` value is safe to return to after auth.

/**
 * Validate a `next` query param against the hub being logged into.
 * Returns the original path when it's a safe in-hub destination, otherwise
 * the hub root. Rejects anything that could act as an open redirect.
 */
export function resolveReturnPath(
  next: string | undefined | null,
  slug: string
): string {
  const fallback = `/hub/${slug}`;
  if (!next) return fallback;

  // Only printable ASCII — the value round-trips through base64 (btoa) in the
  // WorkOS state param, which throws on non-Latin1 input.
  if (!/^[\x20-\x7E]+$/.test(next)) return fallback;

  // No protocol-relative URLs, backslash tricks, or absolute URLs.
  if (next.includes("//") || next.includes("\\")) return fallback;

  // Must stay inside this hub.
  if (
    next !== fallback &&
    !next.startsWith(`${fallback}/`) &&
    !next.startsWith(`${fallback}?`)
  ) {
    return fallback;
  }

  // Never bounce back to the login page itself.
  if (next === `${fallback}/login` || next.startsWith(`${fallback}/login?`)) {
    return fallback;
  }

  return next;
}
