"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFetch } from "@/hooks/use-fetch";
import { WidgetInstallInstructions } from "./widget-install-instructions";
import {
  Key,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import type {
  OutputDetailLevel,
  WidgetCaptureConfig,
  WidgetConfig,
  WidgetConfigCreateResponse,
  WidgetConfigRotateResponse,
  WidgetUIConfig,
} from "@/lib/widget-types";
import { BOOTSTRAP_DEFAULTS } from "@/lib/widget-bootstrap";
import { isOutputDetailLevel } from "@/lib/widget-picks";
import { OUTPUT_LEVEL_COPY, outputLevelCopy } from "@/lib/widget-output-levels";

interface WidgetConfigFormProps {
  hubId: string;
}

type CaptureToggleKey = Exclude<keyof WidgetCaptureConfig, "replay">;

const CAPTURE_TOGGLES: Array<{ key: CaptureToggleKey; label: string; hint: string }> = [
  { key: "screenshot", label: "Screenshot", hint: "Area / full-viewport capture with annotation" },
  { key: "captureTab", label: "Capture tab", hint: "Native tab capture (getDisplayMedia)" },
  { key: "elementPick", label: "Element pick", hint: "Click an element to attach its selector + markup" },
  { key: "video", label: "Video", hint: "Short screen recording" },
  { key: "console", label: "Console errors", hint: "Attach recent console.error / warn entries" },
  { key: "sentry", label: "Sentry context", hint: "Link the reporter's Sentry replay / trace when present" },
];

function captureFromConfig(config: WidgetUIConfig): Record<CaptureToggleKey, boolean> {
  const d = BOOTSTRAP_DEFAULTS.capture;
  const c = config.capture ?? {};
  return {
    screenshot: c.screenshot ?? d.screenshot,
    captureTab: c.captureTab ?? d.captureTab,
    elementPick: c.elementPick ?? d.elementPick,
    video: c.video ?? d.video,
    console: c.console ?? d.console,
    sentry: c.sentry ?? d.sentry,
  };
}

/** Rows written before the column existed read as undefined; they are 'standard'. */
const DEFAULT_OUTPUT_LEVEL: OutputDetailLevel = "standard";

function outputLevelFromConfig(config: WidgetConfig | null): OutputDetailLevel {
  const stored = config?.output_detail_level;
  return isOutputDetailLevel(stored) ? stored : DEFAULT_OUTPUT_LEVEL;
}

function maskTextFromConfig(config: WidgetUIConfig): string {
  return (config.privacy?.maskSelectors ?? []).join("\n");
}

function parseMaskText(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)));
}

const inputClass =
  "w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground/60";

export function WidgetConfigForm({ hubId }: WidgetConfigFormProps) {
  const [isPending, startTransition] = useTransition();
  const {
    data: configs,
    loading,
    refetch,
  } = useFetch<WidgetConfig[]>(`/api/widget/config?hubId=${hubId}`);

  // Key modal state. Full keys live only in memory (configId -> key) for this page session.
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);
  const [fullKeys, setFullKeys] = useState<Record<string, string>>({});
  const [confirmRotateId, setConfirmRotateId] = useState<string | null>(null);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Config editing state (for first/selected config)
  const activeConfig = configs?.[0] ?? null;
  const [widgetName, setWidgetName] = useState("");
  const [theme, setTheme] = useState<WidgetUIConfig["theme"]>("auto");
  const [position, setPosition] = useState<WidgetUIConfig["position"]>("bottom-right");
  const [triggerText, setTriggerText] = useState("Feedback");
  const [origins, setOrigins] = useState<string[]>([]);
  const [originInput, setOriginInput] = useState("");
  const [capture, setCapture] = useState<Record<CaptureToggleKey, boolean>>(
    captureFromConfig({})
  );
  const [maskText, setMaskText] = useState("");
  const [outputLevel, setOutputLevel] = useState<OutputDetailLevel>(DEFAULT_OUTPUT_LEVEL);
  const [dirty, setDirty] = useState(false);

  // Sync state from fetched config
  useEffect(() => {
    if (activeConfig) {
      setWidgetName(activeConfig.name);
      setTheme(activeConfig.config.theme ?? "auto");
      setPosition(activeConfig.config.position ?? "bottom-right");
      setTriggerText(activeConfig.config.triggerText ?? "Feedback");
      setOrigins(activeConfig.allowed_origins ?? []);
      setCapture(captureFromConfig(activeConfig.config));
      setMaskText(maskTextFromConfig(activeConfig.config));
      setOutputLevel(outputLevelFromConfig(activeConfig));
      setDirty(false);
    }
  }, [activeConfig]);

  // Track dirty state
  useEffect(() => {
    if (!activeConfig) return;
    const isDirty =
      widgetName !== activeConfig.name ||
      theme !== (activeConfig.config.theme ?? "auto") ||
      position !== (activeConfig.config.position ?? "bottom-right") ||
      triggerText !== (activeConfig.config.triggerText ?? "Feedback") ||
      JSON.stringify(origins) !== JSON.stringify(activeConfig.allowed_origins ?? []) ||
      JSON.stringify(capture) !== JSON.stringify(captureFromConfig(activeConfig.config)) ||
      JSON.stringify(parseMaskText(maskText)) !==
        JSON.stringify(activeConfig.config.privacy?.maskSelectors ?? []) ||
      outputLevel !== outputLevelFromConfig(activeConfig);
    setDirty(isDirty);
  }, [widgetName, theme, position, triggerText, origins, capture, maskText, outputLevel, activeConfig]);

  const generateKey = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/widget/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hubId, name: "Default Widget" }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to generate key");
        }
        const data: WidgetConfigCreateResponse = await res.json();
        setFullKeys((prev) => ({ ...prev, [data.id]: data.apiKey }));
        setNewApiKey(data.apiKey);
        setKeyCopied(false);
        setShowKeyModal(true);
        toast.message("Site key created (inactive)", {
          description: "Add an allowed origin, save, then activate the key.",
        });
        refetch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to generate key");
      }
    });
  }, [hubId, refetch]);

  const rotateKey = useCallback(
    (configId: string) => {
      startTransition(async () => {
        try {
          const res = await fetch(`/api/widget/config/${configId}/rotate`, {
            method: "POST",
          });
          if (!res.ok) {
            const err = (await res.json()) as { error?: string };
            throw new Error(err.error ?? "Failed to rotate key");
          }
          const data: WidgetConfigRotateResponse = await res.json();
          setFullKeys((prev) => ({ ...prev, [data.id]: data.apiKey }));
          setNewApiKey(data.apiKey);
          setKeyCopied(false);
          setConfirmRotateId(null);
          setShowKeyModal(true);
          toast.success("Site key rotated — the old key no longer works");
          refetch();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to rotate key");
        }
      });
    },
    [refetch]
  );

  const toggleActive = useCallback(
    (configId: string, currentActive: boolean) => {
      startTransition(async () => {
        try {
          const res = await fetch(`/api/widget/config/${configId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: !currentActive }),
          });
          if (!res.ok) {
            const err = (await res.json()) as { error?: string; message?: string };
            throw new Error(err.message ?? err.error ?? "Failed to update");
          }
          toast.success(currentActive ? "Key deactivated" : "Key activated");
          refetch();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to update");
        }
      });
    },
    [refetch]
  );

  const deleteConfig = useCallback(
    (configId: string) => {
      startTransition(async () => {
        try {
          const res = await fetch(`/api/widget/config/${configId}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const err = (await res.json()) as { error?: string };
            throw new Error(err.error ?? "Failed to delete");
          }
          toast.success("API key deleted");
          setConfirmDeleteId(null);
          refetch();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
      });
    },
    [refetch]
  );

  const saveConfig = useCallback(() => {
    if (!activeConfig) return;
    if (!isOutputDetailLevel(outputLevel)) {
      toast.error("Pick a valid output detail level");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/widget/config/${activeConfig.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: widgetName.trim(),
            allowed_origins: origins,
            // Own column, not part of the config JSONB.
            output_detail_level: outputLevel,
            // Merge so fields owned by other slices (e.g. replay) survive a save.
            config: {
              ...activeConfig.config,
              theme,
              position,
              triggerText: triggerText.trim(),
              capture: { ...activeConfig.config.capture, ...capture },
              privacy: { ...activeConfig.config.privacy, maskSelectors: parseMaskText(maskText) },
            } satisfies WidgetUIConfig,
          }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string; message?: string };
          throw new Error(err.message ?? err.error ?? "Failed to save");
        }
        toast.success("Configuration saved");
        setDirty(false);
        refetch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }, [activeConfig, widgetName, theme, position, triggerText, origins, capture, maskText, outputLevel, refetch]);

  const addOrigin = () => {
    const raw = originInput.trim();
    if (!raw) return;
    let normalised: string;
    try {
      const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
      normalised = url.origin.toLowerCase();
    } catch {
      toast.error("Enter a valid origin, e.g. https://app.example.com");
      return;
    }
    if (!origins.includes(normalised)) {
      setOrigins((prev) => [...prev, normalised]);
    }
    setOriginInput("");
  };

  const removeOrigin = (origin: string) => {
    setOrigins((prev) => prev.filter((o) => o !== origin));
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(newApiKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading configuration...
      </div>
    );
  }

  return (
    <>
      {/* A: API Keys */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Site Keys</h3>
          <button
            onClick={generateKey}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Generate New Site Key
          </button>
        </div>

        {!configs || configs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No site keys yet. Generate one to get started.
          </p>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            {configs.map((config, i) => (
              <div
                key={config.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5",
                  i < configs.length - 1 && "border-b border-border"
                )}
              >
                <Key className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-muted-foreground">
                      {config.api_key_prefix}...
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {config.name}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Created {new Date(config.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium",
                    config.is_active
                      ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]"
                      : "bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]"
                  )}
                >
                  {config.is_active ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => toggleActive(config.id, config.is_active)}
                  disabled={
                    isPending ||
                    (!config.is_active && (config.allowed_origins?.length ?? 0) === 0)
                  }
                  title={
                    !config.is_active && (config.allowed_origins?.length ?? 0) === 0
                      ? "Add at least one allowed origin before activating"
                      : undefined
                  }
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {config.is_active ? "Deactivate" : "Activate"}
                </button>
                {confirmDeleteId === config.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteConfig(config.id)}
                      disabled={isPending}
                      className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(config.id)}
                    className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                    title="Delete key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* B: Configuration */}
      {activeConfig && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-4">
          <h3 className="text-sm font-semibold">Configuration</h3>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Widget Name
            </label>
            <input
              type="text"
              value={widgetName}
              onChange={(e) => setWidgetName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Theme</label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {(["auto", "light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    theme === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Position
            </label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {(["bottom-right", "bottom-left"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPosition(p)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    position === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {p === "bottom-right" ? "Bottom Right" : "Bottom Left"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Trigger Text
            </label>
            <input
              type="text"
              value={triggerText}
              onChange={(e) => setTriggerText(e.target.value)}
              placeholder="Feedback"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Capture modes
            </label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Applied on the next page load of the client site via the bootstrap endpoint — no redeploy needed.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CAPTURE_TOGGLES.map((t) => (
                <label
                  key={t.key}
                  className="flex items-start gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={capture[t.key]}
                    onChange={(e) =>
                      setCapture((prev) => ({ ...prev, [t.key]: e.target.checked }))
                    }
                    className="mt-0.5 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{t.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Output detail
            </label>
            <p className="text-[11px] text-muted-foreground mb-2">
              How much detail each element pick contributes to the Linear issue body.
            </p>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {OUTPUT_LEVEL_COPY.map((o) => (
                <button
                  key={o.level}
                  type="button"
                  aria-pressed={outputLevel === o.level}
                  onClick={() => setOutputLevel(o.level)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors",
                    outputLevel === o.level
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {outputLevelCopy(outputLevel).help}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {outputLevelCopy(outputLevel).preview.join("\n")}
            </pre>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Mask selectors
            </label>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              CSS selectors excluded from screenshots and replays. One per line.
            </p>
            <textarea
              value={maskText}
              onChange={(e) => setMaskText(e.target.value)}
              rows={3}
              placeholder={".account-balance\n[data-pii]"}
              className={cn(inputClass, "font-mono text-xs")}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveConfig}
              disabled={!dirty || !widgetName.trim() || isPending}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                dirty && widgetName.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {isPending ? "Saving..." : "Save Changes"}
            </button>
            {dirty && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
      )}

      {/* C: Allowed Origins */}
      {activeConfig && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Allowed Origins</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only these origins can load the widget and submit feedback. At least one is required before the site key can be activated. Exact match — include the scheme and any non-default port.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={originInput}
              onChange={(e) => setOriginInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOrigin();
                }
              }}
              placeholder="https://example.com"
              className={inputClass}
            />
            <button
              onClick={addOrigin}
              disabled={!originInput.trim()}
              className="shrink-0 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Add
            </button>
          </div>

          {origins.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-500">
              <AlertTriangle className="w-3.5 h-3.5" />
              No origins yet — the widget will reject every request until you add one and save.
            </p>
          )}

          {origins.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {origins.map((origin) => (
                <span
                  key={origin}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted text-foreground"
                >
                  {origin}
                  <button
                    onClick={() => removeOrigin(origin)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* D: Install Instructions */}
      {activeConfig && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <WidgetInstallInstructions
            siteKey={fullKeys[activeConfig.id]}
            siteKeyPrefix={activeConfig.api_key_prefix}
            onRotate={() => setConfirmRotateId(activeConfig.id)}
            rotating={isPending}
          />
          {confirmRotateId === activeConfig.id && (
            <div className="flex items-center gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
              <span className="flex-1">
                Rotating issues a new site key and invalidates the current one immediately. Sites using the old key stop working until updated.
              </span>
              <button
                onClick={() => rotateKey(activeConfig.id)}
                disabled={isPending}
                className="font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                Rotate
              </button>
              <button
                onClick={() => setConfirmRotateId(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowKeyModal(false)}
          />
          <div className="relative w-full max-w-md bg-background border border-border rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Your Site Key</h3>
              <button
                onClick={() => setShowKeyModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-500">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Copy this key now. It is shown once; the install snippets below are pre-filled while you stay on this page.</p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-muted/50 border border-border rounded-md px-3 py-2 break-all">
                  {newApiKey}
                </code>
                <button
                  onClick={copyKey}
                  className="shrink-0 p-2 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy"
                >
                  {keyCopied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <button
                onClick={() => setShowKeyModal(false)}
                className="w-full px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
