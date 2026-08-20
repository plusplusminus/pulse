"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, BellOff, Check, Loader2 } from "lucide-react";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
} from "@/components/ui/dropdown";

type SubState = "subscribed" | "muted" | null;
type SubSource = "manual" | "auto_comment" | "auto_mention" | null;

const TRIGGER_META = {
  subscribed: { label: "Following", Icon: BellRing },
  muted: { label: "Muted", Icon: BellOff },
  default: { label: "Notify", Icon: Bell },
} as const;

/**
 * Per-task notification control (PULSE-364): follow / mute / use-default for the
 * current user on a single task. Renders in the task page header.
 */
export function TaskSubscriptionControl({
  hubId,
  issueId,
}: {
  hubId: string;
  issueId: string;
}) {
  const [state, setState] = useState<SubState>(null);
  const [source, setSource] = useState<SubSource>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/hub/${hubId}/tasks/${issueId}/subscription`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const data = d as { state?: SubState; source?: SubSource } | null;
        if (active && data) {
          setState(data.state ?? null);
          setSource(data.source ?? null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hubId, issueId]);

  const update = useCallback(
    async (next: SubState) => {
      setOpen(false);
      if (next === state) return;
      const prev = { state, source };
      setSaving(true);
      setState(next);
      setSource(next ? "manual" : null);
      try {
        const res = await fetch(
          `/api/hub/${hubId}/tasks/${issueId}/subscription`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: next }),
          }
        );
        if (!res.ok) throw new Error("save failed");
      } catch {
        // revert optimistic update
        setState(prev.state);
        setSource(prev.source);
      } finally {
        setSaving(false);
      }
    },
    [hubId, issueId, state, source]
  );

  if (loading) return null;

  const meta = TRIGGER_META[state ?? "default"];
  const TriggerIcon = meta.Icon;
  const autoNote =
    state === "subscribed" && source === "auto_comment"
      ? "Following because you commented"
      : null;

  return (
    <Dropdown>
      <DropdownTrigger
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="h-7 gap-1.5 px-2 py-0 text-xs font-medium text-muted-foreground"
        title={autoNote ?? undefined}
        aria-label="Notification settings for this task"
      >
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <TriggerIcon className="w-3.5 h-3.5" />
        )}
        {meta.label}
      </DropdownTrigger>

      {open && (
        <>
          {/* Outside-click catcher */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <DropdownContent align="end" className="z-50">
            {autoNote && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {autoNote}
              </p>
            )}
            <Option
              current={state}
              value="subscribed"
              Icon={BellRing}
              label="Follow this task"
              hint="Every update, even in mentions-only mode"
              onSelect={update}
            />
            <Option
              current={state}
              value="muted"
              Icon={BellOff}
              label="Mute this task"
              hint="Never notify me about this task"
              onSelect={update}
            />
            <DropdownSeparator />
            <Option
              current={state}
              value={null}
              Icon={Bell}
              label="Use my default settings"
              onSelect={update}
            />
          </DropdownContent>
        </>
      )}
    </Dropdown>
  );
}

function Option({
  current,
  value,
  Icon,
  label,
  hint,
  onSelect,
}: {
  current: SubState;
  value: SubState;
  Icon: typeof Bell;
  label: string;
  hint?: string;
  onSelect: (v: SubState) => void;
}) {
  const active = current === value;
  return (
    <DropdownItem
      onClick={() => onSelect(value)}
      className="flex-col !items-start gap-0.5"
    >
      <span className="flex items-center gap-2 w-full">
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1">{label}</span>
        {active && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
      </span>
      {hint && (
        <span className="text-[11px] text-muted-foreground pl-[22px]">
          {hint}
        </span>
      )}
    </DropdownItem>
  );
}
