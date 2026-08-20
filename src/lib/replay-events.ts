/**
 * PULSE-346 — pure helpers for the admin replay player.
 *
 * Kept out of the components so they are unit-testable without a DOM (the repo
 * has no jsdom/testing-library setup) and so nothing here drags `rrweb-player`
 * into a bundle.
 */

/**
 * One rrweb event. Structurally typed rather than imported from `@rrweb/types`,
 * which pnpm does not install (it is only a devDependency of rrweb-player).
 */
export type ReplayEvent = { type: number; timestamp: number; data?: unknown };

/** rrweb replays a full snapshot plus at least one incremental event; fewer will not play. */
export const MIN_REPLAY_EVENTS = 2;

/** rrweb `EventType.Meta` — carries the recorded viewport size. */
const META_EVENT_TYPE = 4;

const DEFAULT_ASPECT = 9 / 16;

/**
 * Normalise a fetched replay file. Accepts either a bare rrweb events array or
 * an `{ events: [...] }` envelope: PULSE-318 (the recorder) has not landed, so
 * the stored shape is not fixed yet. Returns null for anything else.
 */
export function readReplayEvents(payload: unknown): ReplayEvent[] | null {
  if (Array.isArray(payload)) return payload as ReplayEvent[];
  if (payload && typeof payload === "object") {
    const nested = (payload as { events?: unknown }).events;
    if (Array.isArray(nested)) return nested as ReplayEvent[];
  }
  return null;
}

/**
 * Height/width of the recorded viewport, so the player box matches the shape of
 * the page that was recorded. Falls back to 16:9 when there is no meta event.
 */
export function recordedAspect(events: ReplayEvent[]): number {
  const meta = events.find((event) => event.type === META_EVENT_TYPE);
  const data = meta?.data as { width?: number; height?: number } | undefined;
  if (data?.width && data?.height) return data.height / data.width;
  return DEFAULT_ASPECT;
}
