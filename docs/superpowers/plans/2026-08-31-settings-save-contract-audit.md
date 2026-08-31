# Settings save/order contract audit

Date: 2026-08-31. Read-only source audit; no implementation, database execution, tests, deployment, or external writes performed. The parent reports that the user has now authorized the save-API expansion that the earlier numbered-read audit left pending.

## Recommendation

Use one transactional, `SECURITY INVOKER` save per catalog plus a **read-only projected-draft page** backed by the same deterministic journal reducer. Transfer only edited fields, new rows, and ordered actions—not a full catalog or full ordered-ID list. Keep the existing explicit Save button, add/delete/move/name-sort controls, and drafts across pages/filters. Do not retain client `index + 1` as a persisted rank.

Suggested logical interfaces (five allow-listed kinds, or five thin typed wrappers):

```ts
type Draft = {
  kind: 'school' | 'classroom' | 'term' | 'teacher' | 'class_group';
  requestId: string;                     // UUID; immutable for a logical Save/retry
  baseRevision: string;                  // opaque persisted input-state fingerprint
  operations: Operation[];               // chronological; stable UUIDs for additions
  expectedProfiles?: Record<string, string>; // versions from linked-profile detail/picker
};
type Operation =
  | { op: 'patch'; id: string; fields: Record<string, unknown> }
  | { op: 'add'; id: string; fields: Record<string, unknown>; team?: string }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; direction: 'up' | 'down' }
  | { op: 'name_sort'; direction: 'asc' | 'desc' } // school only
  | { op: 'set_default'; id: string };           // class_group only

preview_settings_draft_page_v1(draft, filters, page, pageSize)
  -> { rows, totalCount, page, pageSize, baseRevision,
       projectedFingerprint, defaultGroupId, draftGeneration }
save_settings_draft_v1(draft)
  -> { outcome: 'applied' | 'replayed', revision,
       changedIds, deletedIds, defaultGroupId }
```

Names are design suggestions, not existing RPCs. Use `pageSize` 10/15/20 for page output. Input validation must reject unknown kinds/fields/ops, non-UUID row IDs, non-one-based pages, and malformed payloads (`22023`). Reject missing/inaccessible targets explicitly; never accept an UPDATE/DELETE that silently affected zero rows as success. Do not create arbitrary table-name SQL from request text.

### Why a journal, not `finalDirtyRows + orderOps`

`rename -> name-sort -> rename` and `team-change -> move -> team-change` depend on intermediate field values. Applying final patches before every order operation changes current behavior. Journal patches may be coalesced between ordering barriers, but not moved across them. Add then delete may be optimized away only if intervening moves/sorts/default choices no longer depend on that row. Replay in memory/server CTE state first; issue physical DML only for the final diff, so intermediate edits do not generate audit events or trigger uniqueness failures.

Preview and save must share this reducer. Preview must be one consistent persisted snapshot plus the complete draft, followed by filter/count/order/page. It returns only the requested page and metadata, including off-page default identity. A client overlay over a persisted page cannot fill holes after deletions, compute sorted-page membership, or resolve a cross-page neighbor. Invalid in-progress additions may appear in preview; final save validation rejects them. Cache by actor, catalog, baseRevision, journal generation, filters, and page; reject late responses. Preserve drafts on save/preview conflicts, cancellation, navigation, and request errors. Clear only the acknowledged generation.

Do not invent a total-catalog cap. A transport/journal resource limit, if measurements require it, must be separately documented in bytes/operation count, reject atomically before execution, and preserve the draft; never truncate operations or silently batch one Save into partial transactions. No numeric journal cap is justified by this read-only audit.

## Exact ordering semantics to preserve

| Workspace | Required replay behavior |
|---|---|
| School | Initial order `sort_order ASC, name ASC, id ASC`. Add prepends globally. Up/down moves against the global adjacent row, even while category/search filters hide that neighbor. Name-sort is global, not filtered; toggle explicit asc/desc and preserve action chronology. |
| Classroom | Add prepends globally. Up/down also uses global adjacency, not adjacency within the subject filter. Invalid/missing-campus rows currently remain visible under every subject filter; keep this read behavior. |
| Term | Initial order `academic_year DESC, sort_order ASC, name ASC, id ASC`. Add prepends the draft array; save assigns its global position, then the normal post-save year-first read can reposition it. No existing move or name-sort control. Do not quietly change this to append-by-max. |
| Class group / period | Add prepends globally. No existing move control. One whole-collection default selection; never infer it from a page. |
| Teacher | Add after the last row of the chosen team in the global array; append globally if that team has no row. Up/down finds the preceding/following row of the same normalized team, then **splices** the row to that global index. Intervening other-team rows shift; this is not a swap of two teacher ranks. Changing team alone does not reposition a row. |

After replay, preserve existing ranks when membership/order is unchanged and the final field values under the normal persisted read comparator still produce the intended ID order. Otherwise assign server-owned global1..N and write only differing ranks. A tied-rank rename can require reassignment even without a move; a cancelled move/add/delete must not compact sparse ranks merely because Save was called. Retain the normal term year-first post-save behavior. This intentionally removes incidental legacy whole-array cleanup, not user-visible order semantics. Empty/semantic no-op saves create no catalog/profile timestamp or audit churn.

Retain the ordinal immediately before each name-sort for comparator-equal names in either direction. Existing JS school sort uses `localeCompare('ko-KR', { numeric:true })` on raw draft names. Keep the existing deterministic `dashboard_private.ko_numeric` unchanged; a settings-local nondeterministic ICU `ko-u-kn-true` comparator is the selected candidate, pending exact local SQL/Intl parity for numeric padding, punctuation/case, Unicode equivalents, raw whitespace, asc/desc and stable ties. See the compatibility review; do not silently fall back to byte/ID ordering for this user action.

Sources: `school-master-workspace.tsx:257,318,335`; `classroom-master-workspace.tsx:260,321`; `term-master-workspace.tsx:133,137`; `class-group-master-workspace.tsx:168,172`; `teacher-master-workspace.tsx:307,603,690` (all under `src/features/management/`). Collation: `supabase/migrations/20260813194812_dashboard_statistics_sources.sql:5`.

## Editable fields and normalization

Persist explicit allow-listed fields; omitted fields retain their original values. `sort_order`, timestamps, and `is_default` are server-owned consequences, not patch fields.

Normalize only explicitly patched fields, new-row fields and required coupled consequences (such as assistant team forcing assistant role) at final Save. Keep untouched stored bytes, including off-page whitespace names; rank-only writes must not normalize other fields. The legacy UI's incidental full-array normalization/upsert is not part of the new changed-only contract. Compare the final stored diff so edit/revert journals are true no-ops.

| Catalog | Editable persisted fields and existing normalization |
|---|---|
| `academic_schools` | `id,name,category,color`. Name trim + collapse all whitespace runs to one space; nonempty; authoritative duplicate check across normalized surviving names (case-sensitive current UI), plus existing unique `name`. Category UI aliases elementary/elem/primary→초등, middle/mid/secondary→중등, high/highschool→고등; persist elementary/middle/high; preserve unknown trimmed legacy category. Trim color, blank→null. Preserve `textbooks` and other non-editor fields. |
| `classroom_catalogs` | `id,name,subjects,campus,is_visible`. Name trim; match whitespace-stripped legacy aliases using `CLASSROOM_ALIAS_MAP`, otherwise retain trimmed original spacing. Subjects accept registry English/Math/Science aliases, deduplicate and order 영어/수학/과학; require at least one. Campus must be 본관/별관 for an edited/new row. Visibility is boolean. Preserve untouched legacy invalid rows; do not accidentally make a rank-only move rewrite invalid subject/campus values. |
| `class_terms` | `id,academic_year,name,status,start_date,end_date`. Trim name/nonempty; integer year; blank dates→null; validate date inputs. **Existing defect:** UI/new-row/service fallback is `수강`, but the final schema CHECK permits `수업 진행 중`,`개강 준비 중`,`종강`. Explicitly map the UI alias `수강`→`수업 진행 중` (and any supported preparation alias to `개강 준비 중`) or use database labels in the editor; do not weaken the constraint or copy the broken fallback into the RPC. |
| `teacher_catalogs` | `id,name,subjects,is_visible,profile_id,account_email,dashboard_role`. Name trim/nonempty. Workspace stores exactly one normalized team in `subjects`: 영어팀/수학팀/과학팀/관리팀/조교팀; first recognized comma-separated alias wins, fallback 영어팀. Roles admin/staff/teacher/assistant/viewer; trim/lowercase, current fallback teacher; 조교팀 forces assistant. Trim profile UUID/null; trim/lowercase account email/null. Account identifier can originate from login ID, so do not add an email-format restriction. |
| `class_schedule_sync_groups` | Editor patches `id,name,subject`; name/subject trim. `term_id,color,note` exist but are not editable here and must remain untouched. The legacy builder supplies omitted `term_id` as null: do not reproduce that unintended destructive overwrite in changed-only saves. `is_default` changes only through `set_default`. |

Normalization pointers: `management-service.js:38,509,617,626,644,754–817`; `school-master-workspace.tsx:50–87,268`; `teacher-master-workspace.tsx:78–140,575–591,630`; `src/lib/academic-subject-registry.ts:43–75`. Term status evidence: `20260316090000_class_terms.sql:65–74` and baseline `dashboard-free-tier-v1.sql:110379`; UI `term-master-workspace.tsx:44–65,137`.

## Version, locks, atomicity, and retry

All five have `updated_at`, and final update triggers invoke `set_updated_at()` using `now()`. School/term/group timestamps are nullable; teacher/classroom declare NOT NULL. **Neither max(updated_at), count+max, nor the page's row timestamps is a collection revision**: deletion, non-max changes, same-transaction timestamps, and untouched off-page rows break it.

Controller clarification: teacher baseRevision additionally hashes DISTINCT currently linked profiles and visible incoming backlinks through invoker RLS (`id,role,teacher_catalog_id,updated_at`); an unreadable forward link uses only a fixed sentinel keyed by its already-visible catalog profile_id. Hidden incoming backlinks are neither discovered nor hashed. `expectedProfiles` covers newly selected IDs outside that initial revision, read through bounded ID context. Recompute after locks. Rank-shifted off-page linked teachers remain sync candidates; unreadable or un-lockable explicit candidates fail42501 because a stable authorized no-op cannot be established. No hidden-data hashing or full profile transfer is allowed.

Smallest safe foundation without a new revision table/definer: return an opaque canonical SHA-256 fingerprint over all RLS-visible collection IDs, editable stored values, ordering values, and `updated_at` (including nulls), sorted by ID. For groups include global default and preserved group metadata that replay depends on. This is server-side full-set computation, not full-set transfer. For teachers separately version all profiles a save would synchronize, including newly chosen profile IDs. Do not hash inaccessible profile data into a client-visible oracle.

Save transaction:

1. Check authenticated identity and existing catalog authorization; fix `search_path=''`, fully qualify all objects. Acquire a namespaced transaction advisory lock for `(actor, requestId)`, then check that actor's receipt before any collection-version check. Return its stored response if the canonical request hash matches; reject request-ID reuse with different payload (`22023`). This request lock does not replace the collection lock below.
2. Acquire collection `SHARE ROW EXCLUSIVE` lock before re-reading/checking base fingerprint. This conflicts with normal INSERT/UPDATE/DELETE, including legacy direct writers; an advisory lock alone does not. Keep locks only for this short transaction. Teacher explicit profiles and visible incoming backlinks of deleted teachers use deterministic `FOR NO KEY UPDATE NOWAIT` prelocks, then teacher collection `SHARE ROW EXCLUSIVE NOWAIT`. Revalidate the observable lock set without acquiring newly discovered locks in reverse order. A fixed function-local1s lock_timeout, restored on exit, also bounds implicit hidden FK/trigger contention. Preserve real55P03/40P01 and the draft/UUID; no partial writes/receipt on failure. Matching signup order alone does not cover legacy DELETE's inverse FK path, and this is not a global deadlock-free claim. Test both paths and SELECT-only profile authorization against the final chain.
3. Re-read fingerprint and affected-profile versions; reject stale base/profile state with `55000` and a machine-readable `settings_revision_conflict` detail. Do not use `40001` for this domain conflict.
4. Replay entire journal, validate final state/references/default, compute normalized final diff. Apply deletes, inserts, changed fields, changed ranks, and profile synchronization within the same transaction. Keep all FK/unique/CHECK/audit triggers active. Preserve real PostgreSQL errors (`23505`,`23503`,`23514`,`42501`) and roll back all writes on failure.
5. Insert the actor/request receipt and narrow result in this same transaction, then return new opaque revision, changed/deleted IDs, default ID; reload only needed numbered pages. Do not return all rank-shifted row bodies.

Retry must never reapply a relative move after an uncertain response. **Selected contract: actor-bound immutable request receipts**, keyed `(actor_id, request_uuid)`, containing catalog kind, canonical request hash, narrow stored response/revision, and creation time. Hash the entire semantic request (kind, baseRevision, chronological operations, expected profile versions); exclude transport-only page/preview generation. Keep the request UUID, new-row UUIDs, and request payload unchanged after uncertain transport. Serialize the same request by its advisory lock, return an existing matching receipt before expected-version checks, and never re-run catalog/profile DML or audit on replay. A failed transaction leaves no receipt; the retry can execute normally. A semantic no-op may record a receipt but creates no catalog/profile timestamp or audit churn. A user-edited replacement draft is a new logical request with a new UUID.

Put receipts in a **new narrowly scoped, non-API-exposed schema**, e.g. `settings_private`, to avoid granting access to unrelated existing private functions. Grant authenticated `USAGE` on that schema, SELECT/INSERT only on this table, and own-actor SELECT/INSERT RLS (`actor_id = (select auth.uid())`); no CREATE on schema and no UPDATE/DELETE/TRUNCATE on table. `USAGE` alone does not grant table/function rights, and a new schema contains no existing functions to accidentally expose. Explicitly revoke default PUBLIC/anon privileges on every new helper/function; do not add this schema to PostgREST's exposed schemas. Receipt SELECT uses the request advisory lock, not SELECT FOR UPDATE, so it does not need an UPDATE grant. All RPCs/reducers remain invoker. This isolates actors but, because invoker execution requires caller INSERT privileges, receipt contents must **not** be elevated into security/audit evidence. Keep stored results narrow and treat original revision as original-save output, not proof that the current collection is unchanged. No privileged receipt writer is necessary. Do not add automatic receipt expiry in v1: deleting receipts ends replay guarantees; retention/cleanup needs an explicit retry-horizon contract.

Alternative assessed, not selected: preview may compute a projected fingerprint excluding server timestamps and compare the present postcondition after a base mismatch, returning a no-write `already_satisfied`. This can prevent duplicate state transitions but cannot establish whether this actor's ordered journal executed. A client-provided postcondition fingerprint must never bypass a stale-input check to permit writes. The explicit Save flow therefore uses receipts rather than this shortcut. Projected fingerprint remains useful for preview consistency/testing only; it is not a save authorization or replay token.

Timestamp sources: `20260316091000_academic_calendar_extension.sql:3` (latest `set_updated_at` definition), `20260318120000_teacher_classroom_catalogs.sql:46–67`, `20260316090000_class_terms.sql:163–170`, `20260426090000_class_groups_many_to_many.sql:50–59`, validated baseline `dashboard-free-tier-v1.sql:55–64,111834–111835` for school.

## Default period and linked-profile side effects

Default period: preserve `class_schedule_sync_groups_single_default_idx` (unique partial index on true). Validate the final replacement exists and survives the journal. Clear old true rows first, then set exactly the selected row true **inside this same transaction**; a one-statement per-row CASE update is not guaranteed to satisfy the immediate unique index in every update order. No observer sees an intermediate defaultless state. Deleting a default while rows remain requires explicit replacement; deleting the final row may leave an empty collection/default null. Legacy preexisting no-default collections may remain defaultless until explicitly selected; do not invent a default from the current page. Browser fallback preference can be resolved by direct ID/name lookup, never by page membership, and persist that preference only after successful Save. Current `[rows]` effect writes unsaved default choices to local storage (`class-group-master-workspace.tsx:146`); move that effect to confirmed-save/reload reconciliation to honor staged Save. Preserve existing group-member FK cascade and term FK SET NULL behavior, not new cascades.

Teacher: existing `upsertTeacherCatalogs` filters unchanged catalog rows, upserts them, then synchronizes each **changed linked row** into `profiles.role = dashboard_role` and `profiles.teacher_catalog_id = teacher.id`; it does not update profile name/email. Include a rank-only changed linked row in the comparison, matching existing behavior, but skip profile DML if those two profile fields already match. Unlink/relink currently does not clear the old profile or restore its role; preserve that behavior unless separately authorized. Teacher delete lets existing FK SET NULL clear profile linkage and does not reset its role. Unique nonnull teacher `profile_id`, lower(name), and FK constraints remain active. If profile RLS prevents a required update, fail the whole Save rather than claim catalog+profile completion. Do not broaden teacher rights to other users' profiles.

Teacher sources: `management-service.js:655–699,869–975,1554–1564`; `20260429162000_teacher_account_link_audit.sql:3–66`; `20260525091554_assistant_dashboard_role.sql:1–27`. Final audit triggers are `20260814115116_dashboard_audit_diff_format.sql:225–230` under existing constrained audit writer v2; leave them and their audit-chain validation intact. No direct audit inserts and no notification/provider calls.

## Final access chain and implementation gates

| Relation | Effective existing boundary |
|---|---|
| Schools | Baseline authenticated SELECT and permissive authenticated ALL `using/check true`; separate staff-write policy does not narrow permissive OR. `dashboard-free-tier-v1.sql:111266–111275`. Do not mistakenly restrict new save to staff only. |
| Terms | Authenticated SELECT and ALL true; `20260317103000_class_terms_authenticated_write.sql` supersedes earlier staff-write. |
| Teacher/classroom | Authenticated SELECT; writes `current_dashboard_role() IN ('admin','staff','teacher')`; `20260318120000_teacher_classroom_catalogs.sql:72–99`. |
| Groups | Authenticated SELECT; writes admin/staff; `20260426090000_class_groups_many_to_many.sql:66–80`. |
| Profiles | Final `20260808172743_rls_policy_initplan_consolidation.sql:78–139`: SELECT self/identity matches/admin/staff; UPDATE self OR admin/staff with matching WITH CHECK. Do not rely on the older staff-only policy. |

Baseline grants authenticated DML on all these tables: `dashboard-free-tier-v1.sql:112166,112244,112249,112258,112432,112466`. Preserve ACL/RLS, do not grant broader table privileges. New callable functions: revoke default PUBLIC/anon EXECUTE and grant authenticated only; invoker throughout. Preserve existing auth helper rather than adding a new definer bypass. Tables' permissive historic policies are observations, not a proposal to broaden them.

Required implementation evidence before rollout: final-chain pgTAP SQLSTATE assertions for malformed request, unauthorized writes, stale base/profile, natural constraint failures, rollback after profile/default failure; direct-writer-vs-save locking; delete+insert fingerprint changes; first/last/cross-page moves, interleaved teacher teams, rename-sort-rename and team-change-move chronology; school natural-sort parity; rank compaction without page-local renumbering; default off-page/replacement/empty-catalog; linked-profile diff/audit/no-send; lost-response replay with no duplicate move/audit; page 11 + exact projected totals + off-page drafts + stale preview suppression. Verify legacy null/invalid fields are not rewritten on an unrelated edit. This audit did not execute those tests.

Official guidance consulted: [Supabase database functions](https://supabase.com/docs/guides/database/functions), supporting invoker and explicit function privileges. Changelog markdown fetch was attempted but the web provider rejected its content type; no feature was implemented from unverified changelog assumptions.
