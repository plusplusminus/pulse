import type {
  WidgetBootstrapPayload,
  WidgetConfig,
  WidgetUIConfig,
} from "@/lib/widget-types";

/**
 * Safe defaults: screenshot + element pick (both user-initiated), every passive
 * capture mode off, replay off. The widget falls back to the same shape when
 * bootstrap is unreachable.
 */
export const BOOTSTRAP_DEFAULTS: Omit<WidgetBootstrapPayload, "site" | "api"> = {
  capture: {
    screenshot: true,
    captureTab: false,
    elementPick: true,
    video: false,
    voiceOver: false,
    console: false,
    sentry: false,
    replay: { enabled: false, bufferSeconds: 30, maskAllInputs: true },
  },
  privacy: { maskSelectors: [] },
  ui: { theme: "auto", position: "bottom-right", triggerText: "Feedback" },
};

const THEMES = ["auto", "light", "dark"] as const;
const POSITIONS = ["bottom-right", "bottom-left"] as const;
const MAX_BUFFER_SECONDS = 120;
const MIN_BUFFER_SECONDS = 5;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** One selector per line / comma; trims, drops blanks and duplicates. */
export function parseMaskSelectors(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.filter((v): v is string => typeof v === "string")
    : typeof input === "string"
      ? input.split(/[\n,]/)
      : [];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
}

/** Only the columns the payload needs; callers may pass a full row. */
export type BootstrapConfigRow = Pick<WidgetConfig, "name"> & {
  config: WidgetUIConfig | null | undefined;
};

/**
 * Pure: stored row + Pulse API base -> public bootstrap payload.
 * Whitelists fields explicitly so nothing else in the row (hash, prefix, hub id) can leak.
 */
export function buildBootstrapPayload(
  row: BootstrapConfigRow,
  options: { apiBase: string }
): WidgetBootstrapPayload {
  const cfg = row.config ?? {};
  const capture = cfg.capture ?? {};
  const replay = capture.replay ?? {};
  const d = BOOTSTRAP_DEFAULTS;

  const bufferSecondsRaw =
    typeof replay.bufferSeconds === "number" && Number.isFinite(replay.bufferSeconds)
      ? Math.round(replay.bufferSeconds)
      : d.capture.replay.bufferSeconds;

  return {
    site: { name: row.name },
    api: { base: options.apiBase.replace(/\/+$/, "") },
    capture: {
      screenshot: bool(capture.screenshot, d.capture.screenshot),
      captureTab: bool(capture.captureTab, d.capture.captureTab),
      elementPick: bool(capture.elementPick, d.capture.elementPick),
      video: bool(capture.video, d.capture.video),
      voiceOver: bool(capture.voiceOver, d.capture.voiceOver),
      console: bool(capture.console, d.capture.console),
      sentry: bool(capture.sentry, d.capture.sentry),
      replay: {
        enabled: bool(replay.enabled, d.capture.replay.enabled),
        bufferSeconds: Math.min(MAX_BUFFER_SECONDS, Math.max(MIN_BUFFER_SECONDS, bufferSecondsRaw)),
        maskAllInputs: bool(replay.maskAllInputs, d.capture.replay.maskAllInputs),
      },
    },
    privacy: { maskSelectors: parseMaskSelectors(cfg.privacy?.maskSelectors) },
    ui: {
      theme: oneOf(cfg.theme, THEMES, d.ui.theme),
      position: oneOf(cfg.position, POSITIONS, d.ui.position),
      triggerText:
        typeof cfg.triggerText === "string" && cfg.triggerText.trim()
          ? cfg.triggerText.trim().slice(0, 40)
          : d.ui.triggerText,
    },
  };
}
