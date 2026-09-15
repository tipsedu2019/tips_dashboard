# T08 — table and toolbar density

2026-09-15. Existing compliant composition adapted; source/focused checks complete. T07 integrated gallery and route QA remain a required follow-up.

## Inventory and adaptation

- Existing `DataTableWorkspaceToolbar` already has stable search/action and conditions/summary rows; feedback replaces only the existing action slot. Reused this behavior without moving callbacks, reads, filter state, pagination, selection or column preferences.
- `DataTableSurface` now consumes central header 44px, row minimum 48px and cell padding 12px tokens. HTML table height remains extensible for long cells. Single surface uses explicit 8px radius with no shadow.
- Search occupies a stable named slot with 240px desktop minimum; the existing 340px action slot is retained. Existing mobile 44px / desktop 36px action sizing stays unchanged.
- Detail buttons retain full identity wrapping and now use neutral 600-weight text. Hover remains muted, selected rows accent plus the existing checkbox, focused controls use the common 3px ring/outline. No extra row click handler or selection semantics were added.
- Current management toolbar and filter compositions remain intact; the shared wrapper does not invent a new mobile filter policy.

## Verification

- `node --test tests/data-table-surface.test.mjs tests/data-table-pagination.test.mjs tests/numbered-pagination.test.mjs tests/management-filter-transition.test.mjs tests/common-controls-ui.test.mjs`: 35 passed, 0 failed, clean output.
- Added a rendered React DOM transition test: search input/filter/command-row/condition-row keep the same DOM nodes and entered value through ready→loading→error→ready. Focus stays on search; retry runs once and returns focus there.
- Updated that test harness to import React DOM after installing its DOM. The first run exposed its preexisting feature-detection ordering when the new test focused an input; the final run has no attachEvent/detachEvent errors.
- ESLint on the changed surface and row-actions components: exit 0, no output.
- Browser follow-up: 1440/390 student/textbook/class-plan 20-row long-identity internal scroll; actual 44/48/12 geometry, hover/selected/focus distinction; filter loading/error search/action y-shift target ≤2px; more-menu Escape focus. DOM tests alone do not prove pixel positions.
- No build, server restart, service change, real data mutation or deployment.
