# 알림 adapter runtime forward-install 설계

**작성일:** 2026-08-12

**상태:** 서면 검토 요청 전 초안

**대상:** registration-observation Google Chat Task 6 Phase 6A의 로컬 provider-zero lifecycle 검증을 막는 adapter runtime capability

## 1. 결정과 목표

현재 active migration chain에는 `dashboard_private.notification_runtime_dependency_ready_v1('adapters')`가 요구하는
`public.notification_workflow_adapters_runtime_version() = 1`이 없다. 따라서 실제 service-role flag setter는
`notification_control_plane_dispatch_registration_enabled`를 켜려 할 때 `notification_runtime_not_ready`로 거절한다.
이것은 Task 6이 요구하는 **실제 setter·heartbeat·v2 save·delivery lifecycle**의 provider-zero 검증을 시작하지 못하게 하는
active-schema 계약 결손이다.

이 작업의 목표는 새 정식 forward migration으로 현재 active schema에 필요한 adapter runtime capability만 설치하는 것이다.
설치 직후에도 모든 runtime flag와 rule은 OFF이며, cron·worker·provider·Directory·SOLAPI는 실행하거나 호출하지 않는다.

이 문서는 install과 activation을 분리한다. 이 문서가 승인되어도 runtime flag를 켜거나 운영 DB에 migration을 적용하는 권한은 생기지 않는다.

## 2. 확인된 사실

1. active `set_notification_runtime_flag_v1_impl`은 UI 외 dispatch flag 활성화 전에 `common`, `adapters`, 최근 성공 heartbeat를 요구한다.
   registration dispatch에는 `registration_appointment_reminders_runtime_version() = 1`도 요구한다.
2. `common`과 `registration` marker는 active migration chain에 있으나 adapters marker는 없다.
3. `dashboard_private.notification_cutover_owners`와
   `dashboard_private.notification_dispatch_scope_for_event_v1(text,text)`은 active science notification 함수가 참조하지만,
   현재 active chain에는 없다. 이 참조는 PL/pgSQL body 생성 시에는 남아 있다가 실제 lifecycle에서 실패할 수 있다.
4. marker와 과거 cutover 객체의 원본은
   `supabase/pending-migrations/notification-cutover/`에 reference-only quarantine으로 보관되어 있다.
   그 README는 해당 파일을 실행·복사·이동하지 말고, install/activation을 분리한 새 forward migration을 설계하라고 명시한다.
5. Task 6의 provisional independent harness는 migration/pgTAP/runtime-0 readiness까지 local-only로 통과했으며,
   실제 dispatch setter에서만 위 marker 결손으로 멈췄다. 이는 provider send, external attempt, Directory call 이전의 실패다.

## 3. 범위

### 3.1 포함

- pinned Supabase CLI가 생성하는 새 timestamp migration 하나를 active lane에 추가한다.
- 현재 active 함수가 실제로 호출하는 최소 adapter capability ABI를 새로 구현한다.
- active code의 dispatch scope를 위한 private ownership mapping과 exact resolver를 설치한다.
- 새 adapters runtime marker와 그 전제 검사를 설치한다.
- active migration과 필요한 pgTAP/Node contract tests를 local-only로 추가한다.
- Task 6의 independent provider-zero harness를 재개해 실제 production setter/lifecycle을 provider-zero 경계까지 검증한다.

### 3.2 제외

- `supabase/pending-migrations/notification-cutover/`의 파일, manifest, SHA, 테스트를 수정·복사·이동·실행하지 않는다.
- 기존 migration을 수정하거나 migration history를 repair하지 않는다.
- 운영 Supabase `db push`, remote SQL, runtime flag/rule 변경, cron schedule, worker start, webhook/Directory/SOLAPI request를 실행하지 않는다.
- Vercel 배포, Git push, production activation, backfill, 실제 수신 검증은 별도 승인 단계다.
- 기능 flag의 기본값이나 승인된 rule content를 변경하지 않는다.

## 4. 채택한 아키텍처

### 4.1 새로운 active forward package

새 migration은 quarantine SQL을 이식하지 않는다. 현재 active function signature와 실제 execution path를 기준으로 아래의
**최소 compatibility package**를 새로 작성한다.

| 객체 | 책임 | 설치 후 상태 |
| --- | --- | --- |
| `dashboard_private.notification_cutover_owners` | 현재 dispatch scope별 flag 소유권을 한 행으로 고정 | 10개 scope 모두 `owner_kind='legacy'` |
| `dashboard_private.notification_dispatch_scope_for_event_v1(text,text)` | workflow/event를 하나의 current dispatch scope로 결정 | 알 수 없는 조합은 `NULL` |
| 필요한 current-path private helper/trigger ABI | active generic event/delivery lifecycle이 실제로 참조하는 missing symbol만 공급 | canonical dispatch를 만들거나 외부 작업을 시작하지 않음 |
| `public.notification_workflow_adapters_runtime_version()` | current adapter ABI가 완전하게 설치되었다는 capability marker | `1` 반환, activation 의미 없음 |

`notification_cutover_owners`의 identity는 다음 행으로 정확히 고정한다. 이 row set과 flag key는 현재 setter의 allowlist와
일치해야 하며, 중복·누락·기존 다른 값은 migration 전 preflight에서 실패한다.

| scope | workflow | dispatch flag | initial owner |
| --- | --- | --- | --- |
| `tasks` | `tasks` | `notification_control_plane_dispatch_tasks_enabled` | `legacy` |
| `word_retests` | `word_retests` | `notification_control_plane_dispatch_word_retests_enabled` | `legacy` |
| `approvals` | `approvals` | `notification_control_plane_dispatch_approvals_enabled` | `legacy` |
| `transfer` | `transfer` | `notification_control_plane_dispatch_transfer_enabled` | `legacy` |
| `withdrawal` | `withdrawal` | `notification_control_plane_dispatch_withdrawal_enabled` | `legacy` |
| `makeup_requests` | `makeup_requests` | `notification_control_plane_dispatch_makeup_requests_enabled` | `legacy` |
| `registration` | `registration` | `notification_control_plane_dispatch_registration_enabled` | `legacy` |
| `registration_phone` | `registration` | `notification_control_plane_registration_phone_adapter_enabled` | `legacy` |
| `registration_visit` | `registration` | `notification_control_plane_registration_visit_adapter_enabled` | `legacy` |
| `registration_solapi` | `registration` | `notification_control_plane_registration_solapi_adapter_enabled` | `legacy` |

resolver는 현재 flag partition만 따른다.

- `registration.phone_consultation_ready` → `registration_phone`
- `registration.visit_*` → `registration_visit`
- `registration.admission_message_*` → `registration_solapi`
- all other known `registration` events → `registration`
- other known workflow keys → same-named scope
- every unknown or malformed input → `NULL`, never a default scope

install migration은 어떤 owner도 `canonical`로 바꾸지 않는다. 이후 별도 승인된 activation만 기존 control-plane/ownership
contract를 통해 그런 ownership 변경을 수행할 수 있다.

### 4.2 Marker is a capability proof, not an activation switch

`public.notification_workflow_adapters_runtime_version()` is created last in the migration, is owned by `postgres`, has an empty
`search_path`, revokes `PUBLIC` and `anon`, and grants `EXECUTE` only to `authenticated` and `service_role` to match the sibling markers.

The marker can return `1` only after migration-time preflight verifies all of the following in the same transaction:

1. required active control-plane tables, request ledger, runtime flag rows, heartbeat contract, generic event/delivery functions, and
   registration marker are present;
2. the 10 ownership mappings do not already conflict with another scope/workflow/flag identity;
3. 이 package가 unlock할 수 있는 dispatch/adapter flag가 모두 disabled이며, settings UI와 shadow flag의 기존 값은 읽기만 하고
   변경하지 않는다;
4. no existing runtime marker or private helper with the same signature has a conflicting owner, ACL, or incompatible definition;
5. the newly installed resolver recognizes exactly the allowed scope mapping and returns `NULL` for invalid pairs.

The preflight does **not** require the quarantined legacy closure marker or its scheduler/vault tables. Those were artifacts of the historic
cutover lane, not evidence that the current active runtime is safe to activate.

If the active execution inventory reveals any additional missing symbol needed by the Task 6 real lifecycle, the migration must add that
symbol with a narrowly defined ABI and a direct behavior test before creating the marker. It must not satisfy the marker by stubbing an
unreachable function or by changing the dependency predicate.

### 4.3 Security and data rules

- All private functions are `SECURITY DEFINER`, `SET search_path = ''`, owned by `postgres`, and have `PUBLIC`, `anon`,
  `authenticated`, and `service_role` direct grants revoked unless a public wrapper specifically needs execution.
- `notification_cutover_owners` uses RLS and has no direct table privileges for API roles.
- All DDL/DML runs in one migration transaction. A conflict rolls back both rows and marker.
- 새 `notification_cutover_owners` 10행 외에는 notification event/delivery를 insert하거나 기존 event, rule, template,
  connection, draft, user, heartbeat, runtime flag, provider configuration row를 변경하지 않는다.
- `notification_workflow_adapters_runtime_version() = 1` only says that the passive adapter ABI exists. It does not authorize
  dispatch, provide a sender, or make a network request.

## 5. Required test strategy

### 5.1 RED-first source and schema contracts

Before production SQL is written, tests must fail because the active marker/package is absent. The first RED must show the real
`notification_runtime_not_ready` boundary from the production setter, not a synthetic flag update.

The static contract tests must prove:

- the migration is a newly generated active timestamp migration, with no edit to the quarantine lane;
- it creates only the declared forward package and no `cron.schedule`, `pg_net`, Vault, HTTP, webhook, provider, or worker-start call;
- the marker is created after the capability preflight and uses the exact owner/ACL/search-path contract;
- the 10 owner rows and resolver mapping are exact, including unknown-input rejection;
- migration body에는 runtime flag `UPDATE`나 `enabled=true` write가 없다.

### 5.2 Isolated PostgreSQL behavior

An owned local Supabase project applies the real active migration history and uses the existing verified prerequisite/history fixture
verbatim under Task 6 ownership. It then proves the following with actual RPCs and SQL boundaries:

1. before the forward migration, the production registration-dispatch setter reaches `notification_runtime_not_ready`;
2. after the migration, the marker returns `1` and the two private compatibility objects are present with their exact ACL/RLS/owner shape;
3. all flags and all Task 6 Google Chat rules remain OFF before any receipt;
4. the real receipt order succeeds only as
   `readiness → activate → heartbeat.started → heartbeat.succeeded → settings-ui flag → registration-dispatch flag`;
5. setting a flag directly is denied, flags use expected revision/idempotency, and replay returns the same receipt;
6. a missing prerequisite, conflicting owner mapping, malformed resolver input, stale flag revision, missing heartbeat, or wrong actor
   fails closed without a delivery, provider audit, customer queue, or SOLAPI row;
7. the existing Task 6 v2 save and lifecycle proof can run only after the above receipt and reaches Google Chat `sending` and in-app `sent`
   boundaries without external attempt registration.

The test database is disposable. Test-only temporary flag enables are allowed only through the production service-role setter and only after
the explicit readiness/heartbeat receipts. Final cleanup destroys the exact project resources and proves runtime/provider counters are zero.

### 5.3 Provider-zero integration continuation

The existing separate Task 6 harness remains independent of the frozen common runner except for the approved verbatim fixture copies and
their SHA-256 source-integrity tests. It must execute the full ordered lifecycle in the Task 6 brief after the forward migration is
installed.

Transport traps are installed before runtime imports and remain active through cleanup:

- `fetch`, `node:http.request/get`, and `node:https.request/get` reject every non-owned-loopback target;
- injected Google Chat provider and Directory clients throw if called;
- recorded `fetch/http/https/directory/provider/externalAttempt` counts stay zero;
- no remote Supabase, provider credential, webhook, customer, or SOLAPI state enters the fixture or evidence.

## 6. Rollout and approval gates

| Gate | Allowed action | Required evidence | Not allowed |
| --- | --- | --- | --- |
| A — local install | disposable active migration + tests | exact source, pgTAP, Node, cleanup, provider-zero counters | remote DB, deploy, activation |
| B — review | code review and source/ACL/diff review | no open Critical/Important issue | runtime flag/rule changes |
| C — production migration | separately approved forward apply | remote migration history and passive post-state | dispatch, cron, provider send |
| D — runtime activation | separately approved one-scope receipt | flag revision, heartbeat, real adapter readiness | unrelated scope activation |
| E — recipient evidence | separately approved controlled delivery | provider response and intended recipient receipt | bulk or unreviewed sends |

This task ends at Gate A/B only. A merged local migration is not production migration evidence; a production passive install is not an
activation or message-receipt claim.

## 7. Failure handling

- Any schema/ACL/owner mismatch stops before marker creation.
- Any existing conflicting owner row stops the migration without rewriting it.
- Any non-OFF runtime flag discovered in an install fixture stops that fixture rather than silently disabling it.
- Any unknown dispatch mapping returns `NULL` and makes the caller reject the operation; it never falls back to a broad registration scope.
- Any network/provider/Directory attempt fails the local provider-zero run and is reported separately from database cleanup.
- A local container, volume, network, or temporary-root cleanup failure fails the verification gate.

## 8. Completion evidence

The implementation is ready for the next approval only when all of the following are present:

1. one frozen forward migration generated by the pinned CLI, with an exact scope diff;
2. source and pgTAP RED→GREEN evidence for marker absence, preflight conflict, owner/resolver/ACL shape, and real setter order;
3. a disposable Task 6 run that completes the committed readiness/activation/heartbeat/flag/v2-save/lifecycle receipt without network or
   provider attempt;
4. `runtimeVersion=0` before core activation, all flags/rules OFF before the test receipt, and cleanup/provider counters exactly zero at
   final teardown;
5. independent code review with no unresolved Critical or Important finding;
6. a report that separately names local code/tests, migration application, deployment, runtime activation, provider request, and recipient
   receipt boundaries.

## 9. Alternatives rejected

### 9.1 Copy the pending cutover migration

Rejected. The quarantine lane is explicitly non-executable and includes obsolete scheduler, vault, ownership, and legacy closure
assumptions. Copying it would make source origin rather than current active behavior the authority and could activate unrelated machinery.

### 9.2 Add only a `select 1` marker

Rejected. That would bypass the production dependency setter while leaving active lifecycle bodies with missing private symbols. The
marker must be the final proof of a tested current ABI, not a test-only escape hatch.

### 9.3 Flip runtime flags directly in the local harness

Rejected. Task 6 specifically proves the production service-role setter's dependency and receipt behavior. Direct table DML would hide
the same blocker and weaken the provider-zero evidence.

### 9.4 Activate as part of installation

Rejected. Installation makes passive capability available; activation changes delivery ownership and requires independent operational
approval, a fresh heartbeat, a precise scope, and provider/recipient evidence.
