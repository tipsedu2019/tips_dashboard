# Registration statistics and static-resource follow-through

## Confirmed problem and change

The registration count query expanded the full subject-track summary view even though it uses only membership, subject, director and the latest active visit place. That view also contains observation, phone and level-test lateral joins and their RLS plans. The new migration narrows the relation to the fields actually consumed. It preserves the final active SQL aggregation, search normalization, owner/status/view filters, parent deduplication, `archived_at is null`, visit ordering/limit, invoker security and existing ACL.

The migration checks the exact prior function source before replacing the relation. The application RPC/DTO and full row summary view are unchanged. No business-state mutation or notification dispatch is introduced.

## Measurement and validation

`registration-stats-benchmark.mjs --local --container tips_timetable_perf_final_20260927` uses a network-isolated synthetic database, 500 added cases/1,000 tracks, unchanged baseline SQL, alternating variants, 2 warm-ups and 25 samples per filter. Everything is rolled back. It checks result parity for staff, linked teacher and unlinked teacher and bounds shared-buffer reads.

| Filter | Before median | After median | Before/after max shared hits |
|---|---:|---:|---:|
| Empty search / inquiry | 18.114ms | 12.648ms | 14,452 / 7,268 |
| Search | 20.788ms | 16.344ms | 9,426 / 7,268 |
| Consultation owner | 18.099ms | 12.625ms | 14,452 / 7,268 |
| Status / completed | 17.960ms | 12.588ms | 14,452 / 7,268 |

The final fixture run reduced the empty-search median by 30.2% and shared-buffer hits by 49.7%. These are synthetic database timings, not field p95 or overall page speed.

Focused local pgTAP: numbered pages 596/596, cursor page reads 22/22. New assertions cover all nine views, sibling counts, archived tracks, normalized visit/phone searches, statuses, consultation ownership/metrics, teacher RLS, anonymous rejection and exact invalid-filter SQLSTATE 22023. Existing assertions confirm no notification deliveries or registration messages.

## Investigation limits

After PR #74, the production log window 2026-09-27 16:28:41 through 2026-09-28 00:49:39 UTC had 28 numbered-page POSTs (p95 1,960ms, max 2,147ms) and 11 stats POSTs (p95 1,951ms), all successful. No PostgreSQL ERROR/FATAL/PANIC or statement timeout was found in that window. The small sample includes QA and is not a representative long-term latency cohort. Historical cumulative database errors/statistics are not new failures.

A one-shot stats EXPLAIN initially took 316.5ms, while a second invocation on one connection took 10.861ms. A custom-plan wrapper regressed the synthetic workload and was rejected. That one-shot comparison must not be advertised as the speedup. The retained change removes unnecessary relational work, with repeated comparison above.

Root manifest, push worker and icons were also confirmed 404 on tipsedu.co.kr while available on the dashboard origin. Public repository PR #15 restores only their exact proxy paths, preserving root manifest/service-worker scope and public landing routing. Deployment verification is recorded separately in release-verification.md.
