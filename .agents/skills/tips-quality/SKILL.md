---
name: tips-quality
description: Route TIPS dashboard UI, React performance, Supabase/Postgres, and quality-guideline work to the repository's current contracts and the relevant maintained skill or canonical source. Use for non-trivial implementation, review, or guideline changes in this repository.
---

# TIPS Quality

Use the smallest relevant route below. User instructions and `AGENTS.md` remain authoritative.

## Shared grounding

1. Read [DESIGN.md](../../../DESIGN.md) for product priorities, existing tokens and components, interaction standards, and the management-list contract.
2. Inspect the affected source, its callers, and relevant tests before deciding what should change.
3. Keep code inspection, automated tests, browser evidence, production data, deployment, and provider outcomes as separate claims.

## UI and interaction work

- Start with the existing `components.json`, `src/app/globals.css`, `src/components/ui/`, and the feature's real states. Reuse or repair local components before adding another pattern.
- When available, use the provided `vercel:shadcn` skill for component mechanics. Apply it to this repository's installed components and configuration; do not migrate or overwrite components merely to match newer examples.
- For accessibility or UX review, use the official Vercel Web Interface Guidelines source pinned in [quality-sources.md](../../../docs/agents/quality-sources.md).
- The separate official Vercel `design.md` applies to Vercel-authored reports and proposals. Reuse its evaluation and feedback-routing method only; do not apply its logo, Geist, stylesheet, or brand system to TIPS.
- Verify the affected route at representative desktop and 390px mobile widths. Check the relevant keyboard, focus, loading, empty, error, dense-data, and long-content states.

## React performance work

- Establish a reproducible symptom and measurement first. Do not refactor only because a generic rule sounds faster.
- When available, use `vercel:react-best-practices`; otherwise read the revisioned canonical source in [quality-sources.md](../../../docs/agents/quality-sources.md).
- Re-measure under the same conditions and report the observed tradeoff. Preserve auth, role, data, and interaction behavior.

## Supabase and Postgres work

- Use `supabase:supabase` for Supabase product and security behavior. Add `supabase:supabase-postgres-best-practices` for query, index, schema, RLS, locking, or performance work. If unavailable, use the revisioned canonical sources in [quality-sources.md](../../../docs/agents/quality-sources.md).
- Determine the final active PL/pgSQL definition from the ordered migration chain. Preserve authentication, RLS/ACL, locks, idempotency, and no-send boundaries.
- Require the exact SQLSTATE evidence and a meaningful pgTAP assertion against that final definition. Reserve `40001` for a real concurrency collision.
- Keep local migration verification separate from production application and runtime evidence. External mutation still requires the authority established by the user's request.

## Guideline maintenance

- Read [quality-sources.md](../../../docs/agents/quality-sources.md) before changing this skill, `DESIGN.md`, or source attribution.
- Recheck the official text, revision, license, installed version, and actual repository behavior. Summarize only guidance that changes decisions; do not vendor whole external skills.
- Resolve conflicts in this order: user instruction, repository policy and domain contract, actual installed stack, task-relevant official guidance.

Choose verification proportional to the change. This skill does not add blanket approval, full-suite testing, or subagent requirements to ordinary small edits.
