# Existing dispatch actor guard: impact and bounded repair

Draft PR126 only. No production SQL, actor impersonation, provider request, role grant, Chat API/configuration/connection/key change, or shared Chrome use. The additional delegated instruction authorizes this conservative code and synthetic-test candidate; production application remains separate.

## Actual impact and boundaries

The final `public.get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)` used `IF NOT (source actor OR requester OR assignee OR secondary assignee OR admin/staff)`. An unrelated actor with a NULL optional assignee makes the predicate NULL, so PL/pgSQL skips the denial. The same defect exists on main `6a6d7abe4f45e366beccc14efbbcce0534f0370f`.

In a fresh isolated main database, real public request RPCs and final notification functions produced a nonempty management plan for an unrelated synthetic teacher for both `transfer.submitted` and `withdrawal.submitted`. The plan contained canonical event/template/rule metadata, rendered title/body, target connection identity, task link and schedule. It did not contain a webhook credential, and the stable function itself did not write a claim/delivery or send anything. Missing-profile actor IDs also passed this old guard in these nullable cases. The regression suite recorded six expected-denial failures on main, and the original adapter remained 46/47; these failures are retained, not counted as gate success.

Call restrictions are narrower than the earlier report's shorthand:

- Public wrapper `get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)`: EXECUTE only for `postgres` and `service_role`; `anon`/`authenticated` direct calls fail with `42501`.
- Internal helper `get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)`: EXECUTE only for `postgres`. Even `service_role` cannot call it directly; the postgres-owned SECURITY DEFINER wrapper delegates to it.
- In the unrelated-teacher fixture, RLS exposes none of those event IDs. This limits discovery but does not filter the service-role/SECURITY DEFINER plan call when an ID is already known.
- The public POST `/api/notifications/legacy/ops-task` verifies the JWT through `getUser`, fixes actor identity to that user, and accepts only a `sourceEventId` envelope. Its registration-specific preflight returns `false` for transfer/withdrawal and the route continues to the service wrapper. Thus a logged-in unrelated user with a known event ID has a code path to the defective check without holding the service credential. The route returns counts and event IDs, not the rendered plan body.

The actual route, with the captured nonempty synthetic main plan and mocked auth/RPC transport, reached the intent and ownership calls. We deliberately stopped at a mocked ownership refusal: provider and fetch counts were zero. This demonstrates route reachability, not a successful real delivery. Existing rule snapshots, current rules, dispatch ownership/generation, deduplication, external-attempt fences and webhook connection state further condition real sending. No operational event lookup, unauthorized production reproduction or sending was performed. The new route test proves a `42501` plan denial returns HTTP 403 before intent, ownership, webhook lookup, external-attempt registration or provider execution.

## Exact bounded change

Migration `supabase/migrations/20261009082000_ops_legacy_dispatch_actor_null_guard.sql` changes only the guard in the final internal helper:

```sql
if not coalesce((
  v_source.actor_id = p_actor_profile_id
  or v_task.requested_by = p_actor_profile_id
  or v_task.assignee_id = p_actor_profile_id
  or v_task.secondary_assignee_id = p_actor_profile_id
  or v_actor_role in ('admin', 'staff')
), false) then
  raise exception 'ops_task_legacy_dispatch_forbidden' using errcode = '42501';
end if;
```

No allowed relation/role is added or removed: TRUE still permits; FALSE still rejects; NULL now rejects. Existing NULL input validation remains `22023`. We did not add a new active-profile policy or modify the separate subject-completion/retirement guards.

Migration SHA256: `191aaeb47a383122b52d85b6c0c21bb8ffe235c9bc9c456d3518dd4cb3ae05b3`.

The transaction requires exact original function md5 `0960819fac3c984d0ae471e02eafb03a` and one matching guard anchor. Final md5 is `c1ba1c861d5dcd60f986d9d23f961f9f`. A drift aborts with `55000`; do not force replacement. Lock/statement timeouts are 5/30 seconds. Across 1,108 functions, only the two earlier transfer definitions plus this helper differ from main. Owner, ACL, search_path, SECURITY DEFINER and volatility are unchanged; the public wrapper is byte-identical. Isolated guard rollback/reapply restored the exact candidate catalog.

## Validation

| Check | Main / before guard | Candidate |
|---|---|---|
| Existing adapter, same unchanged input | 46/47 (gate failure) | **47/47** |
| Independent guard matrix | 32/38 (six NULL denials failed) | **38/38** |
| Transfer completion regression, fresh DB | prior 220/220 run retained | **194/194** |
| Subject completion | existing baseline | **39/39** |
| Withdrawal request snapshot | existing baseline | **83/83** |
| Real route and adjacent Node suites | — | **52/52** |
| Captured-plan route diagnostic, mocked transport | reaches mocked ownership | 403 before intent; **2/2** |
| Default `db lint --fail-on error` | — | exit 0 |
| Squawk PG17 / migration layout / domain SQLSTATE / changed-test ESLint | — | pass |

Guard matrix covers each existing positive relationship independently (event actor, requester, primary assignee, secondary assignee), admin/staff, NULL/one-NULL/non-NULL assignees, unrelated teacher, missing profile and NULL actor, direct caller ACLs, authenticated RLS and registration preflight, and zero delivery/HTTP queue/cron records. The adapter was neither skipped nor weakened. The transfer test source is unchanged: the fresh database has 26 fewer pre-existing synthetic detail rows, so its per-row unchanged-detail check runs 26 fewer times; every named scenario and other assertion is identical. Prior UI 6/6 and concurrency 7/7 evidence remains for the unchanged transfer/UI definitions; this guard adds no UI or mutation/concurrency logic.

[Machine-readable results and hashes](actor-guard-validation.json), [main matrix failures](guard-main-guard-matrix.tap), [candidate matrix](guard-candidate-guard-matrix.tap), [closed adapter regression](guard-candidate-adapter.tap), [route diagnostic](guard-route-impact.log).

## Review and operational scope

Independent preliminary review agrees this guard belongs in PR126 as a **separate commit**: it closes the existing adapter's security assertion without weakening tests or expanding rights, and keeps the newly discovered issue independently reviewable. Exact-head final review is required before handoff.

The parent must separately coordinate this migration's production scope alongside the earlier transfer migration. No need to change browser code, server route, ACL, role, RLS policy, notification rule, Chat setting/key or provider connection. Hosted CI remains blocked by account billing; the parent's promised local-check/independent-review substitution authority has not yet been supplied, so repository merge requirements remain unresolved. Production SQL, merge, deployment and independent production UI verification remain pending.

Prefer retaining this fail-closed guard when reverting the separate transfer behavior. [Guard rollback reference](actor-guard-rollback-reference.sql), SHA256 `20e46a9efa9e49431ad5d948dc87181d7c701bb7f6d8a9550a25aa3c2c3a9088`, restores the old flaw and is **not a routine rollback recommendation**. It requires exact current md5, explicit security/release approval and pausing the affected dispatch route first. The earlier transfer rollback affects only its own two functions. Neither function rollback undoes completed roster/history/claim/notification changes.
