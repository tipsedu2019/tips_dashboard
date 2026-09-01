# Task 1 report: shared ten-page pagination foundation

## Scope and base

- Base verified: `b4bc900e` is `HEAD` for this task workspace.
- Implemented only the shared pager foundation: UI primitive, pure pagination helper, page-size preference hook, shared data-table pager, and focused behavior tests.
- No domain feature, remote database, browser, deployment, provider, or notification changes were made. The approved shadcn registry CLI inspection did access the component registry; it did not change runtime dependencies or remote application state.

## Delivered behavior

- `getNumberedPagination({ page, pageSize, totalCount })` strictly accepts sizes `10`, `15`, and `20`; normalizes malformed pages to `1`; clamps known totals; preserves unknown totals as `null`; and emits fixed blocks of at most ten existing page numbers.
- Empty results retain page `1`, show a `0–0` range, no page buttons, and disabled navigation.
- `DataTablePagination` uses semantic native buttons with Korean labels, active `aria-current="page"`, First/Previous/Next/Last controls, row range/count or `건수 확인 중`, a wrapping current-number group, and the existing Select component when a page-size callback is supplied. It has no page textbox or fake links.
- `useDataTablePageSize(tableId)` starts `ready: false`, only becomes ready after guarded client-storage hydration, keeps versioned per-table manual `10/15/20` values, defaults to viewport-estimated auto sizing, accepts measured auto overrides, and tolerates malformed/blocked storage. Auto mode removes its manual preference rather than storing list data.

## TDD and verification

- RED recorded before implementation with:

  ```text
  node --test --experimental-strip-types tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs
  ERR_MODULE_NOT_FOUND: src/lib/numbered-pagination.ts
  ENOENT: src/hooks/use-data-table-page-size.ts
  ```

- GREEN: `node --test --experimental-strip-types tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs` — 10/10 passed.
- Focused ESLint on all six new source/test files — passed without warnings.
- `tsc --noEmit` — passed.
- `git diff --check` — passed.

The behavior tests cover literal 10/11/26 block cases; 0/1/9/10/11/20/21 totals; 9→10, 10→11, 11→10, and 20→21 boundaries; page sizes 10/15/20; invalid page/size including manual 5 rejection; unknown and empty totals; rendered number buttons, `aria-current`, disabled boundaries, First/Last callbacks, no textbox, and wrapping keyboard-native button controls; hydration; malformed storage; and storage access exceptions.

## shadcn provenance and fallback

- Official registry dry-run and source review ran with `shadcn@latest add pagination --dry-run`, `docs pagination`, `--view`, and `--diff src/components/ui/button.tsx`.
- The official generated `Pagination`, `PaginationContent`, and `PaginationItem` source was used in `src/components/ui/pagination.tsx` with this repository's existing `cn` helper and aliases.
- A real CLI add was attempted after the dry-run, but it attempted to overwrite the customized Button and add `radix-ui`; the command stopped at `ERR_PNPM_IGNORED_BUILDS` for `sharp` and `unrs-resolver`. Package manager security settings were not changed. The incidental package and lockfile changes were restored exactly (matching original lockfile checksum), and no new dependency was retained because this primitive only needs already-installed project dependencies.

## Self-review

- Confirmed no list-data persistence, no zero/5/30 page request values, no invented unknown total, no ellipses/input/fake anchors, and no number controls hidden on narrow layout.
- Confirmed only owned implementation/test/report files are intended for the commit; pre-existing task-planning/QA documentation changes remain unstaged and untouched.

## Fix round 1: exact extracted shared contract

### Why the initial signature diverged

The first extracted brief carried the behavior list but omitted the repeated exact contract section. As a result, the initial foundation supplied an object named `DataTablePageSizePreference` for the hook result, accepted only numeric manual sizes in `setPreference`, and let `setAutoPageSize` change a manual setting to auto. It also did not expose the automatic Select option, loading input, or per-list navigation label. The regenerated brief explicitly restored those requirements; this round aligns the foundation before any consumer integration exists.

### Changes

- Exported `DataTablePageSizePreference = 'auto' | DataTablePageSize` and `NumberedPage<T>` from the shared helper.
- Renamed the hook result to `UseDataTablePageSizeResult`. `setPreference` now accepts auto or one allowed manual size; `setAutoPageSize` accepts a required measured size and only updates already-auto state.
- Exported the exact `DataTablePaginationProps`, including `loading`, `pageSizeMode`, `ariaLabel`, and the union-valued page-size callback.
- Added the automatic Select item, kept its mode reflected in the Select value, forwarded `'auto'` unchanged, and disabled navigation while loading.
- Added focused render tests for per-list labels, automatic callback forwarding, manual-mode selection, loading, 11–20 and 21–26 visible number blocks, and measured auto sizing not overwriting a manual preference.

### Fix verification

- RED: `node --test --experimental-strip-types tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs` — 4 expected new-contract failures: missing exported union/envelope, default navigation aria label, auto preference rejection, and manual state overwritten by measured auto sizing.
- GREEN: same command — 14/14 passed.
- Focused ESLint on all shared source/test files — passed.
- `tsc --noEmit` — passed (including the paused Task 2 untracked files without edits).
- `git diff --check` — passed.

Only Task 1 shared source, focused tests, and this report are included in the fix commit. Controller documentation and paused Task 2 service/test files were left untouched.
