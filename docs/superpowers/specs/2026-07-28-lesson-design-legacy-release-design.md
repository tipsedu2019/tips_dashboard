# Lesson Design Legacy Release Design

## Goal

Ship the approved lesson-design usability fixes without introducing the v3
lesson-plan domain, database migrations, RPCs, backfill, or period-schedule
storage.

## Release scope

This release keeps the existing `schedule_plan` save path and changes only the
current lesson-design user experience.

1. Calendar cells cycle on one click. For both timetable and non-timetable
   dates the visible sequence is `정상 → 휴강 → 보강 → 미정 → 해제 → 정상`.
   A skipped session is visually empty, excluded from session numbering, and
   retains its existing session ID and progress draft when restored.
2. The textbook section shows useful textbook metadata beside the textbook
   title and removes duplicate controls: the repeated textbook-information
   disclosure, redundant period summary, and automatic-range buttons.
   Candidate textbooks are limited to the class subject; `science` is shown as
   `과학`.
3. Selecting a session opens progress editing in a child dialog. The dialog
   owns a local draft; Cancel makes no parent-draft change and Apply updates
   only that session's textbook progress entries.
4. The lesson-design parent dialog has one close lifecycle. Closing does not
   clear the route or unmount content twice, and it preserves the exit
   animation before restoration work occurs.

## Explicitly deferred

- v3 plan normalization, revision checking, conflict handling, and typed
  mutation services.
- Database migrations, RPCs, idempotency ledgers, backfill, and capability
  activation.
- Period-specific timetable persistence, `schedule_overrides`, and automatic
  propagation of teacher, room, weekday, or time changes.
- Any notification provider activation or notification dispatch.

## Architecture

Keep `ClassScheduleWorkspace` as the legacy data and save boundary for this
release. Extract small presentational or draft helpers only where they make a
new interaction testable; do not replace the legacy plan model. Existing
Dialog primitives provide exit-presence behavior, while the parent and child
dialogs maintain separate open and draft state.

## Data and safety rules

- Preserve the existing `schedule_plan` data shape and server save endpoint.
- A skipped date must preserve the original session object until restored.
- Do not write class timetable fields, `schedule_overrides`, or new database
  columns in this release.
- Do not expose UUIDs in visible UI.
- Do not enable Google Chat, Web Push, SOLAPI, notification workers, or
  permission prompts.

## Verification and release gate

- Add behavior tests for calendar transitions, textbook candidate/title
  behavior, local progress-dialog draft behavior, and dialog close lifecycle.
- Run targeted Node and DOM tests, lint, and the Webpack production build.
- Run actual browser QA against a class with data. The current local
  `classes 데이터를 불러오지 못했습니다.` state is a release blocker, not a
  successful browser check.
- Inspect the final diff, commit only after Git write access is available, and
  deploy only after all preceding checks pass.
