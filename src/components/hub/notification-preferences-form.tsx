"use client";

import { useCallback, useEffect, useState } from "react";
import { useHub } from "@/contexts/hub-context";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Check, AlertCircle } from "lucide-react";

type Preference = {
  event_type: string;
  in_app_enabled: boolean;
  email_mode: "off" | "immediate" | "daily" | "weekly";
  digest_time: string;
  timezone: string;
};

const EVENT_TYPE_META: Record<string, { label: string; description: string }> =
  {
    comment: {
      label: "Comments",
      description: "When someone comments on a task",
    },
    status_change: {
      label: "Status Changes",
      description: "When a task's status changes",
    },
    project_update: {
      label: "Epic Updates",
      description: "When an epic's status or details change",
    },
    new_issue: {
      label: "New Tasks",
      description: "When new tasks are created",
    },
    cycle_update: {
      label: "Cycle Updates",
      description: "When cycles start, end, or are updated",
    },
    initiative_update: {
      label: "Initiative Updates",
      description: "When initiatives are updated",
    },
  };

const EMAIL_MODE_LABELS: Record<string, string> = {
  off: "Off",
  immediate: "Immediate",
  daily: "Daily Digest",
  weekly: "Weekly Digest",
};

const DIGEST_HOURS = Array.from({ length: 24 }, (_, i) => {
  const hour = i % 12 || 12;
  const ampm = i < 12 ? "AM" : "PM";
  return {
    value: `${String(i).padStart(2, "0")}:00`,
    label: `${hour}:00 ${ampm}`,
  };
});

type PresetId = "everything" | "comments_only" | "custom";

const PRESETS: {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
}[] = [
  {
    id: "everything",
    label: "Everything",
    description: "Email me about every type of update.",
  },
  {
    id: "comments_only",
    label: "Comments only",
    description:
      "Only email me about comments — mutes automated status, task and project updates.",
  },
];

const CUSTOM_DESCRIPTION = "Custom — fine-tune each update type below.";

/** Derive which preset (if any) the current preferences match. */
function detectPreset(prefs: Preference[]): PresetId {
  if (prefs.length === 0) return "custom";
  // "Everything": no event type has email turned off.
  if (prefs.every((p) => p.email_mode !== "off")) return "everything";
  // "Comments only": the comment stream emails, every other type is off.
  const commentsOn = prefs.some(
    (p) => p.event_type === "comment" && p.email_mode !== "off"
  );
  const restOff = prefs
    .filter((p) => p.event_type !== "comment")
    .every((p) => p.email_mode === "off");
  if (commentsOn && restOff) return "comments_only";
  return "custom";
}

export function NotificationPreferencesForm() {
  const { hubId } = useHub();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);

  // Shared digest settings (derived from first pref that has daily/weekly)
  const hasDigest = preferences.some(
    (p) => p.email_mode === "daily" || p.email_mode === "weekly"
  );

  // Active quick-setup preset, derived from the current preferences.
  const activePreset = detectPreset(preferences);

  function applyPreset(id: Exclude<PresetId, "custom">) {
    setPreferences((prev) =>
      prev.map((p) => ({
        ...p,
        email_mode:
          id === "everything"
            ? "daily"
            : p.event_type === "comment"
            ? "immediate"
            : "off",
      }))
    );
    setDirty(true);
    setFeedback(null);
  }

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/hub/${hubId}/notifications/preferences`
      );
      if (!res.ok) throw new Error("Failed to load preferences");
      const data = (await res.json()) as { preferences: Preference[] };
      setPreferences(data.preferences);
    } catch {
      setFeedback({
        type: "error",
        message: "Failed to load notification preferences",
      });
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  function updatePref(
    eventType: string,
    field: keyof Preference,
    value: unknown
  ) {
    setPreferences((prev) =>
      prev.map((p) =>
        p.event_type === eventType ? { ...p, [field]: value } : p
      )
    );
    setDirty(true);
    setFeedback(null);
  }

  function updateAllDigestSettings(field: "digest_time" | "timezone", value: string) {
    setPreferences((prev) =>
      prev.map((p) => ({ ...p, [field]: value }))
    );
    setDirty(true);
    setFeedback(null);
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/hub/${hubId}/notifications/preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences }),
        }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to save");
      }
      const data = (await res.json()) as { preferences: Preference[] };
      setPreferences(data.preferences);
      setDirty(false);
      captureEvent(POSTHOG_EVENTS.notification_preferences_updated, { hubId });
      setFeedback({ type: "success", message: "Preferences saved" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to save preferences",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading preferences...
      </div>
    );
  }

  // Get shared digest settings from the first preference
  const sharedDigestTime = preferences[0]?.digest_time ?? "09:00";
  const sharedTimezone =
    preferences[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="space-y-6">
      {/* Quick-setup presets */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Quick setup
        </p>
        <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              aria-pressed={activePreset === preset.id}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                activePreset === preset.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {activePreset === "custom"
            ? CUSTOM_DESCRIPTION
            : PRESETS.find((p) => p.id === activePreset)?.description}
        </p>
      </div>

      {/* Preferences table */}
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_140px] sm:grid-cols-[1fr_80px_160px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Event
          </span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-center">
            In-App
          </span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Email
          </span>
        </div>

        {/* Rows */}
        {preferences.map((pref) => {
          const meta = EVENT_TYPE_META[pref.event_type];
          if (!meta) return null;

          return (
            <div
              key={pref.event_type}
              className="grid grid-cols-[1fr_80px_140px] sm:grid-cols-[1fr_80px_160px] gap-4 px-4 py-3 border-b border-border last:border-b-0 items-center"
            >
              {/* Event info */}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {meta.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                  {meta.description}
                </p>
              </div>

              {/* In-app toggle */}
              <div className="flex justify-center">
                <button
                  type="button"
                  role="switch"
                  aria-checked={pref.in_app_enabled}
                  onClick={() =>
                    updatePref(
                      pref.event_type,
                      "in_app_enabled",
                      !pref.in_app_enabled
                    )
                  }
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    pref.in_app_enabled
                      ? "bg-primary"
                      : "bg-muted-foreground/30"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      pref.in_app_enabled
                        ? "translate-x-4"
                        : "translate-x-0"
                    )}
                  />
                </button>
              </div>

              {/* Email mode select */}
              <div>
                <Select
                  value={pref.email_mode}
                  onValueChange={(val) =>
                    updatePref(pref.event_type, "email_mode", val)
                  }
                >
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMAIL_MODE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>

      {/* Digest settings — only visible when at least one event uses daily/weekly */}
      {hasDigest && (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Digest Settings
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure when digest emails are delivered
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Delivery time */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Delivery Time
              </label>
              <Select
                value={sharedDigestTime}
                onValueChange={(val) =>
                  updateAllDigestSettings("digest_time", val)
                }
              >
                <SelectTrigger size="sm" className="w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIGEST_HOURS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Timezone */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Timezone
              </label>
              <TimezoneSelect
                value={sharedTimezone}
                onChange={(val) =>
                  updateAllDigestSettings("timezone", val)
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* Save button + feedback */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || !dirty}
          size="sm"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Preferences"
          )}
        </Button>

        {feedback && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              feedback.type === "success"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive"
            )}
          >
            {feedback.type === "success" ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}

function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [timezones, setTimezones] = useState<string[]>([]);

  useEffect(() => {
    try {
      const tzs = Intl.supportedValuesOf("timeZone");
      setTimezones(tzs);
    } catch {
      // Fallback for older browsers
      setTimezones([
        "UTC",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo",
        "Australia/Sydney",
        "Africa/Johannesburg",
      ]);
    }
  }, []);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[220px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {timezones.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
