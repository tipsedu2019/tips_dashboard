# Task 4 report — dashboard statistics DB source contracts

## Status

- Source implementation: **GREEN**
- Migration lifecycle: **candidate**
- Isolated pgTAP runtime: **BLOCKED before database allocation**
- Production database, deployment, provider, and recipient lanes: **not requested and not touched**

## Migration lifecycle

- `draft`: `supabase/migrations/20260813194812_dashboard_statistics_sources.sql`, created only by Supabase CLI v2.103.0 with `migration new dashboard_statistics_sources`; manifest hash `null`.
- `candidate`: SHA-256 `5b69ac8d86161ca82b84491dd4e3b851bcfc44cced7ea3fba06134cabffce482`, refreshed after review-fix round 2 and recorded after the migration, source contract test, and fixture-backed pgTAP source were written.
- `final`: not promoted. The approved reviewed active baseline capture is absent, so migration replay and pgTAP did not run. Promoting without pgTAP GREEN would violate the shared manifest lifecycle.

## Files changed

- `supabase/migrations/20260813194812_dashboard_statistics_sources.sql`
- `supabase/tests/dashboard_statistics_sources_test.sql`
- `tests/statistics-resource-pressure.test.mjs`
- `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- `.superpowers/sdd/2026-08-13-dashboard-home-statistics-lazy-loading/task-4-report.md`

The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded.

## RED evidence

After the exact CLI-created migration existed only as an empty file and its manifest entry was `draft`/null, the focused command was run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/statistics-resource-pressure.test.mjs
```

Result: 0 pass, 6 fail. The failures were the intended missing-contract failures:

- manifest lifecycle was still `draft` rather than candidate/final;
- the four-tab RPC and allowed filter/range branches did not exist;
- aggregate projections and heavy/private-field exclusions did not exist;
- the exact deterministic ICU `ko_numeric` collation guard did not exist;
- bounded normalized-name keyset drilldowns did not exist;
- the ACL/RLS/parity/payload-budget pgTAP source file did not exist.

An additional RED refinement was observed after the base branches existed: the aggregate source test failed until the full `DashboardConflictRow`/`source` field contract was projected.

Review-fix round 1 added five focused source tests covering all six findings. Before the SQL and pgTAP fixes, the focused suite reported 6 pass / 5 fail: executable fixtures, both exam rules plus stable-key merging, legacy textbook statuses plus multi-day schedules, duplicate JSON-id counts, and inferred-grade precedence were all RED.

## Source GREEN evidence

The exact Task 4 source verification command passed:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-resource-pressure.test.mjs \
  tests/dashboard-metrics.test.mjs
```

Result after review-fix round 1: 34 pass, 0 fail.

Additional checks:

- `"$TASK_NODE" --check tests/statistics-resource-pressure.test.mjs`: exit 0;
- `git diff --check`: exit 0;
- on-disk migration SHA-256 equals the candidate manifest hash exactly.

## Implemented contract

- Added the fixed `overview | students_classes | schedule_conflicts | textbooks` aggregate RPC with tab-specific subject/division/date validation and exact preset ranges.
- `overview` and `students_classes` share the existing KPI/filter meanings; only `students_classes` adds nested grade/school counts and grade/teacher/classroom group counts.
- Aggregate output never embeds student rosters or class drilldown rows and does not project full message/audit/contact/note content or full `schedule_plan` JSON.
- `schedule_conflicts` rejects subject/division filters, uses the existing bounded class-session date RPC for dated conflicts, and computes academy-wide teacher/classroom overlap branches.
- `textbooks` returns active title counts, active-class assignment counts, and period-bounded `pending | partial | done` progress counts.
- Installed `dashboard_private.ko_numeric` with ICU locale `ko-u-kn-true`, deterministic ordering, `IF NOT EXISTS`, and a fail-closed catalog definition check.
- Added student-roster, class-group, and class-roster RPCs. They accept only the documented enums, require server limit 30, read 31 rows, return 30, and use the same `btrim -> internal whitespace collapse -> sentinel -> ko_numeric` normalized-name key in cursor predicates, ordering, and returned cursors.
- All four public RPCs are stable SECURITY INVOKER functions with empty search paths and authenticated-only execute grants. Existing relation RLS remains authoritative.
- pgTAP source covers metadata/ACL, invalid tab/filter/range calls, 400-day academy-wide conflict branch parity, aggregate/drilldown separation, 31/read-30 and normalized cursor contracts, RLS-invoker behavior, and a 204800-byte budget for every aggregate tab.
- Review-fix round 1 replaced placeholder pgTAP checks with transactional fixtures and executable assertions: 31-student two-page cursor behavior, an authenticated class policy hiding one fixture row, exact 400-day teacher/classroom overlaps, both exam rules with two students merged per stable conflict key, helper parity, and actual serialized payload measurements.
- Exam conflicts now cover same-day/same-subject and day-before/other-subject rules and group affected students/event/detail IDs by the stable conflict key.
- Textbook status normalization recognizes `active | 사용중` and excludes `inactive | 미사용`; weekly minutes expand each parsed multi-day schedule slot while preserving the legacy dayless-range fallback.
- Enrollment and waitlist counts deduplicate JSON IDs within each class. Class grade groups and their drilldown use direct grade when present; otherwise they share the union of class-name and enrolled-student grade inference.

## Review fix round 2

### RED

The focused source suite was run before changing the migration. It reported 9 pass / 2 intended failures:

- the conflict source had no combined modern/fallback exam source and still read only `academic_event_exam_details`;
- the inferred-grade helper still returned class-name grades before enrolled-student grades instead of combining both when direct grade was absent.

### Changes

- Exam candidates now preserve the existing date-level precedence: all subject-bearing exam details are combined with subject-specific annual-board academic events, and `academic_exam_days` is used only for a student/date with no modern candidate. Detail rows are not filtered by their parent academic-event type.
- Same-day and day-before checks run against that shared per-student source, so a same-subject candidate suppresses the day-before-other-subject rule consistently across detail, direct-event, and fallback records.
- Stable exam keys remain `exam:v1:<class>:<exam-date>:<rule>`; grouping still merges affected student, event, and detail IDs under that key, and the existing row/source output shape and ordering are unchanged.
- When a class has no direct grade, the grade helper now returns the distinct union of grades parsed from the class name and grades present on enrolled students. The aggregate and class-group drilldown call the same helper.
- The pgTAP fixture now places a duplicate registered ID directly in class 301's `student_ids`. It asserts the source duplicate exists, the aggregate/class-group count is deduplicated, and both class-roster pages contain 31 distinct students.
- A two-school, multi-grade inferred class fixture asserts the `중2` aggregate class group and `grade=중2` drilldown both resolve to the same class. Exam fixtures separately cover direct subject academic events, date-level legacy exam-day fallback, and a detail whose parent event is not an exam type.

### GREEN and blocked DB lane

Fresh source verification after round 2 passed 34/34:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-resource-pressure.test.mjs \
  tests/dashboard-metrics.test.mjs
```

`"$TASK_NODE" --check tests/statistics-resource-pressure.test.mjs`, `git diff --check`, and candidate hash equality also passed. The authorized isolated DB command again stopped before allocation with `isolated_supabase_db_baseline_review_required`; therefore the new pgTAP assertions remain fixture-backed source coverage, not a claimed pgTAP runtime pass.

## DB runtime gate — blocked, not passed

The exact authorized harness shape was attempted with a generated non-secret request ID:

```bash
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id "$TASK_REQUEST_ID" \
  --test supabase/tests/dashboard_statistics_sources_test.sql
```

Result: exit 1, exact output `isolated_supabase_db_baseline_review_required`.

The runner stopped at the reviewed active-baseline gate. It did not allocate/start a database, replay migrations, execute pgTAP, read production, or apply any production migration. Consequently this report claims source GREEN only and the manifest remains `candidate` with its matching hash.

## Self-review

- Rechecked that aggregate function bodies do not invoke any of the three drilldown RPCs.
- Rechecked that `students_classes` aggregate has counts/groups only, while identifiable student/class rows exist only behind explicit drilldown calls.
- Rechecked the tab parameter matrix: subject on overview/students/classes/textbooks only; division on overview/students/classes only; dates on conflicts/textbooks only.
- Rechecked public ACL signatures and absence of SECURITY DEFINER in the new migration.
- Remaining empirical risk is exactly the blocked PostgreSQL lane: SQL execution, fixture parity, RLS behavior, and measured fixture payloads are specified in pgTAP source but cannot be claimed passed until a reviewed active baseline is available.
