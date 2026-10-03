# Legacy lesson default recovery — cycle 10

Base: `fd381ccf19411a9b584c76082d64ff85b301aefe`, the previous production hotfix. This isolated change does not include paused annual-board performance or source synchronization work.

## Reproduction and change

The previous snapshot helper treated an existing skipped/exception/tbd date as historical even after an operator restored it to active. A date-only restored past lesson therefore failed client validation with `2026-10-01 수업의 시작·종료 시간을 입력해 주세요.`. The error did not select/open its editor, and skipped legacy dates were absent from the mobile list.

- Capture complete, uniquely resolved weekday defaults only during an explicit regular-date restoration. Keep the existing ID and every other date, historical record, manual/blank override, and saved-plan concurrency contract.
- Determine new draft dates against the accepted baseline. Reading or opening a saved plan does not capture defaults or save anything.
- Show skipped legacy dates for explicit restoration; keep their exclusion from active counts and keep normalized behavior unchanged.
- Offer `기본 정보 적용` on an incomplete, unambiguous selected regular lesson. Fill missing fields only, preserve typed values, and hide the button when complete. Application changes the draft and requires a separate save.
- On client validation failure, open the offending month/date and focus its start-time field. Clear pending focus when the class changes.

Actual narrow reads confirmed the reported class uses a canonical multiline weekday schedule and one visible matching teacher/room catalog. The API workspace's integer minute fields are a different contract; they are not used as a substitute for dashboard raw data. Latest observed source contained an existing skipped October 1 and active October 29. No duplicate date was generated and no production record was written during this verification.

## Verification

- Related helper/planner/service tests: 138/138; actual workspace DOM: 29/29; shared design contracts: 71/71. Total 238, disjoint test files.
- Meaningful regressions: previous hotfix fails all three restoration/recovery/focus DOM cases; previous overwrite behavior fails the typed-value preservation case. New helper exports are absent on the previous hotfix.
- Full package lint: zero errors, seven existing warnings. `tsc --noEmit` and `next build --webpack` pass.
- Final local build: `h5UhTCK7U-jU3evOXMui0`.
- Actual compiled Next browser route: 10/10 cases, 390/1440px, Korean locale, Seoul timezone, standard keyboard input. Synthetic stored October 1 skipped + October 29 active/date-only, empty date override map, multiline basic times and English catalogs.
- Cases include passive reads with zero saves; October 1 restoration and October 6 cancellation; selected-only defaults; manual `18:00` preservation; missing/ambiguous defaults selecting/focusing the past lesson; mocked conflict preserving draft with no automatic retry; explicit mocked successful save.
- The first browser run caught a typed-value overwrite; corrected before release. Its separate evidence is retained. A fixture assumption about canonicalized September overrides was corrected to use date-only historical rows matching the reported storage shape.

Browser auth, catalog names, records and RPC responses are wholly synthetic. All data/API traffic is fulfilled or aborted; only local document/static GETs reach the local server. This establishes UI behavior, not live login, RLS, real conflicts or database commits.

## Release boundary

Only two product files, two test files and this QA note change. SQL, permissions, locks, idempotency, expected-plan validation, existing save RPC, production schema and agent API past-date policy remain unchanged. No Git push/merge or linked database workflow is authorized here. Code-only direct production deployment uses the previously approved project/CLI path.

Actual October 1 normal / October 6 holiday storage requires an authenticated normal administrator app session. This executor has no connected authenticated browser; a successful synthetic save must not be reported as that production change. Parent owns that execution handoff and final narrow read verification.
