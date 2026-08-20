import { describe, expect, it } from "vitest";
import {
  MIN_REPLAY_EVENTS,
  readReplayEvents,
  recordedAspect,
  type ReplayEvent,
} from "../replay-events";

const meta = (width: number, height: number): ReplayEvent => ({
  type: 4,
  timestamp: 1,
  data: { href: "https://example.com", width, height },
});

const incremental: ReplayEvent = { type: 3, timestamp: 2, data: {} };

describe("readReplayEvents", () => {
  it("accepts a bare rrweb events array", () => {
    const events = [meta(1280, 720), incremental];
    expect(readReplayEvents(events)).toEqual(events);
  });

  it("accepts an { events } envelope", () => {
    const events = [meta(1280, 720), incremental];
    expect(readReplayEvents({ events })).toEqual(events);
  });

  it("accepts an empty recording rather than calling it invalid", () => {
    expect(readReplayEvents([])).toEqual([]);
  });

  it("rejects anything that is not a recording", () => {
    expect(readReplayEvents(null)).toBeNull();
    expect(readReplayEvents("[]")).toBeNull();
    expect(readReplayEvents({ error: "Not found" })).toBeNull();
    expect(readReplayEvents({ events: "nope" })).toBeNull();
  });
});

describe("recordedAspect", () => {
  it("uses the recorded viewport from the meta event", () => {
    expect(recordedAspect([meta(1000, 500), incremental])).toBe(0.5);
  });

  it("falls back to 16:9 when there is no meta event", () => {
    expect(recordedAspect([incremental])).toBeCloseTo(9 / 16);
  });

  it("falls back to 16:9 when the meta event has no dimensions", () => {
    const broken: ReplayEvent = { type: 4, timestamp: 1, data: { href: "x" } };
    expect(recordedAspect([broken])).toBeCloseTo(9 / 16);
  });
});

describe("MIN_REPLAY_EVENTS", () => {
  it("requires a snapshot plus one incremental event", () => {
    expect(MIN_REPLAY_EVENTS).toBe(2);
  });
});
