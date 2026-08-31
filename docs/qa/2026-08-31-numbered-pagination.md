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
| Students/classes | Read API (`451b25d7`), SQL gate (`701e9a96`); UI (`0915e8d4`) plus fix (`0a86a16a`) awaiting scoped re-review | Relevant235/235; focused ESLint/TS and isolated production build pass | Final-only isolated pgTAP114/114 passed | Pending |
| Tasks/retests/registration/transfer/withdrawal | Pending | Pending | Pending | Pending |
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

Commit `0915e8d4` adds the shared request controller and connects student/class tables to numbered reads, controlled server sort and URL page/sort state. It retains successful rows/page/count during pending/error, clears cross-actor presentation, migrates valid manual page sizes and preserves initial restored pages through auto measurement/default-period resolution. The review/fix status below supersedes this initial implementation evidence; foundation is not yet complete.

Independent review found three consumer defects: urgent size preference versus Next transition page reset sent an unintended intermediate request; detail catalogs depended on unrelated metadata success; confirmed deletion retried twice. Fix `0a86a16a` reconciles request page/size before effects, separates authorized detail ownership and removes duplicate delete reconciliation. Actual production Page+hook tests use a suspended native-history transition; detail tests cover stats failure/role changes and deletion tests cover normal/final-page counts. Relevant235/235, focused lint/TS and isolated build passed. Scoped re-review is pending; the initial229-test result did not cover these defects.

Implementer final command: `node --test --experimental-strip-types tests/management-*.test.mjs tests/numbered-page-controller.test.mjs tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs`. Result229/229, fail/cancelled/skipped0; focused lint and non-incremental TypeScript exit0. Actual hook and real TanStack/shadcn component tests cover direct page11, stale/abort, actor/StrictMode transitions, header sorting, partial-page count and mobile measurement readiness. Superseded cursor/source assertions were updated; independent review checks their replacement coverage.

An isolated source copy at `/private/tmp/tips-task3-build.4uOr0v` compiled with `next build --webpack`: exit0,81/81 static pages. The temporary copy was never served and the existing localhost3017 `.next` artifact was not replaced. This is compile/component evidence, not authenticated live UI evidence. Exact commands and logs are in the Task3 report/local `/private/tmp/tips-task3-*-final.log` artifacts.

The query-surface verifier currently reports two known static-recognition gaps for the otherwise validated management RPC: immutable AbortSignal aliases and `p_page_size` rather than legacy `p_limit`. Foundation Task4 will add narrowly validated recognition with negative tests; this gate has not passed yet and no blanket/scalar exemption is planned.

Read-only task/secondary preflights are saved in `docs/superpowers/plans/2026-08-31-task-workflow-preflight.md` and `2026-08-31-secondary-workflow-preflight.md`. They sharpen parent-count, metadata/facet, server-order, independent calendar/detail and auth contracts for later implementation; they are not implementation or SQL evidence for those routes.

## Resolved user/environment input

- Docker was launched directly on the user's request; the local daemon responds. Candidate promotion still requires a passing isolated SQL run.
- The user approved recommended save API improvements. Include transactional settings save/order/default handling to preserve cross-page behavior; do not renumber only visible rows, remove controls, broaden write authority, or change business semantics.

The settings plan is saved at `docs/superpowers/plans/2026-08-31-numbered-pagination-settings-workflows.md`. It uses chronological edits, server-side draft pages, atomic changed-only saves and actor/request retry receipts. This is an approved implementation plan, not a claim that settings APIs/UI are implemented.

The read-only compatibility review is preserved at `docs/superpowers/plans/2026-08-31-settings-save-plan-compat-review.md`. The plan now requires settings-local natural-sort equality parity, fail-fast teacher/profile prelocks and bounded implicit-FK lock waits, exact native lock errors, conservative existing-rights checks and limited-trust retry receipts. No new settings SQL has run and no receipt or lock guarantee is claimed as implemented.

## Browser and rollout boundaries

Prior localhost Browser reload was denied by URL security policy. That is not permission to use another browser/URL/CDP path. New rendered checks remain pending until access is actually allowed.

Keep the existing local production build until the numbered RPC prerequisites can be verified. Do not make the new UI silently fall back to full-table or intermediate cursor loads. Remote migration/deployment is a separate authorized step.
