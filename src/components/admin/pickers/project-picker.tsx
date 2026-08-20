"use client";

import { useFetch } from "@/hooks/use-fetch";
import { PickerShell, PickerItem } from "./picker-shell";

interface SyncedProject {
  linear_id: string;
  name: string;
  status_name: string | null;
  data: {
    id?: string;
    name?: string;
    color?: string;
    icon?: string;
    status?: { name?: string; color?: string };
  };
}

interface ProjectPickerProps {
  teamId: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  description?: string;
  icon?: React.ReactNode;
  /** Project IDs to exclude from the list (e.g. overview-only projects) */
  excludeIds?: string[];
}

export function ProjectPicker({ teamId, value, onChange, label, description, icon, excludeIds }: ProjectPickerProps) {
  const { data, loading, error, refetch } = useFetch<SyncedProject[]>(
    teamId ? `/api/admin/linear/teams/${teamId}/projects` : null,
    { enabled: !!teamId }
  );

  const projects = data ?? [];

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  }

  if (!teamId) {
    return (
      <div className="border border-border rounded-lg bg-card">
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
            {icon}
            {label ?? "Projects"}
          </p>
        </div>
        <div className="px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Select a team to see its projects
          </p>
        </div>
      </div>
    );
  }

  return (
    <PickerShell
      label={label ?? "Projects"}
      description={description}
      icon={icon}
      loading={loading}
      error={error}
      onRetry={refetch}
      empty={projects.length === 0}
      emptyMessage="No projects found for this team"
      searchPlaceholder="Filter projects..."
    >
      {(filter) => {
        const excludeSet = new Set(excludeIds ?? []);
        const filtered = projects.filter((p) =>
          p.name.toLowerCase().includes(filter.toLowerCase()) &&
          !excludeSet.has(p.linear_id)
        );

        if (filtered.length === 0) {
          return (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              No projects match &quot;{filter}&quot;
            </div>
          );
        }

        return filtered.map((project) => (
          <PickerItem
            key={project.linear_id}
            selected={value.includes(project.linear_id)}
            onToggle={() => toggle(project.linear_id)}
          >
            <span className="flex items-center gap-2 min-w-0">
              {project.data.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: project.data.color }}
                />
              )}
              <span className="truncate">{project.name}</span>
              {project.status_name && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {project.status_name}
                </span>
              )}
            </span>
          </PickerItem>
        ));
      }}
    </PickerShell>
  );
}
