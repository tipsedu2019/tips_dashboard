# Task 4 report — mode-scoped operations reads

## Migration lifecycle

- `draft`: Supabase CLI v2.103.0 created `supabase/migrations/20260814035710_operations_scoped_reads.sql` via `migration new operations_scoped_reads`; the manifest began with a null hash.
- `candidate`: source-complete SHA-256 `266603c7b020c4e2b2681287f0f7bd63bd9ae411451b26778dd22a80a4abd87d` is recorded and equals the on-disk migration.
- `final`: not promoted. The isolated harness stopped before database allocation with `isolated_supabase_db_baseline_review_required`; migration replay and pgTAP runtime GREEN are not claimed.

## RED evidence

- The new operations service/source suite first ran **0 pass / 8 fail** because the mode service, migration, scoped hook, and mode UI did not exist.
- The visible-range calendar callback contract independently failed **0 pass / 1 fail** before `CalendarMain` exposed its exact rendered range.

## Implementation

- Replaced the initial 17-table operations fan-out with a discriminated `calendar | annual | class_schedule` request and one mode RPC per initial read.
- Calendar reads exactly the rendered inclusive range, rejects ranges over 42 days, returns at most 2,000 complete rows, and fails all-or-nothing with `visible_range_too_dense` plus a seven-day recovery. The last successful grid remains mounted.
- Annual board reads only the selected year, returns renderer-ready bounded entries and summary data, excludes full notes/raw curriculum payloads, and fails all-or-nothing above 4,000 entries or 400 KiB.
- Calendar and annual edit actions make no detail request before selection and use one exact `get_academic_event_detail_v1(eventId)` request after selection. Deep-linked calendar selection follows the same exact-detail boundary.
- Class schedule list sends the canonical term/search/subject/grade/teacher/sync-group filter scope to the server, uses Korean-numeric name plus UUID keyset order, reads 30+1 rows, appends/deduplicates `다음 30건`, and displays authoritative same-filter stats/options without browser re-filtering.
- Class list rows contain only explicit summary scalars and never read `schedule_plan`. The selected class continues to use exact `get_class_schedule_v1(classId,dateFrom,dateTo)` for its visible month.
- Small teacher/classroom/subject catalogs are bounded and cached for 30 minutes inside the authenticated user/role service scope.
- All read RPCs use an eight-second abort signal and disable automatic retries. New RPCs are fixed-search-path `security invoker` functions granted only to `authenticated`; no service-role client or new definer function was added.
- Extended the query-surface guard only for the exact scalar or internally bounded operations read contracts used by this surface.

## Source GREEN evidence

Focused command:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/operations-scoped-reads.test.mjs \
  tests/academic-calendar-ui.test.mjs \
  tests/academic-annual-board.test.mjs \
  tests/class-schedule-planner-calendar-toggle.test.mjs \
  tests/continuous-class-schedule-consumer-parity.test.mjs
```

Result: **38 pass, 0 fail**.

Additional verification:

- Query-surface budget regression plus Task 4 service suite: **64 pass, 0 fail**.
- TypeScript `tsc --noEmit`: exit 0.
- Operations query-surface guard: exit 0.
- ESLint on changed source/test files: exit 0 after resolving the only warning.
- `git diff --check`: exit 0.
- Task 4 migration lexical normalization: GREEN.
- Candidate manifest SHA-256 equals the on-disk migration SHA-256.

The repository-wide migration-layout suite remains blocked by the pre-existing Task 3 candidate `20260814011752_management_page_reads.sql` lexical-normalization finding. Task 4's `20260814035710_operations_scoped_reads.sql` is no longer in that finding.

## DB runtime gate — blocked, not passed

The authorized isolated command was attempted after the candidate hash update:

```bash
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id 8f4a17a0-a22d-4a75-8d41-bc45ca71c8b4 \
  --test supabase/tests/operations_academic_scoped_reads_test.sql
```

It stopped before allocation with `isolated_supabase_db_baseline_review_required`. No migration replay, pgTAP runtime, production query, migration application, deployment, worker, webhook, or provider activity occurred. The manifest therefore remains `candidate`.

## Boundary

Source implementation and source verification are complete. Runtime SQL behavior is specified in `supabase/tests/operations_academic_scoped_reads_test.sql` but remains empirically unverified until the reviewed isolated baseline gate opens. The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded from staging.

## Adversarial fix round 1

Review RED was **6 pass / 8 fail**. A second exact-wire-shape RED reproduced the stored metadata array loss as **0 pass / 1 fail**, and an annual-board read-save regression reproduced the missing metadata envelope as **0 pass / 1 fail**.

The round closes these source contracts:

- Exact event detail now returns the untouched stored note, parses `[[TIPS_META]]`, and preserves unknown metadata plus exam term, science area, scalar scopes, and structured scope arrays through both calendar and annual-board read-save paths.
- Annual RPC rows now carry renderer-ready `examTerm`, stable synthetic derived IDs, `parentEventId`, `sourceKind`, and one row per comma-delimited grade. Derived subject rows edit the parent academic event instead of masquerading as it.
- Lesson-design deep links hydrate the exact class ID even outside page one. The editor opens only after the exact legacy `schedule_plan`, connected textbooks, and subject-scoped teacher/classroom catalogs arrive; the initial class list still does not read `schedule_plan`.
- Continuation append captures both request revision and fingerprint and rejects stale rows or stale errors after a scope change.
- Dense calendar recovery retains the last successful monthly grid while loading and then renders an actual seven-day agenda. Returning to month mode cannot cache the seven-day response as a month.
- The exact lesson-design RPC and all other Task 4 reads remain eight-second/no-retry, authenticated-only, fixed-search-path `security invoker` boundaries. No new definer or service-role client was introduced.

Final source evidence:

- Task 4 focused UI/service/read-safety/query suite: **112 pass / 0 fail**.
- Exact operations plus query-budget suite: **70 pass / 0 fail**.
- TypeScript, targeted ESLint, operations worktree query guard, and `git diff --check`: GREEN.
- Candidate migration SHA-256: `b45e5a2d49ebe42780f08ced9d8a5094581c7f8cbef30538040607d5cde21940`, equal to the manifest and on-disk SQL.
- The repository-wide source run remains non-GREEN for unrelated notification fixture/golden drift already present in the shared branch. Migration-layout verification remains separately blocked by pre-existing Task 3 `20260814011752_management_page_reads.sql` lexical normalization. Task 4 focused verification is GREEN.

No DB runtime command was run in this fix round. The manifest remains `candidate`; migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, and provider effects are all unclaimed.

## Adversarial fix round 2

Round-2 RED was **0 pass / 5 fail** for the exact scalar/structured scope roundtrip, legacy title term inference, separate textbook candidate page, and calendar/annual fail-closed detail loading.

The round closes these source contracts:

- `EventFormData` and both calendar/annual save payloads retain legacy scalar `textbookScope` and `subtextbookScope` alongside structured scope arrays, including unknown embedded metadata.
- Calendar and annual deep-link/edit flows never open a summary-backed editor after an exact-detail failure. They remain closed, show the Korean failure state, and expose an explicit retry.
- Exact calendar normalization and annual derived subject rows infer renderer-ready exam terms from the original parent title, honoring explicit semester text before the date fallback.
- Lesson-design uses a separate subject-scoped, searchable 30+1 textbook candidate RPC. Connected legacy textbooks remain hydrated from exact class detail; candidate pages only extend the editor catalog and use stale-response revision guards.
- The initial class list still does not read `schedule_plan`; all new read functions remain eight-second/no-retry, authenticated-only, fixed-search-path `security invoker` boundaries.

Round-2 source evidence:

- New RED regressions after implementation: **5/5 GREEN**.
- Task 4 service/UI/continuous-schedule focused verification: **50/50 GREEN**.
- TypeScript, targeted ESLint, operations worktree query guard, and `git diff --check`: GREEN.
- Candidate migration SHA-256: `47d6af4718be42c95d402fe183a229d9709bc50e3523466d34a7b19b4a2cf67c`, equal to the manifest and on-disk SQL.
- The whole-repository glob is non-GREEN with 18 unrelated pre-existing/shared-branch failures: notification fixture/golden drift, the Task 3 management migration normalization gate, one notification worker contract, and one concurrent isolated PostgreSQL termination. Task 4 focused verification is GREEN.

No round-2 DB runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Adversarial fix round 3

Round-3 RED was **0 pass / 4 fail** for the calendar scalar-scope adapter roundtrip, the shared request-current predicate, calendar latest-selection wiring, and annual stale-result wiring.

The round closes these source contracts:

- Calendar exact-detail adaptation now forwards legacy scalar `textbookScope` and `subtextbookScope` with the structured arrays and complete embedded metadata. A direct exact-detail → calendar adapter → form scope → mutation payload regression preserves the full metadata envelope.
- Calendar and annual detail reads assign both a monotonically increasing request revision and an exact selected identity. Older success, failure, and `finally` completion paths cannot mutate editor, error, pending, or loading state.
- Deep-linked calendar selection uses the same guarded request path. User navigation or new-event creation explicitly invalidates an in-flight detail identity.
- No SQL changed in this round. The operations migration remains the same source candidate with SHA-256 `47d6af4718be42c95d402fe183a229d9709bc50e3523466d34a7b19b4a2cf67c`.

Round-3 source evidence:

- New regressions: **4/4 GREEN** after the recorded **0/4 RED**.
- Task 4 focused service/UI/continuous-schedule verification: **54/54 GREEN**.
- TypeScript and targeted ESLint: GREEN.
- Operations query-surface guard and `git diff --check`: GREEN.
- The repository-wide source glob is non-GREEN with 17 unrelated shared-branch failures: notification fixture/golden drift, one notification worker contract, and the pre-existing Task 3 management migration normalization gate. No Task 4 focused test failed.

No round-3 DB runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Adversarial fix round 4

Round-4 RED was **0 pass / 3 fail** for the actual hidden-scope form output, calendar view-context invalidation, and annual-board context invalidation.

The round closes these source contracts:

- `EventForm` no longer deletes existing scalar or structured textbook scope metadata merely because the selected event type hides the scope inputs. The actual form output retains both representations through save; there is still no implicit type-change deletion policy.
- Calendar date/range navigation, overflow navigation, new-event paths, and calendar visibility changes synchronously revoke the pending exact-detail revision and identity before changing view context. Stale success, failure, and `finally` paths therefore remain inert.
- Annual year, school category, semester, school, reset, invalid-school correction, highlighted-event semester, cell-create, and search-parameter context changes all revoke the pending exact-detail revision and identity before applying the new context.
- No SQL changed. The candidate migration and manifest remain byte-identical at SHA-256 `47d6af4718be42c95d402fe183a229d9709bc50e3523466d34a7b19b4a2cf67c`.

Round-4 source evidence:

- New regressions: **3/3 GREEN** after the recorded **0/3 RED**.
- Task 4 focused service/UI/continuous-schedule verification: **57/57 GREEN**.
- Exact operations plus query-budget verification: **76/76 GREEN**.
- TypeScript, targeted ESLint, operations worktree query guard, manifest hash, and `git diff --check`: GREEN.
- The repository-wide source glob was attempted twice but did not terminate: the first run remained in the unrelated registration-observation Google Chat provider-zero test for more than four minutes; a second run excluding that file remained in the unrelated notification adapters forward-install test. Both were stopped without changing source or external state. No Task 4 focused test failed.

No round-4 DB runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Adversarial fix round 5

Round-5 RED was **0 pass / 1 fail** for URL date/event context changes and successful calendar event drops leaving an older exact-detail request current.

The calendar now revokes the pending exact-detail revision and identity before applying a changed or removed URL date, before processing a changed or removed URL event, during the URL-event effect cleanup, and before updating the selected date after a successful event drop. Removing the URL event also clears the applied deep-link identity so the same event can be opened again later. Older detail success, failure, and loading completion cannot reopen or overwrite the new context.

Round-5 source evidence:

- New regression: **1/1 GREEN** after the recorded **0/1 RED**.
- Task 4 focused service/UI/continuous-schedule verification: **58/58 GREEN**.
- TypeScript, targeted ESLint, operations worktree query guard, and `git diff --check`: GREEN.
- No SQL changed. Candidate migration and manifest remain byte-identical at SHA-256 `47d6af4718be42c95d402fe183a229d9709bc50e3523466d34a7b19b4a2cf67c`.

No round-5 DB runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Final review remediation

Final-review RED was **0 pass / 4 fail** for the annual embedded-metadata projection, empty-scope school catalog, annual material/fallback renderer rows, and class-detail mutation refresh boundary.

- The annual list now emits bounded display scalars, scope badges, and capped material sections only. Full `embeddedNoteMeta` remains available exclusively from the exact event-detail RPC.
- The authenticated, invoker-scoped catalog now returns up to 200 academic schools and calendar/annual editors merge it with visible rows, so a first event can select a school even when the current range or year is empty.
- Annual renderer entries now include bounded exam-material/curriculum sections and synthesise missing subject date entries only when matching material exists, retaining parent event ID, split grade, and board entry type for exact-detail routing.
- Lesson-detail saves re-read and patch the selected exact detail plus visible schedule range. The 30+1 list refresh runs only if a displayed list-summary field changed; the legacy direct write is exact-key, bounded, timed out at eight seconds, and non-retrying.

Final-review source evidence:

- New regressions: **4/4 GREEN** after the recorded **0/4 RED**.
- Task 4 focused calendar/annual/class suite: **63/63 GREEN**.
- Exact operations plus query-budget verification: **80/80 GREEN**.
- TypeScript, targeted ESLint, operations worktree query guard, candidate hash, and `git diff --check`: GREEN.
- Candidate migration SHA-256: `0fadb63a8733b8a44c1940c20af553a0f2874b854250d0a05c9203a51a85d623`.

No DB runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Final Task 4 P1 remediation

The fresh review RED was **44 pass / 3 fail** for the server material projection, empty-year creation path, and post-mutation class refresh guard. A follow-up stale-route regression independently ran **0 pass / 1 fail** before the live requested-class identity ref was added.

This round closes the four P1 boundaries:

- Annual exam-material plans normalize both stored `exam_period_code` and each renderer entry's `examTerm` to the same four-value key. Fallback eligibility and material projection both require that exact key, so midterm and final materials cannot merge.
- Annual renderer projection now includes main academy-plan textbooks without requiring child `academy_curriculum_materials`, resolved child textbook labels, school curriculum profiles, supplement materials, and detail scope sections.
- An empty selected year exposes `첫 일정 추가`; it builds the first draft from the authenticated catalog's bounded academic-school list and the selected school/category instead of requiring an existing event row.
- Post-mutation lesson detail and visible-range refreshes capture a mutation revision and requested class ID. A newer request, route, or selected class revokes the prior refresh before it can replace detail or increment the range refresh nonce.

Final source evidence:

- Task 4 focused calendar/annual/class suite: **67/67 GREEN**.
- Operations worktree query-surface guard: GREEN.
- TypeScript and targeted ESLint: GREEN.
- Candidate migration SHA-256: `7f1f3a8a5f2b6224c15caf3e0888b9d999e00e74f597a3b1aa0ab442d8b44ee4`, equal to the manifest and on-disk SQL.
- The combined query-budget suite is non-GREEN only in two concurrent Task 6 worktree expectations involving `ops-task-service.ts`; Task 4's exact operations suite is GREEN. The repository migration-layout suite remains non-GREEN in unrelated pre-existing/shared notification cutover fixtures.

No DB runtime command was run. The new pgTAP fixtures specify period isolation, main/profile/supplement renderer parity, and scope retention, but migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Final Task 4 P1 remediation round 2

The latest review run was **48 pass / 4 fail**: the annual RPC still discarded explicit `academy_curriculum_plan_id` / `curriculum_profile_id`, the annual hover fallback merged every generic `시험범위` item into the textbook bucket, and class mutations created their UI refresh revision only after the mutation completed. The legacy annual model characterization for explicit links was already GREEN and served as the parity oracle.

This round closes the three P1 boundaries:

- Subject-detail rows retain both explicit curriculum identifiers and their separate textbook, supplement, and other scopes through the bounded annual CTE. A deterministic `selected_curriculum` lateral chooses exactly one source in legacy priority order: explicit academy plan, explicit school profile, first generic academy plan, then first generic school profile. Material and structured-scope projections join only that chosen plan/profile, so same-year/grade/subject rows cannot mix unrelated curricula.
- Annual output emits distinct scalar `textbookScope` / `subtextbookScope` values and capped structured `textbookScopes` / `subtextbookScopes` objects. Main books, plan materials, profile supplements, and categorized exam materials keep their own name, publisher, and scope fields. The UI fallback reads only labeled `교과서` or `부교재` sections and never treats the generic `시험범위` or `자료` bucket as a textbook.
- Each lesson session/content/generation mutation captures an immutable lifecycle token before its first write. Closing the editor increments the lifecycle revision. The post-mutation refresh checks the token before starting the exact detail read and again before committing; a late completion therefore cannot load or write detail, increment the visible-range nonce, or trigger conditional list refresh.

Source evidence:

- New behavior/source regressions: the four failing contracts are GREEN; the legacy explicit-link parity characterization remains GREEN.
- Two exact annual/operations files: **52/52 GREEN**.
- Task 4 focused calendar/annual/class/continuous-schedule suite: **72/72 GREEN**.
- TypeScript, targeted ESLint, operations worktree query guard, candidate hash, and `git diff --check`: GREEN.
- Candidate migration SHA-256: `5cf05b41ec9a5e0bf7fbbfd1fd2f3ad1442aa2ad13cb0353a29abdd77f167bf9`, equal to the manifest and on-disk SQL.
- The combined query-budget run is non-GREEN only in the pre-existing Task 6 real-legacy-task baseline expectation (`ops-task-service.ts`). Migration layout remains non-GREEN only for the separate Task 3 and Task 5 candidates; the Task 4 migration passes its lexical gate.

No DB runtime command was run. The expanded pgTAP fixture specifies explicit plan/profile priority and separated scalar/structured scope behavior, but migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.

## Fresh Task 4 P1 remediation after `0559051b`

The behavior-first review ran **30 pass / 5 fail**. The expected failures showed that scalar scope fallbacks had no usable name, annual completeness did not consume the shared normalized scope contract, and the class route/save lifecycle abstraction did not yet exist.

This round closes the three requested P1 boundaries:

- Annual completeness and hover warnings consume the same normalized textbook/subtextbook/supplement scope resolver as rendering. Structured and scalar scopes can coexist, labeled `교과서`/`본교재`/`교재` and `부교재`/`보충교재`/`보조교재` sections are compatible fallbacks, generic `시험범위` remains excluded, and unnamed populated entries receive the meaningful `교재` or `부교재` name.
- The lesson-design route owns one requested-class lifecycle. Route changes enter only the URL-requested class, effect cleanup revokes and clears the identity on dependency cleanup/unmount, explicit close and external detail navigation revoke immediately, and no selected-row fallback can preserve a removed `classId`.
- Session, content/plan, generation preview, and generation confirmation capture the lifecycle before their asynchronous work. Success, stale success, error, draft clearing, notice/error/loading, preview clearing/installation, detail/range refresh, and conditional list refresh all pass through the captured identity. After a committed session/content/generation write, public-class cache invalidation still runs before the stale UI gate and is therefore unconditional with respect to navigation.

Fresh source evidence:

- New lifecycle/scope regression run: **35/35 GREEN** after the recorded **30/35 RED**.
- Task 4 focused calendar/annual/class/continuous-schedule suite: **76/76 GREEN**.
- TypeScript, targeted ESLint, operations worktree query guard, and `git diff --check`: GREEN.
- Candidate migration SHA-256 remains `5cf05b41ec9a5e0bf7fbbfd1fd2f3ad1442aa2ad13cb0353a29abdd77f167bf9`, equal to both the candidate ledger manifest and on-disk SQL; no SQL or manifest bytes changed.

No DB runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, migration application, deployment, worker, webhook, provider request, and recipient receipt remain unclaimed; the manifest stays `candidate`.
