"use client";

/**
 * PULSE-346 — session replay for the admin submission detail view.
 *
 * `ReplayPlayer` takes the rrweb events array and mounts the vendor player
 * through a `next/dynamic` boundary, so `rrweb-player` (Svelte) and its
 * stylesheet stay out of every other route's JS and out of the public widget
 * bundle entirely (PULSE-343).
 *
 * `ReplayPlayerFromUrl` is what the detail view actually renders: it fetches the
 * events through the Pulse media proxy (`GET /api/widget/media/:id/replay`),
 * which authorises the viewer and 302s to a short-lived signed Supabase Storage
 * URL. No signed URL is ever embedded in the page payload.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCw, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { readReplayEvents, type ReplayEvent } from "@/lib/replay-events";

export type { ReplayEvent };

const ReplayPlayerImpl = dynamic(() => import("./replay-player-impl"), {
  ssr: false,
  loading: () => (
    <PlayerFrame>
      <Loader2 className="w-4 h-4 animate-spin" />
      Loading player...
    </PlayerFrame>
  ),
});

export default function ReplayPlayer({
  events,
  className,
}: {
  events: ReplayEvent[] | null | undefined;
  className?: string;
}) {
  if (!events || events.length === 0) {
    return (
      <PlayerFrame className={className}>
        <Video className="w-4 h-4" />
        No replay data
      </PlayerFrame>
    );
  }

  return <ReplayPlayerImpl events={events} className={className} />;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; events: ReplayEvent[] }
  /** 404 from the proxy: this submission never had a recording. */
  | { status: "absent" }
  /** 410 from the proxy: the retention job removed it (PULSE-317). */
  | { status: "purged" }
  | { status: "error"; message: string };

export function ReplayPlayerFromUrl({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (res.status === 404) return setState({ status: "absent" });
      if (res.status === 410) return setState({ status: "purged" });
      if (!res.ok) {
        return setState({
          status: "error",
          message: `Could not load the replay (${res.status})`,
        });
      }

      const events = readReplayEvents(await res.json());
      if (!events) {
        return setState({
          status: "error",
          message: "Replay file is not a valid rrweb recording",
        });
      }
      setState({ status: "ready", events });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Could not load the replay",
      });
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <PlayerFrame className={className}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading replay...
      </PlayerFrame>
    );
  }

  if (state.status === "absent") {
    return (
      <PlayerFrame className={className}>
        <Video className="w-4 h-4" />
        No replay data
      </PlayerFrame>
    );
  }

  if (state.status === "purged") {
    return (
      <PlayerFrame className={className}>
        <AlertTriangle className="w-4 h-4" />
        Replay removed after the retention period
      </PlayerFrame>
    );
  }

  if (state.status === "error") {
    return (
      <PlayerFrame className={cn("flex-col gap-2", className)}>
        <span className="inline-flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          {state.message}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-accent/50 transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </PlayerFrame>
    );
  }

  return <ReplayPlayer events={state.events} className={className} />;
}

function PlayerFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 py-10 text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
