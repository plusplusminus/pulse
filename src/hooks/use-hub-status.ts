"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const HUB_STATUS_POLL_MS = 60_000;

type HubStatus = {
  unreadCount: number;
  lastSyncedAt: string | null;
};

/**
 * Polls /api/hub/[hubId]/status for the top bar (unread count + last sync).
 * One request per tick for the whole hub shell; skips ticks while the tab is
 * hidden and refreshes as soon as it becomes visible/focused again; never
 * overlaps requests.
 */
export function useHubStatus(hubId: string | null | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!hubId || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/hub/${hubId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as HubStatus;
      setUnreadCount(data.unreadCount ?? 0);
      setLastSyncedAt(data.lastSyncedAt ? new Date(data.lastSyncedAt).getTime() : null);
    } catch {
      // Non-critical: keep showing the last known values.
    } finally {
      inFlight.current = false;
    }
  }, [hubId]);

  useEffect(() => {
    if (!hubId) return;
    refresh();

    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(tick, HUB_STATUS_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [hubId, refresh]);

  return { unreadCount, setUnreadCount, lastSyncedAt, refresh };
}
