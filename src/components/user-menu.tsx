"use client";

import { useRef, useState, useEffect } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  displayName: string;
  showName?: boolean;
}

export function UserMenu({ displayName, showName = true }: UserMenuProps) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Esc") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const initial = (displayName ?? "?").charAt(0).toUpperCase();
  const menuId = "user-menu-dropdown";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`User menu for ${displayName}`}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-accent transition-colors"
      >
        <div
          className={cn(
            "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium",
            "bg-muted text-muted-foreground"
          )}
        >
          {initial}
        </div>
        {showName && (
          <span className="text-xs text-muted-foreground hidden sm:block">
            {displayName}
          </span>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[180px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground sm:hidden">
            {displayName}
          </div>
          <div className="sm:hidden -mx-1 my-1 h-px bg-muted" />
          <button
            role="menuitem"
            onClick={() => signOut({ returnTo: window.location.origin })}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
