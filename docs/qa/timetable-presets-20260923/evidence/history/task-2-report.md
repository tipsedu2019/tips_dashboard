# Task 2 report — canonical timetable placement

Status: DONE. Base: `665de75f`. Branch: `codex/timetable-presets-20260923`.

## Implementation

- `src/features/academic/timetable-plan-contract.ts`: canonical plan slot, live shadow, item, pending slot, blocker, target, conflict and four-view types. Weekday uses 0–6; intervals use integer minutes and `[start,end)`.
- `src/features/academic/timetable-plan-model.ts`: immutable `moveSlot`, preserving the original duration and untouched resource while rejecting invalid weekdays, times, midnight crossings and empty override resources. Shared weekday/interval validators.
- `src/features/academic/timetable-placement-adapter.ts`: `projectTimetableSlot` projects the same plan or shadow slot ID into each view using catalog IDs and weekday keys. `resolveGridTarget` adds the cropped visible start and snaps new placement to five-minute absolute starts. `resolveMovedGridTarget(slot, originGrid, targetGrid)` compares absolute pointer minutes on the two grids, rounds **only the delta** to five minutes, adds it to the original slot start, and derives weekday/resource from the target grid. The caller passes the resulting target to `moveSlot` for duration and bounds validation. This supports moving a 17:13 slot by +5 to 17:18 and changing resource at zero time delta, even across different cropped axes.
- `src/features/academic/timetable-conflicts.ts`: `findConflicts` compares all slots within each plan and each plan slot against every supplied live shadow, reporting teacher, room and same-item causes independently. Half-open boundaries do not conflict. `suggestPlacements` checks the selected plan plus all shadows; it keeps resource IDs/duration, searches distinct selected weekdays in supplied order and earliest five-minute starts within the allowed occupancy window, returns at most five, and leaves existing slots untouched. It ignores unrelated preexisting conflicts when assessing a candidate.

No DB, RPC, React, UI, operation or send code changed. Applied-slot exclusion remains a caller contract for Task 3; this helper does not silently exclude a shadow by source class.

## TDD and verification

Tests written before working implementations:

```text
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/timetable-plan-model.node.ts tests/timetable-placement-adapter.node.ts tests/timetable-conflicts.node.ts
```

- RED: 13/13 failed on explicit unimplemented function stubs. Raw log: `.superpowers/sdd/2026-09-23-timetable-presets/task-2-red.log`.
- GREEN: 13/13 passed. Raw log: `.superpowers/sdd/2026-09-23-timetable-presets/task-2-green.log`.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed. Raw log: `.superpowers/sdd/2026-09-23-timetable-presets/task-2-tsc.log` (empty on success).
- `node node_modules/eslint/bin/eslint.js` on the four implementation and three test files: passed. Raw log: `.superpowers/sdd/2026-09-23-timetable-presets/task-2-eslint.log` (empty on success).
- `git diff --check`: passed.

## Self-review

- Verified the four projection layouts use one stable slot ID, and teacher/classroom views own only their respective resource override. No names appear in panel/column keys.
- Verified interval touching, one-minute overlap, both resource reasons, same-item overlap, separate plans, all-plan shadow comparison and no source-class exemption.
- Verified a drag from 17:13 retains its `:13` offset; moving between differently cropped grid axes with zero absolute time delta leaves the time unchanged.
- The pure functions assume canonical slot/shadow IDs and resource IDs are loaded from authoritative storage. Server-side concurrency, unresolved operating data, and applied-slot filtering belong to later tasks; this code is not an authoritative save guard.
