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
  Sparkles,
  Info,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHub } from "@/contexts/hub-context";
import { useCanInteract } from "@/hooks/use-can-interact";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

type Task = {
  id: string;
  title: string;
  identifier: string;
  status: { name: string; color: string; type: string };
  labels: Array<{ id: string; name: string; color: string }>;
};

type UserTaskRanking = { issueLinearId: string; rank: number };

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

export function TaskRankingView({
  tasks,
  projectId,
}: {
  tasks: Task[];
  projectId: string;
}) {
  const { hubId } = useHub();
  const canInteract = useCanInteract();
  const [ranked, setRanked] = useState<Task[]>([]);
  const [unranked, setUnranked] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragSnapshotRef = useRef<{ ranked: Task[]; unranked: Task[] } | null>(null);

  // Cleanup debounce and abort on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Track view
  useEffect(() => {
    try {
      captureEvent(POSTHOG_EVENTS.task_ranking_viewed, { hubId, projectId });
    } catch {
      /* best-effort */
    }
  }, [hubId, projectId]);

  // Load rankings
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setIsLoading(true);
    setShowBanner(false);

    async function load() {
      try {
        const res = await fetch(
          `/api/hubs/${hubId}/projects/${projectId}/task-rankings`,
          { signal }
        );
        if (signal.aborted) return;

        if (!res.ok) {
          setRanked([]);
          setUnranked([...tasks]);
          setShowBanner(false);
          setIsLoading(false);
          return;
        }
        const data = (await res.json()) as {
          userRanking: UserTaskRanking[];
        };

        if (signal.aborted) return;

        if (data.userRanking.length === 0) {
          setRanked([]);
          setUnranked([...tasks]);
          setShowBanner(true);
          setIsLoading(false);
          return;
        }

        const taskMap = new Map(tasks.map((t) => [t.id, t]));
        const rankedIds = new Set(
          data.userRanking.map((r) => r.issueLinearId)
        );

        const orderedRanked: Task[] = [];
        for (const r of data.userRanking) {
          const t = taskMap.get(r.issueLinearId);
          if (t) orderedRanked.push(t);
        }

        const newTasks = tasks.filter((t) => !rankedIds.has(t.id));

        setRanked(orderedRanked);
        setUnranked(newTasks);
        setShowBanner(false);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setRanked([]);
        setUnranked([...tasks]);
        setShowBanner(false);
      }
      if (!signal.aborted) setIsLoading(false);
    }
    load();

    return () => controller.abort();
  }, [hubId, projectId, tasks]);

  const saveRanking = useCallback(
    (items: Task[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const res = await fetch(
            `/api/hubs/${hubId}/projects/${projectId}/task-rankings`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ranking: items.map((t) => t.id) }),
              signal: controller.signal,
            }
          );
          if (res.ok) {
            const data = (await res.json()) as { changedCount: number };
            try {
              captureEvent(POSTHOG_EVENTS.task_ranking_updated, {
                hubId,
                projectId,
                issueCount: items.length,
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
    [hubId, projectId]
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
    if (unranked.find((t) => t.id === id)) return UNRANKED_CONTAINER;
    if (ranked.find((t) => t.id === id)) return RANKED_CONTAINER;
    if (id === UNRANKED_CONTAINER || id === RANKED_CONTAINER) return id;
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    dragSnapshotRef.current = { ranked: [...ranked], unranked: [...unranked] };
    setActiveId(event.active.id as string);
  }

  function handleDragCancel() {
    if (dragSnapshotRef.current) {
      setRanked(dragSnapshotRef.current.ranked);
      setUnranked(dragSnapshotRef.current.unranked);
      dragSnapshotRef.current = null;
    }
    setActiveId(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    let overContainer = findContainer(over.id as string);

    if (!overContainer) {
      if (over.id === RANKED_CONTAINER) overContainer = RANKED_CONTAINER;
      else if (over.id === UNRANKED_CONTAINER)
        overContainer = UNRANKED_CONTAINER;
    }

    if (!activeContainer || !overContainer || activeContainer === overContainer)
      return;

    if (
      activeContainer === UNRANKED_CONTAINER &&
      overContainer === RANKED_CONTAINER
    ) {
      const item = unranked.find((t) => t.id === active.id);
      if (!item) return;
      setUnranked((prev) => prev.filter((t) => t.id !== active.id));
      const overIndex = ranked.findIndex((t) => t.id === over.id);
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
      const item = ranked.find((t) => t.id === active.id);
      if (!item) return;
      setRanked((prev) => prev.filter((t) => t.id !== active.id));
      setUnranked((prev) => [...prev, item]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    dragSnapshotRef.current = null;

    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (
      activeContainer === overContainer &&
      activeContainer === RANKED_CONTAINER
    ) {
      const oldIndex = ranked.findIndex((t) => t.id === active.id);
      const newIndex = ranked.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(ranked, oldIndex, newIndex);
        setRanked(reordered);
      }
    }

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

  if (tasks.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">No tasks to rank</p>
      </div>
    );
  }

  if (tasks.length === 1) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Priority ranking is available when there are 2 or more tasks
        </p>
      </div>
    );
  }

  const activeTask = activeId
    ? [...ranked, ...unranked].find((t) => t.id === activeId)
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {showBanner && canInteract && (
        <div className="flex items-center gap-2 px-3 py-2 mx-3 sm:mx-6 mt-4 sm:mt-6 mb-0 rounded-md bg-accent/50 text-sm text-muted-foreground">
          <Info className="w-4 h-4 shrink-0" />
          <span>Drag tasks from left to right to set priorities</span>
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
        onDragCancel={handleDragCancel}
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
                items={unranked.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
                disabled={!canInteract}
              >
                <DroppableContainer id={UNRANKED_CONTAINER}>
                  {unranked.length > 0 ? (
                    unranked.map((task) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        rank={null}
                        canDrag={canInteract}
                        isNew={true}
                      />
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Check className="w-5 h-5 mb-2 text-green-500/60" />
                      <p className="text-sm">All tasks ranked</p>
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
                items={ranked.map((t) => t.id)}
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
                    ranked.map((task, index) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        rank={index + 1}
                        canDrag={canInteract}
                        isNew={false}
                      />
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <p className="text-sm">
                        Drag tasks here to set priorities
                      </p>
                    </div>
                  )}
                </DroppableContainer>
              </SortableContext>
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeTask ? (
            <SortableTaskRow
              task={activeTask}
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

function SortableTaskRow({
  task,
  rank,
  canDrag,
  isNew,
}: {
  task: Task;
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
  } = useSortable({ id: task.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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
          aria-label={`Drag to reorder ${task.title}`}
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

      {/* Status dot */}
      <CircleDot
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: task.status.color }}
      />

      {/* Identifier + Title */}
      <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
        {task.identifier}
      </span>
      <span className="text-sm font-medium text-foreground truncate flex-1">
        {task.title}
      </span>

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {task.labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
          {task.labels.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{task.labels.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
