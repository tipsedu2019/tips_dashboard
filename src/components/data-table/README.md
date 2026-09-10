# Data table presentation API

`data-table-surface.tsx` contains opt-in presentation primitives for operational tables. It does not own TanStack state, filters, selection, permissions, pagination, storage, or URL synchronization.

## Standard composition

```tsx
<div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
  <DataTableToolbar>{/* search, filters, primary action */}</DataTableToolbar>
  <DataTableViewport
    role="region"
    aria-label="학생 목록 스크롤"
    tabIndex={0}
    className="[&>[data-slot=table-container]]:overflow-visible"
  >
    <Table className={DATA_TABLE_TABLE_CLASS_NAME}>
      <TableHeader>
        <DataTableHeaderRow>
          <DataTableHeaderCell>이름</DataTableHeaderCell>
        </DataTableHeaderRow>
      </TableHeader>
      <TableBody>
        <DataTableBodyRow data-state={selected ? "selected" : undefined}>
          <DataTableBodyCell wrap>{longText}</DataTableBodyCell>
        </DataTableBodyRow>
      </TableBody>
    </Table>
  </DataTableViewport>
</div>
```

- `DATA_TABLE_LAYOUT_CLASS_NAME` supplies the single outer border, radius, background, and shadow. The shared toolbar, viewport, and pager classes use internal dividers and should stay unframed when composed inside it.
- `DATA_TABLE_HEADER_CELL_CLASS_NAME` and `DATA_TABLE_BODY_CELL_CLASS_NAME` expose the same 44px header, 48px body, and 12px horizontal padding to legacy settings tables that cannot yet use the components directly.
- Use `DataTableSortButton` inside a header cell. Pass the current `asc`, `desc`, or `false` state so the active sort remains visible and its accessible label describes the next action.
- Use `pin={{ left, layer }}` on matching header and body cells. Pinned body cells preserve the row hover and selection colors instead of masking them.
- Add `wrap` only to cells that can contain long operator-entered text. The base `ui/table` no-wrap behavior remains unchanged for legacy and dense tables.
- Use `DATA_TABLE_MOBILE_LIST_CLASS_NAME` for the padded mobile-card region when the desktop scrollport is hidden.
- When using `ui/Table`, override its immediate `table-container` to `overflow-visible` as shown above. The outer viewport must own both horizontal and vertical scroll for sticky cells and keyboard navigation to agree.
- Keep `DataTablePagination` as the numbered footer. Its contract is fixed page sizes 10, 15, and 20 with page buttons grouped in blocks of 10.

## Adoption boundary

The management student, class, and textbook lists, the operational textbook master, and the curriculum work queue use these primitives. `SettingsMasterHeader` and `SettingsTableFrame` use the same toolbar, viewport and cell tokens for existing settings consumers; the standalone settings frame supplies its own outer border. The class schedule workspace can adopt the composition when its interaction contracts are reviewed. Calendar grids, print/export layouts, and purpose-built schedule or textbook matrices should keep their dedicated table presentation; do not force them through these wrappers.

## Curriculum composition

The curriculum workspace uses the shared outer frame, toolbar, header/body cells, mobile list and pager. Its overlapping work classifications remain feature-owned filter buttons with `aria-pressed`, not navigation tabs. Show them once between filters and rows, including on mobile.

Use a `max-height` on the viewport so short lists shrink to their content. Its pager stays outside the viewport. Only a successfully accepted new page resets list scroll; pending and failed reads preserve the displayed rows and position. Detail links keep the accepted filter/page return URL and save the viewport scroll position for return navigation. Row keyboard handlers must ignore events from nested links so native link activation is not intercepted.

## Operational textbook stock

`TextbookTable` uses the same frame, viewport, cells, mobile region, pager and 40px selection targets. The feature owns its strict server order, subject groups, stock locations, selection and mutation flows. Render classification as wrapped school/grade and sub-subject lines so book titles retain enough space; subject remains visible in the group header. Repeated subject labels need distinct React keys derived from each contiguous group's first row ID. Do not regroup or sort the accepted page in the presentation layer.

Label the catalog `교재 재고`; it already contains stock quantities by location. Keep search and the four classification choices together with one conditional reset. Do not show heuristic stock/quality filters or optional-field warning badges. Expose inactive books with one pressed-state toggle; pending counts belong on the request, purchase and sale tabs. Use one refresh control beside the workflow tabs. Canonical URLs migrate retired stock/quality conditions to the active catalog before issuing reads, retaining the inactive catalog when explicitly requested. The master uses a full-width numbered pager inside the shared footer (`[&>div]:w-full` when wrapping `DataTablePagination`). Its initial read failure must not present an empty-library registration action. RPC-backed workflow tabs use manual keyboard activation and preserve their tabpanel while loading. The specialized purchase, sale and count renderers remain feature-specific.

## Purchase process composition

The specialized purchase process table keeps its feature-owned grouping and row actions. Put the book title first, followed by status and the requested/ordered/received stages; each stage displays explicitly labeled student and teacher quantities. Keep all six values and use authoritative summary totals, including an unknown state while the summary is unavailable. Requests show only the requested stage. Do not add inferred `판단`, shortage/surplus badges or duplicate class-fit summary cards. Preserve optional metadata columns and their existing storage key; the shared column hook drops retired keys while retaining other preferences. Long titles wrap on desktop and mobile. A primary row action advances the workflow; secondary operations use the shared dropdown menu and retain the existing permission, fresh-read and confirmation callbacks. The focusable outer scroll region owns horizontal scrolling, including when a nested `ui/Table` is used.

## Direct filters

`DataTableFilters` lays out labeled conditions directly below search and primary actions. Use `DATA_TABLE_FILTER_FIELD_CLASS_NAME` for each field, put lifecycle status first, and place one conditional reset at the trailing edge. The row wraps on desktop and uses two columns on mobile. Students use it for status and school conditions; class management and curriculum use it through `ClassFilterPanel`. Do not hide a single remaining condition inside a generic filter popover or repeat the selected values in a second row of badges. The caller continues to own filtering, dependent choices, page resets and URL synchronization.

`DataTableSelectFilter` composes the existing Label and Select with that same field width. Order/receiving uses scope, stage and textbook registration; sales uses status. Keep all valid options, including zero-count results. Optional authoritative counts appear inside the menu, while the trigger shows only the selected label. Set `textValue` to that label for keyboard typeahead. Do not replace the control or change its border/width when selected.

Keep search, filters, column settings and the primary add action mounted when results are empty or refreshing. A reset that sits among these fields stays in place and is disabled at the default value. Use the shared toolbar for all process lists. Keep the mobile total and action buttons on separate rows so changing totals cannot move buttons. Render accepted rows with their accepted filter until the next page is accepted, announce pending/stale results without adding layout height, and disable filter-scoped exports while the selected conditions differ from those rows. Preserve existing writer and selection guards.

## Table settings

`data-table-settings.tsx` provides a controlled popover, section, labeled select and column setting row. The caller owns grouping, sorting, visibility, width, order, persistence and reset behavior. `onReset` restores all table preferences; `완료` only closes the panel because changes apply immediately through existing callbacks.

The panel keeps its header and footer visible and scrolls only the body within Radix's available viewport height. Render one settings control per table: students, classes and textbooks all place it at the trailing edge of the search/action toolbar on every screen size. The action column is reserved for row actions. Keep sort options restricted to the real service's supported columns.

## Selection and action hierarchy

`DataTableSelectionCheckbox` keeps a 16px visual checkbox inside an associated 40px label target. It forwards checked, indeterminate, disabled and change props without owning selection state. Use zero horizontal cell padding and 4px vertical body padding for the fixed 40px selection column; mobile cards use the same component.

Student rows use `StudentRowActions` with the existing authorized withdrawal callback. The neutral more button opens an explicit 퇴원 처리 menu item; a missing callback disables the trigger. Ordinary 재원 and 수강 summaries stay neutral, while waitlist and other lifecycle states retain their existing distinctions.

`DataTableRowActions` supplies the same trailing primary action, accessible more trigger and aligned dropdown in student, request, purchase and sale rows. The caller supplies menu items, disabled state and callbacks. Use `DataTableDetailButton` for wrapped titles that open a dialog; keep navigation destinations as links. Do not attach mutation or permission logic to either presentation wrapper.

## Sale process composition

Use the shared frame, toolbar, viewport, selection target, cells, mobile region and row actions. Put the book title and recipient first, followed by status and quantity; wrap long titles and class names. Only show the next workflow action as a primary row button. Keep detail, cancellation, customer return and history deletion in the shared menu with their existing eligibility and fresh-read callbacks.

The toolbar shows authoritative quantity and amount once, with an explicit unknown state while the summary is unavailable. Group footers label their page-only quantity as `이 페이지 합계`. Place the historical ledger and its independent pager below the operational list; hide both only when the accepted history summary confirms zero source records.

Cache display references per accepted sale line for desktop and mobile, independently of selection. Changes to the accepted lines, sales, textbooks, classes, students or locations must invalidate this cache. Keep state grouping, server ordering, URL filters, paging and writes feature-owned.

## Inventory count composition

Use the shared frame, toolbar, viewport, cells, mobile region, selection target and footer for both the count list and its separate history. Read all active books (`audit: "all"` for service compatibility) without recommended/pending/done/all audit controls or status badges. The feature retains its authoritative location, accepted server order, drafts, selection revisions, read-before-write and idempotency rules.

`InventoryCountQuantityInput`, `InventoryCountSubmitButton` and `InventoryCountDifference` are shared by desktop and mobile. Keep zero as a valid count, distinguish a placeholder from a draft, and clear quantity and memo together. Both Enter and the visible submit action respect saving/schema-disabled states. Input and selection remain editable during pending work so the existing revision guards can preserve newer intent. Mobile selection uses the same state as the desktop table and enables the existing bulk workflow.

Put publisher and location beneath the wrapped book title. Show the actual last-count date or `실사 이력 없음`, without recommendation reasons or due labels. Keep current quantity, draft count, difference and memo; do not switch to an invisible completed filter after saving. An empty search, unavailable location, pending read and failed read must not all say there are no books. Historical names and memos wrap, and its own pager is kept inside the history frame. Fixed trailing headers need an opaque background and a stacking layer to avoid text from scrolling columns showing through.

## Retired textbook controls

The workflow has five tabs: `교재 재고`, `요청`, `주문·입고`, `출고`, and `재고 실사`. Monthly closing is retired at the user's request. Do not restore its navigation, list, creation, confirmation, detail, comparison or export controls without a concrete new workflow requirement.

Old closing URLs return to stock page one, retain a valid page size and discard closing detail/movement state before reads. The workspace does not mount closing list, preview, detail or movement readers. Existing stored records and backend contracts remain intact; UI retirement does not delete ledger data.
# Read failures

Use `DataTableWorkspaceToolbar.feedback` with `DataTableReadFeedback` to show read failures and their retry action in the existing command row. Keep search and filters mounted; do not insert a new alert above the whole workspace. Distinguish a failed read from a successful empty result. Pass a search ref for focus recovery when retry replaces the feedback with loading or normal actions. Keep resource selection, permission checks and retries in the feature.
