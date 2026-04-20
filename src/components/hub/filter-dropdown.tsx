"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CheckboxFilterDropdown({
  items,
  selected,
  onChange,
  label,
  icon,
}: {
  items: Array<{ id: string; name: string; color?: string; description?: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors",
          selected.length > 0
            ? "bg-accent text-foreground ring-1 ring-ring"
            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {icon}
        {label}
        {selected.length > 0 && (
          <span className="px-1 py-0 rounded bg-primary text-primary-foreground text-[10px]">
            {selected.length}
          </span>
        )}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-56 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
          {items.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors text-left"
              >
                <div
                  className={cn(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-border"
                  )}
                >
                  {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </div>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: item.color || "var(--muted-foreground)" }}
                />
                <span className="truncate">
                  {item.name}
                  {item.description && (
                    <span className="text-muted-foreground font-normal ml-1">{item.description}</span>
                  )}
                </span>
              </button>
            );
          })}
          {selected.length > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <button
                onClick={() => onChange([])}
                className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-left"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
