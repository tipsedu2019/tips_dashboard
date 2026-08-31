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
| Students/classes | Read API static review approved (`451b25d7`); UI pending | Service13/13; related41/41; combined88/88; focused ESLint/TS pass | Docker unavailable; candidate only | Pending |
| Tasks/retests/registration/transfer/withdrawal | Pending | Pending | Pending | Pending |
| Makeup/approvals/curriculum/class planning | Pending | Pending | Pending | Pending |
| Textbook operations/settings/auxiliary lists | Pending | Pending | Pending | Pending |

No row marked pending is complete. Foundation completion alone is not app-wide completion.

## Baseline

Before new numbered code, `b4bc900e` included61 passing tests from `management-page-size`, `management-request-lifecycle`, `management-progressive-loading`, and `management-students-toolbar`. This only establishes the previous behavior baseline, not numbered-pagination evidence.

Shared pager review approved both spec and quality. A controller integration check found the extracted brief had omitted exact shared interfaces; Task1 was reopened and repaired before consumers proceeded. Scoped re-review approved all four fixes: exported shared types, auto/manual preference behavior, loading/per-list label props, and later-block component assertions. The component tests now cover11–20 and21–26 as well as the first block. This remains component-level evidence, not live viewport QA.

The official shadcn CLI add encountered `ERR_PNPM_IGNORED_BUILDS` and attempted unnecessary dependency/Button changes. The inspected official registry Pagination primitives were adopted without modifying package-manager security policy, Button, package.json or the lockfile. This is not a dependency installation success claim.

## Local SQL capability

Read-only preparation found the existing top-level baseline manifest has28 validated final entries; active capture `47838c718a358344` is older, so new local verification uses `--review-head`. Preserve the active pointer, capture and existing final entries.

New migrations must be appended in order with exact SHA256 as `candidate`; promote only after local proof and rerun with `--require-final`.

Docker daemon is unavailable (`Cannot connect to the Docker daemon at unix:///Users/hyunjun/.docker/run/docker.sock`). The user was asked to start Docker Desktop while implementation continues. Do not claim SQL passed until an actual isolated run finishes.

The CLI wrapper is `.codex-temp/npm-cache/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase`; it requires appropriate host permission for its telemetry file. The colocated `supabase-go` lacks this runner's `db start`/`test db`, so it is not interchangeable.

Management candidate `20260831013310_management_numbered_pages.sql` has SHA256 `577a477ad1ef68ad44768a39adc2cd7acda0a782dd12d02d9038397d24a65667`. The isolated runner was attempted before/after registration and stopped at `db start` because Docker could not connect; no SQL executed. The candidate was not promoted. Exact SQL syntax, pgTAP, RLS-runtime and execution-plan claims remain unverified.

Existing runner `[inbucket]` deprecation output is separate from the Docker failure; it did not cause the failure and the runner config was not changed in this task.

Independent SQL/service source review found no blocking static implementation defect. Before accepting SQL proof, make DTO compatibility assertions fail when their matching cursor row is absent (test currently uses filtered rows under no_plan). Retain actual EXPLAIN JSON instead of treating presence of execution time as enrichment-plan proof. These review notes are not evidence of a database pass.

Fresh controller command at `451b25d7`:

```sh
node --test --experimental-strip-types tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs tests/management-numbered-service.test.mjs tests/management-page-size.test.mjs tests/management-request-lifecycle.test.mjs tests/management-progressive-loading.test.mjs tests/management-students-toolbar.test.mjs
```

Result:88/88 pass; fail/cancelled/skipped0. No fresh production-build claim is made for the numbered integration, because UI integration has not started.

## Pending user/environment input

- Start Docker Desktop so the isolated SQL gate can run; do not promote the migration candidate until it passes.
- Confirm whether preserving paginated settings' global reorder/add behavior may include changing their ordering/save API structure. The currently approved read-only mutation boundary cannot safely renumber only visible page rows. Operational list implementation plans and settings audit remain saved; no unapproved save API change was made.

## Browser and rollout boundaries

Prior localhost Browser reload was denied by URL security policy. That is not permission to use another browser/URL/CDP path. New rendered checks remain pending until access is actually allowed.

Keep the existing local production build until the numbered RPC prerequisites can be verified. Do not make the new UI silently fall back to full-table or intermediate cursor loads. Remote migration/deployment is a separate authorized step.
