---
id: ppm-v4-process
domain: process
version: 1
updated: 2026-03-05
applies_to: []
---

# PPM v4 Process Standard

## Quick Reference

- Every slice produces: Grounding Report → Proof → Delivery Note
- Three families: 1 (TDD), 2 (visual rounds), 3 (approval-gated)
- Linear states: Grounding → In Progress → In Proof → Done | Blocked
- Estimates: small / medium / large (no Fibonacci hours)
- Bugs: P1 Down, P2 Degraded, P3 Broken, P4 Minor
- Task track: sub-4-hour, compressed grounding + proof, no Judge approval
- Grounding MUST be approved before code. Proof MUST be approved before Done.
- "One scenario NOT covered" is the most important line in the proof.
- Delivery note required before Done — no exceptions.

## Artifact Templates

### Grounding Report

```
GROUNDING — Slice N: [name]

Schema verified:
  - [column/table confirmed or deviation found]

Patterns identified:
  - [existing code to follow, with file path]

Spec deviations:
  - [anything the spec assumed that the codebase contradicts]

What I don't know yet:
  - [genuine unknowns that could affect this slice]
```

An empty "What I don't know yet" field is a red flag, not a sign everything is fine.

### Proof

```
PROOF — Slice N: [name]

What was verified:
  - [behaviour description] ✓
  - [behaviour description] ✓

One scenario NOT covered by these tests and why:
  - [honest statement of what was left out]

Deviations from spec:
  - [anything that changed from what was specified]

Assumptions still open:
  - [anything unresolved that downstream slices may depend on]
```

A proof that claims complete coverage is almost always wrong. Honest gaps are more useful.

### Delivery Note

```
DELIVERY NOTE — Slice N: [name]

[What users can now do, in plain language. Not what was built —
what changed for the person using the product.]

Verified by: [N] tests covering [behaviours in plain language].
```

Forwardable to a client verbatim. No technical language.

## Family Execution

### Family 1: Spec-first (TDD)

Backend, business rules, integrations, API endpoints, queue workers.
Risk: wrong behaviour. Verification: tests.

1. Ground (confirm schema, patterns, deviations, unknowns)
2. Write failing test first — must fail before implementation
3. Implement minimum to pass
4. Refactor while green
5. Repeat for each behaviour
6. Produce proof

### Family 2: Visual feedback (rounds)

UI components, pages, layouts, dashboards, design system work.
Risk: wrong appearance. Verification: human eyes.

1. Ground (confirm components, patterns, design tokens)
2. Draft implementation
3. Screenshot / show in browser
4. Adjust based on feedback
5. Repeat rounds until it looks right with real data
6. Produce proof with screenshots
7. Judge reviews for component reuse, PM reviews for client intent (async)

### Family 3: Approval-gated (human approves before execution)

Migrations, Terraform, Kubernetes, production SQL, infrastructure.
Risk: blast radius. Verification: human approval of actual code.

1. Ground (confirm current state, proposed changes)
2. AI proposes the plan — actual SQL/HCL/YAML, not a summary
3. HARD STOP — human reviews the actual code line by line
4. Apply to staging
5. Verify result on staging
6. HARD STOP — human approves production execution
7. Apply to production

**AI never runs terraform apply, kubectl apply, or production SQL without explicit human approval.**

## Review Model

Four review moments, each catching different problems:

| When | What | Catches |
|------|------|---------|
| Before coding | Grounding report (human, 2 min) | Wrong assumptions, schema mismatches |
| During build | Quality gates (automated, instant) | Type errors, lint, test failures |
| After coding | Proof (Judge, 5 min) | Tested the wrong thing |
| Interface slices | Judge: component reuse. PM: client intent | Wrong patterns, wrong UX |

PRs are proportional to risk:
- Small slice + clean proof → merge after proof approval
- Large slice (10+ files) → Judge skims diff 5 min
- Family 3 → full line-by-line review

## Roles

- **Judge**: Spec author, slice approver, reads proof "one NOT covered" field first
- **Interpreter/Developer**: Validates grounding, steers AI, produces proof
- **Client Lead**: Owns Epic, chases blockers, visual sign-off on interface rounds
