// Shared formatting for notification event metadata shown in emails.
//
// Notification events store raw metadata (state names, UUIDs, internal linking
// keys, numeric enums). Rendering it verbatim leaks machine values like
// `old_state_id: 8c820fea-...` into client emails. This helper keeps only
// human-meaningful string values and presents the keys as readable labels.

// Keys that are internal (linking/preview) and must never be shown directly.
const HIDDEN_KEYS = new Set([
  "team_key",
  "excerpt",
  "_issue_id",
  "_issue_identifier",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turn a snake_case / camelCase key into a "Title Case" label. */
export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type MetadataEntry = { key: string; label: string; value: string };

/**
 * Reduce raw event metadata to clean, user-facing label/value pairs.
 * Drops internal keys, any *_id key, raw UUID values, and non-string values
 * (e.g. numeric priority enums) so emails only ever show readable content.
 */
export function formatMetadataEntries(
  metadata?: Record<string, unknown> | null
): MetadataEntry[] {
  if (!metadata) return [];

  return Object.entries(metadata)
    .filter(([key, value]) => {
      if (HIDDEN_KEYS.has(key)) return false;
      if (key.startsWith("_")) return false;
      if (/(_ids?|Ids?)$/.test(key)) return false;
      if (typeof value !== "string") return false;
      const trimmed = value.trim();
      if (trimmed === "") return false;
      if (UUID_RE.test(trimmed)) return false;
      return true;
    })
    .map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value: (value as string).trim(),
    }));
}
