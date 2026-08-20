# Standards

Concise reference documents for consistent implementation.

## Usage

Standards are auto-injected by Agent-OS based on file patterns. See `agent-os/standards-index.yaml` for the mapping.

Manual reference: `agent-os/standards/{name}.md`

## Available Standards

| Standard | Domain | Auto-Inject | Purpose |
|----------|--------|-------------|---------|
| `pulse-project.md` | Global | Yes | Pulse repo conventions — overrides house core where they disagree |
| `code-style.md` | Global | Yes | TypeScript/React conventions |
| `testing.md` | Global | Yes | Vitest patterns and requirements |
| `frontend.md` | Frontend | No | React/TanStack patterns (house core; not Pulse's stack) |
| `react-best-practices.md` | Frontend | Yes | React performance & quality checklist |
| `backend.md` | Backend | No | NestJS/Drizzle patterns (house core; not Pulse's stack) |
| `linear.md` | Process | No | Linear workflow conventions (MCP) |
| `estimation-standards.md` | Process | No | Estimation guide (small/medium/large) |
| `ppm-v4-process.md` | Process | No | PPM v4 process quick reference |

## Format

Each standard follows:
```
---
id: [name]
domain: [global|backend|frontend|cms|process]
version: [number]
updated: [YYYY-MM-DD]
applies_to: [glob patterns]
---

# [Name]

## Quick Reference
[Most common patterns - copy/paste ready]

## Patterns
[Detailed patterns with examples]

## Anti-Patterns
[What NOT to do]
```

## Rules
- Keep standards < 200 lines each
- Use real code from the codebase, never hypothetical
- Quick Reference section < 30 lines
- Rules first, explanations second
- Update `standards-index.yaml` when adding new standards
