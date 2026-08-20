"use client";

/**
 * PULSE-346 — the half of the replay player that actually touches `rrweb-player`.
 *
 * Split into its own module so `replay-player.tsx` can pull it in with
 * `next/dynamic({ ssr: false })`: the Svelte player and its stylesheet land in a
 * lazy chunk that only the admin submission page ever requests, and never in the
 * public widget bundle (PULSE-343). Nothing outside `replay-player.tsx` should
 * import this file directly.
 */

import { useEffect, useRef, useState } from "react";
import RrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { cn } from "@/lib/utils";
import {
  MIN_REPLAY_EVENTS,
  recordedAspect,
  type ReplayEvent,
} from "@/lib/replay-events";

/**
 * The surface we use off the Svelte component. Declared locally rather than
 * imported so the build does not depend on `@rrweb/types` (a devDependency of
 * rrweb-player, so pnpm does not install it) resolving.
 */
type PlayerHandle = {
  $set: (props: Record<string, unknown>) => void;
  $destroy: () => void;
  triggerResize: () => void;
};

type PlayerConstructor = new (options: {
  target: HTMLElement;
  props: {
    events: ReplayEvent[];
    width?: number;
    height?: number;
    autoPlay?: boolean;
    showController?: boolean;
  };
}) => PlayerHandle;

const Player = RrwebPlayer as unknown as PlayerConstructor;

export default function ReplayPlayerImpl({
  events,
  className,
}: {
  events: ReplayEvent[];
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const measured = width > 0;

  // Mount once per events array. Width is read from the DOM here rather than
  // taken as a dependency so a resize adjusts the live player (effect below)
  // instead of tearing it down and losing the playhead.
  useEffect(() => {
    const target = mountRef.current;
    const initialWidth = wrapperRef.current?.clientWidth ?? 0;
    if (!target || !measured || initialWidth === 0) return;
    if (events.length < MIN_REPLAY_EVENTS) return;

    const player = new Player({
      target,
      props: {
        events,
        width: initialWidth,
        height: Math.round(initialWidth * recordedAspect(events)),
        autoPlay: false,
        showController: true,
      },
    });
    playerRef.current = player;

    return () => {
      playerRef.current = null;
      try {
        player.$destroy();
      } catch {
        // Player already torn down (e.g. React strict-mode double invoke).
      }
      target.replaceChildren();
    };
  }, [events, measured]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || width === 0) return;
    player.$set({ width, height: Math.round(width * recordedAspect(events)) });
    player.triggerResize();
  }, [width, events]);

  if (events.length < MIN_REPLAY_EVENTS) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-border bg-muted/20 py-10 text-sm text-muted-foreground",
          className
        )}
      >
        Replay recording is too short to play
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={cn("w-full", className)}>
      <div ref={mountRef} className="pulse-replay-mount" />
    </div>
  );
}
