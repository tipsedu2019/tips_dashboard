# Settings Numbered Read Audit

**Date:** 2026-08-31
**Status:** Read-only implementation input for numbered-pagination planning.
**Scope:** School, classroom, term, period/class-group, teacher catalog, and teacher change-history surfaces.

## Decision

Do **not** put the current editable catalog lists behind server pages while retaining their present `saveAll` behavior. Each workspace owns a complete in-memory list and, on save, assigns every row a contiguous global `sort_order` (`index + 1`), deletes queued IDs, then upserts the entire array. A page slice cannot reproduce that operation: it would overwrite ranks outside the page, create duplicates/gaps, and make the next new-row rank unknowable.

Safe numbered reads are possible only after separating page-local field editing from global ordering. Existing row-upsert/delete mutations can save a changed record by ID, but they cannot safely implement cross-page reordering, global alphabetical sort, or new-row placement without a new authoritative reorder/insert contract. Do not hide a full collection behind a pager, add an arbitrary cap, or silently fall back to loading every row.

## Current write contracts

All five master workspaces use `managementService` in `src/features/management/management-service.js`:

| Surface | Read/order | Existing save path | Global-state dependency |
|---|---|---|---|
| School | `academic_schools`: `sort_order ASC, name ASC` | `deleteAcademicSchools(ids)` then `upsertAcademicSchools(allRows)` | Add/delete/move/name sort all rebuild global sequential rank; duplicate names are checked in the full local array. |
| Classroom | `classroom_catalogs`: `sort_order ASC, name ASC` | `deleteClassroomCatalogs(ids)` then `upsertClassroomCatalogs(allRows)` | Add/delete/move rebuild global sequential rank; subject filter is a local view over the complete list. |
| Term | `class_terms`: `academic_year DESC, sort_order ASC, name ASC` | `deleteClassTerm(ids)` then `upsertClassTerms(allRows)` | No move control, but every save still rewrites every `sort_order`; add needs the global maximum rank. |
| Period (class group) | `class_schedule_sync_groups`: `sort_order ASC, name ASC` | `deleteClassGroup(ids)`, `upsertClassGroups(allRows)`, then `setDefaultClassGroup(id)` | `handleSaveAll` renumbers every row; `is_default` is a global database state, not a property of the visible page. |
| Teacher | `teacher_catalogs`: `sort_order ASC, name ASC` | `deleteTeacherCatalogs(ids)` then `upsertTeacherCatalogs(allRows)`, then linked profile synchronization | Adds and within-team moves rebuild global sequential rank; global rank is also the persisted cross-team sequence. |

`upsertRows` is direct `from(table).upsert(payload, { onConflict: "id" })`, not an all-list transactional RPC. `upsertTeacherCatalogs` first filters unchanged rows by reading them by ID, then upserts changed IDs and calls `syncLinkedTeacherProfiles`. That makes a no-reorder, per-record edit feasible with the existing mutation code, but it provides neither a collection revision nor atomic rank rebalancing.

### Exact workspace locations

- `src/features/management/school-master-workspace.tsx`: `handleSaveAll`, `reorderWithSequentialSort`, `handleNameSort`, `duplicateNameSet`.
- `src/features/management/classroom-master-workspace.tsx`: `handleSaveAll`, `reorderWithSequentialSort`, `filterClassroomCatalogRowsForSubject`.
- `src/features/management/term-master-workspace.tsx`: `handleSaveAll` and `nextSortOrder`.
- `src/features/management/class-group-master-workspace.tsx`: `loadGroups` (line 94; table read at line 107) reads `class_schedule_sync_groups` (`id,name,subject,sort_order,is_default`); `handleSaveAll` (line 172) assigns `sortOrder: index + 1`, deletes queued IDs, upserts all rows, and persists the selected default at line 204.
- `src/features/management/teacher-master-workspace.tsx`: `handleSaveAll`, `withSequentialSort`, `handleMoveRowWithinTeam`.
- `src/features/management/management-service.js`: `buildAcademicSchoolPayload`, `buildResourceCatalogPayload`, `buildClassTermPayload`, `buildClassGroupPayload`, `upsertRows`, `deleteRows`, `upsertTeacherCatalogRows`, `syncLinkedTeacherProfiles`. `setDefaultClassGroup(id)` (line 1641) currently clears `is_default` for every other group then sets it on the target through two client updates (lines 1650 and 1658); it is not an atomic server-side default RPC.

## Smallest safe read/detail/catalog split

### 1. Page reads

Use separate authenticated, `security invoker` page reads for the five actual record lists. A common wire shape is acceptable, but filters and DTOs remain local:

```ts
type SettingsPage<T> = {
  rows: T[];
  page: number; // one-based
  pageSize: 10 | 15 | 20;
  totalCount: number;
};
```

Suggested signatures (versioned, because no current page RPC exists):

```sql
list_academic_school_numbered_page_v1(
  p_category text,
  p_search text,
  p_sort text,            -- only the existing list order or name asc/desc when it is read-only
  p_page integer,
  p_page_size integer
) returns jsonb;

list_classroom_catalog_numbered_page_v1(
  p_subject text,
  p_page integer,
  p_page_size integer
) returns jsonb;

list_class_term_numbered_page_v1(
  p_academic_year integer,
  p_page integer,
  p_page_size integer
) returns jsonb;

list_class_schedule_sync_group_numbered_page_v1(
  p_page integer,
  p_page_size integer
) returns jsonb;

list_teacher_catalog_numbered_page_v1(
  p_team text,
  p_page integer,
  p_page_size integer
) returns jsonb;
```

Validate one-based page, `10|15|20`, and each filter/sort allow-list with `22023`; append `id` to every order. Each `totalCount` must come from the same RLS-visible filtered relation as rows.

List DTOs should be narrow but edit-complete for a page-local editor:

- School: `id,name,category,color,sort_order,updated_at`.
- Classroom: `id,name,subjects,campus,is_visible,sort_order,updated_at`.
- Term: `id,academic_year,name,status,start_date,end_date,sort_order,updated_at`.
- Period/class group: `id,name,subject,sort_order,is_default`. Return the authoritative default group ID in page metadata so a page that does not contain it cannot manufacture a page-local default.
- Teacher: `id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role,updated_at`.

Do not use the operations catalog RPC's existing `limit 200` arrays as a settings-master fallback. They are picker/catalog support data, not authoritative complete configuration lists.

### 2. Direct detail and dependent catalogs

- School details/references: before delete or rename, inspect affected records explicitly. `academic_schools.name` is unique and is referenced by academic event/curriculum relationships; page presence is not an authority check.
- Classroom details: retain full subject membership and campus. The class/schedule selection catalogs are separate and remain subject-scoped.
- Term details: retain the exact term and its classes/reference checks; a term page must not imply that all periods/classes were loaded.
- Period/class-group details: this is the database period master, separate from `class_terms`. Preserve the one global `is_default` selection. Browser-local `readDefaultPeriodPreference` is only the legacy fallback when no database row is marked default; it must not choose a default from the current page. If deletion targets the default, require an explicitly selected replacement before deletion because the existing mutation has no clear-default operation.
- Teacher details: direct teacher-by-ID read must retain account-link fields. The account-profile selector is a separate searchable/bounded catalog; it must not be derived from currently loaded teacher rows. Linked profile synchronization remains independent after a teacher update.

## Required product/mutation boundary

### Allowed without changing domain mutations

After a UI refactor from `rows[] + saveAll` to `dirtyById + pendingDeleteIds`, these actions can invoke the existing upsert/delete operations using only the edited ID(s):

- page-local scalar edit (school category/color/name; classroom membership/campus/visibility; term dates/status/name; teacher name/team/visibility/account/role);
- page-local deletion, subject to the existing database foreign-key/RLS result and a clear reload on conflict;
- period/class-group default selection only if it remains an explicit whole-collection mutation with a replacement rule for deleting the current default; do not infer it from a page slice;
- teacher profile synchronization, because it already follows changed teacher-row upsert.

This is not a license to retain the current client duplicate checks: school duplicate detection must become an authoritative uniqueness-conflict response (or a dedicated server validation read) because a page cannot see all names.

### Not safe without a new mutation and an explicit product decision

- Up/down reorder across a page boundary.
- School's name-sort action, which currently reassigns every row's rank.
- Any add that promises a place in global sorted order (the current `nextSortOrder` requires complete-list max rank).
- Renumbering only the visible page, or using page size/loaded rows as the highest rank.
- Period/class-group add/delete or save through `upsertClassGroups(allRows)`: it has the same full-list rank rewrite, plus default-period semantics.

To retain global ordering under numbered pages, add one authoritative transactional contract such as `move_<catalog>_item_v1(p_id uuid, p_before_id uuid null, p_after_id uuid null, p_expected_revision bigint)` or a reorder RPC that accepts the full ordered IDs plus collection revision. It must lock/revision-check the order, calculate ranks server-side, and return the affected rows/revision. Existing direct `upsert` calls are insufficient.

**Status — authorized on 2026-08-31:** The user requested Docker launch and inclusion of recommended save API improvements. Implement the smallest transactional save/order contract that retains existing staged editing, add, cross-page move, alphabetical reorder, period default, and teacher account-link behavior. Page navigation must preserve off-page drafts; saving a page must not overwrite untouched off-page records. Use server-owned ranks and revision/conflict checks, not a full-array fallback or an arbitrary catalog cap. Preserve existing authorization and business semantics; remote application remains unapproved.

Do not make the current page selection mean "all items", silently remove existing ordering controls, or treat page rows as a complete collection.

## Tables, active access contracts, and history

- `public.teacher_catalogs` and `public.classroom_catalogs`: introduced in `20260318120000_teacher_classroom_catalogs.sql`; RLS select is authenticated and write policy is role-based (`admin|staff|teacher`). Later migrations add teacher account fields/roles and classroom subject/campus rules. Preserve these policies through invoker reads.
- `public.class_terms`: defined in `20260316090000_class_terms.sql`, unique on `(academic_year, name)`. `20260317103000_class_terms_authenticated_write.sql` replaces the staff-write policy with `class_terms_authenticated_write` (`using/check true`); a new page read must not broaden this existing authorization contract.
- `public.class_schedule_sync_groups`: the period master used by `class-group-master-workspace.tsx`, not `class_terms`. The workspace's current fallback supports older schemas without `sort_order`/`is_default`; a paged deployment must use the final migration/RLS chain for those fields rather than treating fallback as a semantic substitute. `20260426090000_class_groups_many_to_many.sql` lines 66–80 defines authenticated `SELECT USING (true)` and authenticated write gated by `current_dashboard_role() IN ('admin','staff')`; those remain the access boundary.
- `public.academic_schools`: present in the repository's validated catalog baseline with unique `name`, RLS, authenticated select, and existing write policies. Its creation is not represented as a normal forward migration in this checkout; use the catalog-baseline/parity contract rather than inventing a new client-side authority.
- Teacher history is `public.dashboard_audit_logs`, generated by audit triggers on `teacher_catalogs` and `profiles`; the current final audit migration (`20260814115116_dashboard_audit_diff_format.sql`) retains those triggers under the v2 audit writer. RLS staff read remains the authority.

### Teacher history: preserve the recent preview and add the already-approved full history

`selectRecentAuditLogs` currently reads only 12 entries ordered `changed_at DESC` for `entity_table IN ('teacher_catalogs','profiles')`; the UI labels it **최근 변경 이력**. This is a deliberately recent-activity preview, not proof of a complete history.

- Keep the 12-row preview unpaged while it is labelled **최근 변경 이력**. Do not put numbered navigation under that label unless the whole surface is renamed **전체 변경 이력**.
- The approved numbered-pagination scope already includes teacher audit/history. Add a distinct full-history surface, with no new search/filter controls, using `list_teacher_audit_numbered_page_v1(p_page integer, p_page_size integer)`. It must filter only the existing teacher entities (`teacher_catalogs`,`profiles`), order `changed_at DESC, id DESC`, and return the RLS-authorized exact total. List fields are limited to event identity, actor identity/display fields, action, entity table/ID/label, and `changed_at`; an event-by-ID detail may reconstruct the diff, but the list must not carry pre/post/full diff payloads.
- `dashboard_audit_logs` is write-only for the audit writer in the final v2 design; no list implementation may insert or rewrite audit records.

## Explicit exclusions

- `src/features/management/subject-master-workspace.tsx` is a finite configuration matrix: `ACADEMIC_SUBJECTS` is exactly English, Math, Science; its service rejects any response not containing exactly those three and saves one subject at a time. It is not a pageable record list.
- `src/features/management/period-preferences.ts` is browser-local default-period fallback, not the database period catalog. The applicable database period master is `class_schedule_sync_groups`; `class_terms` remains a separate term master.

## Test plan and existing evidence files

Retain existing tests and add behavioral page/read and mutation-boundary coverage:

- Existing school workspace checks: `tests/school-settings-workspace.test.mjs` (filters, duplicate-name behavior, layout).
- Existing classroom checks: `tests/classroom-subject-membership.test.mjs` (multi-subject payload ordering, campus validation, mobile/desktop parity, explicit catalog projection).
- Existing teacher checks: `tests/teacher-account-linking.test.mjs` (account linking, roles/team model, audit-history surfaces and migration/audit triggers).
- Existing database parity contract: `supabase/tests/dashboard_free_tier_catalog_parity_test.sql`.

Add, before implementation completion:

1. `tests/settings-numbered-read-service.test.mjs`: exact RPC arguments, direct page 11, one-based/size validation, matching count/filter scope, deterministic ties, stale/cancelled result rejection, and no full-array fallback.
2. `tests/settings-numbered-edit-boundary.test.mjs`: page-local dirty rows save only their IDs; page navigation preserves/guards unsaved drafts; school uniqueness conflict; no visible-page rank renumbering; add/reorder controls are unavailable until the approved mutation exists.
3. `tests/teacher-audit-numbered-page.test.mjs`: retain the 12-entry explicitly `recent` preview and verify the approved separate full-history pager has no new filters, exact totals, deterministic `changed_at DESC, id DESC`, and an event-detail boundary for diffs.
4. `supabase/tests/settings_numbered_reads_test.sql`: RLS/authenticated access, exact full-filter totals, arbitrary pages, stable order, invalid `22023`, catalog-list DTO non-leakage, and period default metadata that remains correct when the default is off-page.
5. `supabase/tests/settings_catalog_reorder_test.sql` for the now-authorized reorder/save API: concurrent/revision conflict, cross-page move, no duplicate/gap ranks, new-row placement, default-period replacement/atomicity, and rollback behavior.

This audit is design input; implementation and local testing are authorized by the user's request. Remote migration/deployment remains a separate permission boundary.
