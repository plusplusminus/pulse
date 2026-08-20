# Clean Code & Architecture — house rules

Consumed by code-reviewer, the built-in /simplify, and improve-codebase-architecture. These are PPM's ratified choices, not generic advice — a model already knows clean code; this file records where WE land on the judgment calls. Grows only from ratified review findings.

## Architecture
- **Deep modules over shallow ones**: a module earns its interface by hiding real complexity. Many thin pass-through layers are a smell; collapse them.
- **Vertical slices**: features cut through the stack; shared code is extracted after the second use (rule of three applies to abstractions).
- **No client conditionals in shared code** — divergence by file structure, config, or tokens; never `if (client === ...)`.
- **Boundaries are contracts**: cross-module calls go through the module's declared interface; reaching into another module's internals is a finding, not a style preference.

## Code
- **Delete before you abstract**: dead code, unused params, speculative generality — removal is the first refactor.
- **Names carry the design**: a function that can't be named honestly is mis-factored — fix the factoring, not the name.
- **Comments state constraints, not narration** — why-it-must-be-so, never what-the-next-line-does.
- **Errors are handled or propagated, never swallowed**; empty catch blocks are findings.
- **Tooling-enforced rules are never review findings** — if a linter can catch it, wire the linter and drop it from human/agent review.

## Simplification posture (for /simplify runs)
Prefer: fewer concepts over fewer lines · reuse of an existing pattern over a locally-optimal new one · deleting an abstraction over documenting it. A simplification that changes behavior is a bug, not a simplification — gates must stay green.
