---
name: code-quality
description: Evaluate and improve code quality using Fallow analysis and evidence-based triage. Use for code-quality reviews, cleanup, and refactoring; documentation-only edits do not need this workflow.
---

# Code quality

Use Fallow to identify improvement candidates, then establish whether each candidate warrants a
change. A finding is a signal to investigate, not proof of a defect.

For review or audit requests, report findings and recommendations. Apply changes when the request
includes fixes, cleanup, or refactoring.

## Gather evidence

Select analyses that address the requested scope and run them from the repository root:

- `deno run -A fallow dead-code`: investigate reachability and unused code.
- `deno run -A fallow dupes`: investigate duplication and consolidation candidates.
- `deno run -A fallow health`: investigate complexity and maintainability.
- `deno task architecture:check`: check import boundaries using the project configuration.

For a broad audit, `deno run -A fallow` runs the combined pipeline. Consult
`deno run -A fallow --help` or subcommand help for version-specific options; see the
[official command reference](https://github.com/fallow-rs/fallow#commands) when needed.

Confirm that the analyzer covers the intended files and entry points. Check its handling of Deno
configuration, import resolution, tasks, and tests before trusting reachability findings. Correct
analysis configuration narrowly rather than restructuring application code to satisfy discovery.

The CLI uses the version pinned in `deno.json`. Report unavailable tooling, failed analysis, or
incomplete coverage instead of treating them as clean results. Continue useful manual analysis and
independent work within scope, identifying conclusions that remain unverified.

## Separate signal from noise

Before changing code, classify candidates as actionable, intentional or false positive, or
uncertain. Support the classification with code and usage evidence:

- For dead code, inspect callers, configured entry points, dynamic loading, side effects, and
  external consumers. Absence from a static import graph alone does not justify deletion.
- For duplication, establish that the code represents shared knowledge and should evolve together.
  Similar syntax across distinct domain concepts does not justify coupling them.
- For complexity, identify a concrete comprehension, correctness, or maintenance problem. A lower
  score is useful only when the design improves.

Prioritize confirmed issues by impact and task scope. Investigate uncertain findings; leave code
unchanged when evidence remains insufficient and continue with independent, supported findings.
Explain dismissals that affect confidence in the analysis or a decision the user needs to make. Keep
justified exclusions narrow; do not weaken thresholds or rename symbols merely to silence reports.

## Improve and validate

When changes are requested, make the smallest supported change that meets the repository's quality
standards while preserving intended behavior and meaningful names. Review proposed automated fixes
before applying them; never bulk-delete or refactor solely on tool output.

After edits, rerun affected analyses and the repository's relevant formatting, lint, type, and
behavior checks. Evaluate the actual improvement, not just disappearing findings. Report changes,
triage rationale, validation results, and unresolved uncertainty; distinguish pre-existing issues
from new regressions.
