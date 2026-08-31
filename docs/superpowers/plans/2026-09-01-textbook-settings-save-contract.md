# Textbook editable settings — closed read, draft, save and UI contract

Root design ruling on2026-09-01 at f29765fa while Task3c implements. This closes the source-only questions in `task-6-owner-settings-preflight.md` and `subsubject-preflight.md` under this plan's SDD directory; it does not implement an API. The existing plan remains authoritative for unchanged details. Revalidate the ordered final schema/ACL at dispatch. PostgreSQL17 `SHARE ROW EXCLUSIVE` blocks ordinary row writers while allowing plain readers, transaction advisory locks are short-lived, `lock_timeout` applies to each lock acquisition, and core `sha256(bytea)` avoids a new extension dependency. Primary references inspected: [PostgreSQL17 locking](https://www.postgresql.org/docs/17/explicit-locking.html), [lock timeout](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-LOCK-TIMEOUT), and [SHA256](https://www.postgresql.org/docs/17/functions-binarystring.html).

## Reviewable delivery boundaries

The former Task6/7 implementation is too broad for one review seat. Keep one UI and one Save button, but deliver three reviewed checkpoints:

1. **Task6a — owner APIs and owner-only atomic save foundation.** Three numbered reads, two selected-owner details, strict adapters, draft reducer/preview parity and an owner-only final save RPC. The save body has `subSubjects:null`; a non-null value is invalid until Task6b. No workspace UI changes.
2. **Task6b — taxonomy API and shared-save extension.** Add the projected taxonomy page and replace the already-final save body in a new additive migration so an included owner and taxonomy journal commits or rolls back together. Still no workspace UI changes.
3. **Task6c — all three settings tabs and shared atomic Save integration.** Replace full publisher/supplier/taxonomy list loading together, preserve complete owner drafts and chronological taxonomy journal, and use the already complete common save. A separate partial-UI bridge would need a full taxonomy transfer or a second mutation coordinator; neither is needed.

Each checkpoint has its own TDD/report/review and commit. The branch is not released between them. This sequence never introduces a new atomic owner write followed by a legacy taxonomy write.

## Exact Task6a read contracts

Create these public invoker RPCs and named service methods:

- `list_textbook_publisher_page_v1(p_filters jsonb,p_draft jsonb,p_sort text,p_page integer,p_page_size integer)` / `listTextbookPublisherPage`.
- `list_textbook_supplier_page_v1(...)` / `listTextbookSupplierPage`, with the same five parameters.
- `list_textbook_supplier_setting_picker_page_v1(...)` / `listTextbookSupplierSettingPickerPage`, with the same five parameters.
- `get_textbook_publisher_setting_detail_v1(p_id uuid,p_draft jsonb)` / `getTextbookPublisherSettingDetail`.
- `get_textbook_supplier_setting_detail_v1(p_id uuid,p_draft jsonb)` / `getTextbookSupplierSettingDetail`.

Page services take `PageRequest<SettingFilters,"name"> & {draft:OwnerDraft|null}`, followed by optional TextbookReadOptions. Detail services take `{id:string,draft:OwnerDraft|null}` and the same options. All page filters are exactly `{search:string}` and sort is exactly `name`; requested page is positive and page size is10/15/20. Page responses echo an off-end request with full matching count and empty rows. They additionally return `baseRevision` and `ownerCounts:{publishers,suppliers}` over the entire projected unfiltered authorized source. The shared controller alone clamps and reloads. Details return `{row:null|row,baseRevision,ownerCounts}` independently of page/search.

`PublisherSettingsRow` is `{id,name,subjects,suppliers,textbookCount,isNew}`. `suppliers` is the publisher's complete ordered `{id,name}` list, not the picker page and not a current-page subset. Source-only `source_notion_url`, publisher memo/URL-array and link memo remain untransferred and untouched. `SupplierSettingsRow` is `{id,name,contact,memo,linkedPublisherCount,linkedPublisherNames,isNew}`; `linkedPublisherNames` is exactly the first3 Korean-numeric display names while the count and server search use all projected links. `isNew` is true only for journal adds.

The picker page returns projected nondeleted supplier `{id,name}` options by server name search/order. Its ordinary UI uses size10 and ten-number blocks; checked IDs live in the complete publisher draft/detail, not in picker rows. A missing selected ID or selected detail is never inferred from an empty picker page. Missing selected owner returns row:null; invalid UUID/filters/draft/sort/page return22023.

With `p_draft:null`, source order is the existing raw name-ascending database order stabilized by real ID ASC. Existing base rows retain that base position after draft rename. New draft owners precede base rows in reverse chronological add order, matching current prepend behavior. Deletion removes a row; patch preserves position. Filter/search and authoritative count occur after projecting the full journal and before key pagination. Search exactly preserves current `query.trim().toLowerCase()` substring behavior over publisher `name + subjectLabel + every linked supplier name`, and supplier `name + every linked publisher name`; it does not search contact/memo, collapse inner whitespace, add NFKC or use fuzzy scoring. Execute literal old-JS oracles for whitespace/Korean/Latin cases rather than assuming SQL parity.

Persisted publisher links have a newly explicit canonical read order: `is_primary DESC, priority ASC, real link ID ASC`. This is the order already used by the reviewed configured-supplier SQL. An untouched relationship keeps raw link records unchanged even if legacy priority/primary data is odd. If a relationship is explicitly edited, final ordered IDs use first=true/priority1 and later=false/index+1; update existing pair rows in place to preserve link IDs/memo/timestamps, delete removed pairs and insert only added pairs. A scalar owner edit never rebuilds links.

Publisher textbook count preserves the old whole-source rule against the canonical persisted publisher identity, not a draft-renamed label: nonblank `publisher_id` wins even when dangling; only absent ID falls back to the last publisher in canonical base order with an exactly equal trimmed name. It includes inactive caller-visible books. Draft-added owner count is0 and rename does not dynamically move a count. Book rows are a display-count source, not part of the settings write revision.

Supplier reverse previews use every projected publisher/link, including off-page drafts. Their display names are Korean numeric sorted with a stable ID tie, while search concatenation uses full projected owner source order as before. Deleting a supplier removes it from every projected publisher link list. Those reverse-linked publishers are explicitly affected by that delete: the first remaining link becomes primary and remaining links receive1-based priority when the save executes. Unrelated publishers are not rewritten.

## Draft and revision envelope

Task6a `p_draft` is null or exact:

```ts
type OwnerDraft = {
  version: 1;
  baseRevision: string;
  operations: Array<
    | { type: "publisher.add"; id: string; name: string; subjects: string[]; supplierIds: string[] }
    | { type: "publisher.patch"; id: string; patch: Partial<{ name: string; subjects: string[]; supplierIds: string[] }> }
    | { type: "publisher.delete"; id: string }
    | { type: "supplier.add"; id: string; name: string; contact: string; memo: string }
    | { type: "supplier.patch"; id: string; patch: Partial<{ name: string; contact: string; memo: string }> }
    | { type: "supplier.delete"; id: string }
  >;
};
```

UUIDs for adds are generated once in the browser and retained across replay. Keys and values are exact; patch is nonempty; arrays are arrays of strings; IDs and every submitted supplier reference are UUIDs. Unknown fields, repeated supplier-ID values (by UUID identity), add-ID reuse and impossible lifecycle transitions fail22023. Subject strings retain legacy normalizeList trim/nonblank/exact-dedup meaning. Consecutive keystroke patches to the same owner/field may be coalesced client-side without crossing an add/delete/link operation; semantic order is otherwise retained.

The opaque lowercase64-hex `baseRevision` hashes every RLS-visible persisted publisher, supplier and link row, including hidden preserved values, IDs and timestamp nulls, sorted by ID and serialized with explicit nulls. Timestamp serialization is explicitly UTC and independent of session TimeZone/DateStyle; the core pg_catalog SHA256 implementation needs no pgcrypto grant. It does not hash page/search, book counts or transferred draft values. The same canonical helper is shared by read, preview and save. A nonnull draft must match current base; mismatch is55000 with `textbook_settings_revision_conflict`, never a manually assigned40001. Read-only null draft returns current revision. Reads remain one statement snapshots and never write/lock.

Full draft projection happens server-side before page selection. Read adapters require exact row/reference/count consistency and fail malformed/incomplete responses. There is no catalog cap, client traversal, page-overlay approximation or full source transfer. The three pages alone enter the exact numbered-RPC registry after final proof; details and save are separately named nonpageable boundaries.

## Atomic save and replay

Task6a creates `save_textbook_settings_draft_v1(p_request_id uuid,p_draft jsonb)` / `saveTextbookSettingsDraft({requestId,draft},options)`. The exact body is `{version:1,owners:OwnerDraft|null,subSubjects:null}`; both null is invalid22023. Task6b extends `subSubjects` in an additive replacement without changing owner semantics. The service sends one caller/deadline AbortSignal, eight-second timeout, retry(false), strict response and no automatic write retry.

Read authority remains current authenticated SELECT for all dashboard roles under caller RLS; no admin-only read guard is introduced by navigation assumptions. UI editing controls and save remain admin/staff. The save RPC explicitly checks admin/staff and relies on caller RLS/DML; forbidden is42501. PUBLIC/anon execute is revoked and authenticated granted. No definer or new table/policy grants on existing domain tables.

Create non-exposed schema `textbook_settings_private` and receipt table keyed `(actor_id,request_id)` with request hash, narrow result JSON and created_at. Grant authenticated only schema USAGE plus table SELECT/INSERT under own-actor RLS; revoke PUBLIC/anon and UPDATE/DELETE/TRUNCATE/CREATE. It is not a security/audit record and has no expiry in v1.

Save sequence is fixed:

1. Resolve auth/role, establish function-local1s `lock_timeout` (including the request lock), take a transaction advisory lock namespaced to `(actor,requestId)`, and check own receipt before any base revision. Matching semantic request hash returns the stored result; mismatched reuse raises22023. Request hash includes the exact semantic body/base/chronological operations and excludes page/search/preview generation. Restore the prior timeout at function exit; do not change session/global defaults.
2. For each included section acquire collection `SHARE ROW EXCLUSIVE` locks in the same fixed order: publishers, suppliers, publisher-supplier links, then taxonomy when Task6b adds it. Taxonomy-only skips owner tables; owner-only skips taxonomy. This blocks legacy DML while plain SELECT can continue. Preserve native55P03/40P01 and any genuine database concurrency state; no automatic retry or manual40001 domain mapping.
3. Recompute included canonical revision(s) after locks. Stale base raises55000. Project every included operation and validate the complete submitted final state before DML. Blank final names on any dirty retained owner fail22023. Trim name/contact/memo on save, normalize publisher subject and supplier-ID arrays exactly as legacy helpers, and rely on real FK/UNIQUE/CHECK/RLS errors. Unrelated legacy-invalid owners remain untouched and do not block a different owner's save.
4. Apply only semantic diffs. Delete owners, insert/add owners, patch changed editable fields and minimally diff explicitly affected publisher links. Keep all existing FK cascades, triggers and hidden values. A projected final value equal to the normalized base is a no-op and changes no timestamp/link. Any failure rolls back all included work.
5. Insert receipt with narrow response in the same transaction and return `{requestId,owners:null|{baseRevision,newRevision,changedPublisherIds,deletedPublisherIds,changedSupplierIds,deletedSupplierIds,changedLinkPublisherIds},subSubjects:null}`. Changed-owner arrays contain inserted/physically updated owner IDs; link-only owners are separately named by changedLinkPublisherIds. Arrays are unique stable UUID order; no page/full rows are returned.

An unknown transport/timeout retains the frozen request ID/body and exposes only an explicit result-confirmation retry. Newer local edits remain after that frozen generation. The confirmation retry first replays the identical request; after its receipt/result is acknowledged, later edits are rebased to the returned new revision and require another explicit Save. Known rollback errors retain all drafts but may form a new logical request after editing. Logout/actor or same-ID role change clears presentation/pending retry and rejects late acknowledgements; ordinary page/tab/filter changes preserve drafts for that actor.

## Task6b taxonomy extension

`list_textbook_sub_subject_numbered_page_v1(p_filters jsonb,p_draft jsonb,p_page integer,p_page_size integer)` / `listTextbookSubSubjectPage({page,pageSize,filters:{subject,search},draft},options)` remains the plan's one taxonomy page. Subject is canonical english/math/science/other and search is a string. It returns the requested NumberedPage plus `baseRevision`, entire projected `visibleCount`, per-row `canMoveUp/canMoveDown`, and exact `subjectCounts:{english,math,science,other}`. Counts include hidden editable rows and allow Add to navigate to the full subject's final page without traversing earlier pages. Projection applies the full chronological journal to persisted normalized rows plus every missing one of the21 built-in defaults before subject/search/count/page.

Its draft is exact:

```ts
type SubSubjectDraft = {
  version: 1;
  baseRevision: string;
  operations: Array<
    | { type: "add"; id: string; subject: "english"|"math"|"science"|"other"; name: string; isVisible: boolean }
    | { type: "patch"; id: string; patch: Partial<{name:string;isVisible:boolean}> }
    | { type: "delete"; id: string }
    | { type: "move"; id: string; direction: "up"|"down" }
  >;
};
```

Patch is nonempty; unknown keys/types/targets/lifecycle transitions fail22023. Add derives rank from the full active subject maximum (at least0) plus10, not client rank. Client-added rows use fixed UUIDs. Persisted rows use UUIDs. Row DTO extends the existing TextbookSubSubjectSettingRecord with `kind:persisted|default|added` and move availability. Virtual defaults retain their current stable non-UUID IDs and explicit default kind; they are never cast/written as UUID. A successful operation that needs a virtual default persisted materializes a real server UUID in the first committed execution and returns `materializedIds:{virtualId:uuid}` in the receipt result; uncertain replay returns the same mapping. Untouched virtual defaults never write.

Canonical taxonomy revision hashes the entire caller-visible persisted raw table plus the fixed default-definition version; no page/filter timestamp surrogate. Project full subject order, then move against its real neighbor independent of search/page. Preserve blank-new editing, blank-new omission, blank-persisted nondelete, built-in suppression/reappearance, hidden persisted suppression, subject order/rank/name/ID ties and full-source duplicate checks exactly as the existing Task7 plan states.

Task6b replaces the same save RPC to admit `{version:1,owners:null|OwnerDraft,subSubjects:null|SubSubjectDraft}`. One or both may be present; mixed validation, locks, DML, receipt and response are all-or-none. Publisher-only save never reads/writes taxonomy, taxonomy-only never reads/writes owners. Result adds `{baseRevision,newRevision,changedIds,deletedIds,materializedIds}` for taxonomy. Existing owner tests run unchanged against the final replacement.

## Task6c UI rules

- Extract owner/taxonomy reducer/controller logic from the workspace; page arrays are presentation snapshots, drafts/tombstones/journals are actor-scoped maps independent of page. Late actor/role/request generation cannot commit presentation or clear drafts.
- Preserve existing navigation behavior without claiming a route-leave guard exists: the current workspace and SettingsWorkspaceShell have no unsaved-navigation hook. Same-actor page/filter/tab/subject changes retain drafts; this task does not add a new route interception policy.
- Owner tabs use shared pager and preference IDs `textbooks:publishers` and `textbooks:suppliers`, sizes Auto/10/15/20 minimum10 and ten visible page numbers. Add clears search, selects page1 and focuses its prepended blank row. No current-page filter/sort over server order. Mobile consumes the same page snapshot.
- Supplier checkbox popover uses shadcn Command/Input/Checkbox styling already present in the app, its independent size10 page and all ten page buttons. Checked off-page IDs come from the complete publisher draft/detail. It never loads all suppliers or treats an absent page item as unchecked/deleted.
- Badges use `ownerCounts`, not page length. Supplier first3 linked names/count and publisher complete link order/textbook count retain the server semantics above. A read error retains the prior page and explicit retry; it never clears a complete relationship.
- Move all three tabs and the shared Save together to the reviewed page/draft/atomic APIs; there is no intermediate full-taxonomy bridge. Successful acknowledgement clears only the frozen journal prefix; later generation stays dirty and virtual targets are remapped using acknowledged materializedIds. No second Save and no direct table write remain.
- Adopt the shared pager `textbooks:subsubjects`, keep loading lazy until its tab, use server move availability, and keep the independently complete master picker unchanged. Add clears search and targets `ceil((subjectCounts[active]+1)/pageSize)` for the new global-end row. Search/page/subject/tab changes preserve journal edits. Successful-save canonical reload may reintroduce deleted/renamed built-in defaults exactly as specified.

## Required evidence

Each SQL task uses a fresh CLI migration, literal existence/behavior RED, actual candidate then distinct immutable final run in isolated Docker, exact prior-final manifest preservation, baseline/catalog parity and no-send assertions. Tests cover >100 projected owners/taxonomy rows, direct page11/off-end totals, page10→11, filters, draft rename/delete/add membership, complete off-page links, selected detail/picker, old-JS search/count/link order, malformed contexts, all authenticated read roles, admin/staff writes, forbidden/anon, native constraints, no-op timestamps, hidden metadata/link preservation, supplier-delete affected links, untouched off-page rows, stale55000, lock55P03, rollback, exact/mismatched replay and mixed-section failure.

UI/model tests use actual reducers/services, both renderers, auth/cache generation, unknown-response confirmation, newer edits during save, shared pager/prefs and no old direct full-owner/taxonomy query. Final Task8 runs all affected gates and a never-served isolated build; browser remains a separately authorized evidence gate.
