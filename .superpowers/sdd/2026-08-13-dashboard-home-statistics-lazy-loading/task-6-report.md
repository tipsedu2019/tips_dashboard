# Task 6 report — dedicated lazy statistics workspace

## Status

- Source implementation and requested Node source suite: **GREEN**
- TypeScript: **GREEN** using the installed compiler with the pinned Node runtime
- Direct ESLint: **GREEN for errors**; one pre-existing warning remains in `src/features/management/use-management-records.ts`
- Production database, migrations, deployment, workers, providers, and recipients: **not requested and not touched**

## Delivered

- Added the `/admin/statistics` route and the `StatisticsWorkspace` feature. The dashboard home remains daily-brief-only and does not mount the statistics hook or the previous `SectionCards` presentation.
- Added the `통계` workspace metadata and full-dashboard navigation item. Command search derives from that same navigation map. The assistant navigation path remains unchanged; the client route guard and new server route both exclude the assistant role.
- Added four active-lazy panels: overview, students/classes, schedule conflicts, and textbooks. Only the selected panel mounts its aggregate hook. Each active panel owns its local loading/error/retry state, shows the last generated timestamp, and has one manual refresh control.
- Preserved aggregate KPI labels and the students/classes operational grouping: school/grade nested counts, grade/teacher/classroom group modes, and weekly-hours labels. Conflict presentation mounts only in the schedule-conflict tab. Textbook and conflict tabs use the contract's allowlisted presets.
- Added action-only student roster, class group, and class roster drilldowns. They make no request at screen/tab mount, load exactly 30 rows on user action, append by stable row ID without duplicates, and expose loading, retry, next-page, and end states per expanded group.
- Added `/api/dashboard/statistics/drilldown`: it validates the bearer JWT with the anonymous-key client, checks the current dashboard role is admin/staff/teacher, and invokes only the established security-invoker drilldown RPCs through that JWT client. It never reads or uses the service role.

## TDD evidence

The new route/workspace/drilldown contracts were written before source implementation. The RED run was:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-workspace.test.mjs \
  tests/statistics-drilldown.test.mjs \
  tests/admin-shell.test.mjs
```

It reported 28 pass / 6 intended failures: each missing page, workspace, drilldown component, and route was an `ENOENT` failure. After implementation, the requested source suite was re-run and passed 74/74.

## Verification

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-workspace.test.mjs \
  tests/statistics-drilldown.test.mjs \
  tests/statistics-resource-pressure.test.mjs \
  tests/admin-shell.test.mjs \
  tests/dashboard-metrics.test.mjs \
  tests/continuous-class-schedule-consumer-parity.test.mjs
```

Result: **74 pass, 0 fail**.

`"$TASK_PNPM" exec tsc --noEmit --pretty false` and `"$TASK_PNPM" eslint src tests middleware.ts next.config.ts` were attempted exactly. The wrapper stopped before either command because the existing dependency-status gate rejects ignored build scripts for `sharp@0.34.5` and `unrs-resolver@1.11.1`. No dependency approval or lockfile was changed. Running the installed compiler and ESLint with the pinned Node runtime succeeded; ESLint emitted only the unrelated existing `react-hooks/set-state-in-effect` warning in `src/features/management/use-management-records.ts:720` and no errors.

`git diff --check` passed.
