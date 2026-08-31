# App-wide numbered pagination — verification ledger

Date: 2026-08-31. Branch: `codex/loading-performance`.
Design: `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`.
Implementation is authorized; remote DB migration, deployment and notification sends are not.

## Acceptance contract

Ten-number fixed blocks, one-page single arrows, global first/last double arrows, no ellipsis/page input. Rows10/15/20 with minimum10. Every numbered request loads only its target page and returns the authorized full-filter total. Preserve prior displayed rows/page/count until a new page succeeds; abort and reject stale results. Keep current-page selection, domain drafts/details and full-result aggregate/export scope.

## Evidence status

| Surface | Implementation | Unit/type/build | Final SQL/pgTAP | Rendered/live |
|---|---|---|---|---|
| Shared pager/preferences | Reviewed (`1f62316f`, including interface repair) | 14/14 behavior tests; focused ESLint/TS pass | Not applicable | Live viewport pending |
| Students/classes | Read API (`451b25d7`), SQL gate (`701e9a96`); UI (`0915e8d4`), first fix (`0a86a16a`) and final foundation fix (`97b17191`) reviewed and approved | Fresh combined foundation/query guard370/370; focused lint/TS, full ESLint0 errors/6 existing warnings, isolated production build81/81 pass | Final-only isolated pgTAP114/114 passed (unchanged; not rerun in final fix) | Pending |
| Tasks/retests/registration/transfer/withdrawal | Numbered read model, route integration and final integration fix `57ea0622` independently reviewed; local slice complete | Final selected regression **960/960**; TypeScript pass; focused lint 0 errors/3 legacy warnings; fresh isolated build **81/81** | Isolated final-only **613/613** plus baseline/catalog **1937/1937**; unchanged after UI-only final fix; required `20260831031913_ops_task_numbered_pages.sql` final hash retained | Browser-policy blocked; remote RPC/deployment pending |
| Makeup/approvals/curriculum/class planning | Pending | Pending | Pending | Pending |
| Textbook operations/settings/auxiliary lists | Pending | Pending | Pending | Pending |
| Teacher Google Chat identity table/cards | Identified in final inventory; auxiliary plan saved | Pending | Pending | Pending |

No row marked pending is complete. Foundation completion alone is not app-wide completion.

## Baseline

Before new numbered code, `b4bc900e` included61 passing tests from `management-page-size`, `management-request-lifecycle`, `management-progressive-loading`, and `management-students-toolbar`. This only establishes the previous behavior baseline, not numbered-pagination evidence.

Shared pager review approved both spec and quality. A controller integration check found the extracted brief had omitted exact shared interfaces; Task1 was reopened and repaired before consumers proceeded. Scoped re-review approved all four fixes: exported shared types, auto/manual preference behavior, loading/per-list label props, and later-block component assertions. The component tests now cover11–20 and21–26 as well as the first block. This remains component-level evidence, not live viewport QA.

The official shadcn CLI add encountered `ERR_PNPM_IGNORED_BUILDS` and attempted unnecessary dependency/Button changes. The inspected official registry Pagination primitives were adopted without modifying package-manager security policy, Button, package.json or the lockfile. This is not a dependency installation success claim.

## Local SQL capability

Read-only preparation found the existing top-level baseline manifest has28 validated final entries; active capture `47838c718a358344` is older, so new local verification uses `--review-head`. Preserve the active pointer, capture and existing final entries.

New migrations must be appended in order with exact SHA256 as `candidate`; promote only after local proof and rerun with `--require-final`.

The prior attempts failed because Docker was unavailable. On the user's explicit request, Codex ran `open -a Docker`; `docker info --format '{{.ServerVersion}}'` returned `29.6.2`. The isolated SQL gate subsequently passed114/114, and the official final-only runner returned `status:passed` with successful cleanup.

The CLI wrapper is `.codex-temp/npm-cache/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase`; it requires appropriate host permission for its telemetry file. The colocated `supabase-go` lacks this runner's `db start`/`test db`, so it is not interchangeable.

Management migration `20260831013310_management_numbered_pages.sql` retains SHA256 `577a477ad1ef68ad44768a39adc2cd7acda0a782dd12d02d9038397d24a65667`. Earlier pre-Docker attempts executed no SQL. After actual candidate pgTAP success, only this manifest entry was promoted tofinal; all28 earlier entries and migration bytes remained unchanged. Final-only verification passed again. This is local functional/RLS/ACL evidence, not remote application or production performance evidence.

Existing runner `[inbucket]` deprecation output is separate from the Docker failure; it did not cause the failure and the runner config was not changed in this task.

Independent SQL/service source review found no blocking static implementation defect. Commit`701e9a96` changed DTO parity to LEFT LATERAL with an explicit non-null match assertion; a local mutation replacing the join condition withfalse produced exactly3 expected failed assertions. Fixture-only corrections use the final school category enum and unlink the synthetic class roster before deleting its student, keeping the real delete guard active.

Nine complete wrapper EXPLAIN JSON plans (three list kinds × first/middle/final pages) are retained in the local SQL evidence. These tiny warm-cache postgres-fixture plans are privileged/structural, not representative authenticated/production latency. Optional nested auto_explain instrumentation emitted no nested plans; nested enrichment loop counts remain unobserved. No speculative index or constant-time OFFSET claim was made. The unmodified final-only runner was run separately and passed after the optional collector's plan-count check failed.

Final command: `node scripts/run-isolated-supabase-db-tests.mjs --review-head --execute --authorized --request-id numbered-pages-20260831 --test supabase/tests/management_numbered_pages_test.sql --require-final` with the documentedTASK_SUPABASE_CLI wrapper. Result:pgTAP114/114, exit0, cleanup/stop succeeded, temporary root removed. The controller independently confirmed only the pre-existing healthy `supabase_db_tips_obs_provider_zero_a1a462eb8257` container remained.

Fresh controller command at `701e9a96`:

```sh
node --test --experimental-strip-types tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs tests/management-numbered-service.test.mjs tests/management-page-size.test.mjs tests/management-request-lifecycle.test.mjs tests/management-progressive-loading.test.mjs tests/management-students-toolbar.test.mjs
```

Result:88/88 pass; fail/cancelled/skipped0. At that checkpoint UI integration had not started, so no numbered-integration production build was claimed then; the subsequent UI evidence follows below.

## Management UI integration

Commit `0915e8d4` adds the shared request controller and connects student/class tables to numbered reads, controlled server sort and URL page/sort state. It retains successful rows/page/count during pending/error, clears cross-actor presentation, migrates valid manual page sizes and preserves initial restored pages through auto measurement/default-period resolution. The review/fix status below supersedes this initial implementation evidence; foundation was not yet complete at that checkpoint.

Independent review found three consumer defects: urgent size preference versus Next transition page reset sent an unintended intermediate request; detail catalogs depended on unrelated metadata success; confirmed deletion retried twice. Fix `0a86a16a` reconciles request page/size before effects, separates authorized detail ownership and removes duplicate delete reconciliation. Actual production Page+hook tests use a suspended native-history transition; detail tests cover stats failure/role changes and deletion tests cover normal/final-page counts. Relevant235/235, focused lint/TS and isolated build passed. Scoped re-review approved the fix; the initial229-test result did not cover these defects.

Implementer final command: `node --test --experimental-strip-types tests/management-*.test.mjs tests/numbered-page-controller.test.mjs tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs`. Result229/229, fail/cancelled/skipped0; focused lint and non-incremental TypeScript exit0. Actual hook and real TanStack/shadcn component tests cover direct page11, stale/abort, actor/StrictMode transitions, header sorting, partial-page count and mobile measurement readiness. Superseded cursor/source assertions were updated; independent review checks their replacement coverage.

An isolated source copy at `/private/tmp/tips-task3-build.4uOr0v` compiled with `next build --webpack`: exit0,81/81 static pages. The temporary copy was never served and the existing localhost3017 `.next` artifact was not replaced. This is compile/component evidence, not authenticated live UI evidence. Exact commands and logs are in the Task3 report/local `/private/tmp/tips-task3-*-final.log` artifacts.

Task4 reproduced the numbered service's two static-recognition gaps (immutable AbortSignal aliases and `p_page_size` instead of legacy `p_limit`), plus three hook abort-alias findings. The narrow guard correction and final local gates are recorded below; no blanket or scalar exemption was added.

Read-only task/secondary preflights are saved in `docs/superpowers/plans/2026-08-31-task-workflow-preflight.md` and `2026-08-31-secondary-workflow-preflight.md`. They sharpen parent-count, metadata/facet, server-order, independent calendar/detail and auth contracts for later implementation; they are not implementation or SQL evidence for those routes.

## Task4 query guard and final local gates

Implementation `ea6f1b2a` recognizes immutable signal/8000ms const chains by their actual lexical declaration, including module/function/block ancestors. It rejects nearer unsafe shadows, parameters, destructuring/property aliases, mutable or reassigned bindings, forward references and cycles. All conditional paths still need a bound, and AbortSignal.any still requires exactly two non-spread elements. Native AbortSignal shadow bindings are not trusted. Arithmetic/property-derived timeout values remain unsupported.

Only `list_management_numbered_page_v1` is in the separate numbered-RPC registry. It requires exactly one direct `p_page_size` field with no ambiguous/spread envelope, rejects known invalid sizes (including9/11/31), and permits a dynamic size only because the final SQL rejects everything except10/15/20. Other list RPCs retain `p_limit`; scalar exemptions are unchanged. Future adapters must provide equivalent final ordered-migration and pgTAP proof before adding any registry entry; a client-side type or server clamp is insufficient.

Self-review reproduced a module-only8000→12000 edit escaping function changed-line selection. The fix compares raw baseline abort findings by exact chain and occurrence: a new `list_abort_signal_missing` is checked even outside the changed function. Safe alias rewrites and unchanged raw legacy findings remain unchanged. This is a narrow abort regression guard, not a generic dependency-span system.

Fresh local verification at Task4 (Node `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`):

- `node --test --experimental-strip-types tests/management-*.test.mjs tests/numbered-page-controller.test.mjs tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs tests/query-surface-budget.test.mjs`:351/351 pass,0 failed/cancelled/skipped; includes the full116-case query-budget suite with its prior104 cases unchanged.
- `node scripts/verify-query-surface-budget.mjs --surface management --base ff5c5ce4 --head HEAD`: exit0, no findings. The same command with `--surface all` also exits0.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0.
- `node node_modules/eslint/bin/eslint.js src tests middleware.ts next.config.ts`: exit0,0 errors and6 pre-existing warnings in academic timetable, task service, public cache invalidation and its integration test. Those files have no diff from Task4 base`ad519cf5`; the two large-file Babel notices are informational.
- Resynced isolated `/private/tmp/tips-task3-build.4uOr0v` with the existing repository node_modules symlink; `node node_modules/next/dist/bin/next build --webpack`: exit0,81/81 generated pages. Task4 analyzer/test bytes match the copy. No temporary server was started and the live workspace `.next` was not replaced.

Task4 rechecked the migration SHA256 above and its sole ordered definition; it did not rerun SQL, change SQL/manifest bytes, apply remote migrations or contact providers. The114/114 SQL result remains the earlier separately recorded local proof. Task4 independent review and scoped re-review are complete. The subsequent whole-foundation review and final fix are recorded separately below; no app-wide completion is claimed.

Task4 review round1 found that class static-block `var` declarations were incorrectly owned by the outer function, allowing an outer8000 const to hide a nearer12000 variable. Fix `d1822bdd` stops the owner search at the static block. RED/GREEN regression covers direct, destructured, hoisted, nested-block/function bindings and sibling/outside isolation; the full query-budget suite passes117/117 and focused source/test ESLint passes. Scoped re-review is complete and clean. The combined351-test/full lint/TS/build results above remain the preceding checkpoint, not fresh reruns after that scope fix; the later fresh370-test checkpoint follows.

## Final foundation fix — fresh local checkpoint

Whole-foundation review at `513437b8` found two Important consumer defects: normalization reordered the RPC's server-sorted rows, and the default class period was canonicalized only in the URL dedup key, leaving controller retry/clamp bound to an unresolved period. It also found an unknown total reported as a server-zero class count and stale Task4 review wording. Fix `97b17191` and QA `60f8a1f2` passed the independent final scoped re-review: both Important findings and the two in-scope Minor findings were addressed, with no new Critical/Important breakage. The pre-existing hidden-delete error remains explicitly deferred below. Foundation code is ready for dependent adapters; this is not rendered, remote or whole-branch release approval.

The numbered normalization path now preserves RPC order while retaining normalized fields and the legacy helper default. Real DTO -> numbered service -> hook -> TanStack/shadcn component tests cover literal descending[Z,A], natural numeric[Class2,Class10] and primary/secondary sorting. The class caption and actual pager distinguish initial failure/unknown count from a successful zero.

The approved additive `NumberedPageLoadRequest` contains `canonicalizeScope(scope:string):boolean`. A successful default resolver pins the current internal retry/clamp scope before the numbered read, including when that read fails. The callback cannot publish or relabel previous successful rows and expires when its particular read settles, before success/error observers run; stale/aborted/disposed and first-read callbacks during clamp returnfalse. The existing load/retry/dispose API and `NumberedPage<T>` payload are unchanged. Resolved-period presentation is also bound to the exact unresolved/canonical query scope, preventing old filter/actor/role results from fixing a new URL to the wrong period.

TDD reproduced6 initial hook/component failures,3 missing-controller-contract failures,3 prior-period ownership failures and1 error-observer callback failure before each respective fix. Additional resolver failure/stale/disable negatives protect existing behavior. The final new coverage is18 tests; retained tests cover initial page restore, atomic page-size transitions, StrictMode cleanup, separate detail catalogs and single-owner mutation reconciliation.

Fresh commands after all source/test fixes, using `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`:

- `node --test --experimental-strip-types tests/management-*.test.mjs tests/numbered-page-controller.test.mjs tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs tests/query-surface-budget.test.mjs`:370/370 pass,0 failed/cancelled/skipped, exit0. Includes unchanged full117-case query-budget suite. Log:`/private/tmp/tips-foundation-final-fix-tests.log`.
- Focused ESLint over the five changed source/test files and `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0, no output.
- `node node_modules/eslint/bin/eslint.js src tests middleware.ts next.config.ts`: exit0,0 errors/6 pre-existing warnings. The four warning-bearing files have no diff from `513437b8`; large-file Babel notices are informational. Log:`/private/tmp/tips-foundation-final-fix-lint.log`.
- Resynced `/private/tmp/tips-task3-build.4uOr0v`, excluding `.git`, `.next`, `node_modules`, `.codex-temp`, `.superpowers`, using its existing node_modules symlink. `node node_modules/next/dist/bin/next build --webpack`: exit0, compiled successfully,81/81 static pages. Log:`/private/tmp/tips-foundation-final-fix-build.log`. The copy was never served; live `.next/BUILD_ID` SHA256 remained `3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323` before/after.
- `git diff --check`: exit0. Management SQL SHA256 remains unchanged. No SQL/query-guard/manifest/dependency changes or SQL rerun occurred in this wave.

The controller independently reran the same370-test combination at`60f8a1f2`:370/370,0 failed/cancelled/skipped,27.308s. `verify-query-surface-budget.mjs --surface all --base ff5c5ce4 --head HEAD` also exited0 with no findings. Documentation-only`8e664390` preserves the approved canonical-scope callback and carries real RPC-to-consumer server-order tests into the next task workflow plan.

Still tracked, **not fixed**: the pre-existing list-delete error is hidden because confirmation closes before deletion and operationError is rendered only in the now-closed detail dialog. The failed-delete test proves retained rows/no refresh, not visible error feedback.

Rendered desktop/mobile/keyboard/viewport evidence, remote migration/deployment and representative performance measurements remain pending. The nine earlier privileged warm wrapper plans do not establish nested enrichment loop counts or production latency. No browser-policy workaround, remote mutation, push, deploy or send was used.

## Task read model checkpoint — historical pre-UI evidence

Commit `ebde2adb` adds `list_ops_task_numbered_page_v1` and the cache-free numbered task service for general/textbook tasks, registration parent cases, withdrawal, transfer and word retests. Independent review found that the new nested enrollment parser rejects legitimate canonical rows, nullable correction IDs and signed sort order. Fix `31b3c2b1` adds the strict persisted-shape union and populated-row regressions; scoped independent re-review marked R1 addressed with no new Critical/Important breakage. This completed the read-model gate before UI integration; the subsequent completed local UI slice is recorded below.

- Scoped Node regression: **396/396**, comprising new service68, existing task suites209 and query-budget119; zero failures/cancelled/skipped. TypeScript passed. Focused lint has zero errors and three pre-existing unused warnings in the legacy task service.
- Local Docker candidate: baseline/catalog **1937/1937**, new task plus retained cursor SQL **590/590**. After actual candidate success, only the new manifest entry was promoted; final-only rerun passed **568/568** new task SQL plus the same1937 baseline assertions. Both isolated projects stopped and temporary roots were removed.
- Exact final migration: `20260831031913_ops_task_numbered_pages.sql`, SHA256 `2f3303d4dda16d925e70ed11ee5ae6b676aa90f92493cc54e4b5263e3199362c`. Immutable-history validation confirmed29 previous final entries unchanged and one appended entry. The query guard registered this exact RPC only after final-only proof.
- Registration phone-ready fixtures use a disabled in-app rule/template; seed and read phases assert zero new deliveries. No trigger suppression, provider call or worker/send run was used.
- The separate existing `ops_task_completion_actor_test.sql` attempt failed before its16 assertions because its profile fixtures omit `auth.users` rows. It was not changed or claimed passing. The new suite independently covers stored actor snapshots, real auth/RLS and masked observation data.
- The R1 fix reproduced11 legitimate-row failures before implementation, then passed **143/143** new service/retained mapping cases. Final-only SQL rerun with populated canonical/correction rows passed **572/572** plus1937 baseline assertions; cleanup succeeded. Migration/hash/manifest stayed unchanged; the updated fixture hash is `6d586e617717264a375a949a6f69de575236a1f2da9cda03bb1ebf7a478a6cd2`. Narrow parser/test lint and full TypeScript passed. This later focused evidence supplements, rather than relabels, the earlier396-case run.

These are synthetic local correctness checks, not production latency measurements, remote RPC availability or rendered task UI evidence. Task screen/cache/draft integration is verified separately below.

## Task workflow slice verification — local only

The numbered task UI integration from `a19920d4` and its reviewed follow-up `0329233b` is covered as a local slice for `/admin/tasks`, `/admin/word-retests`, `/admin/registration`, `/admin/transfer`, and `/admin/withdrawal`. This is in-process/source and isolated-database evidence: it is not rendered desktop/mobile evidence, a live request proof, or remote RPC availability.

- Selected task/registration/retest/shared regression command: `node --test --experimental-strip-types tests/ops-task-*.test.mjs tests/registration-track-*.test.mjs tests/word-retest-expected-at.test.mjs tests/numbered-page-controller.test.mjs tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs tests/query-surface-budget.test.mjs` — **942/942** pass, zero failed/cancelled/skipped, exit0. It covers the task routes, stored actor presentation, retained cursor-service compatibility, the shared controller/pager/page-size preference, and the query budget without rerunning unrelated provider/notification mocks.
- Final-only isolated SQL command staged `ops_task_numbered_pages_test.sql`, retained legacy cursor `ops_task_page_reads_test.sql`, and repaired `ops_task_completion_actor_test.sql` together. Baseline/catalog was **1937/1937**; the three requested SQL files were **613/613**: numbered **575** (the prior572 plus three plan assertions), cursor **22**, and actor **16**. The runner exited0 and reported successful stop and temporary-root cleanup. The final migration remains `20260831031913_ops_task_numbered_pages.sql` with SHA256 `2f3303d4dda16d925e70ed11ee5ae6b676aa90f92493cc54e4b5263e3199362c`; no manifest or production SQL changed.
- The legacy completion-actor fixture first reproduced its old pre-assertion `profiles_id_fkey` failure with **0/16** assertions run. The compatibility repair seeds its three matching `auth.users` accounts, restores the signup-trigger-created profiles with an ID-conflict upsert, and pairs `request.jwt.claims` with `request.jwt.claim.sub` for both actors and the no-JWT historical phase. Its preserved **16/16** result is actor/backfill compatibility evidence only: the historical portion uses privileged DML and its existing transactional trigger toggles, not new RLS proof.
- The numbered fixture records exactly three warm `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` public-function wrapper plans for authenticated actor `94000000-0000-4000-8000-000000000001`, `general` filter `{taskType:"general",search:"np-fixture",statuses:[],queue:"inbox",requestedById:null,requestedTeam:null,assigneeId:null,assigneeTeam:null,focus:"none",sort:"due"}`, page size10, and pages1/6/11. Fixture count is101; wrapper execution times were4.330/4.336/4.194ms with shared-hit blocks595/595/559. These plans are warm after earlier fixture assertions and wrapper-only; no nested eligible-key/projector plan, loop count, constant-time OFFSET inference, or production-latency claim is made.
- `tsc --noEmit --incremental false` passed. Focused ESLint had0 errors and the three pre-existing unused warnings in `ops-task-service.ts` (`embeddedTaskRows`, `readTaskScopedTable`, `resolveRegistrationTrackSummariesForParents`); the Babel >500KB styling message for `ops-task-workspace.tsx` is informational. The text audit found no in-scope task record-list `다음30건`/`더 보기` control. Old cursor contracts remain separately exercised by the 22-case retained cursor SQL test.
- No application build input changed after Task2 R1's exact-source isolated build. Its never-served `/private/tmp/tips-task3-build.4uOr0v` webpack build remains **81/81** and is explicitly reused; the protected live `.next/BUILD_ID` SHA256 was rechecked as `3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323`. No build was run in the live checkout.

Browser access remains prohibited by the earlier localhost policy decision, so desktop/mobile rendering and authenticated network evidence are pending without workaround. No remote migration, provider/notification action, deployment, or send was performed.

## Shared exports for downstream adapters

| Source | Contract |
|---|---|
| `src/lib/numbered-pagination.ts` | `DataTablePageSize`, `DataTablePageSizePreference`, `NumberedPage<T>`, `getNumberedPagination({page,pageSize,totalCount})` |
| `src/components/data-table/data-table-pagination.tsx` | `DataTablePagination` / `DataTablePaginationProps`; successful displayed page/size/count, loading, per-list ariaLabel and preference callback |
| `src/hooks/use-data-table-page-size.ts` | `useDataTablePageSize(tableId)` → ready/pageSize/mode/setPreference/setAutoPageSize; wait for ready before loading |
| `src/lib/numbered-page-controller.ts` | `createNumberedPageController<T>({loadPage,onChange})`; unchanged load/retry/dispose; `NumberedPageLoadRequest` adds invocation-bound canonicalizeScope to scope/page/pageSize/signal; successful-envelope snapshot retention |

Adapters own filters/sort, authorized identity/role clearing, independent metadata/detail reads and domain drafts/aggregate/export semantics. They must not use cursor/full-table fallback or page-local aggregates to satisfy numbered UI. The task-owned local slice is complete and reviewed below. Academic/makeup/approval/curriculum, textbook/settings and auxiliary integrations remain pending under their separate plans.

## Residual control spot-check before task adapters

A read-only source search after the foundation gate found task/registration, curriculum/class-planning, textbook/supplier/publisher, settings and teacher Google Chat record-table surfaces in the existing domain plans. All were pending at that historical checkpoint; the task-owned local slice has since passed review. This is not a final app-wide coverage claim, and card-based makeup/approval counterparts must also be checked at their slice gates.

The residual text search also found intentionally separate controls: `class-schedule-workspace.tsx`'s lesson-textbook candidate list, `class-textbook-picker.tsx`, and `management-page.tsx`'s relationship picker keep their independent bounded selection readers. `nav-user.tsx`'s `더 보기` expands avatar presets, not database records. `notification-control-panel.tsx`'s table is the finite rule matrix, and `academic-annual-board-workspace.tsx` is the excluded school-by-month layout. Do not mechanically remove these controls to make a text search empty; the final audit must classify actual record-list scope.

## Resolved user/environment input

- Docker was launched directly on the user's request; the local daemon responds. Candidate promotion still requires a passing isolated SQL run.
- The user approved recommended save API improvements. Include transactional settings save/order/default handling to preserve cross-page behavior; do not renumber only visible rows, remove controls, broaden write authority, or change business semantics.

The settings plan is saved at `docs/superpowers/plans/2026-08-31-numbered-pagination-settings-workflows.md`. It uses chronological edits, server-side draft pages, atomic changed-only saves and actor/request retry receipts. This is an approved implementation plan, not a claim that settings APIs/UI are implemented.

The read-only compatibility review is preserved at `docs/superpowers/plans/2026-08-31-settings-save-plan-compat-review.md`. The plan now requires settings-local natural-sort equality parity, fail-fast teacher/profile prelocks and bounded implicit-FK lock waits, exact native lock errors, conservative existing-rights checks and limited-trust retry receipts. No new settings SQL has run and no receipt or lock guarantee is claimed as implemented.

## Browser and rollout boundaries

Prior localhost Browser reload was denied by URL security policy. That is not permission to use another browser/URL/CDP path. New rendered checks remain pending until access is actually allowed.

Keep the existing local production build until the numbered RPC prerequisites can be verified. Do not make the new UI silently fall back to full-table or intermediate cursor loads. Remote migration/deployment is a separate authorized step.

## Task-slice final integration fixes — I1/I2/I3 (2026-08-31)

Commit `57ea0622f96dfde99cd8a60cd702ea7d38995a73` resolves the whole-slice review's three Important findings. The independent scoped final re-review read `cef4e3a3..57ea0622` and marked I1/I2/I3 addressed with no new breakage. Task3 deliverables and the local task-workflow slice are complete; dependent adapters may proceed.

- I1: refresh keeps the current scope's pending/failed page-one reset or restored page-seven target instead of combining new filters/size with prior accepted page11. Six real hook/workspace RED regressions reproduced the incorrect page11 request; GREEN retains rows/count and accepted-only history writes. A separate paused-read regression protects the refresh enabled guard. Existing same-scope refresh and mutation-shrink clamp remain passing.
- I2: catalog enrichment leaves the stored completion-actor DTO label intact, including empty/absent labels, while requester/assignee/comment/attachment/event labels still enrich. Completed withdrawal-view raw DTOs traverse the real strict reader, mapper and workspace catalog composition; the actual table consumer retains `STORED ACTOR` or empty label through same-page reread and page replacement. The accepted DTO is separately rendered through the real private completion-detail panel to verify `STORED ACTOR` / `처리자 미기록`; this is downstream rendering evidence, not a claim that normal detail dialogs use numbered summaries. Normal independent exact-detail authority remains covered.
- I3: registration matching tracks and representative actions use both view and consultation owner from the accepted scope. Requested/completed consultation cases cover mine, pending/failed mine→all, successful all, the actual row-action URL, both rendered list mirrors, all-sibling DTO retention, server-search authority and unchanged parent order. Wire-null/all is translated to the model's undefined/all option.
- Final selected gate ran once after final application edits: **960/960 pass**, zero failed/cancelled/skipped, exit0 (36.34s). Persistent log: `/private/tmp/task-final-fix-selected-regression.log`. Command: `NODE --test --experimental-strip-types tests/ops-task-*.test.mjs tests/registration-track-*.test.mjs tests/word-retest-expected-at.test.mjs tests/numbered-page-controller.test.mjs tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs tests/query-surface-budget.test.mjs`, where NODE is `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.
- Nonincremental TypeScript exit0, no output: `/private/tmp/task-final-fix-typescript.log`. Focused lint exit0, zero errors, only the same three pre-existing unused service warnings plus the informational Babel large-workspace note: `/private/tmp/task-final-fix-lint.log`.
- Final source was resynced to never-served `/private/tmp/tips-task3-build.4uOr0v`; fresh webpack production build exit0, **81/81** static pages: `/private/tmp/task-final-fix-isolated-build.log`. Source checksum dry-run reports no differences. Live `.next/BUILD_ID` SHA256 remained `3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323`; `.next/build-manifest.json` remained `aac272c3ac88e8389ab35ebb9e4c6aeb13292e2a9dce55864bb29963dd28ddcf` before/after.
- This fix changes only the task hook/workspace, actual consumer tests and this QA evidence. No SQL/service/shared API/query guard/provider change or SQL/provider rerun. Prior **613 + 1937** SQL evidence remains separately attributed to Task3, not newly executed here. No browser, new server, policy workaround, remote mutation, push/deploy or send occurred. Independent scoped re-review is complete; these checks do not establish app-wide or production completion. The pre-existing service lint warnings and foundation closed-dialog delete-error feedback debt remain deferred, not fixed by this slice.
