---
id: estimation-standards
domain: process
version: 4
updated: 2026-03-05
applies_to: []
trigger_on: ["estimate", "spec", "epic", "decompose"]
---

# Estimation Standards (PPM v4)

## Quick Reference

All slices use: **small / medium / large**. Not hours. Not Fibonacci. Not points.

| Size | Meaning | When to Use |
|------|---------|-------------|
| **small** | Half day or less | Confident it can be grounded, built, and proved quickly |
| **medium** | Up to a full day | Standard complexity, clear path |
| **large** | Full day or more | Consider splitting |

## Rules

1. Estimates are per **slice**, not per spec
2. A spec is the sum of its slices — if the sum feels like more than a few days, split the spec
3. Tasks (sub-4-hour track) don't get formal estimates — they're inherently small
4. Bugs don't get formal estimates — severity (P1-P4) drives urgency, not size

## Application by Work Type

### Slices (inside specs)
- Each slice gets small / medium / large
- If a slice is large, ask: can it be split?
- Mixed-family specs sum slice estimates across families

### Tasks (<4 hours)
- No formal estimate needed
- If it crosses 4 hours, it's not a task — escalate to a spec

### Bugs
- Severity (P1-P4) determines response time, not estimates
- If a bug fix exceeds 4 hours, convert to a lightweight spec

## Estimation Guidelines

### Small
- Configuration changes
- Simple bug fixes
- Single endpoint additions
- Minor UI adjustments
- Adding validation rules
- Documentation updates

### Medium
- Complete feature modules
- Complex UI components with state
- API endpoints with business logic
- Database queries with joins/aggregation
- Comprehensive test suites

### Large
- Multi-component features
- Complex integrations
- Performance optimizations
- Schema migrations with data transformation
- Should usually be split into smaller slices

## Setting Estimates in Linear

Estimates are set per spec (the sum), not per slice. Slices are tracked locally in `slices.yaml`.

```
mcp__claude_ai_Linear__save_issue(
  title: "Spec: Implement search filters",
  team: "${LINEAR_TEAM_NAME}",
  labels: ["spec"],
  state: "Grounding"
)
```

Slice-level estimates live in `slices.yaml`:

```yaml
slices:
  - id: 1
    title: "Search API endpoint"
    family: 1
    estimate: medium
  - id: 2
    title: "Search UI component"
    family: 2
    estimate: small
```

## Anti-Patterns

1. **Don't use hours** — "4 hours" is not a valid estimate; use small/medium/large
2. **Don't use Fibonacci** — 1, 2, 4, 8, 16 is the old scale
3. **Don't estimate bugs** — severity drives urgency
4. **Don't estimate tasks** — they're inherently sub-4-hour
5. **Don't pad** — estimates reflect complexity, not buffer
