# Registration numbered-page key selection — 2026-09-28

## Change

The final numbered-key function expanded the full security-invoker registration summary three times: representative selection, sibling-subject search, and the archived-only parent fallback. It used none of the level-test or observation output at this stage.

The migration narrows those relations to the actual key/search/order columns. Latest scheduled visit and latest waiting phone consultation retain their original predicates, tie-breaks and LIMIT. Every relation retains `archived_at is null`; normal table RLS still applies. The full row projector and its observation visibility checks are unchanged.

The ordered chain ends at `20260901110600_registration_subject_soft_archive.sql` for the summary and the additional empty-subject fallback. The migration guards the exact existing key-function definition MD5 `3a4bbc27fa126eae7bb5b5ee88b3b7b4` and keeps signature, volatility, invoker security, timezone, plan configuration, owner and grants through `pg_get_functiondef`. It does not alter authentication, mutation, locking, idempotency, or delivery paths.

## Measurement and verification

500 added synthetic parents / 1,000 added tracks, plus the existing fixture corpus, in an isolated local PostgreSQL container with no network or published ports. Both variants alternate in the same transaction; two warmups and 25 recorded samples per filter. The before wrapper substitutes only the original key helper. Entire JSON responses (including count, order and all row fields) matched in 135 actor/filter/page combinations: three actors, all nine views, subject and phone searches, first/second/off-end pages.

| Filter | Before median | After median | Shared hits before → after |
| --- | ---: | ---: | ---: |
| Inquiry, empty search | 42.759 ms | 35.496 ms | 21,138 → 12,423 |
| Inquiry, text search | 44.356 ms | 36.708 ms | 21,251 → 12,799 |
| Consultation owner | 17.209 ms | 16.580 ms | 6,694 → 6,241 |
| Completed, requested tasks | 20.446 ms | 19.044 ms | 8,501 → 7,274 |

Inquiry median falls 17.0% and shared hits 41.2%. These are synthetic SQL results, not production API p95 claims.

605 numbered-page/statistics pgTAP checks pass against the final local definitions. Added checks cover normalized visit search/full DTO, archived-only inquiry parents, archive exclusion outside inquiry, and comparison with the unchanged cursor implementation. Existing checks retain exact invalid-input SQLSTATE 22023, anonymous denial, teacher isolation, ordering, all other operation types and zero deliveries/messages.

Run after applying the ordered migrations to the isolated DB:

```sh
node scripts/qa/registration-numbered-keys-benchmark.mjs --local --container tips_timetable_perf_final_20260927
docker exec -i tips_timetable_perf_final_20260927 psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/ops_task_numbered_pages_test.sql
```

## Separate shared API delay

At 02:10 UTC, each of five browser RPCs added exactly one PostgreSQL call. The constant `registration_subject_tracks_runtime_version` executed in 8.931 ms, but its upstream service time was 2,013 ms and browser response headers took 2,915.822 ms. Page SQL execution was 995.988 ms, upstream 2,934 ms and browser headers 3,852.699 ms. Planning tracking is disabled, so the remainder cannot be attributed solely to gateway or pool waiting.

A subsequent reload showed 213 ms upstream for the constant marker and 441 ms for the page. The latency is intermittent. A point-in-time DB sample had 11 idle PostgREST connections and a 60-connection limit; no active blocker was observed. Supabase UI reports healthy free Nano/shared compute in Seoul. The visible high-CPU alert was dated August 19, not this measurement window. These observations do not establish CPU exhaustion or justify a paid upgrade/configuration change.

`api-db-correlation.json` retains sanitized DB timing evidence. Production pre/post response hashes, deployment status and browser checks belong in the release receipt, after the release succeeds.

If the shared summary later changes archive, visit or phone semantics, update the narrow key relation alongside it and rerun parity tests.
