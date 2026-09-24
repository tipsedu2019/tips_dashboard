# Task 3 — shared timetable plan storage

Status: DONE_WITH_CONCERNS (implementation complete; operational lock adoption/datetime session checks and provider delivery remain subsequent task/rollout gates).

## Scope and files

- `supabase/migrations/20260923081138_timetable_plan_storage.sql` (CLI-created filename): 4 public plan tables, private receipts/transfers, minimal public invalidation signal table; explicit owner, RLS, SELECT-only client ACLs and restricted RPCs.
- `src/features/academic/timetable-plan-contract.ts`: canonical item commands, plan metadata, access, members/candidates, snapshot/reference/revision/list, catalog tombstone, event and RPC argument/result types. Existing canonical PlanSlot extended with optional server label snapshots; no second wire model.
- `supabase/tests/timetable_plan_storage_test.sql`: 61 executed rollback-only assertions.
- `supabase/tests/timetable_plan_permissions_test.sql`: 24 executed rollback-only assertions.

No existing operational migration/function was edited, no UI/React changes, production/provider calls, push or deployment. Root's untracked spec/plan and ignored reports/logs are not staged.

## Final RPC signatures

All public APIs have fixed empty search_path, explicit postgres owner, EXECUTE granted to authenticated only. SQL rechecks live profiles/membership; client access flags are not authority.

- `list_timetable_plans_v1(p_search text default '', p_archived boolean default false, p_page integer default 1, p_page_size integer default 25) -> jsonb` returns `PlanList`. `p_archived=true` includes archived and draft; false returns draft only. One-based pages, maximum 100 rows/page, explicit total.
- `get_timetable_plan_v1(p_plan_id uuid) -> jsonb` returns canonical `PlanSnapshot` including all draft/applied items, draft-only slots, separate appliedSnapshots, shadowSlots/shadowClasses, full catalogs, missing-resource tombstones, unresolvedOccupancies, fingerprint/complete/capacity, members and permissions.
- `get_timetable_plan_revision_v1(p_plan_id uuid) -> jsonb` returns `PlanRevision`.
- `list_timetable_share_candidates_v1() -> jsonb` returns only `{ userId, name, role: 'teacher' }[]`, management-only.
- `mutate_timetable_plan_v1(p_command jsonb) -> jsonb` returns `{ plan: PlanMetadata }`; discriminated `PlanCommand` operations create/rename/clone/share/archive/restore.
- `mutate_timetable_plan_item_v1(p_command jsonb) -> jsonb` returns `PlanMutationResult`; discriminated save/delete commands. `expectedItemRevision=null` creates, new item revision starts at 1. `operation:'save'` with `slots:[]` explicitly unplaces. Delete requires `itemId`.
- RLS entrypoints `can_read_timetable_plan_v1(uuid)` / `can_read_timetable_operating_signal_v1()` expose only caller-specific booleans. All other helpers are private and have client EXECUTE revoked.

For item save, `item` is exactly the canonical `PlanItemDraft`, lifecycle/provenance fields are rejected. IDs are caller UUIDs (stable across retry); server fields remain server-owned. Slot `sourceSlotId` must equal the existing server value, or null on new slot. Supplied display names are ignored; server derives/preserves them. Receipts are namespaced by actor + `plan.<operation>`/`item.<operation>` + requestKey. Same body replays exact response after latest authorization; changed body is 22023.

## Integration foundations for Tasks 4/5/7

- Call `dashboard_private.lock_timetable_operating_resources_v1()` **before any operating class/plan row lock**. It acquires transaction advisory bigint key `pg_catalog.hashtextextended('tips:timetable:operational',0)` (shared planned key for Tasks 3/4/7/8). Plan mutation order: actor -> advisory -> plan row -> current permission -> receipt -> revisions -> current reference -> validation -> delta -> sequence/signal -> receipt. There is no operational guard adoption in Task 3.
- `dashboard_private.read_timetable_operating_reference_v1() -> jsonb` is a STABLE read-only weekly reference with full catalogs and minimal active class metadata. Normalized slots are authoritative, all subjects/resources are considered. Legacy complete tokens accept newline/semicolon/comma separated blocks, grouped Korean weekdays, exact time minutes, optional `(teacher, room)` labels; unique exact catalog name resolution only. Unknown/ambiguous/unparseable/incomplete data yields occupancy blockers and complete=false, never an empty available board or mode activation. Fingerprint includes raw source state (including unresolved normalized slots) and catalog/shadow values.
- `dashboard_private.validate_timetable_item_slots_v1(plan uuid,item uuid,subject text,slots jsonb,reference jsonb)` is reusable. It checks changed occupancy against candidate same-item slots, all other draft items in that plan and all live shadows. Unchanged conflicts survive; safe move/delete/name-only updates are supported. Teacher aliases use the existing final `registration_observation_teacher_subject_matches_v1` helper; classrooms use exact subject membership. Task 4 must add bounded dated-session validation to this shared path when target dates apply.
- `get_timetable_plan_v1` is STABLE, so its reads share a coherent command snapshot. Snapshot slots do not include applied rows even if applied_class_id becomes null. Applied immutable history is separate.
- Per-plan signal automatically writes on insert/change_sequence update. Payload columns are only `id`, optional `plan_id`, `change_sequence`, `updated_at`. Operational singleton exists but Task 4 owns operating emission. Only signal table is added to existing supabase_realtime publication. Task 5 subscribes to INSERT/UPDATE and re-fetches; retain polling/focus fallback.
- Resource plan-slot IDs deliberately have **no catalog FK**; deleted resources retain stable UUID/name snapshots and return `isMissing:true,isVisible:false` catalog tombstones. New occupancy of absent/hidden resources is invalid; unchanged slots can be renamed/repaired. Existing unique lower(name) catalog indexes remain untouched.
- Full clone follows controller ruling: draft slots (including existing conflicts/unavailable resources) copied to new IDs; applied items become unplaced drafts. No memberships copied. This differs from Task 7 selected destination transfers, which require fresh destination conflict checks.
- `dashboard_private.timetable_plan_transfers` has unique actor/request key, source/target plan IDs, selected_mapping/revisions/result JSON plus timestamp. It is foundational storage only; operational transfer RPCs remain later work.
- Existing final auth trigger (`pg_get_functiondef` captured) updates teacher.profile_id and then profiles.teacher_catalog_id. Sharing requires mutual identity linkage and profile role=teacher. Reverse-only, unlinked or assistant/viewer profiles are not inferred eligible. Hidden but linked teachers remain eligible; resource visibility is separate.

## Test evidence

Final commands (from this worktree):

```sh
/Users/hyunjun/.npm/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration new timetable_plan_storage
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < /tmp/timetable-rebuild.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_plan_storage_test.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_plan_permissions_test.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .superpowers/sdd/2026-09-23-timetable-presets/task-3-producer-contract.ts
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/timetable-plan-model.node.ts tests/timetable-placement-adapter.node.ts tests/timetable-conflicts.node.ts
git diff --check
```

The final rebuild transaction dropped/recreated **only Task 3 new objects**, appended the full final migration, then committed. The shared container and all prerequisite/Task 1 migrations were retained. Raw final apply log ends COMMIT. Tests use the approved socket-only Docker fixture; `supabase test db` assumes the CLI-managed local port/stack and was not used against a different environment. Actual pgTAP outputs and `finish()` counts were parsed, not merely psql exit status.

Raw logs/artifacts under this report directory:

- `task-3-red.log`: expanded pre-implementation suite stopped in fixture setup because current auth hook had already created linked teacher rows. The initial missing-list-RPC smoke assertion was run before migration but its log was overwritten by this expanded run; do not misrepresent this file as a full pre-implementation behavior RED.
- `task-3-legacy-red.log`: preserved executed behavioral RED, **58 assertions, 5 failures** (comma legacy parsing, incomplete metadata, deleted resource tombstone) before those changes were loaded/fixed.
- `task-3-final-migration.log`: complete final DDL/functions/ACL/publication application, COMMIT.
- `task-3-storage-green.log`: **61/61**, `1..61`, no not-ok or ERROR, ROLLBACK.
- `task-3-permissions-green.log`: **24/24**, `1..24`, no not-ok or ERROR, ROLLBACK.
- `task-3-model.log`: **13/13** canonical model/adapter/conflict tests.
- `task-3-typescript.log`: strict TypeScript exit 0 (empty diagnostic log).
- `task-3-producer-snapshot.json`, `task-3-producer-contract.ts`: actual non-empty DB snapshot (nullable applied/source IDs, applied history, missing-resource catalog tombstone) assigned to canonical PlanSnapshot, strict checked.
- `task-3-final-definition-acl.log`: actual installed RPC/auth trigger definitions, owner/search_path/volatility/EXECUTE, table RLS/SELECT/DML ACLs, and signal-only publication evidence.

Assertions include exact P0001/timetable_stale; 23P01/timetable_resource_conflict; 22023/timetable_invalid or timetable_capacity; 42501/timetable_forbidden; actual composite FK 23503; replay/body mismatch/other-actor key isolation; role/share revocation; viewer/editor distinction; same resource different plan independence; duplicate IDs and cross-plan slot theft; same-item/teacher-only/room-only overlap; half-open adjacency; live conflicts preserved on name edits then repaired; hidden/deleted IDs; legacy exact parsing and fail-closed blockers; applied null-FK lifecycle; clone/archive/restore/delete; separate metadata/item revisions; full over-capacity reads and blocked writes; signal writes/RLS/ACL.

## Concerns / explicit verification boundaries

1. The isolated PostgreSQL fixture has no Realtime provider and wal_level=replica. DB signal/RLS/publication are verified; websocket delivery is not claimed.
2. Operating writers do not yet adopt this advisory lock; concurrent plan-vs-operating safety becomes complete only after Task 4 guards and real two-session races. Dated-session target-range checks are explicitly Task 4 work.
3. Existing synthetic class DELETE hits unrelated dashboard audit class FK behavior. The storage test instead closes that fixture through the existing private test guard. Applied-class-null semantics are independently established by private synthetic setup, while public ordinary mutations reject lifecycle fields. No existing production deletion behavior was changed.
4. Pre-implementation full suite RED encountered fixture-hook setup failure rather than missing RPC, as described above; preserved behavior RED and final GREEN are separately identified.
5. No Supabase provider advisory service, production migrations, deployment, browser or websocket claim. Native final ACL/owner/search_path/actual-role tests replace unavailable remote advisor checks for this local task.

## Shared lock integration correction

The helper retains its name and now uses the approved `hashtextextended('tips:timetable:operational',0)` bigint key. `task-3-operating-lock-key.log` contains the actual final function definition and a rollback-only pgTAP assertion against pg_locks: classid/objid equal the high/low 32 bits of that key, objsubid=1 (single bigint form), mode=ExclusiveLock and granted=true for the current backend. This targeted check passed; unchanged broad suites were not repeated.

## Independent review fix round 1 (base a8e3f62e)

Both Important findings in `task-3-review-1.md` are fixed, without extending Task 3 scope.

1. The standard SQL regex had doubled backslashes around literal parentheses, so a valid legacy line emitted by the existing writer did not parse. The two literals now use `[(]` and `[)]`, avoiding SQL-string escape ambiguity. New actual RPC tests read two lines with different per-slot teachers/classrooms and exact minute ranges (월 17:13–18:43 / 수 09:10–10:40); assert complete=true, no blockers and each authoritative resource UUID; reject teacher-only and classroom-only overlaps with exact `23P01/timetable_resource_conflict`; and accept unrelated safe occupancy. They prove valid input is understood instead of merely producing a generic fail-closed conflict.
2. Slot duplicate detection now compares `(id)::uuid`, matching the identity type used by row lookup/upsert. New tests supply lower/uppercase representations and hyphenated/compact representations of the same UUID with different coordinates. Both now raise exact `22023/timetable_invalid`. Separate before/after snapshots include plan metadata/revisions, every item/slot/member, signal row and all private receipts, proving the rejected command leaves the whole write state unchanged.
3. Minor fixture noise: pgTAP extension creation now checks pg_extension before CREATE, so already-installed extension NOTICE is absent. No client_min_messages or error/warning suppression was introduced.

Behavior RED was run **before either production helper fix was installed**. `task-3-fix1-red.log` contains 73 assertions, `1..73`, and 10 failures: uppercase/compact UUID rejection plus state preservation (4), valid parenthesized snapshots/resource resolution/safe save (6). Existing 61 checks stayed green. The suite rolled back its synthetic mutations. An initial regression-test SQL-expression error was corrected before capturing this complete RED; final preserved RED is the complete behavioral run.

Exact local commands:

```sh
# RED: new tests against the unchanged installed a8e3f62e helper bodies
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_plan_storage_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-3-fix1-red.log 2>&1
# Install only the two changed CREATE OR REPLACE helper definitions extracted from final migration
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < /tmp/timetable-task3-fix1.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-3-fix1-apply.log 2>&1
# GREEN against those final installed helper definitions
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_plan_storage_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-3-fix1-storage-green.log 2>&1
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_plan_permissions_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-3-fix1-permissions-green.log 2>&1
git diff --check
```

Current final SQL evidence supersedes the earlier 61/24 counts: **storage 73/73**, **permissions 24/24**, exact `finish()` plans, no not-ok/ERROR, ROLLBACK. A parser counted each actual `ok N -` line, verified the final plan and rejected not-ok/ERROR; exit status alone was not considered sufficient. `task-3-fix1-final-definitions.json` stores actual pg_get_functiondef/prosrc for both helpers. Their installed bodies were compared to the final migration bodies and matched exactly; postgres ownership, empty search_path, and authenticated/anon EXECUTE=false remained intact.

Only two production expression lines changed, plus these regression tests and harmless extension initialization. No TypeScript/model code changed, so the already-green 13 model tests/producer contract were not repeated. No container reset, production/provider calls, push, deployment, new permissions or extra feature scope. No unresolved finding remains from this review round; previously recorded Task 4/7 and Realtime rollout boundaries are unchanged.
