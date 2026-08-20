"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  closestCorners,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  CircleDot,
  Calendar,
  Sparkles,
  Info,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHub } from "@/contexts/hub-context";
import { useCanInteract } from "@/hooks/use-can-interact";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

type Project = {
  id: string;
  name: string;
  color?: string;
  progress: number;
  priority: number;
  priorityLabel: string;
  labels: Array<{ id: string; name: string; color: string }>;
  status: { name: string; color: string; type: string };
  targetDate?: string;
};

type UserRanking = { projectLinearId: string; rank: number };

const UNRANKED_CONTAINER = "unranked";
const RANKED_CONTAINER = "ranked";

function DroppableContainer({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 space-y-1 min-h-[200px] rounded-lg p-2 transition-colors",
        isOver && "bg-accent/20",
        className
      )}
    >
      {children}
    </div>
  );
}

export function RankingView({ projects }: { projects: Project[] }) {
  const { hubId } = useHub();
  const canInteract = useCanInteract();
  const [ranked, setRanked] = useState<Project[]>([]);
  const [unranked, setUnranked] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track view
  useEffect(() => {
    try {
      captureEvent(POSTHOG_EVENTS.ranking_viewed, { hubId });
    } catch {
      /* best-effort */
    }
  }, [hubId]);

  // Load rankings
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/hubs/${hubId}/rankings`);
        if (!res.ok) {
          setRanked([...projects].sort((a, b) => a.priority - b.priority));
          setUnranked([]);
          setShowBanner(false);
          setIsLoading(false);
          return;
        }
        const data = (await res.json()) as {
          userRanking: UserRanking[];
        };

        if (data.userRanking.length === 0) {
          // Never ranked — show default order, don't save
          setRanked([]);
          setUnranked([...projects].sort((a, b) => a.priority - b.priority));
          setShowBanner(true);
          setIsLoading(false);
          return;
        }

        // Rebuild ordered list from ranking data
        const projectMap = new Map(projects.map((p) => [p.id, p]));
        const rankedIds = new Set(
          data.userRanking.map((r) => r.projectLinearId)
        );

        const orderedRanked: Project[] = [];
        for (const r of data.userRanking) {
          const p = projectMap.get(r.projectLinearId);
          if (p) orderedRanked.push(p);
        }

        // Projects not yet ranked (new additions)
        const newProjects = projects.filter((p) => !rankedIds.has(p.id));

        setRanked(orderedRanked);
        setUnranked(newProjects);
      } catch {
        setRanked([...projects].sort((a, b) => a.priority - b.priority));
        setUnranked([]);
        setShowBanner(false);
      }
      setIsLoading(false);
    }
    load();
  }, [hubId, projects]);

  const saveRanking = useCallback(
    (items: Project[]) => {
      // Debounce: wait 2s after last drag before saving.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        // Abort any in-flight save so an older request can't overwrite newer state
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const res = await fetch(`/api/hubs/${hubId}/rankings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ranking: items.map((p) => p.id) }),
            signal: controller.signal,
          });
          if (res.ok) {
            const data = (await res.json()) as { changedCount: number };
            try {
              captureEvent(POSTHOG_EVENTS.ranking_updated, {
                hubId,
                projectCount: items.length,
                changedCount: data.changedCount,
              });
            } catch {
              /* best-effort */
            }
          }
        } catch {
          // Silent — optimistic UI already updated
        }
      }, 2000);
    },
    [hubId]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function findContainer(id: string): string | null {
    if (unranked.find((p) => p.id === id)) return UNRANKED_CONTAINER;
    if (ranked.find((p) => p.id === id)) return RANKED_CONTAINER;
    if (id === UNRANKED_CONTAINER || id === RANKED_CONTAINER) return id;
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    let overContainer = findContainer(over.id as string);

    // If over ID is a container itself
    if (!overContainer) {
      if (over.id === RANKED_CONTAINER) overContainer = RANKED_CONTAINER;
      else if (over.id === UNRANKED_CONTAINER)
        overContainer = UNRANKED_CONTAINER;
    }

    if (!activeContainer || !overContainer || activeContainer === overContainer)
      return;

    // Move between containers
    if (
      activeContainer === UNRANKED_CONTAINER &&
      overContainer === RANKED_CONTAINER
    ) {
      const item = unranked.find((p) => p.id === active.id);
      if (!item) return;
      setUnranked((prev) => prev.filter((p) => p.id !== active.id));
      const overIndex = ranked.findIndex((p) => p.id === over.id);
      setRanked((prev) => {
        const next = [...prev];
        if (overIndex >= 0) next.splice(overIndex, 0, item);
        else next.push(item);
        return next;
      });
    } else if (
      activeContainer === RANKED_CONTAINER &&
      overContainer === UNRANKED_CONTAINER
    ) {
      const item = ranked.find((p) => p.id === active.id);
      if (!item) return;
      setRanked((prev) => prev.filter((p) => p.id !== active.id));
      setUnranked((prev) => [...prev, item]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    // Reorder within same container
    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (
      activeContainer === overContainer &&
      activeContainer === RANKED_CONTAINER
    ) {
      const oldIndex = ranked.findIndex((p) => p.id === active.id);
      const newIndex = ranked.findIndex((p) => p.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(ranked, oldIndex, newIndex);
        setRanked(reordered);
      }
    }

    // Save ranked items — read current state to avoid stale closure
    setRanked((current) => {
      if (current.length > 0) saveRanking(current);
      return current;
    });
    setShowBanner(false);
  }

  if (isLoading) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">Loading rankings...</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">No projects to rank</p>
      </div>
    );
  }

  if (projects.length === 1) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Priority ranking is available when there are 2 or more projects
        </p>
      </div>
    );
  }

  const activeProject = activeId
    ? [...ranked, ...unranked].find((p) => p.id === activeId)
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {showBanner && canInteract && (
        <div className="flex items-center gap-2 px-3 py-2 mx-3 sm:mx-6 mt-4 sm:mt-6 mb-0 rounded-md bg-accent/50 text-sm text-muted-foreground">
          <Info className="w-4 h-4 shrink-0" />
          <span>Drag projects from left to right to set priorities</span>
          <button
            onClick={() => setShowBanner(false)}
            className="ml-auto text-xs hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col md:flex-row gap-4 flex-1 overflow-hidden p-3 sm:p-6">
          {/* Unranked panel */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden rounded-lg border border-border/40 bg-card/50">
            <div className="flex items-center gap-2 px-3 py-2 mb-0 border-b border-border/40">
              <span className="text-sm font-medium text-foreground">
                Unranked
              </span>
              <span className="px-2 py-0.5 bg-muted/60 rounded-full text-xs font-medium text-muted-foreground">
                {unranked.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SortableContext
                items={unranked.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
                disabled={!canInteract}
              >
                <DroppableContainer id={UNRANKED_CONTAINER}>
                  {unranked.length > 0 ? (
                    unranked.map((project) => (
                      <SortableProjectRow
                        key={project.id}
                        project={project}
                        rank={null}
                        canDrag={canInteract}
                        isNew={true}
                      />
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Check className="w-5 h-5 mb-2 text-green-500/60" />
                      <p className="text-sm">All projects ranked</p>
                    </div>
                  )}
                </DroppableContainer>
              </SortableContext>
            </div>
          </div>

          {/* Ranked panel */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden rounded-lg border border-border/40 bg-card/50">
            <div className="flex items-center gap-2 px-3 py-2 mb-0 border-b border-border/40">
              <span className="text-sm font-medium text-foreground">
                Ranked
              </span>
              <span className="px-2 py-0.5 bg-muted/60 rounded-full text-xs font-medium text-muted-foreground">
                {ranked.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SortableContext
                items={ranked.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
                disabled={!canInteract}
              >
                <DroppableContainer
                  id={RANKED_CONTAINER}
                  className={
                    ranked.length === 0
                      ? "border-2 border-dashed border-border/30"
                      : undefined
                  }
                >
                  {ranked.length > 0 ? (
                    ranked.map((project, index) => (
                      <SortableProjectRow
                        key={project.id}
                        project={project}
                        rank={index + 1}
                        canDrag={canInteract}
                        isNew={false}
                      />
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <p className="text-sm">
                        Drag projects here to set priorities
                      </p>
                    </div>
                  )}
                </DroppableContainer>
              </SortableContext>
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeProject ? (
            <SortableProjectRow
              project={activeProject}
              rank={null}
              canDrag={false}
              isNew={false}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function SortableProjectRow({
  project,
  rank,
  canDrag,
  isNew,
}: {
  project: Project;
  rank: number | null;
  canDrag: boolean;
  isNew: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const color = project.color || project.status.color || "var(--primary)";
  const progressPct = Math.round(project.progress * 100);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md border bg-card transition-colors",
        isDragging
          ? "border-primary/50 shadow-md z-10 opacity-50"
          : "border-border/40 hover:border-border/60",
        isNew && "opacity-70"
      )}
    >
      {/* Drag handle */}
      {canDrag && (
        <button
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      {/* Rank number */}
      <span
        className={cn(
          "w-6 text-center text-xs font-medium tabular-nums shrink-0",
          rank ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {rank ?? (
          <Sparkles className="w-3.5 h-3.5 mx-auto text-amber-500" />
        )}
      </span>

      {/* Color dot */}
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />

      {/* Name */}
      <span className="text-sm font-medium text-foreground truncate flex-1">
        {project.name}
      </span>

      {/* Progress bar */}
      <div className="flex items-center gap-1.5 w-20 shrink-0">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progressPct}%`,
              backgroundColor: color,
            }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">
          {progressPct}%
        </span>
      </div>

      {/* Status badge */}
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/50 text-muted-foreground shrink-0">
        <CircleDot
          className="w-2.5 h-2.5"
          style={{ color: project.status.color }}
        />
        {project.status.name}
      </span>

      {/* Target date */}
      {project.targetDate && (
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
          <Calendar className="w-3 h-3" />
          {formatDate(project.targetDate)}
        </span>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}
