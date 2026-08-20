---
id: linear
domain: process
version: 4
updated: 2026-03-05
trigger_on: ["linear", "issue", "spec", "epic"]
---

# Linear

Linear workflow conventions for Agent-OS (PPM v4).

## Quick Reference

```
Work Hierarchy:
Epic (Project) → Spec (Issue) → Slice (Local)

Estimates (per slice):
small | medium | large

States:
Grounding → In Progress → In Proof → Done | Blocked
```

## Linear MCP (Required)

ALWAYS use Linear MCP tools for all Linear operations:
- `mcp__claude_ai_Linear__get_issue` — fetch issue details
- `mcp__claude_ai_Linear__save_issue` — create or update issues
- `mcp__claude_ai_Linear__list_issues` — search/list issues
- `mcp__claude_ai_Linear__create_comment` — add comments
- `mcp__claude_ai_Linear__list_projects` — list projects
- `mcp__claude_ai_Linear__get_project` — get project details

NEVER use `gh`, `curl`, or direct API calls for Linear operations.

## Issue Types

| Type | Linear Entity | Label | Estimate | State Flow |
|------|---------------|-------|----------|------------|
| Spec | Issue | `spec` | small, medium, large | Grounding → In Progress → In Proof → Done |
| Bug | Issue | `bug`, `P1-P4` | small, medium, large | In Progress → In Proof → Done |
| Task | Issue | `task` | small | In Progress → Done |

## States (PPM v4)

```
Grounding → In Progress → In Proof → Done
                ↓
             Blocked
```

| State | Meaning |
|-------|---------|
| **Grounding** | Developer started, assumptions being verified, no code yet |
| **In Progress** | Grounding approved, build underway |
| **In Proof** | Tests green, proof written, awaiting Judge approval |
| **Done** | Judge approved, delivery note written |
| **Blocked** | Waiting on client answer or external dependency |

### Initial States by Type
| Type | Initial State |
|------|---------------|
| Spec (from /epic:create) | `Grounding` |
| Bug (from /bug) | `In Progress` |
| Task (from /task) | `In Progress` |

## Naming Conventions

### Branches
```
feature/KOA-123-user-dashboard
fix/KOA-456-login-safari-bug
chore/KOA-789-update-deps
```

### Commits
```
[KOA-123] feat: implement user dashboard
[KOA-456] fix: resolve Safari login issue
[KOA-789] chore: update dependencies
```

### PR Titles
```
[KOA-123] User dashboard implementation
[KOA-456] Fix Safari login bug
```

## Spec Lifecycle

```
1. Created (Grounding)
   ↓ /spec:start (grounding report produced)
2. Grounding approved → In Progress
   ↓ Build slices (by family)
3. All slices done, quality gates pass
   ↓ Proof written → In Proof
4. Judge approves proof
   ↓ Delivery note written → Done
```

## Description Templates

### Spec
```markdown
## Overview
[1-2 sentences: what this delivers]

## What Exists
[Current state of the code relevant to this spec]

## Acceptance Criteria
- [ ] [Binary YES/NO]
- [ ] [Binary YES/NO]

## Slices
| # | Slice | Family | Estimate |
|---|-------|--------|----------|
| 1 | [name] | [1/2/3] | [small/medium/large] |

## Dependencies
- Depends on: [KOA-XXX] or None
- Blocks: [KOA-XXX] or None
```

### Bug
```markdown
## Description
[What's broken]

## Severity
[P1 Down | P2 Degraded | P3 Broken | P4 Minor]

## Steps to Reproduce
1. Go to...
2. Click...
3. See error

## Expected
[What should happen]

## Actual
[What happens]
```

## Labels

| Label | Use For |
|-------|---------|
| `spec` | Planned work |
| `bug` | Broken functionality |
| `task` | Quick work (<4h) |
| `blocked` | Waiting on something |
| `P1-Down` | Production broken |
| `P2-Degraded` | Feature broken, workaround exists |
| `P3-Broken` | Bug affecting users, not blocking |
| `P4-Minor` | Cosmetic, typo |
| `frontend` | UI/React |
| `backend` | NestJS/API |

## MCP Commands

```
# Get issue
mcp__claude_ai_Linear__get_issue(id: "KOA-123")

# Create issue (spec)
mcp__claude_ai_Linear__save_issue(
  title: "...",
  team: "${LINEAR_TEAM_NAME}",
  labels: ["spec"],
  state: "Grounding"
)

# Create issue (bug)
mcp__claude_ai_Linear__save_issue(
  title: "[BUG] [P2] ...",
  team: "${LINEAR_TEAM_NAME}",
  labels: ["bug", "P2-Degraded"],
  state: "In Progress"
)

# Update state
mcp__claude_ai_Linear__save_issue(
  id: "KOA-123",
  state: "In Proof"
)

# Add comment
mcp__claude_ai_Linear__create_comment(
  issueId: "KOA-123",
  body: "Grounding report..."
)
```

## Anti-Patterns

```
Bad estimates: using hours instead of small/medium/large
Bad states: using Backlog, Todo, or In Review
Skipping grounding: jumping straight to In Progress without grounding report
Skipping proof: moving to Done without proof
Missing severity: bugs without P1-P4 classification
Missing family: slices without family designation
Creating sub-issues in Linear (slices stay local in slices.yaml)
Not linking commits to Linear IDs
```

## Validation Rules

### Before /spec:start
1. Fetch issue state
2. Verify state is `Grounding`
3. If not, BLOCK with error message

### Before /epic:create
1. Use small/medium/large estimates per slice
2. Set all specs to `Grounding` state
3. Declare family per slice
