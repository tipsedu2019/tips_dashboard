# Loading Performance Vertical Slices Design

**Status:** Approved on 2026-08-30  
**Scope:** Read performance, list density, request cancellation, and staged rollout  
**Out of scope:** Production deployment, remote migration application, provider changes

## Decision

Adopt the researched vertical-slice approach, but split it into two independently testable sub-projects:

1. Management list loading and density.
2. Textbook operations read-model replacement.

The management slice ships first because the repository already has a filtered keyset RPC with a `limit + 1` boundary, separate detail reads, and authoritative aggregate/filter RPCs. The textbook workspace follows as a separate database-backed slice because its current master table requires inventory, taxonomy, barcode, and quality fields that the management textbook projection does not contain.

## Shared Performance Contract

- Desktop list requests initiated by the new UI are limited to `10`, `15`, or `20` rows; `20` is the maximum initial list payload.
- A list page requests `pageSize + 1` rows from PostgreSQL and returns at most `pageSize` rows plus a stable cursor.
- Existing detail and relationship pickers keep their independent `30`-row contract unless their own measurements justify a later change.
- Search and domain filters are evaluated by the server across the whole result set.
- The canonical server order remains `(normalized name/title, id)` until a later RPC version accepts an explicit sort contract.
- Client-only sorting must not be described as whole-result sorting. The first management slice preserves it only for already loaded rows; whole-result server sorting is a separate follow-up.
- The first visible rows must not wait for aggregate counts or filter-option catalogs.
- Changing filters, page size, or route scope aborts the previous Supabase request. A generation/scope guard also prevents late continuation results from merging into a newer list.
- Aborted requests are silent. Real failures keep the previous rows visible and expose the existing retry path.
- Supabase automatic retries are disabled for these reads so one layer owns retry behavior.
- No new grid, query-cache, or virtualization dependency is added.
- Authentication, RLS/ACL, exact SQLSTATE behavior, and no-send boundaries remain unchanged.

## Sub-project 1: Management List Loading

### Existing reusable foundation

- `list_management_page_v1` already applies server filters and keyset pagination, accepts limits from 1 through 30, and returns one boundary row.
- `get_management_stats_v1` and `list_management_filter_options_v1` are already separate RPCs.
- `get_management_detail_v1` and relation-page RPCs already keep heavy detail data out of the list row.
- The UI already keeps old rows while a refresh is pending and restores list scroll after opening a record.

### First-slice behavior

The first management slice changes only list reads made by the student/class management pages:

1. Choose `10`, `15`, or `20` from available vertical space, with `20` as the large-viewport default.
2. A user-selected size is stored per management kind and overrides automatic sizing.
3. Pass the selected size through the page, hook, and list service; relation/detail/picker limits remain 30.
4. Start list, aggregate, and filter-option RPCs together, but publish list rows as soon as the list RPC finishes.
5. Use one `AbortController` for each list scope and compose it with the existing eight-second hard timeout.
6. Abort the previous initial or continuation request on scope change and component cleanup.
7. Re-check generation and request scope before a continuation page is merged.
8. Render compact desktop rows near 34px while keeping interactive targets at least 24px.
9. Preserve the current explicit “load next N rows” continuation control. Automatic infinite scroll is not introduced.

### Approved density adjustment (2026-08-31)

The user rejected a five-row fallback and approved retaining the minimum ten rows. Automatic sizing stays `10/15/20`; fitting every multiline row without any vertical scroll is no longer an absolute acceptance criterion.

- On desktop, constrain the table scrollport to the space left after the complete pager and shell bottom reserve. Keep the header sticky inside that scrollport and the pager outside it.
- Preserve every schedule, teacher, and classroom line. Scrolling reveals overflow; truncation and hidden rows are not substitutes.
- Apply the same scrollport bound to manual sizes. Internal scrolling must not change the automatic row capacity or issue new list requests.
- Keep the scrollport keyboard-accessible, start new pages at the top, and preserve its vertical position when returning from a record.
- Preserve the mobile student/class card layout and its normal page scrolling. Extremely short windows may also scroll the page instead of collapsing the desktop table below 160px.
- Browser acceptance now checks header/pager access, full last-row visibility after scrolling, page transitions, selected-row toolbars, and mobile behavior, rather than requiring zero vertical overflow in every data state.

### Compatibility choice

This slice does not lower the database function's 30-row ceiling. The same function is used by already deployed clients and a forced server cap would be a compatibility change. The new management list caller validates `10 | 15 | 20`; independent detail/relation callers retain 30. A later RPC version can lower the server ceiling together with explicit whole-result sort parameters.

### Completion evidence

- Unit tests demonstrate sizing boundaries and persisted override validation.
- Service tests demonstrate 20+1 behavior, caller-signal propagation, timeout composition, and `retry(false)`.
- Hook contract tests demonstrate abort cleanup, previous-row preservation, and stale continuation rejection.
- Focused management tests, lint, type/build checks, and browser checks at 768px, 900px, and 952px heights pass.
- Browser evidence records displayed row count, page scroll height, list request limit, and loading/error behavior.

## Sub-project 2: Textbook Operations Read Model

The textbook workspace currently starts as many as 17 broad reads, uses `select("*")`, computes inventory from the full stock-movement ledger in the browser, and only slices already-downloaded arrays for “load more.” Preserving its current master-table behavior therefore requires a dedicated database read model rather than connecting the smaller management projection.

The later textbook plan must provide:

- A master list RPC returning 20+1 textbook IDs and only the master-table projection, including barcode/taxonomy and inventory totals needed for the current UI.
- A separate summary RPC for total/filter/quality counts so page-local rows never masquerade as whole-result counts.
- A selected-textbook detail RPC for edit payload and history.
- Tab-scoped loaders; inactive order, issue, inventory, and closing collections are not fetched on initial master entry.
- Deferred or separately loaded inactive-tab badges.
- Real abort signals and `retry(false)` on every participating read.
- pgTAP coverage for the final active definitions, grants, RLS behavior, filtering, cursor continuity, and 20+1 boundaries.

This is intentionally not hidden inside the management slice: it has its own migration, rollback, performance-plan, and production-verification gates.

## Follow-up Work

After the first management slice is measured:

1. Add a versioned management RPC with an explicit, allow-listed server sort contract and cursor-bound sort fingerprint.
2. Replace accumulated-row pagination with true previous/next server pages and URL-restored page state.
3. Execute the textbook read-model plan.
4. Add textbooks, approvals, and makeup requests to the query-surface budget only when each surface has a bounded contract that can satisfy the guard.

## Release Boundaries

Report these independently:

1. Local unit/contract/build evidence.
2. Local pgTAP and authenticated execution-plan evidence when a migration exists.
3. Git commit/branch state.
4. Remote push or pull request state.
5. Vercel production deployment state.
6. Supabase migration application state.
7. Production runtime p50/p95, payload, and error-rate evidence.

Passing local tests does not imply that code was pushed, deployed, that a migration was applied, or that production latency improved.
