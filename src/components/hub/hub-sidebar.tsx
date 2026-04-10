"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useHub } from "@/contexts/hub-context";
import { useCanInteract } from "@/hooks/use-can-interact";
import { useAdminLinearGate } from "@/hooks/use-admin-linear-gate";
import { FormModal } from "@/components/hub/form-modal";
import { SubmissionHistory } from "@/components/hub/submission-history";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  BookOpen,
  Bug,
  Lightbulb,
  FileText,
  ClipboardList,
  Calendar,
  MessageSquare,
  HelpCircle,
  Wrench,
  Flag,
  Star,
  Zap,
  Shield,
  Users,
  Mail,
  Phone,
  Megaphone,
  Unplug,
  type LucideIcon,
} from "lucide-react";

type SidebarForm = {
  id: string;
  name: string;
  type: "bug" | "feature" | "custom";
  button_label: string | null;
  button_icon: string | null;
};

const formTypeIcons: Record<string, LucideIcon> = {
  bug: Bug,
  feature: Lightbulb,
  custom: FileText,
};

const buttonIconMap: Record<string, LucideIcon> = {
  bug: Bug,
  lightbulb: Lightbulb,
  "file-text": FileText,
  calendar: Calendar,
  "message-square": MessageSquare,
  "help-circle": HelpCircle,
  wrench: Wrench,
  flag: Flag,
  star: Star,
  zap: Zap,
  shield: Shield,
  users: Users,
  mail: Mail,
  phone: Phone,
  megaphone: Megaphone,
};

const ctaClasses = "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors w-full bg-primary/10 text-primary hover:bg-primary/15";

export function HubSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [forms, setForms] = useState<SidebarForm[]>([]);
  const pathname = usePathname();
  const { hubId, hubSlug, hubName, teams } = useHub();
  const canInteract = useCanInteract();
  const { blocked: adminLinearBlocked } = useAdminLinearGate();

  // Fetch available forms
  useEffect(() => {
    if (!canInteract) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/hub/${hubId}/forms`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as SidebarForm[];
        if (!cancelled) setForms(data);
      } catch {
        // Non-critical
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hubId, canInteract]);

  const basePath = `/hub/${hubSlug}`;
  const isOverview = pathname === basePath || pathname === `${basePath}/`;

  const activeTeamKey = pathname.match(
    /\/hub\/[^/]+\/([^/]+)/
  )?.[1];

  // Derive team + project context from URL for form routing
  const activeTeam = activeTeamKey
    ? teams.find((t) => t.key === activeTeamKey)
    : null;
  const activeProjectId = pathname.match(
    /\/projects\/([^/]+)/
  )?.[1] ?? null;

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[52px]" : "w-[220px]"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
        {!collapsed && (
          <span className="text-sm font-semibold text-foreground truncate">
            {hubName}
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

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-1.5">
        <nav className="px-1.5 space-y-0.5">
          {/* Overview link */}
          <Link
            href={basePath}
            className={cn(
              "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors group",
              isOverview
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            style={isOverview ? {
              backgroundColor: "var(--accent)",
            } : undefined}
            title={collapsed ? "Overview" : undefined}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">Overview</span>}
          </Link>

          {/* Team divider */}
          {teams.length > 0 && !collapsed && (
            <div className="pt-3 pb-1 px-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Projects
              </span>
            </div>
          )}
          {teams.length > 0 && collapsed && (
            <div className="pt-2" />
          )}

          {/* Team links */}
          {teams.map((team) => {
            const isActive = activeTeamKey === team.key;
            return (
              <Link
                key={team.id}
                href={`${basePath}/${team.key}`}
                className={cn(
                  "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors group",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
                style={isActive ? {
                  backgroundColor: "var(--accent)",
                } : undefined}
                title={collapsed ? team.name : undefined}
              >
                {collapsed ? (
                  <span className="text-xs font-medium shrink-0">{team.name.charAt(0).toUpperCase()}</span>
                ) : (
                  <span className="flex-1 truncate">{team.name}</span>
                )}
              </Link>
            );
          })}

        </nav>
      </div>

      {/* Actions (CTAs) */}
      {canInteract && (
        <div className="px-1.5 py-2 border-t border-border shrink-0 space-y-1">
          {adminLinearBlocked ? (
            /* PPM admin without Linear connection — show connect prompt */
            !collapsed ? (
              <div className="px-2 py-2">
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5">
                  <Unplug className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-foreground leading-snug">
                      Connect Linear to submit requests
                    </p>
                    <Link
                      href="/admin/settings/linear"
                      className="text-[11px] font-medium text-primary hover:text-primary/80 mt-1 inline-block transition-colors"
                    >
                      Connect account &rarr;
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <Link
                href="/admin/settings/linear"
                className="flex items-center justify-center px-2 py-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Connect Linear account"
              >
                <Unplug className="w-4 h-4" />
              </Link>
            )
          ) : (
            <>
              {!collapsed && (
                <div className="px-2 pb-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    Quick Actions
                  </span>
                </div>
              )}
              {forms.map((form) => {
                const Icon = (form.button_icon && buttonIconMap[form.button_icon])
                  || formTypeIcons[form.type]
                  || FileText;
                const label = form.button_label || form.name;
                return (
                  <button
                    key={form.id}
                    onClick={() => setActiveFormId(form.id)}
                    className={ctaClasses}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? label : undefined}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Footer navigation */}
      <div className="border-t border-border py-1.5 px-1.5 space-y-0.5 shrink-0">
        {canInteract && (
          <button
            onClick={() => setShowHistory(true)}
            className={cn(
              "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors w-full",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            title={collapsed ? "My Submissions" : undefined}
            aria-label={collapsed ? "My Submissions" : undefined}
          >
            <ClipboardList className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">My Submissions</span>}
          </button>
        )}
        {(() => {
          const isDocsActive = pathname.startsWith(`${basePath}/docs`);
          return (
            <Link
              href={`${basePath}/docs`}
              className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
                isDocsActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
              title={collapsed ? "Docs" : undefined}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Docs</span>}
            </Link>
          );
        })()}
      </div>

      {/* Form modal */}
      {activeFormId && (
        <FormModal
          formId={activeFormId}
          hubId={hubId}
          teamId={activeTeam?.id ?? null}
          projectId={activeProjectId}
          onClose={() => setActiveFormId(null)}
          onSubmitted={() => {}}
        />
      )}

      {/* Submission history panel */}
      {showHistory && (
        <SubmissionHistory
          hubId={hubId}
          onClose={() => setShowHistory(false)}
        />
      )}
    </aside>
  );
}
