"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAdminHubs } from "@/hooks/use-admin-hubs";
import { useFetch } from "@/hooks/use-fetch";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Settings,
  Activity,
  ClipboardList,
  BookOpen,
} from "lucide-react";

export function AdminSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { hubs, loading } = useAdminHubs();
  const { data: tokenStatus } = useFetch<{ configured: boolean }>(
    "/api/admin/workspace/token"
  );
  const tokenConnected = tokenStatus?.configured ?? false;

  const { data: oauthStatus } = useFetch<{ envConfigured: boolean; authorized: boolean }>(
    "/api/admin/workspace/oauth"
  );
  const oauthNeedsSetup = oauthStatus?.envConfigured && !oauthStatus?.authorized;

  const { data: syncHealth } = useFetch<{ status: string }>(
    "/api/admin/sync/health"
  );
  const syncStatus = syncHealth?.status ?? "unknown";

  const activeHubId = pathname.match(/\/admin\/hubs\/([^/]+)/)?.[1];

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[52px]" : "w-[240px]"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
        {!collapsed && (
          <span className="text-sm font-semibold text-foreground truncate">
            Client Hubs
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Hub list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {loading ? (
          <div className="px-3 py-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-8 rounded-md bg-muted/50 mb-1 animate-pulse"
              />
            ))}
          </div>
        ) : hubs.length === 0 ? (
          !collapsed && (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted-foreground">No hubs yet</p>
            </div>
          )
        ) : (
          <nav className="px-1.5 space-y-0.5">
            {hubs.map((hub) => {
              const isActive = activeHubId === hub.id;
              return (
                <Link
                  key={hub.id}
                  href={`/admin/hubs/${hub.id}`}
                  className={cn(
                    "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors group",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                  title={collapsed ? hub.name : undefined}
                >
                  <HubIcon
                    name={hub.name}
                    isActive={hub.is_active}
                    active={isActive}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{hub.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {hub.team_count}
                      </span>
                    </>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {/* Actions (CTAs) */}
      <div className="border-t border-border py-1.5 px-1.5 space-y-1 shrink-0">
        {!collapsed && (
          <div className="px-2 pb-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Quick Actions
            </span>
          </div>
        )}
        <Link
          href="/admin/hubs/new"
          className={cn(
            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
            pathname === "/admin/hubs/new"
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary hover:bg-primary/15"
          )}
          title={collapsed ? "Create Hub" : undefined}
          aria-label="Create Hub"
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Create Hub</span>}
        </Link>
      </div>

      {/* Footer navigation */}
      <div className="border-t border-border py-1.5 px-1.5 space-y-0.5 shrink-0">
        <Link
          href="/admin/forms"
          className={cn(
            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
            pathname.startsWith("/admin/forms")
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
          title={collapsed ? "Forms" : undefined}
        >
          <ClipboardList className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Forms</span>}
        </Link>
        <Link
          href="/admin/sync"
          className={cn(
            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
            pathname === "/admin/sync"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
          title={collapsed ? "Sync Monitor" : undefined}
        >
          <div className="relative shrink-0">
            <Activity className="w-4 h-4" />
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar",
                syncStatus === "healthy" ? "bg-green-500" :
                syncStatus === "degraded" ? "bg-yellow-500" :
                syncStatus === "unhealthy" ? "bg-red-500" :
                "bg-muted-foreground"
              )}
            />
          </div>
          {!collapsed && <span>Sync Monitor</span>}
        </Link>
        <Link
          href="/admin/settings"
          className={cn(
            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
            pathname.startsWith("/admin/settings")
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
          title={collapsed ? "Settings" : undefined}
        >
          <div className="relative shrink-0">
            <Settings className="w-4 h-4" />
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar",
                !tokenConnected ? "bg-red-500" :
                oauthNeedsSetup ? "bg-yellow-500" :
                "bg-green-500"
              )}
            />
          </div>
          {!collapsed && <span>Settings</span>}
        </Link>
        <Link
          href="/admin/docs"
          className={cn(
            "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
            pathname.startsWith("/admin/docs")
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
          title={collapsed ? "Docs" : undefined}
        >
          <BookOpen className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Docs</span>}
        </Link>
      </div>
    </aside>
  );
}

function HubIcon({
  name,
  isActive,
  active,
}: {
  name: string;
  isActive: boolean;
  active: boolean;
}) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        "w-6 h-6 rounded-md flex items-center justify-center text-xs font-medium shrink-0 transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground",
        !isActive && "opacity-50"
      )}
    >
      {initial}
    </div>
  );
}
