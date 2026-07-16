# Operational Safety and Notification Baseline

Date: 2026-07-16 (Asia/Seoul)

Status: **READY FOR TASK 1 THROUGH SUPABASE PLUGIN**

This document records only observed facts. No linked Supabase mutation,
provider request, push, or deploy was performed.

## Repository and worktree identity

- Root plan commit: `0f0d1b2590118cf8bb111069ffd4a1a87f178bf1`
- Implementation branch: `codex/operational-safety-notification-completion`
- Implementation worktree:
  `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/operational-safety-notification-completion`
- `origin/main`: `b212d43474ca96fbedb415034089ada559b3e724`
- Starting delta: 8 commits ahead of `origin/main` after the plan-only commit.
- The root checkout had only the untracked master plan before that plan was
  committed. No user application-code change overlapped Task 1.
- Existing worktrees were listed and preserved:
  - `/Users/hyunjun/.config/superpowers/worktrees/tips_dashboard/codex-makeup-requests`
  - `/Users/hyunjun/.config/superpowers/worktrees/tips_dashboard/public-classes-sanitized`
  - `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/registration-intake-routing`

## Planned-file and migration inventory

- No file matching `notification-control-plane`,
  `registration-appointment-calendar`, `registration-history-timeline`, or
  `registration-appointment-reminders` existed in the planned source,
  migration, or test paths.
- The latest local migration filename was
  `20260714104301_textbook_taxonomy_arrays.sql`.
- Every timestamp already named by the master plan was unoccupied in the local
  migration filename inventory.
- The Supabase plugin migration inventory was queried read-only and matched the
  latest local migration through `20260714104301_textbook_taxonomy_arrays`.

## Test and static baseline

| Gate | Result |
| --- | --- |
| Focused Node baseline | PASS — 140/140 |
| Full Node baseline | PASS — 1012/1012 |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm run lint` | PASS; existing Babel deoptimization notes for the two >500 KB workspace files |
| `git diff --check` | PASS; no output |

The isolated worktree dependency directory initially required repair because
the bundled fallback pnpm generated an untracked build-policy placeholder and
then left `node_modules` incomplete. The controller restored the worktree from
the root checkout's identical-lockfile `node_modules` and reran the exact type,
lint, and diff commands successfully. No dependency manifest or lockfile was
changed.

## Supabase plugin database identity

The connected Supabase plugin identified the healthy `tips dashboard` project
on PostgreSQL 17. Its migration inventory reaches
`20260714104301_textbook_taxonomy_arrays`, matching the latest local migration,
and both `registration_subject_tracks_runtime_version()` and
`registration_intake_workflow_runtime_version()` returned 1.

Docker and local pgTAP remain unavailable, but they are no longer prerequisites
for implementation. Database truth is checked through plugin reads, while new
database code is covered by migration/schema/service tests in the repository.

- Plugin migration inventory: PASS.
- Subject-track runtime marker: PASS — version 1.
- Intake-workflow runtime marker: PASS — version 1.
- Existing public atomic-create wrapper definition: inspected.

## Browser server state

A Next development server was initially proven on `127.0.0.1:3001` with PID
`71994`, the correct implementation-worktree CWD, and starting HEAD. Dependency
repair invalidated that process. During independent review, PID `74329` briefly
listened on the same port with the correct worktree CWD. At the final
`2026-07-16 22:53:26 KST` recheck, PID `74329` was no longer present and no
process listened on port 3001. Neither transient process has a current, complete
PID/CWD/HEAD ownership record, so Step 7 remains unchecked and the old port must
not be used as QA evidence.

No Google Chat, Web Push, or SOLAPI request was attempted. Browser interaction
QA will use the deterministic fixture runtime while the plugin supplies current
database migration and runtime truth.

## Next step

Proceed directly with Task 1 through TDD, using the Supabase plugin for current
database truth and deterministic fixtures for frontend interaction coverage.
