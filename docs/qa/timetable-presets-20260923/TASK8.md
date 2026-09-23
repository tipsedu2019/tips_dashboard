# Task 8 local verification

Scope: isolated `tips_timetable_20260923`, network none, Unix socket; local release Next webpack at 127.0.0.1. No production reads, sends, push or deployment.

- `concurrency-results.json`: 10 real two-connection races, distinct backend PIDs, observed advisory wait/blocker before commit, outcomes and cleanup. Different editors retain different items; same item is stale. Both operating/draft, management/promotion and generation/actual public makeup approval directions are covered. Final overlaps0; revoked receipt replay42501; pinned RR25001; genuine MVCC40001.
- `task8-verification.json`: pgTAP25 exact makeup states/context/audit +12 old/new guard equivalence +135 operational regression (plans5+5+125) +132 nonempty history/no-send =304. Focused Node120/120; final changed HTTP consumer recheck44/44. Actual DB browser19/19.
- `provider-spy-results.json`: four actual transfer-service copy/move paths and replay; nonempty DB queue1→1, independently observed provider/network fetch calls0. `manual-fixture-preservation.json` confirms the root's original manual items.
- `final-sql-provenance.json`: all8 installed final bodies exactly match the two CLI-generated migrations; postgres owner, SECURITY DEFINER, empty search_path, private anon/authenticated execute false; no manual40001.

## Performance (1440×1200, local production webpack)

| Data | Original drag frame p95 | Final drag frame p95 | Final whole gesture p95 | Final four-view projection p95 | Final pure drag p95 |
|---|---:|---:|---:|---:|---:|
| 200 items/600 slots |33.4ms|17.5ms|17.6ms|1.55ms|0.080ms|
| 500 items/2000 slots |150ms|33.6ms|33.7ms|8.29ms|0.216ms|

The cap **does not meet the32ms target**. The remaining1.6–1.7ms excess is retained as an observation, not relabeled a pass. Pointerdown→second frame55.5/84.9ms and Escape/up→second frame73.5/122.2ms are separate costs, included in whole-gesture sampling. Every measured gesture asserts an actual rendered preview. Full data and collision scope remain intact. Offscreen reveal keeps document heights35473/93133 unchanged; its next drag and cancel work.

`performance-comparison.json` preserves the original dev/release samples, pre-guard samples and final results. With200 normalized classes,13weeks and7800 actual dated sessions (100 closed/100 preparing), original reader18.56s and22.29s → final140–153ms, byte-for-byte JSONB equality true, payload2,594,645B. Revision104–109ms/165B. Three real operating writes11.82/11.35/11.41s →479/367/367ms,694B responses. No historical window truncation.

`task8-offscreen-export.png` is the actual last cap panel PNG3369×3369,710202B:100 DOM slots, midnight row, forced full rendering, no preview and no mutation/provider calls. Visual inspection confirms the complete time axis. `task8-pointer-results.json`/mobile PNG cover actual RPC and native390px touch scrolling.

## Reproduce

Use the installed Node runtime and Docker socket only. Commands are run from this worktree:

```sh
node scripts/verify-timetable-concurrency.mjs --local --container tips_timetable_20260923 --output docs/qa/timetable-presets-20260923/concurrency-results.json
node scripts/qa/verify-timetable-final-sql.mjs --local
node scripts/qa/timetable-reference-performance.mjs --local
TIMETABLE_TASK8_LOCAL=1 node --test --experimental-strip-types tests/timetable-release-contract.test.mjs tests/makeup-create-attempt.test.mjs tests/notification-makeup-adapter.test.mjs
TIMETABLE_BUILD_MODE='Next production webpack' node --experimental-strip-types scripts/qa/timetable-performance-browser.mjs
TIMETABLE_QA_PREFIX=task8- node scripts/qa/timetable-plan-pointer-browser.mjs
node scripts/qa/timetable-render-export-browser.mjs
```

Exact SQL test files are executed through `docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 < FILE`; every TAP plan/ok/error is parsed. No TCP URL is opened for Supabase CLI testing.

## Limits

The historical notification adapter/single-writer suites are **not passed** in this baseline/prerequisite fixture. `notification-suite-limits.json` records the unchanged origin producer, missing registry/contracts join, obsolete baseline trigger, and original direct private-table42501. Rollback-only comparison of the origin trigger/ACL boundary fixes only the obsolete-trigger assertions, not the missing metadata. This is not claimed as proof that the complete old suites pass at branch origin. Focused final SQLSTATE/public approval/cancellation and HTTP recovery tests are separate and passed.

Release browser evidence uses a synthetic read fixture for performance/export and actual isolated DB RPC for pointer saves. It does not prove production latency, actual provider behavior, live Realtime or Task9's two-actor app/import/full-regression gates.

Final focused ESLint and TypeScript (`tsc --noEmit --incremental false`) passed. Export proves complete axis/rows/forced rendering, with partially clipped second title lines in some two-lane 30-minute blocks; full title readability remains a final UI review observation.
