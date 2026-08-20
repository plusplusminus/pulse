---
id: batch-jobs
domain: backend
version: 1
updated: 2026-03-12
applies_to: ["**/processors/**/*.ts", "**/scheduled-jobs/**/*.ts"]
---

# Batch Jobs & Scheduled Jobs

Standards for nightly jobs, queue processors, and any code that touches more than ~100 rows.

## Quick Reference

```typescript
// Cursor-based pagination — never load unbounded result sets
let lastId = '';
while (true) {
  const chunk = await this.drizzle.db.select(...)
    .where(and(...filters, gt(table.id, lastId)))
    .orderBy(asc(table.id))
    .limit(CHUNK_SIZE);

  if (chunk.length === 0) break;
  lastId = chunk[chunk.length - 1].id;
  await this.processChunk(chunk);
}
```

## Data Access Rules

### Never load unbounded result sets
Every batch query MUST have a `LIMIT`. If you need all rows, use cursor-based pagination to fetch in fixed-size pages. Loading an entire table into Node.js memory will cause OOM on large schools.

### Require indexes for batch queries
Any new WHERE clause on a table with >10k rows must have a supporting index. Include a migration in the slice. Prefer partial indexes for NULL-checking filters:

```sql
CREATE INDEX idx_overdue_candidates
ON student_assessment_marks (school_id, due_at)
WHERE submission_code IS NULL
  AND obtained_marks IS NULL
  AND completion_date IS NULL;
```

### Avoid N+1 in batch updates
Do NOT call a single-item service method (e.g., `CrudService.update()`) in a loop unless you've calculated the cost. Each `.update()` may trigger multiple internal queries (findById, guards, events).

**Preferred:** Bulk UPDATE with `WHERE id IN (...)` per chunk, then emit events after.

**If you must use per-item updates:** Run them concurrently within each chunk (`Promise.all`), not sequentially. Document the per-item query cost in a code comment.

```typescript
// BAD — sequential, N+1
for (const item of chunk) {
  await this.crudService.update(item.id, data); // 5 queries each
}

// BETTER — concurrent within chunk
await Promise.allSettled(
  chunk.map(item => this.crudService.update(item.id, data))
);

// BEST — bulk update + batch event
await this.drizzle.db.update(table)
  .set({ status: 'absent', obtainedMarks: 0 })
  .where(inArray(table.id, chunkIds));
await this.eventService.emit(EventType.BATCH_MARKS_UPDATED, {
  context: {},
  data: { markIds: chunkIds, schoolId },
});
```

## Event Handling in Batch Context

### Avoid event storms
When a single-item update emits an event (e.g., `STUDENT_MARK_UPDATED`), calling it 5,000 times in a batch creates 5,000 events and 5,000 downstream job queue attempts. Even with Bull's `jobId` deduplication, the emission volume creates unnecessary load.

### Preferred: batch completion events
Emit a single batch event after processing, not per-item events during processing:

```typescript
// After all marks in a school are processed:
await this.eventService.emit(EventType.OVERDUE_ABSENT_COMPLETED, {
  context: {},
  data: {
    schoolId,
    updatedMarkIds,
    // downstream can recalculate affected student/term/subject combos
    affectedStudentIds: [...new Set(marks.map(m => m.studentId))],
  },
});
```

### Deduplication strategy for batch events
When per-item events are unavoidable, deduplicate BEFORE emitting:

```typescript
// Collect unique recalculation targets
const recalcTargets = new Map<string, { studentId: string; termId: string; subjectId: string }>();

for (const mark of updatedMarks) {
  const key = `${mark.studentId}-${mark.termId}-${mark.subjectGradeLevelId}`;
  if (!recalcTargets.has(key)) {
    recalcTargets.set(key, {
      studentId: mark.studentId,
      termId: mark.termId,
      subjectId: mark.subjectGradeLevelId,
    });
  }
}

// Emit only unique recalculation jobs
for (const [key, target] of recalcTargets) {
  await this.termTotalsQueue.add(JOB_NAMES.TERM_TOTALS_UPDATE, target, {
    jobId: key, // Bull deduplication as safety net
  });
}
```

### When to use which pattern

| Scenario | Pattern |
|---|---|
| <100 items, event chain is critical | Per-item update + per-item events (existing path) |
| 100-1,000 items | Per-item update with concurrent chunks + deduplicated events |
| >1,000 items | Bulk SQL update + single batch completion event |

## Chunking Rules

Chunking must be meaningful. If you chunk, at least one of these must be true:
- **Fetch-side:** Query fetches only `CHUNK_SIZE` rows at a time (cursor pagination)
- **Concurrency:** Items within a chunk run concurrently (`Promise.all`)
- **Backpressure:** A delay or yield between chunks to avoid starving the event loop
- **Transaction boundary:** Each chunk is wrapped in a transaction for atomicity

A `for` loop inside a `for` loop with no concurrency, no transaction, and no delay is not chunking — it's indentation.

## Spec Requirements for Batch Jobs

When writing specs that involve batch processing, the spec MUST include:

1. **Expected data volume** — e.g., "up to 60k marks per school, 20 schools"
2. **Fetch strategy** — cursor pagination, streaming, or justified full load
3. **Per-item cost** — if reusing a single-item path, document the query count per item
4. **Index requirements** — any new query on a large table needs an index migration
5. **Event volume estimate** — calculate downstream events at expected scale
6. **Acceptable runtime** — e.g., "must complete within 10 minutes for largest school"

## Anti-Patterns

- Loading all rows then chunking the JS array — memory bomb
- Sequential per-item updates with no concurrency — cosmetic chunking
- Emitting thousands of individual events when a batch event suffices
- No LIMIT on batch queries — unbounded growth as data scales
- Missing index for batch query filters — progressive slowdown
- Hardcoded timezone offsets — use school config or accept as parameter
- Cross-tenant queries in tenant-scoped services — separate into discovery service
