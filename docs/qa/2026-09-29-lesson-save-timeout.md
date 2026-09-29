# Lesson schedule save timeout repair

The production `update_class_operational_v1` save failed with PostgreSQL SQLSTATE
`57014`, `canceling statement due to statement timeout`. The logged stack reaches
`timetable_effective_date_v1` from `assert_timetable_operational_conflicts_v1`.
The source plan was unchanged after the failed save. Aggregate reference size was
168 weekly slots, 2,234 dated rows, 4,175 unresolved dated rows and 195 dates.
No production identifiers or lesson content are included in this record.

The guard previously recomputed every date, expanding the entire dated JSON array
for each weekly slot. The new reader materializes the requested date and weekday
once. Dated-only changes inspect the multiset difference on both sides; weekly
changes still inspect every actual date. Each affected date retains the complete
cross-class reference, including closed/preparing classes. Removed overrides,
newly exposed defaults, multiplicity, historical conflicts and SQLSTATE `23P01`
remain covered.

A second producer mismatch was found before release: a future plain regular row
whose weekday no longer matches its class defaults lost its known teacher and
room and became a global blocker. A complete single-resource class definition now
retains those resource IDs while leaving the time unresolved. Same-teacher or
same-room saves still fail closed. Forced/makeup/explicit/past/duplicate rows,
ambiguous catalogs and mixed-resource schedules do not acquire this authority.
No source class or schedule rows are backfilled.

## Local verification

- Isolated PostgreSQL 17 container, network none, existing ordered migration replay
  through the previous release plus this forward migration.
- Synthetic actual authenticated RPC, expected-plan comparison, idempotent replay,
  and deferred constraints: 84 classes, 168 weekly slots, 10,752 dated legacy rows.
  Before: same 8-second timeout stack as production. After final patch: 1,963 ms
  including deferred validation (8-second statement timeout stays in force).
- Scoped-uncertainty regression: three red assertions before the reader repair,
  all green afterward; unrelated resources save, same teacher and same room each
  reject with exact `23P01/timetable_resource_conflict`, closed source row unchanged.
- All 16 timetable pgTAP files: 755 passing assertions. This includes 180 multiset
  comparisons with the formerly deployed effective-date reader, date moves,
  distant unchanged actual sessions after weekly edits, removed inherited slots,
  permissions, request receipts, isolation guards, and no-send assertions.
- 23 transactional, SQLSTATE and post-deployment receipt Node tests passed.
- Squawk 2.63, migration layout, domain SQLSTATE verification, and diff checks passed.
- New performance regression added to the isolated SQL CI replay; the workflow
  integrity hash changes only to register that test. No deployment gates removed.

Production application, browser save and persisted readback are separate release
checks. Local results above do not establish those outcomes.
