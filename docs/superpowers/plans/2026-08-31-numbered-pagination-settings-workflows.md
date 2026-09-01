# Settings Numbered Pagination and Atomic Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the common numbered pager to the five editable settings catalogs and teacher history without losing staged edits, global ordering, default-period state, or teacher account synchronization.

**Architecture:** A chronological edit journal is projected on the server before filter/count/page and committed by a transactional invoker API. The server owns ranks and collection revisions; actor-bound request receipts make retries idempotent. Existing catalog-specific editors retain their fields and controls while sharing a bounded read/draft adapter and the reviewed pager/controller.

**Tech Stack:** React19, shadcn/Radix, Supabase/PostgreSQL17, node:test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`, including the user's 2026-08-31 save-API authorization addendum.

## Global Constraints

- For each new bounded RPC, extend the foundation's explicit numbered-RPC query-budget registry only after strict10/15/20 final-SQL validation and local pgTAP proof; retain timeout/retry/authorization checks. The owning read-model task may update `src/lib/query-surface-budget.js` and its focused tests for that exact contract, never exempt arbitrary list RPCs or weaken unrelated guards. Save/profile-version APIs remain separate from pageable reads.

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- List page size is 10/15/20, minimum ten. Existing independent relationship/picker contracts remain unchanged.
- Total count represents the authorized full filtered result, never the loaded subset. Unknown count is not zero.
- Number clicks fetch their page without fetching intermediate pages or full datasets. Persisted page sorts end with id; the school name-sort action instead preserves its immediately preceding draft ordinal for comparator-equal names in either direction. The server assigns new unique ranks only when necessary to preserve the resulting order.
- Preserve previous rows on pending/error, abort superseded requests, reject stale rows/counts, reset page on filter/sort/size changes, and clamp after mutation shrink.
- Preserve staged Save, add/delete/move/name-sort controls, drafts across pages, full global order, and existing account/default semantics. Do not write client page indexes as global ranks.
- Preserve authentication/RLS/ACL/locks/idempotency/no-send. Do not apply remote migrations, push, deploy, or send notifications.
- All new functions are invoker, with empty search_path, qualified objects, and explicit authenticated EXECUTE grants after PUBLIC/anon revocation. No generic privileged table endpoint.
- Domain revision conflicts use SQLSTATE55000 and detail `settings_revision_conflict`; malformed requests use22023. Never manually raise40001. Preserve natural23505/23503/23514/42501 and genuine55P03/40P01 lock errors; contention is not a stale-revision error.
- No arbitrary catalog limit, full-array fallback, silently truncated journal, or partial batch Save.
- Read `docs/superpowers/plans/2026-08-31-settings-save-contract-audit.md` for exact existing normalization/order/access chains. It is required domain input, not implementation proof.
- Read `docs/superpowers/plans/2026-08-31-settings-save-plan-compat-review.md` for precise comparator/FK-lock/receipt boundaries. The decisions below resolve its plan gaps; local SQL parity/concurrency proof remains required.
- Supplier/publisher settings are owned by the textbook plan. The exactly-three-row subject configuration matrix is excluded.

## File and interface map

- `src/features/management/settings-catalog-draft.ts`: types, immutable journal operations, and save-generation tracking; no database or full catalog cache.
- `src/features/management/settings-catalog-service.ts`: strict bounded page/preview/save RPC transport and error normalization.
- `src/features/management/use-settings-catalog-page.ts`: common controller adapter and in-memory draft lifecycle; no field-specific normalization.
- Existing five `*-master-workspace.tsx` files: field rendering and domain actions only.
- `src/features/management/teacher-audit-page.tsx`: full history and authorized event detail, independent from the existing recent preview.
- CLI-created `settings_catalog_pages`, `settings_catalog_atomic_saves`, and `teacher_audit_numbered_pages` migrations: reviewed invoker reads/projector, transactional saves/receipts, history/detail respectively.

## Task 1: Executable journal contract and projected bounded reads

**Files:** Create draft/service modules above; create `tests/settings-catalog-draft.test.mjs`, `tests/settings-numbered-read-service.test.mjs`; create CLI migration `settings_catalog_pages` and `supabase/tests/settings_numbered_reads_test.sql`; append only owned candidate manifest entry.

**Interfaces:** Export `createSettingsCatalogDraft({kind,baseRevision,requestId})`, `appendSettingsCatalogOperation(draft,operation,{requestId})`, and `createSettingsCatalogService({supabase}).readPage({kind,filters,page,pageSize,draft,signal}) -> SettingsCatalogPage<Record<string,unknown>>`. The append function returns a new journal with a fresh logical requestId, never mutates the saved draft, and never reorders/coalesces patches across structural actions. Export all types below. SQL read API: `list_settings_catalog_numbered_page_v1(p_kind text,p_filters jsonb,p_page integer,p_page_size integer,p_draft jsonb default null) returns jsonb`. Put shared pure `project_settings_catalog_v1(p_kind text,p_rows jsonb,p_operations jsonb)` and revision helpers in the new non-exposed `settings_private` schema; explicit invoker grants, no schema CREATE for authenticated.

Filters are strict per kind: school `{category,search}`, classroom `{subject}`, term `{}` (no new year control), teacher `{team}`, class_group `{}`. Strings preserve the current existing aliases through the domain adapter. No new search/filter UI is added. The request has `draft:null` for the persisted initial page; an edited request carries the entire journal, never all catalog rows.

Teacher baseRevision also includes DISTINCT currently linked profile `id,role,teacher_catalog_id,updated_at` visible under invoker RLS, including visible incoming backlinks to the visible catalog even when teacher.profile_id does not point back. Unreadable forward links contribute a fixed sentinel keyed only by the already-visible catalog profile_id; never hash hidden fields or discover/hash hidden incoming backlinks. New profile links outside that initial revision use `expectedProfiles` from a bounded ID context: `service.readProfileVersions({ids,signal}) -> Record<string,string>` backed by invoker `get_settings_profile_versions_v1(p_ids uuid[])`. Return only requested RLS-readable IDs and their opaque versions; reject missing/inaccessible targets. Task1 produces this read; Task2 checks it after locks; Task3 calls it when a new link is chosen. A readable version is not UPDATE/row-lock authority. This is separate from the existing account picker, not a full-profile-array transfer.

The task produces these exact types (import `NumberedPage` from `src/lib/numbered-pagination.ts`):

```ts
export type SettingsCatalogKind = 'school' | 'classroom' | 'term' | 'teacher' | 'class_group';
export type SettingsCatalogOperation =
  | { op:'patch'; id:string; fields:Record<string,unknown> }
  | { op:'add'; id:string; fields:Record<string,unknown>; team?:string }
  | { op:'delete'; id:string }
  | { op:'move'; id:string; direction:'up'|'down' }
  | { op:'name_sort'; direction:'asc'|'desc' }
  | { op:'set_default'; id:string };
export type SettingsCatalogDraft = {
  kind:SettingsCatalogKind; requestId:string; baseRevision:string;
  operations:SettingsCatalogOperation[]; expectedProfiles:Record<string,string>;
};
export type SettingsCatalogPage<T> = NumberedPage<T> & {
  baseRevision:string; projectedFingerprint:string;
  defaultGroupId:string|null;
  moveDirectionsById:Record<string,{up:boolean;down:boolean}>;
};
export type SettingsCatalogSaveResult = {
  outcome:'applied'|'replayed'; revision:string;
  changedIds:string[]; deletedIds:string[]; defaultGroupId:string|null;
};
```

- [ ] Write RED tests for chronological operations and the exact read boundary:

```js
const first = createSettingsCatalogDraft({kind:'school',baseRevision:'revision-a',requestId:'11111111-1111-4111-8111-111111111111'});
const renamed = appendSettingsCatalogOperation(first,{op:'patch',id:'22222222-2222-4222-8222-222222222222',fields:{name:'학교 2'}},{requestId:'33333333-3333-4333-8333-333333333333'});
assert.deepEqual(first.operations, []);
assert.equal(renamed.operations[0].fields.name, '학교 2');
assert.equal(renamed.baseRevision, 'revision-a');
let calls = 0;
const reply = { rows:[],page:11,pageSize:10,totalCount:0,baseRevision:'revision-a',projectedFingerprint:'projection-a',defaultGroupId:null,moveDirectionsById:{} };
const service = createSettingsCatalogService({supabase:{rpc(name,args) {
  calls++;
  assert.equal(name, 'list_settings_catalog_numbered_page_v1');
  assert.deepEqual(args, {p_kind:'school',p_filters:{category:'',search:''},p_page:11,p_page_size:10,p_draft:renamed});
  return {
    abortSignal(signal) { assert.equal(typeof signal.aborted, 'boolean'); return this; },
    retry(value) { assert.equal(value, false); return this; },
    then(resolve,reject) { return Promise.resolve({data:reply,error:null}).then(resolve,reject); },
  };
}}});
assert.equal((await service.readPage({kind:'school',filters:{category:'',search:''},page:11,pageSize:10,draft:renamed})).page, 11);
assert.equal(calls, 1);
```

Record expected pre-implementation failures. Add pgTAP literal fixture expectations for rename→name-sort→rename, interleaved-team moves, prepend/team-add, cross-page/global neighbors under filters, invalid incomplete draft preview, filtered deletion filling a page, exact totals and off-page default. Assert projected reads do not write tables or audit. Include auth/ACL/invalid22023, malformed DTO, timeout/cancel, and no complete-array fallback.
- [ ] Create migration via discovered CLI. Build an explicit five-kind source with edit-complete allowed fields and preserved hidden columns; do not accept table names from the caller. Compute canonical full visible collection revision including IDs/editable values/ranks/updated_at and metadata replay depends on, ordered byid. `max(updated_at)` is forbidden. Use a cryptographic fingerprint available in the final baseline. Initial page order matches the audit; ties end inid.
- [ ] Implement one deterministic pure journal projector shared with Task2. Apply operations in order to server-side narrow state, normalize fields only at the documented final-save boundary and preserve invalid untouched legacy rows. School name-sort uses current raw draft names, `localeCompare('ko-KR',{numeric:true})` semantics and ordinal immediately before each sort as the ascending tie-break for both directions. Create a settings-local ICU `ko-u-kn-true, deterministic=false` comparator candidate; do not alter existing deterministic dashboard_private.ko_numeric. Require SQL/Intl parity for 학교02/학교2, composed/decomposed accents and Hangul, raw double whitespace, move→equal-name-sort and ascending/descending before accepting it. If the candidate fails, report and choose an equivalent comparator; no silent byte/ID fallback. Teacher move literal `[A(English),B(Math),C(English)]`, A down, is `[B,C,A]`. Preview allows incomplete new names/dates for typing; final validation belongs to Save. Filter/count/page only after projection. Return page rows plus revision/default/move metadata; never all reordered row bodies. Validate kind/filter/op/field/UUID/page/size shapes.
- [ ] Strict service parses page/count/revision and per-kind editable DTOs, composes caller abort with eight-second timeout, sets retry(false), and reports missing RPC explicitly. Persist no row/draft data in localStorage. Run focused node tests, lint/TS and isolated SQL runner `--review-head --execute --authorized`; after candidate pass promote only owned entry and rerun`--require-final`. Commit owned files with `feat: add projected numbered settings reads`.

## Task 2: Atomic changed-only saves and exact retry receipts

**Files:** Extend draft/service modules; create CLI migration `settings_catalog_atomic_saves`; create `tests/settings-catalog-save-service.test.mjs`, `supabase/tests/settings_catalog_reorder_test.sql`; add unit companion `tests/settings-catalog-concurrency.test.mjs` and self-contained executable `tests/settings-catalog-concurrency.probe.mjs` using the existing isolated PostgreSQL harness for two real competing connections; update owned manifest entry only.

**Interfaces:** `service.saveDraft({draft,signal}) -> SettingsCatalogSaveResult`; SQL `save_settings_catalog_draft_v1(p_draft jsonb) returns jsonb`. Reuse Task1 projector unchanged unless a behavior defect is reproduced. Request receipt key is `(actor_id,request_id)` and canonical hash includes kind/baseRevision/ordered operations/expectedProfiles. Result is narrow; no all-row response.

- [ ] Write RED tests where losing the first Save response and retrying the same immutable request yields one move and one set of audit changes:

```js
// Execute against the local fixture using a fixed request UUID and a real
// transaction; fetch the order and audit count independently before retry.
const signal = new AbortController().signal;
const initialPage = await service.readPage({kind:'school',filters:{category:'',search:''},page:1,pageSize:10,draft:null,signal});
const draft = {
  kind:'school',requestId:'11111111-1111-4111-8111-111111111111',
  baseRevision:initialPage.baseRevision,
  operations:[{op:'move',id:'22222222-2222-4222-8222-222222222222',direction:'down'}],
  expectedProfiles:{},
};
const result = await service.saveDraft({draft,signal});
const retry = await service.saveDraft({draft,signal});
assert.deepEqual([result.outcome,retry.outcome], ['applied','replayed']);
assert.equal(retry.revision, result.revision);
```

The SQL fixture independently asserts final ordered IDs, unchanged audit count on replay, request-ID/payload mismatch22023, stale revision55000 with exact detail, inaccessible writes42501, final uniqueness/FK/CHECK rollback, empty no-op without timestamp churn, off-page default replacement and all-or-nothing profile updates. Two-connection tests must show legacy direct INSERT/UPDATE/DELETE conflicts and concurrent same-request execution does not double-move. Reproduce the profile-prelock versus direct-teacher-DELETE FK reverse-order interleaving, signup, insert/relink FK KEY SHARE behavior, reverse-only visible/hidden backlinks and concurrent profile mutation. Assert actual SQLSTATE, total rollback and no receipt; do not label source-derived cycles as observed deadlocks or fake concurrency with source assertions.
- [ ] Keep real DB execution outside ordinary unit discovery. The `.test.mjs` companion imports exported parser/protocol helpers and doubles only external execution; it never starts Docker/psql on import or normal unit runs. The `.probe.mjs` artifact is self-contained with Node built-ins, a direct-entry guard and validated injected local URL/nonce, because the isolated runner stages only the named probe file, not repository-local imports. Invoke it explicitly with `--probe tests/settings-catalog-concurrency.probe.mjs` beside the reorder SQL test, `--review-head --execute --authorized --request-id`; candidate pass precedes promotion, then rerun the exact hash with `--require-final`. The probe seeds its own synthetic fixtures since pgTAP fixtures roll back.
- [ ] Coordinate two persistent psql transaction sessions with tagged results and bounded state/lock observations, plus a read-only observer when needed; no sleep-based race or production/test-instrumented RPC hooks. For the DELETE/FK conflict, pre-establish the intended profile `FOR NO KEY UPDATE` lock in the authenticated save session's outer transaction, start the real legacy teacher DELETE and observe its FK wait, then call the unchanged save RPC in the save transaction. Assert the actual NOWAIT error, rollback/no receipt and eventual legacy FK cleanup. This proves the API in a reachable conflict state, not observation of its tiny internal prelock window; check final function statement order separately. For same-request serialization hold the first successful call uncommitted, observe the second waiting, then commit and assert `applied`/`replayed` with stable revision/IDs/default and no second audit/DML set. Bound child/session cleanup and preserve exact SQLSTATE diagnostics.
- [ ] Create immutable actor-bound receipt table in `settings_private` (not PostgREST exposed). Authenticated USAGE on this new schema, SELECT/INSERT on this table with actor=auth.uid() RLS, no CREATE/UPDATE/DELETE/TRUNCATE, no PUBLIC/anon access. Store actor UUID without a cascading/restricting account FK so v1 retention neither expires on account deletion nor blocks existing account deletion. No expiry job in v1. Receipts are retry state, not privileged security/audit evidence: guarantee no duplicate committed effects for identical calls through this API and replay of its original result, not arbitrary actor-row provenance. Negative tests cover cross-actor read/insert denial, own update/delete denial and preinserted own retry state granting no writes/audit evidence.
- [ ] Validate current caller/catalog authority and acquire namespaced transaction advisory lock for actor/request. Check matching receipt before base-version checks; strictly validate its narrow stored result and return it without DML, or reject different hash. Replay never bypasses current authorization or asserts current-state freshness. For new requests, acquire collection SHARE ROW EXCLUSIVE before reading fingerprint so legacy direct writers are covered. Teacher saves first prelock old/new explicit sync profiles and visible incoming backlinks of deleted teachers in deterministic ID order with FOR NO KEY UPDATE NOWAIT, then acquire teacher collection SHARE ROW EXCLUSIVE NOWAIT. Revalidate observable profile/link sets and versions after locks; if additional locks are now required, abort instead of taking them in a reversed order. Preserve55P03 as retryable busy, with unchanged draft/UUID and no receipt. Apply a fixed function-local1s lock_timeout for the whole save call, automatically restored on exit, to bound later trigger/FK contention too. Preserve genuine lock/deadlock codes; claim bounded atomic abort, not global deadlock freedom.
- [ ] Replay and validate final desired state; write only changed fields/ranks/inserts/deletes. Preserve hidden group term_id/color/note and school non-editor fields. Keep all constraints/triggers. For terms map known legacy `수강` to `수업 진행 중`; reject unknown status and retain final CHECK. For period defaults clear priortrue before setting replacementtrue in the same transaction; require explicit replacement when deleting default while rows survive, allow null for empty or already-defaultless collection. Move preference writes out of unsaved UI effects in Task3.
- [ ] Normalize only explicit patch/new-row fields and required coupled consequences, never untouched off-page bytes or other fields of a rank-only change. Reuse existing ranks when final membership/order is unchanged AND those ranks with final field values under the normal read comparator preserve intended ID order; otherwise assign server-owned1..N and write differing ranks. Preserve term's normal year-first post-save behavior. Add sparse/duplicate-rank fixtures, tied-rank rename requiring reassignment, unchanged whitespace names, scalar edits preserving ranks and cancelled move/add/delete with zero catalog/profile timestamp/audit churn. A semantic no-op may insert its retry receipt but must not compact ranks just because Save was called. This intentionally excludes incidental legacy full-array cleanup from changed-only persistence.
- [ ] Teacher synchronization writes only changed linked teachers' profiles.role and teacher_catalog_id, including off-page rank changes only when the profile patch differs. Compare visible profile values before skipping DML. If a sync candidate is unreadable, required-vs-no-op cannot be established: fail42501 conservatively rather than silently skip. Preserve existing unlink/relink/delete semantics; do not reset old profile roles. Detect zero-row unauthorized updates and roll back catalog writes. Insert receipt in the same transaction. Leave existing audit writer and no-send boundaries untouched.
- [ ] Treat SELECT-only identity-matched profiles separately from update-authorized ones in final RLS fixtures. If a required explicit synchronization profile cannot be locked under current rights, fail42501 conservatively even when its visible patch appears unchanged; do not infer lock permission from version reads or grant UPDATE. Hidden reverse-only FK cleanup remains the existing referential action, not explicit role synchronization: do not expose/hash its profile IDs, include them in changedIds, broaden SELECT, or reject an otherwise authorized delete merely because an invoker cannot enumerate hidden backlinks. The function-local lock timeout bounds contention on those implicit rows. Receipt insertion failure rolls back all writes; uniqueness failure is not success after unreceipted DML.
- [ ] On uncertain transport preserve the exact request UUID/body/new-row UUIDs; no automatic write retry and no new UUID for Retry. Run service tests plus actual pgTAP/concurrency tests, lint/TS; promote only after actual candidate pass, final-only rerun, and commit `feat: save paginated settings atomically`.

## Task 3: Wire five settings editors to shared paging and journal lifecycle

**Files:** Create `use-settings-catalog-page.ts`; modify school/classroom/term/class-group/teacher master workspaces and only necessary shared settings layout; create `tests/settings-numbered-edit-boundary.test.mjs`; update affected existing school/classroom/teacher tests without replacing behavioral assertions with source scans.

**Interfaces:** `useSettingsCatalogPage({kind,filters,actorScope,enabled})` returns displayed `{rows,page,pageSize,totalCount,loading,error,metadata}`, preference `{mode,setPreference,setAutoPageSize,ready}`, `{goToPage,appendOperation,save,retrySave,discardDraft,refresh,draft,saveState}`. `saveState` is idle/saving/uncertain/error; all page requests use `createNumberedPageController` from foundation and metadata commits only with that exact successful scope/page. The existing `DataTablePagination` accepts `{page,pageSize,totalCount,loading,onPageChange,pageSizeMode,onPageSizeChange,ariaLabel}`. Keep field normalization in domain code/SQL, not the hook.

- [ ] Write RED real hook/editor tests with external transport doubled, production journal/controller/rendering intact. Assert a page1 edit survives page11 and Save sends its ID, while untouched page1/page11/off-page owners are absent from field writes. Verify draft preview delete refills the page; move crosses page boundary; name-sort with a pending rename; separate teacher team; off-page default remains selected; stale preview cannot replace newer edits. Failed/uncertain Save retains all drafts and Retry sends identical body/UUID; acknowledged generation clears only itself. Auth changes clear rows/drafts immediately.
- [ ] Replace complete-list reads and `saveAll(allRows)` with service/controller/journal. Keep fields and current explicit Save controls. Add operation chronologically for each field/add/delete/move/sort/default action. Use server preview for structural changes; field typing may immediately overlay only that field pending the matching debounced preview. Never infer page membership, total, global ranks, neighbor availability, or uniqueness from page rows. Display server default metadata and global move availability. Do not disable a cross-page move merely because it is at the visible page edge.
- [ ] Keep journal in memory through page/filter navigation, page reset atomic for filters/size, page requested directly, previous successful rows retained on error. Freeze editing during saving or unresolved uncertain outcome so retries cannot mutate the submitted body. After confirmed Save reload current page/clamp; after conflict preserve edits and offer explicit discard/reload, not silent rebase. Keep navigation-away unsaved guard. Shared preference readiness gates first query. Use common pager outside scrollport/mobilemirror and current semantic shadcn components.
- [ ] Preserve separate bounded account/profile lookup and profile versions for changed links, not a teacher-page-derived selector. Remove pre-save local default-period preference writes; update fallback only after confirmed server state. Use valid canonical term default on new rows. Preserve current footer/column controls without adding instruction cards.
- [ ] Run focused new/existing editor tests, common controller/pager suite, full TS and lint; record browser gates separately without bypassing existing URL policy. Commit `feat: paginate settings editors without losing drafts`.

## Task 4: Teacher full history and independently authorized detail

**Files:** Create teacher-audit-page component and `teacher-audit-service.ts`; integrate teacher workspace; create CLI migration `teacher_audit_numbered_pages`; create `tests/teacher-audit-numbered-page.test.mjs`, `supabase/tests/teacher_audit_numbered_pages_test.sql`; owned manifest entry.

**Interfaces:** `createTeacherAuditService({supabase}).readPage({page,pageSize,signal})` returns sharedNumberedPage; `.readDetail({id,signal})` returns authorized event diff. SQL `list_teacher_audit_numbered_page_v1(p_page integer,p_page_size integer)` and `get_teacher_audit_detail_v1(p_id uuid)` are invoker. Keep current12-entry `최근 변경 이력` preview distinct; new full surface labelled`전체 변경 이력`, no new search/filter controls.

- [ ] Write RED service/render/SQL tests: filter onlyteacher_catalogs/profiles, orderedchanged_atDESC,idDESC, page11direct/exacttotal, narrowlistwithout pre/post/full diff, authorizedoffpagedetail, unauthorizeddetaildenied, noauditwrites, previewretained. Invalidpage/size22023 and existing audit RLS remain.
- [ ] Implement narrow filtered key/count/page then actor display enrichment; detail returns diff only after independentRLSauthorizedIDread. Wire common controller/pager and per-list preference. Selection/detail must not depend on loadedpage.find. Runfocusednode+isolatedSQL+TS/lint; promoteownedcandidateonlyafterpass/finalrerun. Commit `feat: add paginated teacher change history`.

## Task 5: Settings verification and app-wide audit handoff

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md` and the saved settings audits with actual evidence; no scope expansion.

- [ ] Run combined settings service/draft/editor/history regressions, common pager/controller, all new SQL and catalog parity tests through final-only isolated verification, typecheck/lint/production build without replacing the protected live3017build.
- [ ] Inspect code for remaining in-scope whole-list save/load paths; confirm subjectfiniteconfig and picker contracts are intentionally separate, not skipped record lists. Verify supplier/publisher coverage from textbook plan independently.
- [ ] Rendered QA when browser access is permitted: desktop1440×768/900/952/mobile390×844, all10numbers, globalfirst/last, cross-page edit/move/default and savedserverresult. If policy blocks access, record pending rather than bypass. No remoteapply/deployclaim.
- [ ] Conduct whole-plan review, resolve findings, and commit evidence. This finishes settings only; app-wide completion still requires every domain plan and final applicability audit.
