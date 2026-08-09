# Registration Observation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 청강 도메인의 스키마·권한·동시성 기반과 예약 생성/변경/취소/철회, 관리자용 bounded read, 등록 목록·상세 예약 UI를 provider와 교사 피드백 구현에 의존하지 않는 하나의 안전한 core로 제공한다.

**Architecture:** `ops_registration_appointments`는 예약 시각·장소·고객 알림 revision의 권위이고, `ops_registration_observations`는 시도별 회차 snapshot·lifecycle revision의 권위다. 공개 함수는 SECURITY INVOKER wrapper, 실제 로직은 고정 `search_path`를 가진 `dashboard_private` SECURITY DEFINER 함수로 분리한다. 모든 mutation은 동일한 receipt·lock 순서와 runtime guard를 사용하고, 외부 provider 호출 대신 닫힌 종류의 domain event만 같은 transaction에서 적재한다. 첫 화면은 고정 크기 summary view, 상세는 bounded RPC, 반별 회차는 canonical resolver RPC로 지연 조회한다.

**Tech Stack:** PostgreSQL 15 / Supabase migrations·pgTAP·RLS, PostgREST RPC, TypeScript, React 19, Next.js App Router, Node test runner, pnpm.

## Global Constraints

- 승인 권위는 `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`다. 이 계획은 core 범위만 구현하며 설계의 lifecycle·revision·privacy 규칙을 축소하지 않는다.
- 이 계획에서 외부 Google Chat/SOLAPI 호출, due-job materialization/worker, 교사 feedback route, attendance/feedback/decision mutation, enrollment source link를 구현하지 않는다. 아래의 frozen interface만 downstream에 제공한다.
- 어떤 downstream migration도 `enter_registration_observation_v1`, `list_registration_observation_sessions_v1`, `save_registration_observation_booking_v1`, `cancel_registration_observation_v1`, `withdraw_registration_observation_v1` 또는 그 private impl을 `CREATE OR REPLACE`하지 않는다. core mutation은 provider 대신 `dashboard_private.registration_observation_domain_events`만 transaction 안에서 INSERT한다.
- 도메인 변경 audit은 기존 exact helper `dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)`로 `ops_task_events`에 남긴다. 이 audit과 stable domain event를 제외한 provider/due/delivery row는 core transaction에서 만들지 않는다.
- runtime 설정의 초기값은 `0`이다. `public.registration_observation_schema_readiness_v1()`은 runtime 값과 무관하게 설치 상태를 보고하고, `public.registration_observation_runtime_version()`만 활성 값을 보고한다. 예약·lifecycle domain mutation private impl은 receipt replay를 제외한 새 쓰기 전에 runtime `1`을 강제하며, admin activation RPC만 이 guard의 예외다.
- 공개 RPC는 SECURITY INVOKER wrapper, private impl/helper는 SECURITY DEFINER와 `SET search_path = ''`를 사용한다. 모든 함수에 `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` 뒤 필요한 private impl과 public wrapper에만 `GRANT EXECUTE ... TO authenticated`를 명시한다. private table은 네 role 모두 ALL revoke한다.
- observation 직접 INSERT/UPDATE/DELETE grant나 write policy를 만들지 않는다. 직접 SELECT는 manager summary view를 위해 authenticated에만 grant하고, admin/staff 또는 해당 track director만 보이는 RLS policy를 적용한다. 교사 상세는 downstream 전용 RPC 외에는 열지 않는다.
- domain mutation lock/write 순서는 전부 `actor+request_key advisory lock → 기존 receipt 조회 → track FOR UPDATE → observation FOR UPDATE → appointment FOR UPDATE → domain event INSERT(해당 시) → audit INSERT → receipt INSERT`다. cancel처럼 observation ID만 받은 함수도 lock 전 read로 track ID를 찾고, track lock 뒤 observation을 다시 읽는다. 어떤 함수도 appointment를 observation보다 먼저 잠그지 않는다. activation만 `advisory → receipt → runtime singleton FOR UPDATE → readiness → receipt` 순서를 사용하고 receipt가 activation actor/time을 보존한다.
- receipt replay는 같은 actor·operation·request key와 같은 request fingerprint일 때 저장된 response를 그대로 반환한다. 다른 fingerprint는 `registration_observation_request_key_conflict`; runtime `0`에서도 이미 완료된 receipt replay만 허용한다.
- DB task는 해당 migration까지 빈 local DB에 clean apply한 뒤 focused pgTAP을 실행하기 전에는 GREEN으로 판정하지 않는다. Node source-contract test만으로 DB task를 통과시키지 않는다.
- 모든 read는 12초 AbortSignal과 `.retry(false)`, mutation은 `.retry(false)`와 caller-generated nonblank text request key를 사용한다. mutation을 자동 재시도하지 않는다.
- 예약 성공과 고객/내부 알림 성공은 서로 다른 상태다. core UI는 예약 저장만 성공 처리하고 알림 발송 성공을 암시하지 않는다.

### Frozen migration creation gate

각 migration 소유 task는 RED 작성보다 먼저 자기 block을 실행한다. pinned CLI version 또는 target 부재 검사가 실패하면 즉시 중단하고, target을 덮어쓰거나 새 timestamp를 채택하지 않는다. `migration new` 뒤 동일 slug 파일이 정확히 하나가 아니면 중단한다. 생성 파일은 아직 untracked이므로 반드시 exact generated path를 먼저 `git add -- "$..._generated"`해 index에 결속한 뒤에만 `git mv --`한다. `git mv` 직후와 SQL 작성 뒤 target을 다시 `git add --`한 다음, staged `ACMR` 경로가 exact frozen target 하나뿐이고 staged `D` source/orphan이 0개인지 검증한다. 이 staged orphan gate, `test -s`, `git diff --cached --check` 중 하나라도 실패하면 RED/GREEN/commit으로 진행하지 않는다.

Task 1:

```bash
test ! -e supabase/migrations/20260809100000_registration_observation_core_schema.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_core_schema
registration_observation_core_schema_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_core_schema\.sql$')"
test "$(printf '%s\n' "$registration_observation_core_schema_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_core_schema_generated"
git mv -- "$registration_observation_core_schema_generated" supabase/migrations/20260809100000_registration_observation_core_schema.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_core_schema\.sql$')" = "supabase/migrations/20260809100000_registration_observation_core_schema.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_core_schema\.sql$')" = "supabase/migrations/20260809100000_registration_observation_core_schema.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_core_schema\.sql$')"
```

Task 3:

```bash
test ! -e supabase/migrations/20260809101000_registration_observation_reads.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_reads
registration_observation_reads_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_reads\.sql$')"
test "$(printf '%s\n' "$registration_observation_reads_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_reads_generated"
git mv -- "$registration_observation_reads_generated" supabase/migrations/20260809101000_registration_observation_reads.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_reads\.sql$')" = "supabase/migrations/20260809101000_registration_observation_reads.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_reads\.sql$')" = "supabase/migrations/20260809101000_registration_observation_reads.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_reads\.sql$')"
```

Task 4:

```bash
test ! -e supabase/migrations/20260809102000_registration_observation_booking.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_booking
registration_observation_booking_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_booking\.sql$')"
test "$(printf '%s\n' "$registration_observation_booking_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_booking_generated"
git mv -- "$registration_observation_booking_generated" supabase/migrations/20260809102000_registration_observation_booking.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_booking\.sql$')" = "supabase/migrations/20260809102000_registration_observation_booking.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_booking\.sql$')" = "supabase/migrations/20260809102000_registration_observation_booking.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_booking\.sql$')"
```

worker는 CLI 생성·staged rename까지 마친 뒤 `apply_patch`로 SQL을 작성한다. 작성 뒤 exact target에 `git add --`, `test -s`, 위 staged `ACMR` exact-one/D-zero gate, `git diff --cached --check`를 다시 실행한다. 같은 `rg` equality까지 모두 PASS한 다음에만 해당 migration RED/GREEN 단계로 진행한다. `git status --short` 또는 staged diff에 frozen target 외 같은 slug generated/orphan path가 보이면 task는 GREEN이 아니다.

## Frozen downstream interfaces

### Domain-event seam

Core가 소유하는 닫힌 event 종류는 정확히 다음 여섯 개다.

```ts
export type RegistrationObservationDomainEventKind =
  | "observation_scheduled"
  | "observation_rescheduled"
  | "observation_canceled"
  | "observation_attendance_recorded"
  | "observation_no_show"
  | "observation_feedback_submitted"
```

`reminder_due`와 `feedback_due`는 domain event가 아니라 downstream due-job kind다. attendance/feedback 계획은 현재 appointment의 `notification_revision`, canonical `source_revision` JSON union, `booking_fact_hash`로 마지막 세 event를 INSERT한다. normalized source는 `{authority:'normalized',sessionId,revision}`, legacy source는 `{authority:'legacy',sessionKey,contentHash}`다. materializer는 다음 규칙을 소유한다.

- `observation_attendance_recorded`: 고객 reminder와 internal prepare due만 취소하고 feedback due는 유지한다.
- `observation_no_show`, `observation_feedback_submitted`: 남은 due를 모두 취소한다.
- claim 시점과 provider 호출 직전에 observation·appointment·session의 현재 상태/revision/hash를 다시 검증하고 불일치면 외부 호출 0회로 닫는다.
- Google Chat/SOLAPI migration은 domain-event seam을 consume/materialize할 뿐 core RPC를 재정의하지 않는다.
- source revision/hash 불일치만으로 `source_dirty`를 만들지 않는다. worker는 저장된 normalized `sessionId` 또는 legacy `sessionKey` 한 건을 exact resolver로 최대 한 번 다시 읽고 현재 `bookingFactHash`를 계산한다. hash가 저장값과 같으면 normalized revision 증가나 legacy selected-session content hash 변화는 content-only drift로 허용한다. 예약 직후 이벤트는 저장 snapshot을 유지하고, preparation due만 같은 선택 회차의 현재 교재·진도를 최대 20개/각 문자열 500자로 bounded refresh한다. appointment/observation/provider revision을 올리지 않는다. class·subject·authority/ID/key·state·date/time·teacher·room·campus 중 하나가 달라 현재 booking hash가 다를 때만 `source_dirty`, provider attempt 0으로 닫는다.

### Future mutation and enrollment signatures

Downstream 계획은 다음 public signature를 그대로 사용한다. 모두 `returns jsonb`이며 core table의 revision 의미를 바꾸지 않는다.

```sql
public.get_registration_observation_feedback_v1(
  p_observation_id uuid
)

public.record_registration_observation_attendance_v1(
  p_observation_id uuid,
  p_expected_observation_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
)

public.submit_registration_observation_feedback_v1(
  p_observation_id uuid,
  p_attendance text,
  p_suitability_result text,
  p_feedback_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
)

public.correct_registration_observation_feedback_v1(
  p_observation_id uuid,
  p_suitability_result text,
  p_feedback_reason text,
  p_correction_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_decision_kind text,
  p_request_key text
)

public.decide_registration_observation_v1(
  p_observation_id uuid,
  p_decision_kind text,
  p_waiting_class_id uuid,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_track_workflow_revision integer,
  p_request_key text
)
```

`correct`의 `p_expected_decision_kind`는 nullable이며 현재 decision과 null-safe equal이어야 한다. `decide`의 `waiting_current_class`만 observation과 과목이 같은 `p_waiting_class_id`를 요구하고 다른 decision은 class ID null을 요구한다. `decision_reason`과 중복 `track_id` 인자는 추가하지 않는다.

Feedback access migration은 `/admin/registration/observations/[observationId]/feedback`의 UUID path와 위 read RPC만 소유한다. read 권한은 assigned teacher, admin/staff, exact track director이고 unrelated actor에는 존재 여부를 숨긴 `registration_observation_not_found`를 반환한다. projection은 학생 이름/학년, subject/class, starts/ends, classroom, assigned teacher, attendance/status, current suitability/reason/revisions만 포함하며 전화번호·학교·문의·sibling track은 포함하지 않는다.

Enrollment 계획은 기존 exact public signature `public.save_registration_enrollment_rows(uuid, jsonb, text)`를 보존하고 row JSON에 optional `classStartSourceObservationId: uuid | null`만 추가한다. private `dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)`가 `completed + fit + same final class`와 exact session source를 검증할 때만 `ops_registration_enrollments.class_start_source_observation_id`를 저장한다. core는 enrollment table/function을 변경하지 않는다.

Historical enrollment option의 exact client shape는 다음 discriminated union의 observation branch다. downstream enrollment service는 manager detail의 bounded scalar `latestEnrollmentDecisionObservationId`로 dedicated feedback detail 한 건을 읽고, 같은 track의 `completed + attended + fit + decision_kind='enrollment' + same final class`일 때만 미래 session 목록과 합친다. 서버 저장 시 enrollment validator가 다시 검증한다. `re_observation → enrollment` 결정 허용 자체에는 suitability 조건을 적용하지 않는다.

```ts
export type RegistrationObservationHistoricalEnrollmentOption =
  | Readonly<{
      source: "observation"
      sourceObservationId: string
      trackId: string
      classId: string
      sessionAuthority: "normalized"
      sessionDate: string
      startsAt: string
      endsAt: string
      classStartSessionKey: string
      classStartLessonSessionId: string
      legacySessionKey: null
      sourceRevision: Readonly<{ authority: "normalized"; sessionId: string; revision: number }>
      label: string
    }>
  | Readonly<{
      source: "observation"
      sourceObservationId: string
      trackId: string
      classId: string
      sessionAuthority: "legacy"
      sessionDate: string
      startsAt: string
      endsAt: string
      classStartSessionKey: string
      classStartLessonSessionId: null
      legacySessionKey: string
      sourceRevision: Readonly<{ authority: "legacy"; sessionKey: string; contentHash: string }>
      label: string
    }>
```

### Local DB runner contract

`scripts/run-registration-observation-local-db-qa.mjs`는 dry-run이 기본이며 실제 실행은 두 gate를 모두 요구한다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus schema
```

`--focus`의 닫힌 값은 `schema | booking | feedback-access | feedback-submit | feedback | enrollment | google-chat | solapi-contract | solapi-queue | solapi`다. 각 focus는 고정 migration ceiling, pgTAP 파일, committed-fixture setup/cleanup/fresh-assert hook을 선택한다. hook은 runner가 만든 loopback DB와 exact synthetic fixture ID manifest만 받을 수 있고 provider credential이나 linked project ref를 입력으로 받지 않는다. 아직 committed fixture가 필요 없는 focus는 Task 1 registry에 setup/cleanup 각각 `begin; commit;`인 concrete no-op hook을 등록해 별도 connection에서 실행한다. 반대로 downstream 계획이 committed fixture를 요구한다고 선언한 focus는 그 계획의 concrete setup/cleanup/fresh hook이 추가되기 전까지 unavailable이다. 따라서 모든 available focus가 동일한 실행 순서와 오류 정리 계약을 갖고, generic no-op이 committed-fixture 요구를 우회하지 못한다.

| focus | migration ceiling | pgTAP file |
|---|---|---|
| schema | `20260809101000` | `supabase/tests/registration_observation_schema_test.sql` |
| booking | `20260809102000` | schema test + `supabase/tests/registration_observation_booking_test.sql` |
| feedback-access | `20260809102500` | `supabase/tests/registration_observation_feedback_access_test.sql` |
| feedback-submit | `20260809103000` | feedback access test + `supabase/tests/registration_observation_feedback_submit_test.sql` |
| feedback | `20260809103500` | feedback access test + feedback submit test + `supabase/tests/registration_observation_feedback_decisions_test.sql` |
| enrollment | `20260809104000` | `supabase/tests/registration_observation_enrollment_test.sql` |
| google-chat | `20260809105000` | `supabase/tests/registration_observation_google_chat_test.sql` |
| solapi-contract | `20260809106000` | `supabase/tests/registration_observation_solapi_contract_test.sql` |
| solapi-queue | `20260809106100` | contract test + `supabase/tests/registration_observation_solapi_queue_test.sql` |
| solapi | `20260809106200` | `supabase/tests/registration_observation_solapi_contract_test.sql` + `supabase/tests/registration_observation_solapi_queue_test.sql` + `supabase/tests/registration_observation_solapi_dispatch_test.sql` |

아직 존재하지 않는 downstream migration/test 또는 focus-owned fixture hook을 선택하면 `registration_observation_local_db_focus_unavailable:<focus>`로 종료한다. 단, `schema` focus는 core의 단계별 TDD를 위해 다음 exact two-phase 규칙을 갖는다. `20260809101000_registration_observation_reads.sql`이 아직 없으면 Task 1 phase로 판정해 required ceiling `20260809100000`까지 apply하고 schema pgTAP을 실행한다. 파일이 생긴 순간부터 Task 3 phase로 판정해 required ceiling `20260809101000`까지 apply하며 101000 apply 누락을 허용하지 않는다. 파일명의 존재 외 환경변수나 수동 phase flag로 이 분기를 바꾸지 않는다. runner Node test는 두 synthetic file manifests에서 각각 100000/101000 ceiling과 동일 schema pgTAP mapping을 assert한다. runner는 linked/remote/production flag, provider credential, 비-loopback DB URL을 거부하고 임시 Supabase project/고유 loopback ports만 사용하며 자신이 만든 Docker resource만 정리한다.

Downstream feedback 계획의 migration 이름은 `supabase/migrations/20260809102500_registration_observation_feedback_access.sql`, `supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql`, `supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql`로 고정한다. pgTAP은 `registration_observation_feedback_access_test.sql`, `registration_observation_feedback_submit_test.sql`, `registration_observation_feedback_decisions_test.sql` 세 파일로 분리한다. `feedback-access`는 access만, `feedback-submit`은 access + submit, `feedback`은 access + submit + decisions를 실행해 최종 HEAD에서도 낮은 ceiling focus가 독립 GREEN이어야 한다.

Runner의 DB command/state lifecycle은 모든 focus에서 정확히 `db start → db reset → focus committed-fixture setup COMMIT → pgTAP → focus cleanup COMMIT → fresh-connection runtime0/fixture-zero assertion → stop`이다. migration/config 복사는 `db start` 전에 끝내되 첫 DB 명령은 pinned CLI의 `db start`, reset은 start 성공 뒤에만 실행한다. setup은 focus registry가 만든 exact UUID manifest를 별도 superuser connection에서 commit하고, pgTAP에는 그 manifest만 전달한다. Single-session lifecycle assertion만 pgTAP outer transaction에서 runtime singleton을 `1`로 바꾸고 rollback할 수 있다. `dblink` concurrency는 uncommitted outer fixture를 절대 사용하지 않는다. runner가 만든 isolated DB에서 별도 superuser connection으로 unique fixture IDs와 runtime `1`을 commit한 뒤 worker connection을 열고, 종료 시 worker disconnect → runtime `0` restore → exact fixture IDs 역 FK 순서 delete → cleanup commit → fresh connection runtime `0` assertion 순서로 정리한다. enrollment activation concurrency는 committed runtime `0`에서 실제 admin RPC를 호출한 뒤 roadmap Gate B-R의 exact marked SQL body로 `1→0`을 rehearsal하고, exact fixture cleanup/fresh runtime0 assertion을 수행한다. production migration에는 test helper/bypass/deactivation RPC/direct-write grant를 만들지 않는다.

`db start`를 시도한 뒤에는 성공/실패와 무관하게 exact project-id `stop --no-backup --yes`를 `finally`에서 정확히 한 번 실행한다. reset 실패면 setup/pgTAP을 실행하지 않고 stop한다. setup을 시작한 뒤 실패하거나 pgTAP이 실패하면 pgTAP 재시도 없이 focus cleanup과 fresh assertion을 각각 한 번 시도한 다음 stop한다. cleanup이 실패해도 fresh assertion과 stop은 계속 실행하고 전체 결과는 실패다. 첫 업무 오류를 primary error로 유지하되 cleanup/fresh/stop 오류를 ordered cleanup errors로 함께 출력하며 하나라도 있으면 성공으로 바꾸지 않는다. stop 뒤 exact created-resource manifest 잔여가 있으면 `registration_observation_local_db_cleanup_incomplete`로 실패한다.

Downstream SOLAPI의 각 focus는 자기 ceiling까지 clean apply한다. `solapi-contract`는 contract만, `solapi-queue`는 contract → queue, `solapi`는 contract → queue → dispatch pgTAP 순서로 실행한다. 선택 focus에 필요한 migration 또는 test가 하나라도 없으면 focus unavailable로 닫는다.

## Current-code anchors

- existing isolated runner explicitly owns local DB `db start` and exact `stop --project-id --no-backup --yes` in `scripts/run-registration-customer-solapi-local-db-qa.mjs:186-211`; the observation runner preserves that boundary and inserts reset/focus hooks between them.
- appointment kind/status/revision의 현재 권위: `supabase/migrations/20260712172644_registration_subject_tracks_schema.sql:1267`.
- workflow status check: `supabase/migrations/20260801090000_registration_manual_workflow_status.sql:84`; current summary recreation: `supabase/migrations/20260808043659_registration_level_test_summary_consultation_chat.sql:6`.
- normalized session source: `supabase/migrations/20260728152442_continuous_class_schedule_foundation.sql:91`; active teacher profile helper: `supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql:140`.
- shell prop/order anchors: `src/features/tasks/registration-application-shell.tsx:11` and `:42`; application section order: `src/features/tasks/registration-application-model.ts:15`.
- summary projection/load anchors: `src/features/tasks/registration-track-service.ts:709` and `:1674`; generic status mutation/render anchors: `src/features/tasks/registration-track-editor.tsx:514` and `:833`.

## File responsibility map

| File | Responsibility | Owner task |
|---|---|---|
| `scripts/run-registration-observation-local-db-qa.mjs` | isolated clean apply, focus routing, destructive-scope guard | Task 1 |
| `tests/registration-observation-local-db-runner.test.mjs` | runner argv/focus/safety contract | Task 1 |
| `supabase/migrations/20260809100000_registration_observation_core_schema.sql` | statuses, columns, observation/receipt/event/runtime tables, checks/indexes/RLS/ACL/readiness | Task 1 |
| `supabase/tests/registration_observation_schema_test.sql` | schema, ACL, RLS, readiness, runtime-default pgTAP | Task 1–3 |
| `tests/registration-observation-schema.test.mjs` | migration source contract and exact signature guard | Task 1–4 |
| `src/features/management/classroom-master-workspace.tsx` | explicit 본관/별관 catalog editing and missing-campus visibility | Task 2 |
| `src/features/management/management-service.js` | strict classroom campus payload mapping | Task 2 |
| `tests/classroom-subject-membership.test.mjs` | campus payload/UI/backfill contract | Task 2 |
| `supabase/migrations/20260809101000_registration_observation_reads.sql` | manager auth helper, canonical resolver, bounded detail/exact single-attempt read RPCs, summary view | Task 3 |
| `tests/registration-observation-reads.test.mjs` | read signature/bounds/source/exact observation lookup contract | Task 3 |
| `supabase/migrations/20260809102000_registration_observation_booking.sql` | generic guard, entry/book/reschedule/cancel/withdraw mutations | Task 4 |
| `supabase/tests/registration_observation_booking_test.sql` | revision, receipt, lock-visible behavior, lifecycle pgTAP | Task 4 |
| `tests/registration-observation-booking.test.mjs` | mutation signature/event/lock-order source contract | Task 4 |
| `src/features/tasks/registration-observation-model.ts` | strict domain and RPC JSON types/normalizers | Task 5 |
| `src/features/tasks/registration-observation-runtime-probe.ts` | readiness + runtime probe and schema-cache miss handling | Task 5 |
| `src/features/tasks/registration-observation-service.ts` | bounded detail/session reads, exact single-attempt read, non-retrying mutations, request mapping | Task 5 |
| `src/features/tasks/registration-track-service.ts` | fixed summary projection and selected case integration | Task 5 |
| `src/features/tasks/registration-track-fixtures.ts` | browser fixture observation shape | Task 5 |
| `src/features/tasks/registration-track-fixture-runtime.ts` | fixture read/mutation parity | Task 5 |
| `tests/registration-observation-service.test.mjs` | normalizer/deadline/request mapping | Task 5 |
| `tests/registration-observation-runtime-probe.test.mjs` | readiness/runtime/cache-miss probe | Task 5 |
| `src/features/tasks/registration-observation-editor.tsx` | manager booking/change/cancel/withdraw surface | Task 6 |
| `src/features/tasks/registration-application-shell.tsx` | explicit observation slot/order | Task 6 |
| `src/features/tasks/registration-application-model.ts` | observation section state/order | Task 6 |
| `src/features/tasks/registration-application-subject-tabs.tsx` | active-track observation badge/state | Task 6 |
| `src/features/tasks/registration-application-progress-stepper.tsx` | observation stage presentation | Task 6 |
| `src/features/tasks/registration-application-track-actions.tsx` | dedicated entry/withdraw actions | Task 6 |
| `src/features/tasks/registration-workflow-status.js` | three statuses and observation view mapping | Task 6 |
| `src/features/tasks/registration-track-editor.tsx` | service orchestration and shell slot | Task 6 |
| `src/features/tasks/registration-case-list-model.ts` | list grouping and fixed scalar summary | Task 6 |
| `src/features/tasks/registration-case-list.tsx` | observation list tab/row | Task 6 |
| `src/features/tasks/ops-task-workspace.tsx` | runtime probe injection and refresh | Task 6 |
| `tests/registration-observation-workspace.test.mjs` | booking UI state machine/source contract | Task 6 |
| existing registration model/workspace/list tests | shell/order/status regressions | Task 6 |
| `package.json` | `verify:registration-observation:local-db` script only | Task 1 |

---

### Task 1: Isolated DB runner와 core schema/readiness를 설치한다

**Files:** Create `scripts/run-registration-observation-local-db-qa.mjs`, `tests/registration-observation-local-db-runner.test.mjs`, `supabase/migrations/20260809100000_registration_observation_core_schema.sql`, `supabase/tests/registration_observation_schema_test.sql`, `tests/registration-observation-schema.test.mjs`; Modify `package.json`.

**Reviewer gate:** migration이 빈 DB에 clean apply되고 schema pgTAP/ACL test가 통과하며 runtime은 여전히 `0`이어야 한다. 이 gate 전에는 Task 2로 가지 않는다.

- [ ] **Step 1: runner와 schema RED test를 먼저 작성한다**

  `tests/registration-observation-local-db-runner.test.mjs`에 실제 argv contract를 고정한다.

  ```js
  test("runner is dry-run by default and rejects unknown focus", () => {
    assert.match(runRunner([]).stdout, /DRY RUN.*zero database changes/s)
    assert.equal(runRunner(["--execute", "--approved-local-db", "--focus", "other"]).status, 2)
  })

  test("runner keeps every independent database reviewer gate", () => {
    assert.deepEqual(readRunnerFocusNames(), [
      "schema", "booking", "feedback-access", "feedback-submit", "feedback", "enrollment", "google-chat",
      "solapi-contract", "solapi-queue", "solapi",
    ])
    assert.deepEqual(readRunnerFocus("feedback-submit"), {
      ceiling: "20260809103000",
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
        "supabase/tests/registration_observation_feedback_submit_test.sql",
      ],
    })
    assert.deepEqual(readRunnerFocus("feedback"), {
      ceiling: "20260809103500",
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
        "supabase/tests/registration_observation_feedback_submit_test.sql",
        "supabase/tests/registration_observation_feedback_decisions_test.sql",
      ],
    })
  })

  test("downstream focus fails explicitly until its files exist", () => {
    const result = runRunner(["--execute", "--approved-local-db", "--focus", "feedback"])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /registration_observation_local_db_focus_unavailable:feedback/)
  })

  test("schema focus advances only when the reviewed reads migration exists", () => {
    assert.equal(resolveSchemaFocusTerminal([
      "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
    ]), "20260809100000")
    assert.equal(resolveSchemaFocusTerminal([
      "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
      "supabase/migrations/20260809101000_registration_observation_reads.sql",
      "supabase/migrations/20260809102000_registration_observation_booking.sql",
    ]), "20260809101000")
  })

  test("runner plans the exact start-reset-fixture-test-cleanup-assert-stop lifecycle", () => {
    const plan = buildRegistrationObservationLocalDbQaPlan(localFixtureInput)
    assert.deepEqual(plan.steps.map((step) => step.name), [
      "db-start",
      "db-reset",
      "focus-fixture-setup",
      "pgtap",
      "focus-fixture-cleanup",
      "fresh-runtime0-assert",
      "db-stop",
    ])
    assert.deepEqual(plan.steps[0].argv, [
      pinnedSupabaseGo, "db", "start", "--workdir", temporaryProjectPath,
    ])
    assert.deepEqual(plan.steps[1].argv, [
      pinnedSupabaseGo, "db", "reset", "--local", "--no-seed",
      "--workdir", temporaryProjectPath,
    ])
    const psqlArgv = (sql) => [
      "docker", "exec", "-i", containerName,
      "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres", "-c", sql,
    ]
    assert.deepEqual(plan.steps[2].argv, [
      ...psqlArgv(focusSetupSql),
    ])
    assert.deepEqual(plan.steps[3].argv, [
      pinnedSupabaseGo, "test", "db", "--workdir", temporaryProjectPath,
      focusPgTapDirectoryPath, "--db-url", loopbackDbUrl,
    ])
    assert.deepEqual(plan.steps[4].argv, [
      ...psqlArgv(focusCleanupSql),
    ])
    assert.deepEqual(plan.steps[5].argv, [
      ...psqlArgv(freshRuntimeZeroAssertionSql),
    ])
    assert.deepEqual(plan.steps[6].argv, [
      pinnedSupabaseGo, "stop", "--workdir", temporaryProjectPath,
      "--project-id", projectId, "--no-backup", "--yes",
    ])
  })

  test("runner cleanup order is fail-safe and never retries pgTAP", () => {
    const afterSetupFailure = runWithFakeSpawn({ failAt: "focus-fixture-setup" })
    assert.deepEqual(afterSetupFailure.calls, [
      "db-start", "db-reset", "focus-fixture-setup",
      "focus-fixture-cleanup", "fresh-runtime0-assert", "db-stop",
    ])
    const afterPgTapFailure = runWithFakeSpawn({
      failAt: "pgtap", alsoFailAt: "focus-fixture-cleanup",
    })
    assert.deepEqual(afterPgTapFailure.calls, [
      "db-start", "db-reset", "focus-fixture-setup", "pgtap",
      "focus-fixture-cleanup", "fresh-runtime0-assert", "db-stop",
    ])
    assert.equal(afterPgTapFailure.calls.filter((name) => name === "pgtap").length, 1)
    assert.equal(afterPgTapFailure.primaryError.step, "pgtap")
    assert.deepEqual(afterPgTapFailure.cleanupErrors.map((error) => error.step), [
      "focus-fixture-cleanup",
    ])
    assert.equal(afterPgTapFailure.status, 1)
  })

  test("start and reset failures cannot reach fixture setup or pgTAP", () => {
    assert.deepEqual(runWithFakeSpawn({ failAt: "db-start" }).calls, [
      "db-start", "db-stop",
    ])
    assert.deepEqual(runWithFakeSpawn({ failAt: "db-reset" }).calls, [
      "db-start", "db-reset", "db-stop",
    ])
  })

  test("cleanup, fresh assertion, and stop errors are ordered without hiding the primary error", () => {
    const result = runWithFakeSpawn({
      failAt: ["pgtap", "focus-fixture-cleanup", "fresh-runtime0-assert", "db-stop"],
    })
    assert.equal(result.primaryError.step, "pgtap")
    assert.deepEqual(result.cleanupErrors.map((error) => error.step), [
      "focus-fixture-cleanup", "fresh-runtime0-assert", "db-stop",
    ])
    assert.equal(result.calls.filter((name) => name === "db-stop").length, 1)
    assert.equal(result.status, 1)
  })
  ```

  `supabase/tests/registration_observation_schema_test.sql`은 transaction 안에 active admin/staff/director/unrelated profiles와 auth claims를 만들고 `plan(61)`로 table/column/check/index/RLS/function privilege, default-OFF, non-admin 거부와 incomplete-readiness activation 거부를 검사한다. 실제 0→1 activation concurrency/replay는 full readiness가 처음 성립하는 enrollment focus가 소유한다. 최소 RED assertion:

  ```sql
  select has_table('public', 'ops_registration_observations');
  select has_table('dashboard_private', 'registration_observation_domain_events');
  select function_returns('public', 'registration_observation_schema_readiness_v1', array[]::text[], 'jsonb');
  select function_returns('public', 'registration_observation_runtime_version', array[]::text[], 'integer');
  select function_returns('public', 'activate_registration_observation_runtime_v1', array['integer','text'], 'jsonb');
  select is(
    (public.registration_observation_schema_readiness_v1()->>'schemaReady')::boolean,
    false,
    'partial schema remains unready before feedback and enrollment'
  );
  select ok(
    public.registration_observation_schema_readiness_v1()->'missingObjects'
      ? 'public.get_registration_observation_feedback_v1(uuid)',
    'exact missing feedback signature is reported'
  );
  select is(public.registration_observation_runtime_version(), 0, 'default off');
  select isnt(has_table_privilege('authenticated', 'public.ops_registration_observations', 'INSERT'), true);
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-schema.test.mjs
  ```
  Expected: runner, migration, functions가 없어 module/path/signature assertion이 FAIL한다.

- [ ] **Step 3: isolated runner를 구현한다**

  기존 `scripts/run-registration-customer-solapi-local-db-qa.mjs`의 spawn/cleanup 구조를 재사용하되 project id, temp directory, API/DB/shadow/pooler ports를 observation 전용으로 생성한다. runner의 CLI executable은 migration creation과 같은 exact pinned binary `/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go`이며 시작 시 version `2.103.0`을 확인한다; sibling Bun wrapper나 PATH의 `supabase`를 호출하지 않는다. repo migration 중 focus ceiling 이하만 임시 project에 복사한다. Focus pgTAP은 exact selected files만 고유 temporary focus-test directory에 복사하고 pinned CLI에 그 directory 하나만 넘긴다; 여러 test path를 하나의 positional argv로 가정하지 않는다. Focus registry의 committed-fixture setup/cleanup/fresh-assert SQL은 audit copy로 materialize한 뒤 파일 내용을 읽어, existing runner의 `psqlCommand`과 byte-compatible한 `docker exec -i <exact-container> psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c <sql>` argv로 shell interpolation 없이 실행한다. Supabase CLI에 존재하지 않는 `db query` subcommand를 가정하지 않는다. setup SQL은 `BEGIN`과 exact synthetic IDs/runtime 값만 쓰고 `COMMIT`; cleanup SQL은 worker disconnect가 끝난 뒤 runtime `0` restore와 exact IDs 역-FK delete를 수행하고 `COMMIT`; fresh assertion SQL은 별도 `docker exec ... psql` process/connection에서 runtime `0`, focus fixture ID 0건과 그 focus ceiling에 존재하는 provider/outbox table의 delta 0을 검사하며 mismatch면 nonzero로 끝난다. 아직 해당 table이 없는 낮은 focus에서는 registry manifest가 그 부재를 expected로 선언하고 query를 생략해야 하며, undefined relation 오류를 성공으로 삼지 않는다. no-op focus setup/cleanup도 실제 별도 `docker exec ... psql` connection과 `BEGIN; COMMIT;`을 사용한다.

  `db-start` 시도 여부, setup 시작 여부, primary error, ordered cleanup errors를 명시적인 runner state로 보존한다. start 시도 뒤 `db-stop`은 outer `finally`에서 정확히 한 번, setup 시작 뒤 cleanup/fresh assertion은 inner `finally`에서 각각 정확히 한 번 호출한다. pgTAP은 자동 재시도하지 않는다. stop 자체가 실패해도 exact project/container/network manifest 잔여 검사를 실행하고 primary error를 덮어쓰지 않는다. 따라서 Task 1의 schema focus는 100000까지, read migration을 추가하는 Task 3 이후 같은 focus는 101000까지 clean apply하되 ceiling을 넘지 않는다. schema focus의 최소 required terminal은 100000, booking부터 각 downstream focus의 required terminal은 표의 exact ceiling이다. `--focus schema`와 `booking`만 core commit에서 성공하고 나머지는 필요한 terminal/test/fixture hook이 생기기 전까지 위 고정 오류로 종료한다. `package.json`에는 다음 한 줄만 추가한다.

  ```json
  "verify:registration-observation:local-db": "node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs"
  ```

- [ ] **Step 4: track/appointment/catalog/runtime schema를 추가한다**

  migration은 `BEGIN`, `SET LOCAL lock_timeout='5s'`, `SET LOCAL statement_timeout='120s'`로 시작하고 관련 table을 SHARE ROW EXCLUSIVE 순서로 잠근다. 다음 exact 변경을 수행한다.

  - track workflow check에 `observation_requested | observation_feedback_pending | observation_completed`를 추가한다.
  - `observation_return_workflow_status text null`을 추가하고 값은 `consultation_completed | waiting_current_class | waiting_new_class | waiting_next_opening`만 허용한다.
  - `(workflow_status IN observation states) = (observation_return_workflow_status IS NOT NULL)` 양방향 check를 추가한다. 기존 행은 observation 상태가 없으므로 무손실이다.
  - appointment kind check에 `observation_class`를 추가한다. 기존 kind/status/revision 값은 갱신하지 않는다.
  - `ops_registration_subject_tracks.observation_attempt_count bigint NOT NULL DEFAULT 0 CHECK (observation_attempt_count >= 0)`를 추가한다. migration 시 observation row는 아직 없으므로 backfill scan은 없고 기존 track은 정확히 0이다. 이 scalar는 history row를 읽어 계산하지 않으며 Task 4의 locked 신규-attempt transaction만 `+1`한다.
  - `classroom_catalogs.campus text null`과 `campus IS NULL OR campus IN ('본관','별관')` check를 추가한다. migration에서 임의 campus를 backfill하지 않는다.
  - `dashboard_private.registration_observation_runtime_settings(singleton boolean PK DEFAULT true CHECK(singleton), activation_version integer NOT NULL DEFAULT 0 CHECK IN (0,1), updated_at timestamptz, updated_by uuid FK profiles)`를 생성하고 `(true,0)`을 insert한다.

- [ ] **Step 5: observation 원장과 exact constraints/indexes를 생성한다**

  `public.ops_registration_observations`의 exact columns는 다음과 같다.

  ```sql
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid not null unique references public.ops_registration_appointments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  session_authority text not null,
  class_lesson_session_id uuid references public.class_lesson_sessions(id) on delete restrict,
  legacy_session_key text,
  session_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  session_schedule_state text not null,
  session_source_revision bigint,
  legacy_session_source_hash text,
  source_revision jsonb not null,
  booking_fact_hash text not null,
  teacher_catalog_id uuid not null references public.teacher_catalogs(id) on delete restrict,
  teacher_profile_id uuid not null references public.profiles(id) on delete restrict,
  classroom_catalog_id uuid not null references public.classroom_catalogs(id) on delete restrict,
  subject text not null,
  class_name_snapshot text not null,
  teacher_name_snapshot text not null,
  classroom_name_snapshot text not null,
  campus text not null,
  textbook_snapshot jsonb not null default '[]'::jsonb,
  progress_snapshot text not null default '',
  status text not null default 'scheduled',
  attendance text,
  attendance_recorded_by uuid references public.profiles(id) on delete set null,
  attendance_recorded_at timestamptz,
  suitability_result text,
  feedback_reason text,
  feedback_submitted_by uuid references public.profiles(id) on delete set null,
  feedback_submitted_at timestamptz,
  feedback_revision bigint not null default 0,
  decision_kind text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  revision bigint not null default 1,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  ```

  Checks는 다음 truth table을 DB가 직접 강제한다: authority는 `normalized|legacy`; normalized면 session ID/source revision만 non-null, legacy면 nonblank legacy key/hash만 non-null; `source_revision`은 authority/source columns와 같은 exact tagged JSON union; `starts_at < ends_at`; status는 `scheduled|attended_feedback_pending|completed|no_show|canceled`; `scheduled`는 attendance/suitability_result/feedback null, `attended_feedback_pending`은 attendance=`attended`이고 suitability_result/feedback null, `completed`는 attendance=`attended`와 suitability_result=`fit|unfit` 및 nonblank reason/actor/time, `no_show`는 attendance=`no_show`이고 suitability_result/feedback null, `canceled`는 attendance/suitability_result/feedback null이다. decision은 null 또는 `enrollment|waiting_current_class|waiting_new_class|waiting_next_opening|not_registered|re_observation`이며 non-null이면 decided actor/time이 모두 존재한다. all revisions는 nonnegative이고 observation revision은 양수다. subject/name/hash/campus는 nonblank, campus는 `본관|별관`, textbook snapshot은 JSON array다.

  Exact indexes:

  ```sql
  create unique index ops_registration_observations_open_track_key
    on public.ops_registration_observations(track_id)
    where decision_kind is null
      and status in ('scheduled','attended_feedback_pending','completed','no_show');
  create index ops_registration_observations_track_decision_status_idx
    on public.ops_registration_observations(track_id, decision_kind, status, created_at desc, id desc);
  create index ops_registration_observations_teacher_status_idx
    on public.ops_registration_observations(teacher_profile_id, status, starts_at, id);
  create index ops_registration_observations_task_idx on public.ops_registration_observations(task_id);
  create index ops_registration_observations_class_idx on public.ops_registration_observations(class_id);
  create index ops_registration_observations_session_idx on public.ops_registration_observations(class_lesson_session_id)
    where class_lesson_session_id is not null;
  create index ops_registration_observations_teacher_catalog_idx on public.ops_registration_observations(teacher_catalog_id);
  create index ops_registration_observations_classroom_catalog_idx on public.ops_registration_observations(classroom_catalog_id);
  create index ops_registration_observations_attendance_actor_idx on public.ops_registration_observations(attendance_recorded_by)
    where attendance_recorded_by is not null;
  create index ops_registration_observations_feedback_actor_idx on public.ops_registration_observations(feedback_submitted_by)
    where feedback_submitted_by is not null;
  create index ops_registration_observations_decision_actor_idx on public.ops_registration_observations(decided_by)
    where decided_by is not null;
  create index ops_registration_observations_created_actor_idx on public.ops_registration_observations(created_by)
    where created_by is not null;
  create index ops_registration_observations_updated_actor_idx on public.ops_registration_observations(updated_by)
    where updated_by is not null;
  ```

- [ ] **Step 6: receipt와 stable domain-event seam을 생성한다**

  ```sql
  create table dashboard_private.registration_observation_mutation_requests (
    actor_profile_id uuid not null references public.profiles(id) on delete restrict,
    operation text not null check (operation in (
      'activate','enter','book','reschedule','cancel','withdraw',
      'record_attendance','submit_feedback','correct_feedback','decide'
    )),
    request_key text not null check (btrim(request_key) <> ''),
    track_id uuid references public.ops_registration_subject_tracks(id) on delete cascade,
    request_fingerprint text not null check (btrim(request_fingerprint) <> ''),
    response_payload jsonb not null,
    created_at timestamptz not null default now(),
    primary key (actor_profile_id, request_key),
    check ((operation = 'activate') = (track_id is null))
  );

  create table dashboard_private.registration_observation_domain_events (
    event_id uuid primary key default gen_random_uuid(),
    observation_id uuid not null references public.ops_registration_observations(id) on delete restrict,
    appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
    notification_revision integer not null check (notification_revision > 0),
    event_kind text not null check (event_kind in (
      'observation_scheduled','observation_rescheduled','observation_canceled',
      'observation_attendance_recorded','observation_no_show','observation_feedback_submitted'
    )),
    booking_fact_hash text not null check (btrim(booking_fact_hash) <> ''),
    source_revision jsonb not null,
    occurred_at timestamptz not null default now(),
    unique (observation_id, notification_revision, event_kind)
  );
  ```

  observation과 event의 `source_revision`에는 다음 tagged union만 허용하는 check를 건다. observation에서는 authority/source scalar columns와도 일치시킨다. 다른 key, null, 문자열 숫자 revision은 거부한다.

  ```sql
  check (
    (source_revision = jsonb_build_object(
      'authority', 'normalized',
      'sessionId', source_revision->>'sessionId',
      'revision', (source_revision->>'revision')::bigint
    ) and source_revision->>'authority' = 'normalized'
      and (source_revision->>'sessionId')::uuid is not null
      and (source_revision->>'revision')::bigint >= 0)
    or
    (source_revision = jsonb_build_object(
      'authority', 'legacy',
      'sessionKey', source_revision->>'sessionKey',
      'contentHash', source_revision->>'contentHash'
    ) and source_revision->>'authority' = 'legacy'
      and nullif(btrim(source_revision->>'sessionKey'), '') is not null
      and nullif(btrim(source_revision->>'contentHash'), '') is not null)
  )
  ```

  observation table에는 위 shape check 외에 다음 equality check를 추가한다. event table은 INSERT하는 mutation/materializer가 referenced observation의 같은 JSON과 일치하는지 검증한 뒤 적재한다.

  ```sql
  check (
    (session_authority = 'normalized'
      and source_revision->>'authority' = 'normalized'
      and source_revision->>'sessionId' = class_lesson_session_id::text
      and (source_revision->>'revision')::bigint = session_source_revision)
    or
    (session_authority = 'legacy'
      and source_revision->>'authority' = 'legacy'
      and source_revision->>'sessionKey' = legacy_session_key
      and source_revision->>'contentHash' = legacy_session_source_hash)
  )
  ```

  event table에 `(occurred_at,event_id)`, `(observation_id,occurred_at,event_id)`, `(appointment_id,occurred_at,event_id)` index를 추가한다. receipt에는 `(track_id,created_at desc)` index를 추가한다. runtime singleton `updated_by`는 행 수가 1로 고정되어 별도 index를 만들지 않는다. 이 migration은 due-job이나 provider delivery table을 만들지 않는다.

- [ ] **Step 7: readiness/runtime/RLS/ACL을 구현한다**

  Exact public signatures:

  ```sql
  public.registration_observation_schema_readiness_v1() returns jsonb
  public.registration_observation_runtime_version() returns integer
  ```

  Private impl names/signatures are exact: `dashboard_private.registration_observation_schema_readiness_v1_impl() returns jsonb`, `dashboard_private.registration_observation_runtime_version_impl() returns integer`, and `dashboard_private.activate_registration_observation_runtime_v1_impl(integer,text) returns jsonb`. Public functions are thin SECURITY INVOKER wrappers over these SECURITY DEFINER implementations.

  readiness JSON exact shape는 `{schemaReady:boolean,missingObjects:text[],runtimeVersion:0|1}`다. `schemaReady` 계산은 activation_version과 무관하다. 함수 존재 검사는 이름이나 wildcard가 아니라 다음 exact `to_regprocedure(...)` 전부로 수행하고, 누락 시 아래 문자열 전체를 `missingObjects` token으로 한 번만 넣는다.

  ```sql
  public.list_registration_observation_sessions_v1(uuid,uuid,date,date)
  public.get_registration_observation_manager_detail_v1(uuid,integer)
  public.get_registration_observation_manager_attempt_v1(uuid,uuid)
  dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb,text)
  public.enter_registration_observation_v1(uuid,integer,text)
  public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)
  public.cancel_registration_observation_v1(uuid,integer,bigint,text)
  public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)
  public.get_registration_observation_feedback_v1(uuid)
  public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)
  public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)
  public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)
  public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)
  dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)
  dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)
  dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)
  dashboard_private.registration_appointment_track_ids_v1(uuid)
  ```

  Table/column tokens are exactly `public.ops_registration_observations`, `dashboard_private.registration_observation_mutation_requests`, `dashboard_private.registration_observation_domain_events`, `dashboard_private.registration_observation_runtime_settings`, `public.ops_registration_subject_track_summaries.observation_attempt_count`, `public.ops_registration_enrollments.class_start_source_observation_id`, `public.ops_registration_appointment_calendar.observation_id`, `public.ops_registration_appointment_calendar.observation_track_id`, `public.ops_registration_appointment_calendar.observation_class_id`, `public.ops_registration_appointment_calendar.observation_class_name`, `public.ops_registration_appointment_calendar.observation_ends_at`, `public.ops_registration_appointment_calendar.observation_teacher_name`, and `public.ops_registration_appointment_calendar.observation_classroom_name`. `missingObjects` is the sorted unique array of these exact tokens plus any missing exact function signatures. 모든 object가 있고 미래 active/makeup normalized session 및 future legacy/shadow selectable session에서 사용 중인 강의실의 missing/invalid campus가 없을 때만 true다. 이 때문에 core 계획만 완료된 상태의 readiness는 의도적으로 false이고, feedback/enrollment/calendar forward replacement까지 clean apply해야 true가 된다. campus 문제가 하나라도 있으면 bounded token `classroom_catalogs.campus_backfill`을 `missingObjects`에 한 번 넣고 이름으로 campus를 추론하거나 backfill하지 않는다. `runtimeVersion`은 진단용 현재 설정값이며 `schemaReady` 계산에 섞지 않는다. public runtime 함수는 expensive readiness scan을 반복하지 않고 locked singleton의 activation_version만 반환한다; readiness는 activation RPC가 0→1 직전에 같은 transaction에서 다시 강제하고 개별 booking resolver도 선택한 회차 prerequisite를 매번 강제한다.

  이미 존재하는 `dashboard_private.registration_appointment_track_ids_v1(uuid)`는 signature 존재만으로 준비 완료로 보지 않는다. readiness는 `pg_get_functiondef`의 normalized body가 기존 level-test/visit 두 branch와 신규 `ops_registration_observations` + `observation_class` branch를 모두 포함하는지, calendar view reloptions에 `security_invoker=true`가 있는지도 확인한다. 하나라도 빠지면 각각 위 exact helper signature 또는 `public.ops_registration_appointment_calendar.security_invoker` token을 `missingObjects`에 남겨 activation을 막는다.

  `dashboard_private.assert_registration_observation_runtime_v1()`은 runtime `1`이 아니면 `registration_observation_runtime_inactive` SQLSTATE `55000`을 낸다. readiness는 active admin/staff, runtime version은 active authenticated, activation은 active admin만 허용한다. observation RLS SELECT policy는 `current_dashboard_role() in ('admin','staff') OR track.director_profile_id=auth.uid()`만 허용한다.

  activation의 exact public signature는 다음이다.

  ```sql
  public.activate_registration_observation_runtime_v1(
    p_expected_current_version integer,
    p_request_key text
  ) returns jsonb
  ```

  private `_impl`은 admin-only다. `actor+request_key` advisory lock, receipt replay/fingerprint conflict, runtime singleton `FOR UPDATE`, readiness 재계산 순서로 같은 transaction에서 실행한다. expected/current가 모두 0이고 readiness `{schemaReady:true,missingObjects:[],runtimeVersion:0}`일 때만 0→1로 갱신하며 response는 `{operation:"activate",requestKey,previousVersion:0,runtimeVersion:1,readiness}`다. 다른 새 요청으로 1→1 또는 1→0을 수행하지 않는다. activation row 직접 UPDATE는 revoke 상태를 유지하고 운영 runbook에서도 금지한다.

- [ ] **Step 8: Task 1 clean-apply GREEN을 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-schema.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus schema
  pnpm eslint scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-schema.test.mjs
  git add -- supabase/migrations/20260809100000_registration_observation_core_schema.sql
  test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_core_schema\.sql$')" = "supabase/migrations/20260809100000_registration_observation_core_schema.sql"
  test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_core_schema\.sql$')"
  test -s supabase/migrations/20260809100000_registration_observation_core_schema.sql
  git diff --cached --check
  git diff --check
  ```
  Expected: isolated reset가 현재 존재하는 migration 중 schema ceiling 이하(`20260809100000`)까지 clean apply한다. readiness는 아직 Task 3/4와 downstream feedback/enrollment object를 `missingObjects`로 보고하므로 false, runtime은 default 0, non-admin activation과 admin premature activation은 모두 거부되고 provider 호출은 0회다.

- [ ] **Step 9: reviewer diff gate와 commit**

  `git diff --stat`와 migration 전체를 검토해 기존 행 UPDATE/DELETE, enrollment/message/provider 변경이 없음을 확인한다.
  ```bash
  git add package.json scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-schema.test.mjs supabase/migrations/20260809100000_registration_observation_core_schema.sql supabase/tests/registration_observation_schema_test.sql
  git commit -m "feat: add observation core schema"
  ```

---

### Task 2: 강의실 campus를 운영자가 명시적으로 관리한다

**Files:** Modify `src/features/management/classroom-master-workspace.tsx`, `src/features/management/management-service.js`, `tests/classroom-subject-membership.test.mjs`.

**Reviewer gate:** 강의실 이름에서 campus를 추론하지 않고 운영자가 각 catalog에 `본관 | 별관`을 직접 선택·저장하며, 누락 행이 화면에서 즉시 식별되어야 한다.

- [ ] **Step 1: campus payload와 UI RED를 작성한다**

  ```js
  test("classroom campus is explicit and never inferred from its name", async () => {
    const [payload] = buildResourceCatalogPayload([{
      id: "room-1", name: "별관 4강", subjects: ["영어"], campus: "본관",
    }], { kind: "classroom" })
    assert.equal(payload.campus, "본관")
    assert.throws(() => buildResourceCatalogPayload([{
      id: "room-2", name: "본관 3강", subjects: ["수학"], campus: "",
    }], { kind: "classroom" }), /강의실 건물을 선택해 주세요/)
    assert.doesNotMatch(managementServiceSource, /name.*includes.*본관|name.*includes.*별관/)
    assert.match(workspaceSource, /campus: "본관" \| "별관" \| ""/)
    assert.match(workspaceSource, /강의실 건물/)
  })
  ```

- [ ] **Step 2: RED를 확인한다**

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/classroom-subject-membership.test.mjs
  ```

  Expected: `campus` payload/record/select가 없어 새 assertion이 FAIL한다.

- [ ] **Step 3: 관리 payload와 모바일·데스크톱 UI를 구현한다**

  `buildResourceCatalogPayload(...,{kind:"classroom"})`는 input의 exact `본관 | 별관`만 `campus` column으로 보낸다. 빈 값, 다른 문자열, 이름 기반 추론은 거부한다. teacher catalog payload에는 campus key를 추가하지 않는다. `ClassroomRecord`는 `campus: "본관" | "별관" | ""`를 갖고 query projection에 `campus`를 추가한다. 새 행은 campus `""`로 시작하며 저장 전 선택을 요구한다. mobile/desktop 모두 이름 옆에 한 개의 compact `건물` select를 공유하고, 기존 null 행은 `건물 미지정` 배지와 저장 차단으로 명시한다. 과목·표시·정렬·삭제 동작은 바꾸지 않는다.

- [ ] **Step 4: 회귀와 operator backfill gate를 검증한다**

  explicit campus round-trip, blank/unknown rejection, misleading room name과 explicit campus 불일치 보존, teacher payload 무변경, mobile/desktop 공통 control, nullable legacy row load를 검사한다. readiness의 `classroom_catalogs.campus_backfill`이 사라지는 운영 증거는 실제 운영자가 이 화면에서 사용 중 강의실을 모두 저장한 뒤 별도 rollout gate에서 확인하며, migration이나 테스트 fixture가 이름으로 자동 backfill하지 않는다.

- [ ] **Step 5: GREEN과 commit**

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/classroom-subject-membership.test.mjs tests/management-service-schema-fallback.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/management/classroom-master-workspace.tsx src/features/management/management-service.js tests/classroom-subject-membership.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  git add src/features/management/classroom-master-workspace.tsx src/features/management/management-service.js tests/classroom-subject-membership.test.mjs
  git commit -m "feat: manage classroom campus"
  ```

---

### Task 3: canonical session resolver, manager detail, exact single-attempt lookup, bounded summary를 추가한다

**Files:** Create `supabase/migrations/20260809101000_registration_observation_reads.sql`, `tests/registration-observation-reads.test.mjs`; Modify `supabase/tests/registration_observation_schema_test.sql`, `tests/registration-observation-schema.test.mjs`.

**Reviewer gate:** normalized/legacy 회차가 한 resolver contract로 귀결되고 read bounds·manager authorization·50개 제한과 독립적인 exact single-attempt lookup·summary index plan을 clean DB pgTAP이 증명해야 한다.

- [ ] **Step 1: bounded read RED tests를 작성한다**

  ```sql
  select throws_ok(
    $$ select public.list_registration_observation_sessions_v1(
      :'track_id', :'class_id', current_date, current_date + 121
    ) $$,
    '22023', 'registration_observation_date_range_invalid'
  );
  select lives_ok(
    $$ select public.get_registration_observation_manager_detail_v1(:'track_id', 20) $$
  );
  select throws_ok(
    $$ select public.get_registration_observation_manager_detail_v1(:'track_id', 51) $$,
    '22023', 'registration_observation_attempt_limit_invalid'
  );
  select lives_ok(
    $$ select public.get_registration_observation_manager_attempt_v1(
      :'track_id', :'oldest_observation_id'
    ) $$,
    'exact observation lookup is independent of the recent-attempt limit'
  );
  select throws_ok(
    $$ select public.get_registration_observation_manager_attempt_v1(
      :'other_track_id', :'oldest_observation_id'
    ) $$,
    'P0002', 'registration_observation_not_found'
  );
  ```

  Step 5의 같은 track 10,001건 history fixture를 재사용해 manager detail 50개에는 가장 오래된 ID가 없음을 먼저 assert한 뒤, exact lookup은 그 ID 한 건을 반환해야 한다. 반환 `trackId/taskId/observation.trackId/observation.taskId/observation.appointmentId`는 fixture와 정확히 같아야 한다. 다른 track ID, 존재하지 않는 observation ID, unrelated actor는 모두 동일 `P0002 registration_observation_not_found`이고 결과 cardinality나 존재를 노출하지 않는다. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`은 observation PK lookup node `Actual Rows <= 1`, `Actual Loops = 1`, history seq scan/aggregate 0을 assert한다. Node contract test는 exact signatures, `security invoker` wrappers, private `security definer set search_path=''`, auth helper, exact observation PK predicate, `LIMIT 1`, date bound, summary scalar columns을 찾는다. legacy fixture는 한 row에 `sessionKey/session_key/id`를 모두 다르게 넣어 `sessionKey` 우선, 각각 하나씩 제거해 `session_key` 다음 `id` 우선, `normal → active`, unknown state 거부를 고정한다. 선택 회차 textbookEntries 변경은 legacy content hash를 바꾸지만 다른 회차의 state/memo/textbookEntries 변경은 hash를 바꾸지 않는 selected-session envelope test도 RED에 포함한다.

이 Task가 schema pgTAP assertion을 추가할 때 Task 1의 literal `plan(61)`을 그대로 두지 않는다. 최종 assertion 수를 다시 세어 하나의 exact literal plan count로 교체하고, `finish()`/no-plan 우회 없이 plan mismatch 자체가 focus 실패가 되게 한다.

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-reads.test.mjs tests/registration-observation-schema.test.mjs
  ```
  Expected: read migration/RPC/view columns가 없어 FAIL한다.

- [ ] **Step 3: manager access와 canonical resolver를 구현한다**

  Exact private signatures:

  ```sql
  dashboard_private.assert_registration_observation_manager_access_v1(p_track_id uuid)
    returns public.ops_registration_subject_tracks

  dashboard_private.resolve_registration_observation_session_v1(
    p_track_id uuid,
    p_class_id uuid,
    p_session_authority text,
    p_class_lesson_session_id uuid,
    p_legacy_session_key text
  ) returns jsonb

  dashboard_private.registration_observation_booking_fact_hash_v1(p_fact jsonb)
    returns text

  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    p_schedule_plan jsonb,
    p_session_key text
  ) returns text
  ```

  access helper는 active profile, admin/staff 또는 exact track director, task/track 존재를 함께 확인하고 권한이 없으면 존재 여부를 숨기는 `registration_observation_not_found`를 낸다. resolver는 track subject와 class subject 일치부터 확인한다.

  - normalized: class storage runtime `1`, exact class의 session ID, state `active|makeup`, canonical start가 server now보다 미래인 session, non-null ordered times, session revision을 사용한다.
  - legacy/shadow: 선택 class 한 행에서 `schedule_plan.sessions`가 array이면 그것을, 아니고 `session_list`가 array이면 그것만 사용한다. 각 row의 stable key는 nonblank `sessionKey` → `session_key` → `id` 순서로 처음 발견한 값이고 셋 다 없거나 같은 canonical key가 중복이면 거부한다. state는 `scheduleState` → `schedule_state` → `state` 순서로 읽어 lowercase하며 `normal`은 canonical `active`로 매핑하고 `active|makeup` 외 값은 거부한다. exact key 한 건과 동일 날짜 repeating slot이 정확히 하나일 때만 time을 derive하며 0/2개면 `registration_observation_session_time_ambiguous`다.

    The legacy hash helper selects that exact canonical key once and passes this exact envelope to existing `dashboard_private.continuous_class_schedule_content_hash_v1(jsonb)`:

    ```sql
    jsonb_build_object(
      'textbooks',
      coalesce((
        select jsonb_agg(book.value order by book.ordinality)
        from jsonb_array_elements(
          case when jsonb_typeof(p_schedule_plan->'textbooks') = 'array'
            then p_schedule_plan->'textbooks' else '[]'::jsonb end
        ) with ordinality book(value, ordinality)
        where nullif(btrim(book.value->>'textbookId'), '') in (
          select nullif(btrim(entry.value->>'textbookId'), '')
          from jsonb_array_elements(
            case when jsonb_typeof(v_selected_session->'textbookEntries') = 'array'
              then v_selected_session->'textbookEntries' else '[]'::jsonb end
          ) entry(value)
        )
      ), '[]'::jsonb),
      'sessions',
      jsonb_build_array(jsonb_build_object(
        'sessionKey', v_canonical_session_key,
        'textbookEntries',
        case when jsonb_typeof(v_selected_session->'textbookEntries') = 'array'
          then v_selected_session->'textbookEntries' else '[]'::jsonb end
      ))
    )
    ```

    `v_selected_session` is the sole row whose priority-normalized key equals nonblank `p_session_key`; `v_canonical_session_key=p_session_key`. Missing/duplicate selection raises `registration_observation_legacy_session_invalid`. This makes selected textbook entries/catalog content authoritative while every unselected session/state/memo/textbook is outside the hash.
  - 두 authority 모두 `session_date + start_time/end_time AT TIME ZONE 'Asia/Seoul'`로 timestamptz를 만들고 `startsAt > now()`를 서버에서 재검증한다.
  - 두 권위 모두 visible teacher catalog, non-null matching `teacher_catalogs.profile_id`, `notification_profile_is_active_v1(profile_id)=true`, visible classroom catalog와 non-null valid `classroom_catalogs.campus`를 요구한다. legacy name fallback은 lower(name) exact unique match만 허용한다.
  - textbook는 선택 회차 `textbookEntries`; progress는 exact class/session progress log → 선택 회차 memo/public_note → `진도: 미입력` 순서다. 다른 회차의 최신 progress는 사용하지 않는다.

  resolver JSON exact keys는 `classId,subject,sessionAuthority,classLessonSessionId,legacySessionKey,sessionKey,scheduleState,sessionDate,startsAt,endsAt,sessionSourceRevision,legacySessionSourceHash,sourceRevision,teacherCatalogId,teacherProfileId,teacherName,classroomCatalogId,classroomName,campus,className,textbooks,progress,bookingFactHash`다. `sessionKey`는 normalized에서 linked `class_lesson_sessions.session_key`, legacy에서 exact `legacySessionKey`와 같고 항상 nonblank다. `sourceRevision`은 normalized면 `{authority:"normalized",sessionId:string,revision:number}`, legacy면 `{authority:"legacy",sessionKey:string,contentHash:string}`인 exact JSON object다. booking hash 입력은 class/subject/authority/ID/key/scheduleState/date/start/end/teacher IDs+name/classroom ID+name/campus만 포함하며 textbook/progress/memo/workflow/status는 제외한다.

- [ ] **Step 4: exact public read RPCs를 구현한다**

  ```sql
  public.list_registration_observation_sessions_v1(
    p_track_id uuid,
    p_class_id uuid,
    p_date_from date,
    p_date_to date
  ) returns jsonb

  public.get_registration_observation_manager_detail_v1(
    p_track_id uuid,
    p_attempt_limit integer default 20
  ) returns jsonb

  public.get_registration_observation_manager_attempt_v1(
    p_track_id uuid,
    p_observation_id uuid
  ) returns jsonb
  ```

  Public wrappers는 같은 인자의 `dashboard_private.list_registration_observation_sessions_v1_impl`, `dashboard_private.get_registration_observation_manager_detail_v1_impl`, `dashboard_private.get_registration_observation_manager_attempt_v1_impl`만 호출한다.

  session list는 `p_date_from >= current_date`, `p_date_to >= p_date_from`, 120일 이하를 강제하고 최대 240개를 date/start/id 순으로 반환한다. detail attempt limit은 1..50이고 최근 attempt만 반환한다. detail exact top-level shape는 `{track,currentObservation,latestEnrollmentDecisionObservationId,attempts,classes}`다. `latestEnrollmentDecisionObservationId`는 attempt limit과 무관하게 `(track_id,decision_kind,status,created_at,id)` index에서 exact track의 최신 `decision_kind='enrollment'` observation ID 한 건을 `created_at desc,id desc limit 1`로 찾는 bounded scalar라서, 그 뒤 canceled-only 시도가 50개를 넘어도 첫 수업일 source를 잃지 않는다. `classes`는 같은 subject이면서 `closed_at is null`인 반 중 최대 100개를 `name,id` 순으로 잘라 `id,name,subject`만 반환한다. feedbackReason/phone/school/inquiry/sibling track/schedule_plan 전체는 반환하지 않는다. `currentObservation`은 open partial-unique predicate와 일치하는 row 또는 null이고, attempts는 최근 row 순서다. 모든 nested exact key/nullability는 Task 5 type block과 1:1이다.

  Exact single-attempt impl은 먼저 `assert_registration_observation_manager_access_v1(p_track_id)`를 호출한 뒤 observation PK를 `observation.id=p_observation_id AND observation.track_id=p_track_id`로 한 건만 읽고 linked appointment/task를 join한다. 반환 exact shape는 `{trackId,taskId,observation}`이며 `observation`은 manager detail `attempts[]`와 byte-for-byte 같은 `RegistrationObservationAttempt` object다. 결과가 0건이거나 task/track/appointment 관계가 일치하지 않으면 권한 실패와 같은 `P0002 registration_observation_not_found`를 낸다. 배열, offset, history count, feedback reason, phone, school, inquiry 또는 sibling track을 읽지 않고 observation PK에서 `LIMIT 1`로 끝난다. Public wrapper는 `LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''`, private impl은 active manager guard가 있는 `STABLE SECURITY DEFINER SET search_path=''`; exact private/public signature는 `PUBLIC,anon,service_role`에서 revoke하고 public만 `authenticated` EXECUTE, invoker chain에 필요한 private signature만 `authenticated` EXECUTE를 갖는다.

- [ ] **Step 5: summary view를 마지막으로 recreate한다**

  기존 `public.ops_registration_subject_track_summaries`의 모든 column 이름/타입/순서를 보존하고 끝에 다음 고정 scalar만 추가한다.

  ```text
  observation_attempt_count bigint
  observation_current_id uuid
  observation_current_status text
  observation_current_appointment_id uuid
  observation_nearest_scheduled_at timestamptz
  observation_nearest_place text
  observation_notification_revision integer
  observation_revision bigint
  observation_feedback_revision bigint
  ```

  `observation_attempt_count`는 track의 transactionally maintained scalar를 직접 투영한다. history `count(*)`/aggregate/lateral은 금지한다. current scalar들은 partial-unique predicate의 observation 한 행과 그 appointment 한 행만 `LEFT JOIN LATERAL ... LIMIT 1`로 읽고 feedback/textbook/progress JSON을 포함하지 않는다. view는 `security_invoker=true`; observation SELECT RLS가 manager 범위를 유지한다.

  RED/GREEN pgTAP은 한 track에 terminal history 10,000건과 open 1건을 만들고 track scalar가 10,001인지 먼저 검증한다. 이어 exact summary row 하나에 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`을 실행해 observation history `Seq Scan`과 aggregate node가 0개, open-index node `Actual Rows <= 1`, `Actual Loops = 1`, 해당 node의 `Shared Hit Blocks + Shared Read Blocks <= 32`임을 수치로 assert한다. 이 fixture에서 history row 수를 20,000으로 늘려도 동일 bound를 유지해야 한다. Node source test는 summary SQL에 observation history `count(`가 없고 track scalar가 projection되는지 고정한다.

- [ ] **Step 6: Task 3 clean-apply GREEN을 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-reads.test.mjs tests/registration-observation-schema.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus schema
  git add -- supabase/migrations/20260809101000_registration_observation_reads.sql
  test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_reads\.sql$')" = "supabase/migrations/20260809101000_registration_observation_reads.sql"
  test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_reads\.sql$')"
  test -s supabase/migrations/20260809101000_registration_observation_reads.sql
  git diff --cached --check
  git diff --check
  ```
  Expected: reset가 `20260809101000`까지 apply되고 schema/read pgTAP이 normalized/legacy/auth/bounds/index assertions를 모두 PASS한다.

- [ ] **Step 7: reviewer diff gate와 commit**

  ```bash
  git add supabase/migrations/20260809101000_registration_observation_reads.sql supabase/tests/registration_observation_schema_test.sql tests/registration-observation-reads.test.mjs tests/registration-observation-schema.test.mjs
  git commit -m "feat: add observation bounded reads"
  ```

---

### Task 4: booking/change/cancel/withdraw RPC와 generic guard를 구현한다

**Files:** Create `supabase/migrations/20260809102000_registration_observation_booking.sql`, `supabase/tests/registration_observation_booking_test.sql`, `tests/registration-observation-booking.test.mjs`; Modify `scripts/run-registration-observation-local-db-qa.mjs`, `tests/registration-observation-local-db-runner.test.mjs`, `tests/registration-observation-schema.test.mjs`.

**Reviewer gate:** exact revision 조합, request replay/conflict, lock order, canceled-only 철회, generic transition guard, transactional domain event가 clean DB pgTAP에서 모두 증명되어야 한다.

- [ ] **Step 1: signature/revision/event RED tests를 작성한다**

  ```sql
  select throws_ok(
    $$ select public.save_registration_observation_booking_v1(
      :'track_id', null, :'class_id', 'normalized', :'session_id', null,
      null, null, null, :'request_key'
    ) $$,
    '22023', 'registration_observation_revision_combination_invalid'
  );
  select results_eq(
    $$ select count(*) from dashboard_private.registration_observation_domain_events
       where event_kind = 'observation_scheduled' $$,
    array[1::bigint]
  );
  select results_eq(
    $$ select count(*) from dashboard_private.registration_observation_domain_events
       where event_kind in ('reminder_due','feedback_due') $$,
    array[0::bigint]
  );
  ```

  Node test는 migration에서 public/private exact signature, operation별 fingerprint, advisory→track→observation→appointment 문자열 순서, domain event insert, provider/due table 부재를 확인한다.

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs
  ```
  Expected: booking migration과 RPC가 없어 FAIL한다.

- [ ] **Step 3: shared receipt/lock/runtime helpers를 구현한다**

  Exact public signatures는 다음이며 각각 동일 인자의 `dashboard_private.enter_registration_observation_v1_impl`, `dashboard_private.save_registration_observation_booking_v1_impl`, `dashboard_private.cancel_registration_observation_v1_impl`, `dashboard_private.withdraw_registration_observation_v1_impl`을 호출한다.

  ```sql
  public.enter_registration_observation_v1(
    p_track_id uuid,
    p_expected_workflow_revision integer,
    p_request_key text
  ) returns jsonb

  public.save_registration_observation_booking_v1(
    p_track_id uuid,
    p_observation_id uuid,
    p_class_id uuid,
    p_session_authority text,
    p_class_lesson_session_id uuid,
    p_legacy_session_key text,
    p_expected_workflow_revision integer,
    p_expected_appointment_notification_revision integer,
    p_expected_observation_revision bigint,
    p_request_key text
  ) returns jsonb

  public.cancel_registration_observation_v1(
    p_observation_id uuid,
    p_expected_appointment_notification_revision integer,
    p_expected_observation_revision bigint,
    p_request_key text
  ) returns jsonb

  public.withdraw_registration_observation_v1(
    p_track_id uuid,
    p_exit_kind text,
    p_target_workflow_status text,
    p_decision_observation_id uuid,
    p_expected_workflow_revision integer,
    p_expected_decision_observation_revision bigint,
    p_expected_decision_feedback_revision bigint,
    p_reason text,
    p_request_key text
  ) returns jsonb
  ```

  request key는 기존 repo contract와 같은 nonblank `text`다. advisory key는 `pg_advisory_xact_lock(hashtextextended(actor_id||':'||request_key,0))`다. fingerprint는 operation과 모든 semantic input을 key-sorted JSON으로 만든 SHA-256이다. 같은 actor가 같은 key를 다른 operation에 쓰면 fingerprint conflict다. receipt가 없을 때만 runtime guard와 domain lock을 수행한다. response exact 공통 keys는 `{operation,requestKey,trackId,workflowStatus,workflowRevision,observation,appointment,changed}`이며 없는 observation/appointment는 JSON null이다.

- [ ] **Step 4: enter와 신규/reschedule booking을 구현한다**

  `enter`는 source가 `consultation_completed|waiting_*`, expected workflow revision 일치, open observation 부재를 track lock 안에서 확인한다. return status를 source로 저장하고 workflow를 `observation_requested`, revision+1로 바꾸며 observation/appointment/event는 만들지 않는다.

  여기서 event를 만들지 않는다는 뜻은 provider용 domain event가 없다는 뜻이다. audit helper에는 `registration_observation_entered`를 남긴다. 예약/변경/취소/철회도 각각 `registration_observation_scheduled|rescheduled|canceled|withdrawn` audit을 남기고 metadata에는 IDs, before/after revisions, exit kind/target만 넣는다. re-observation correction audit은 before/after decision과 필수 reason을 추가한다.

  `save` revision truth table:

  | branch | observation id | expected workflow | expected notification | expected observation |
  |---|---|---:|---:|---:|
  | new attempt | null | required | must be null | must be null |
  | reschedule | required | must be null | required | required |

  신규 branch는 track이 `observation_requested`, expected workflow 일치, open observation 및 scheduled observation appointment가 없음을 같은 track lock에서 확인한다. canonical resolver 결과로 appointment와 observation을 원자 생성하고, 같은 locked-track transaction에서 `ops_registration_subject_tracks.observation_attempt_count = observation_attempt_count + 1`을 딱 한 번 수행한 뒤 `observation_scheduled` event를 notification revision 1로 INSERT한다. insert/counter/event/receipt 중 하나라도 실패하면 전부 rollback한다. same-fingerprint replay, no-op reschedule, reschedule, cancel, withdraw는 counter를 바꾸지 않는다. observation.task_id는 locked track.task_id와 같고 class subject는 track subject와 같아야 하며 appointment.scheduled_at/place는 observation.starts_at/campus와 정확히 같아야 한다. canceled 행을 되살리지 않는다.

  reschedule은 same-track open scheduled observation, appointment scheduled, 두 expected revision을 검증한다. booking hash가 같으면 `changed=false`, revision/event 변화 없이 receipt만 저장한다. 다르면 appointment `scheduled_at/place/notification_revision+1`, observation canonical snapshots/revision+1을 함께 갱신하고 `observation_rescheduled` event를 새 notification revision으로 INSERT한다. textbook/progress만 달라 booking hash가 같으면 고객 revision을 올리지 않고 response snapshot만 현재 resolver 값으로 갱신하지도 않는다; 준비 materializer가 dispatch 시 재조회한다.

- [ ] **Step 5: cancel과 withdraw를 구현한다**

  cancel은 track→observation→appointment 순으로 lock하고 scheduled 상태와 두 expected revision을 검사한다. observation `canceled`, appointment `canceled`, appointment notification revision+1, observation revision+1로 저장하고 `observation_canceled` event를 새 revision으로 딱 한 건 만든다. track은 `observation_requested`, return status는 유지한다.

  withdraw는 track이 `observation_requested`, expected workflow revision 일치, active observation/scheduled observation appointment 부재, 모든 뒤 attempt가 terminal임을 검사한다.

  - `return_to_previous`: target은 저장된 `observation_return_workflow_status`와 정확히 같아야 한다. decision observation/revisions는 모두 null이어야 한다.
  - `director_decision` 일반: target은 `enrollment_requested|waiting_current_class|waiting_new_class|waiting_next_opening|not_registered`; decision observation/revisions는 모두 null이다. 최초 예약 전 또는 단순 canceled 이력만 있을 때 observation decision을 만들지 않는다. 최신 decision-bearing row가 `re_observation`이면 이 branch를 거부한다.
  - `director_decision` re-observation correction: 최신 decision-bearing row가 `re_observation`일 때만 decision observation ID와 observation/feedback expected revisions 셋 모두 required다. 그 row 뒤 attempt는 decision 없는 canceled 행만 허용한다. target을 `enrollment|동명 waiting|not_registered` decision으로 correction하고 before/after/reason/actor/time audit event를 남긴다. enrollment 선택은 suitability와 무관하다. 이 correction은 observation `revision + 1`, track `workflow_revision + 1`만 수행하고 appointment `notification_revision`과 observation `feedback_revision`은 그대로 유지한다. `return_to_previous`와 일반 `director_decision`은 track `workflow_revision + 1`만 수행한다.

  모든 성공 branch는 track workflow/revision을 변경하고 `observation_return_workflow_status=null`로 지운다. enrollment/admission/payment row는 읽기 전후 count가 같아야 한다. `p_exit_kind`는 `return_to_previous|director_decision` 외 값을 거부한다.

  Booking lifecycle의 성공 revision/counter 행렬은 다음과 정확히 같다. `unchanged`에는 response 값도 기존 값과 동일하다는 뜻이 포함되며 pgTAP은 old/new/response를 함께 비교한다.

  | operation | appointment `notification_revision` | observation `revision` | observation `feedback_revision` | track `workflow_revision` | track `observation_attempt_count` |
  |---|---:|---:|---:|---:|---:|
  | `enter` | n/a | n/a | n/a | `+1` | unchanged |
  | `save` new attempt | new row `1` | new row `1` | new row `0` | unchanged | `+1` |
  | `save` same booking hash | unchanged | unchanged | unchanged | unchanged | unchanged |
  | `save` changed booking hash | `+1` | `+1` | unchanged | unchanged | unchanged |
  | `cancel` | `+1` | `+1` | unchanged | unchanged | unchanged |
  | `withdraw` return/general decision | unchanged | unchanged | unchanged | `+1` | unchanged |
  | `withdraw` re-observation correction | unchanged | `+1` | unchanged | `+1` | unchanged |

- [ ] **Step 6: generic workflow RPC를 guarded replace한다**

  현행 `dashboard_private.set_registration_workflow_status_v1_impl`과 public wrapper의 exact 기존 signature/return type/ACL을 보존해 `CREATE OR REPLACE`한다. source 또는 target이 observation 상태거나 `decision_kind is null AND status IN ('scheduled','attended_feedback_pending','completed','no_show')`인 row가 있을 때 `registration_observation_transition_requires_action`을 낸다. observation이 없는 `consultation_completed → enrollment_requested`는 계속 허용한다. 이 migration 외 downstream은 generic RPC도 재정의하지 않는다.

- [ ] **Step 7: concurrency와 replay pgTAP을 완성한다**

  booking ceiling에는 downstream feedback/enrollment가 아직 없으므로 readiness는 false이고 admin activation은 fail closed해야 한다. 같은 connection의 lifecycle/replay/stale assertion만 pgTAP outer transaction에서 local superuser가 runtime singleton을 `1`로 직접 설정하고 `ROLLBACK`한다. `dblink` concurrency는 이 uncommitted 값을 공유하지 않는다. 이 task가 runner의 booking focus registry에 exact UUID manifest setup/cleanup/fresh-assert SQL을 추가한다: runner의 pre-pgTAP setup connection이 task/profile/track/appointment/observation fixture와 runtime `1`을 commit한 뒤 pgTAP worker 두 connection이 book-vs-withdraw와 reschedule-vs-cancel을 실행한다. worker disconnect 후 runner cleanup connection은 event → receipt → observation → appointment → track → task/profile의 exact fixture IDs만 역 FK 순서로 삭제하고 runtime singleton을 `0`, `updated_by=null`로 복구해 commit한다. runner의 마지막 fresh connection에서 runtime `0`과 fixture ID 0건을 assert하며 cleanup 실패도 test failure다. runner Node test는 booking setup이 pgTAP 전, cleanup/fresh assertion이 pgTAP 후이고 failure path도 같은 순서임을 고정한다. 이 예외는 runner가 폐기하는 loopback DB 안에서만 허용하고 production migration·application·운영 runbook에 helper나 direct-write 권한을 만들지 않는다. same-key replay가 동일 JSON/event count/attempt counter를 유지하고, 같은 key 다른 fingerprint와 failed concurrent insert는 counter 증가 0, 성공한 신규 attempt만 정확히 +1인지 검사한다. stale workflow/notification/observation/feedback revision은 SQLSTATE `40001`로 닫혀야 한다. 동시 실행은 timeout/deadlock 없이 한쪽 stale 승패로 끝나야 한다. canceled-only 이력, canceled 뒤 신규 row ID와 counter +1, re-observation correction 뒤 final target, 일반 enrollment suitability 독립도 각각 검증한다. full readiness에서의 실제 admin activation 0→1/concurrency/replay는 enrollment focus `20260809104000`이 최초로 소유한다.

- [ ] **Step 8: Task 4 clean-apply GREEN을 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs tests/registration-workflow-status.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus booking
  git add -- supabase/migrations/20260809102000_registration_observation_booking.sql
  test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_booking\.sql$')" = "supabase/migrations/20260809102000_registration_observation_booking.sql"
  test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_booking\.sql$')"
  test -s supabase/migrations/20260809102000_registration_observation_booking.sql
  git diff --cached --check
  git diff --check
  ```
  Expected: reset가 `20260809102000`까지 clean apply되고 schema+booking pgTAP이 모두 PASS하며 domain events에는 scheduled/rescheduled/canceled만 생기고 provider/due row는 0개다.

- [ ] **Step 9: reviewer diff gate와 commit**

  ```bash
  git add supabase/migrations/20260809102000_registration_observation_booking.sql supabase/tests/registration_observation_booking_test.sql scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs
  git commit -m "feat: add observation booking lifecycle"
  ```

---

### Task 5: strict TypeScript client와 runtime probe를 연결한다

**Files:** Create `src/features/tasks/registration-observation-model.ts`, `src/features/tasks/registration-observation-runtime-probe.ts`, `src/features/tasks/registration-observation-service.ts`, `tests/registration-observation-service.test.mjs`, `tests/registration-observation-runtime-probe.test.mjs`; Modify `src/features/tasks/registration-track-service.ts`, `src/features/tasks/registration-track-fixtures.ts`, `src/features/tasks/registration-track-fixture-runtime.ts`, `tests/registration-track-service.test.mjs`, `tests/registration-track-fixtures.test.mjs`.

**Reviewer gate:** malformed RPC payload가 fail closed하고 timeout/retry/request/revision mapping이 executable test로 고정되어야 한다.

- [ ] **Step 1: model/service/probe RED tests를 작성한다**

  ```js
  test("runtime probe does not require the admin readiness RPC", async () => {
    const client = fakeRpcClient({ version: 0 })
    assert.deepEqual(await probeRegistrationObservationRuntime(client), {
      runtimeVersion: 0, available: false,
    })
    assert.deepEqual(client.rpcNames, ["registration_observation_runtime_version"])
  })

  test("mutation maps each conditional revision without retry", async () => {
    const client = captureRpcClient()
    await saveRegistrationObservationBooking(client, newBookingInput)
    assert.equal(client.calls[0].args.p_expected_workflow_revision, 7)
    assert.equal(client.calls[0].args.p_expected_appointment_notification_revision, null)
    assert.equal(client.calls[0].args.p_expected_observation_revision, null)
    assert.deepEqual(client.retryArguments, [false])
  })

  test("single-attempt loader is bounded by exact track and observation ids", async () => {
    const client = captureRpcClient({ result: exactOldAttemptDetail })
    const result = await loadRegistrationObservationManagerAttempt(client, {
      trackId: exactOldAttemptDetail.trackId,
      observationId: exactOldAttemptDetail.observation.observationId,
    })
    assert.deepEqual(client.calls[0], {
      name: "get_registration_observation_manager_attempt_v1",
      args: {
        p_track_id: exactOldAttemptDetail.trackId,
        p_observation_id: exactOldAttemptDetail.observation.observationId,
      },
    })
    assert.equal(client.abortSignalTimeoutMs, 12_000)
    assert.deepEqual(client.retryArguments, [false])
    assert.deepEqual(result, exactOldAttemptDetail)
  })
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
  ```
  Expected: modules와 summary columns가 없어 FAIL한다.

- [ ] **Step 3: exact types와 strict normalizers를 구현한다**

  ```ts
  export type RegistrationObservationWorkflowStatus =
    | "observation_requested" | "observation_feedback_pending" | "observation_completed"
  export type RegistrationObservationTrackWorkflowStatus =
    | "inquiry" | "level_test_requested" | "consultation_requested" | "consultation_completed"
    | "waiting_current_class" | "waiting_new_class" | "waiting_next_opening"
    | "observation_requested" | "observation_feedback_pending" | "observation_completed"
    | "enrollment_requested" | "payment_in_progress" | "registered" | "not_registered" | "inquiry_only"
  export type RegistrationObservationStatus =
    | "scheduled" | "attended_feedback_pending" | "completed" | "no_show" | "canceled"
  export type RegistrationObservationSessionAuthority = "normalized" | "legacy"
  export type RegistrationObservationDecisionKind =
    | "enrollment" | "waiting_current_class" | "waiting_new_class"
    | "waiting_next_opening" | "not_registered" | "re_observation"
  export type RegistrationObservationSourceRevision =
    | { authority: "normalized"; sessionId: string; revision: number }
    | { authority: "legacy"; sessionKey: string; contentHash: string }
  export type RegistrationObservationRuntimeState = Readonly<{
    runtimeVersion: 0 | 1
    available: boolean
  }>
  export type RegistrationObservationSchemaReadiness = Readonly<{
    schemaReady: boolean
    missingObjects: readonly string[]
    runtimeVersion: 0 | 1
  }>

  export type RegistrationObservationTextbookSnapshot = Readonly<{
    textbookId: string | null
    title: string
    planLabel: string
    memo: string
  }>

  export type RegistrationObservationSessionSource =
    | Readonly<{
        sessionAuthority: "normalized"
        classLessonSessionId: string
        legacySessionKey: null
        sessionKey: string
        sessionSourceRevision: number
        legacySessionSourceHash: null
        sourceRevision: Readonly<{ authority: "normalized"; sessionId: string; revision: number }>
      }>
    | Readonly<{
        sessionAuthority: "legacy"
        classLessonSessionId: null
        legacySessionKey: string
        sessionKey: string
        sessionSourceRevision: null
        legacySessionSourceHash: string
        sourceRevision: Readonly<{ authority: "legacy"; sessionKey: string; contentHash: string }>
      }>

  export type RegistrationObservationSessionOption = Readonly<{
    classId: string
    subject: "영어" | "수학" | "과학"
    scheduleState: "active" | "makeup"
    sessionDate: string
    startsAt: string
    endsAt: string
    teacherCatalogId: string
    teacherProfileId: string
    teacherName: string
    classroomCatalogId: string
    classroomName: string
    campus: "본관" | "별관"
    className: string
    textbooks: readonly RegistrationObservationTextbookSnapshot[]
    progress: string
    bookingFactHash: string
  } & RegistrationObservationSessionSource>

  export type RegistrationObservationAttempt = Readonly<{
    observationId: string
    taskId: string
    trackId: string
    appointmentId: string
    appointmentStatus: "scheduled" | "completed" | "canceled"
    classId: string
    subject: "영어" | "수학" | "과학"
    className: string
    scheduleState: "active" | "makeup"
    sessionDate: string
    startsAt: string
    endsAt: string
    teacherCatalogId: string
    teacherProfileId: string
    teacherName: string
    classroomCatalogId: string
    classroomName: string
    campus: "본관" | "별관"
    textbooks: readonly RegistrationObservationTextbookSnapshot[]
    progress: string
    bookingFactHash: string
    status: RegistrationObservationStatus
    attendance: "attended" | "no_show" | null
    suitabilityResult: "fit" | "unfit" | null
    decisionKind: RegistrationObservationDecisionKind | null
    revision: number
    feedbackRevision: number
    appointmentNotificationRevision: number
    createdAt: string
    updatedAt: string
  } & RegistrationObservationSessionSource>

  export type RegistrationObservationManagerDetail = Readonly<{
    track: Readonly<{
      trackId: string
      taskId: string
      subject: "영어" | "수학" | "과학"
      workflowStatus: RegistrationObservationTrackWorkflowStatus
      workflowRevision: number
      observationReturnWorkflowStatus:
        | "consultation_completed" | "waiting_current_class"
        | "waiting_new_class" | "waiting_next_opening" | null
      directorProfileId: string | null
    }>
    currentObservation: RegistrationObservationAttempt | null
    latestEnrollmentDecisionObservationId: string | null
    attempts: readonly RegistrationObservationAttempt[]
    classes: readonly Readonly<{ id: string; name: string; subject: "영어" | "수학" | "과학" }>[]
  }>

  export type RegistrationObservationManagerAttemptDetail = Readonly<{
    trackId: string
    taskId: string
    observation: RegistrationObservationAttempt
  }>

  export type RegistrationObservationAppointmentSnapshot = Readonly<{
    appointmentId: string
    status: "scheduled" | "completed" | "canceled"
    scheduledAt: string
    place: "본관" | "별관"
    notificationRevision: number
  }>

  export type RegistrationObservationMutationResult = Readonly<{
    operation: "enter" | "book" | "reschedule" | "cancel" | "withdraw"
    requestKey: string
    trackId: string
    workflowStatus: RegistrationObservationTrackWorkflowStatus
    workflowRevision: number
    observation: RegistrationObservationAttempt | null
    appointment: RegistrationObservationAppointmentSnapshot | null
    changed: boolean
  }>

  export type RegistrationObservationSummary = Readonly<{
    observationAttemptCount: number
    observationCurrentId: string | null
    observationCurrentStatus: RegistrationObservationStatus | null
    observationCurrentAppointmentId: string | null
    observationNearestScheduledAt: string | null
    observationNearestPlace: "본관" | "별관" | null
    observationNotificationRevision: number | null
    observationRevision: number | null
    observationFeedbackRevision: number | null
  }>
  ```

  DB resolver/detail/mutation/summary JSON은 위 key set을 그대로 사용한다. `RegistrationObservationSessionSource` normalizer는 authority와 ID/key/revision/hash/sourceRevision branch를 교차 검증하고 legacy `sessionKey === legacySessionKey`, normalized `sourceRevision.sessionId === classLessonSessionId`를 강제한다. UUID, `YYYY-MM-DD`, ISO timestamp, finite nonnegative revision, closed enum, campus `본관|별관`, nonblank session key/hash/name, exact textbook key set을 각각 검증하고 extra/missing key는 fail closed한다. `currentObservation`은 attempts 안의 동일 ID payload와 deep-equal이거나 null이어야 하고 `latestEnrollmentDecisionObservationId`는 attempt limit 밖의 row를 가리킬 수 있으므로 attempts membership을 요구하지 않는다. `RegistrationObservationManagerAttemptDetail` normalizer는 exact three keys만 허용하고 `observation.trackId === trackId`, `observation.taskId === taskId`를 강제한다; appointment ID는 URL target과 비교할 caller에게 observation object의 canonical 값으로 전달하며 별도 fallback을 만들지 않는다.

- [ ] **Step 4: runtime probe와 error contract를 구현한다**

  일반 UI probe는 authenticated 전체에 열린 `registration_observation_runtime_version`만 호출한다. PGRST202 또는 42883이 exact runtime 함수 이름과 함께 온 경우 `{runtimeVersion:0,available:false}`로 정규화하고 다른 DB/auth/network 오류는 throw한다. admin/staff rollout용 `loadRegistrationObservationSchemaReadiness`만 readiness RPC를 호출하며 그 함수의 schema-cache miss는 `{schemaReady:false,missingObjects:['registration_observation_schema_readiness_v1'],runtimeVersion:0}`으로 정규화한다. DB function 안에서 schema-cache 오류를 흉내 내지 않는다.

- [ ] **Step 5: service를 exact RPC mapping으로 구현한다**

  export 목록은 `loadRegistrationObservationSchemaReadiness`, `loadRegistrationObservationManagerDetail`, `loadRegistrationObservationManagerAttempt`, `loadRegistrationObservationSessions`, `activateRegistrationObservationRuntime`, `enterRegistrationObservation`, `saveRegistrationObservationBooking`, `cancelRegistrationObservation`, `withdrawRegistrationObservation`이다. `loadRegistrationObservationManagerAttempt`는 `{trackId:string,observationId:string}`만 받아 exact two-argument RPC를 한 번 호출하며 manager-detail cache나 recent attempts 배열을 검색하지 않는다. activation은 `{expectedCurrentVersion:0,requestKey:string}`만 받아 exact activation RPC에 전달하며 admin rollout 도구 외 UI에서는 호출하지 않는다. read/mutation 모두 12초 abort와 `.retry(false)`를 사용한다. session read만 `(trackId,classId,dateFrom,dateTo)` in-flight dedupe를 사용하고 single-attempt/detail read와 mutation은 dedupe/자동 재시도하지 않는다. 성공 JSON normalizer 통과 후에만 cache generation을 갱신한다.

  `registration-track-service.ts`의 `TRACK_SUMMARY_COLUMNS` 끝에 Task 3의 아홉 scalar를 정확히 추가한다. old schema fallback은 observation runtime이 unavailable일 때만 기존 projection을 사용하고, runtime ready인데 observation column이 없으면 배포 오류를 숨기지 않는다. fixture도 동일 response/revision/request-key replay semantics를 제공한다.

- [ ] **Step 6: Task 5 GREEN 및 commit**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
  pnpm eslint src/features/tasks/registration-observation-model.ts src/features/tasks/registration-observation-runtime-probe.ts src/features/tasks/registration-observation-service.ts src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-track-fixture-runtime.ts tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs
  pnpm tsc --noEmit --pretty false
  git diff --check
  ```
  Expected: strict payload, cache-miss, runtime0, timeout, no-retry, conditional revision tests가 PASS한다.

  ```bash
  git add src/features/tasks/registration-observation-model.ts src/features/tasks/registration-observation-runtime-probe.ts src/features/tasks/registration-observation-service.ts src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-track-fixture-runtime.ts tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
  git commit -m "feat: add observation core client"
  ```

---

### Task 6: 등록 목록·상세에 booking-only UI를 연결한다

**Files:** Create `src/features/tasks/registration-observation-editor.tsx`, `tests/registration-observation-workspace.test.mjs`; Modify `src/features/tasks/registration-application-shell.tsx`, `src/features/tasks/registration-application-model.ts`, `src/features/tasks/registration-application-subject-tabs.tsx`, `src/features/tasks/registration-application-progress-stepper.tsx`, `src/features/tasks/registration-application-track-actions.tsx`, `src/features/tasks/registration-workflow-status.js`, `src/features/tasks/registration-track-editor.tsx`, `src/features/tasks/registration-case-list-model.ts`, `src/features/tasks/registration-case-list.tsx`, `src/features/tasks/ops-task-workspace.tsx`, `tests/registration-track-workspace.test.mjs`, `tests/registration-application-model.test.mjs`, `tests/registration-workflow-status.test.mjs`, `tests/registration-case-list-model.test.mjs`, `tests/ops-task-workspace.test.mjs`.

**Reviewer gate:** observation slot이 shell에서 정확한 순서로 보이고, 모든 lifecycle write가 dedicated RPC로만 가며 core 화면에 teacher feedback/decision/provider action이 없어야 한다.

- [ ] **Step 1: shell/order/state RED tests를 작성한다**

  ```js
  test("application shell places observation between waiting and registration", () => {
    assert.deepEqual(readShellOrder(), [
      "inquiry", "levelTest", "consultation", "waiting", "observation", "registration", "admission",
    ])
  })

  test("observation statuses never call generic workflow mutation", async () => {
    const ui = createObservationWorkspaceFixture({ workflowStatus: "observation_requested" })
    await ui.saveBooking()
    assert.deepEqual(ui.rpcNames, ["save_registration_observation_booking_v1"])
    assert.equal(ui.rpcNames.includes("set_registration_workflow_status_v1"), false)
  })
  ```

  Source test는 editor에 feedback/attendance/decision RPC 이름, Google Chat webhook, SOLAPI send import가 없음을 검사한다.

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-workspace.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  ```
  Expected: observation shell slot/view/editor가 없어 FAIL한다.

- [ ] **Step 3: status/view와 shell의 exact order를 구현한다**

  `registration-workflow-status.js`에 세 상태와 label을 추가하고 모두 view key `observation`으로 매핑한다. generic status option에서는 세 값을 제외해 dedicated action으로만 진입하고, current source가 observation 상태면 generic select 자체를 숨긴다. list view 순서는 문의 → 레벨테스트 → 상담 → 대기 → 청강 신청 → 등록 신청 → 입학 진행 → 완료다.

  `RegistrationApplicationShellProps`에 `observation?: ReactNode`를 추가하고 internal sections/order를 다음으로 고정한다.

  ```ts
  const SECTION_ORDER = [
    "inquiry", "levelTest", "consultation", "waiting", "observation", "registration", "admission",
  ] as const
  ```

  `registration-track-editor.tsx`의 shell call site도 다음 구조로 고정해 observation을 registration prop 안에 중첩하거나 임의 카드로 추가하지 않는다.

  ```tsx
  <RegistrationApplicationShell
    inquiry={inquirySection}
    levelTest={levelTestSection}
    consultation={consultationSection}
    waiting={waitingSection}
    observation={observationRuntime.available ? (
      <RegistrationObservationEditor
        trackId={track.id}
        workflowRevision={track.workflowRevision}
        observationRevision={observationDetail.currentObservation?.revision ?? null}
        appointmentNotificationRevision={observationDetail.currentObservation?.appointmentNotificationRevision ?? null}
        detail={observationDetail}
        actions={registrationObservationActions}
        onSaved={handleObservationSaved}
      />
    ) : undefined}
    registration={registrationSection}
    admission={admissionSection}
  />
  ```

  source test는 `observation=`이 정확히 한 번이고 `registration={registrationSection}`보다 앞에 있으며, runtime unavailable일 때 editor mount/load가 0회인지 검사한다.

  `registration-application-model.ts`의 section order에는 `observation`을 placement와 admission 사이의 독립 key로 추가한다. progress stepper/subject tabs도 같은 view key를 사용한다.

- [ ] **Step 4: list summary와 runtime wiring을 구현한다**

  `registration-case-list-model.ts`는 세 workflow 상태를 observation tab으로 모으고 scalar summary만 사용해 `예약 필요 | 청강 예약 | 교사 피드백 대기 | 청강 완료`를 결정한다. nearest date/place 한 건 외 history/feedback/textbook/progress를 list에 넣지 않는다.

  `ops-task-workspace.tsx`는 authenticated workspace 진입 때 observation runtime probe를 주입한다. unavailable/version0이면 observation entry/tab/action을 숨기고 기존 consultation→enrollment 동선을 유지한다. probe 실패를 runtime0로 오인하지 않고 기존 오류 표면에 전달한다.

- [ ] **Step 5: booking-only editor를 구현한다**

  `RegistrationObservationEditor` props는 `trackId`, workflow/observation/appointment revisions, `detail`, service actions, `onSaved`만 받는다. 상담 완료 또는 waiting에서는 `청강 진행`으로 enter RPC를 호출한다. observation requested에서는 반을 먼저 선택한 뒤에만 최대 120일 session RPC를 호출한다. 선택 회차의 teacher/classroom/campus/textbooks/progress는 read-only로 보이고 missing/ambiguous prerequisite는 해당 필드 아래 한 문장 오류와 disabled 저장으로 처리한다.

  신규 저장은 workflow revision만, 변경은 notification+observation revisions만 전송한다. 취소는 두 revision을 전송하고 성공 뒤 예약 필요 상태를 보인다. 철회 dialog는 `return_to_previous` 또는 explicit director target을 선택하고 일반 경로에는 decision revisions를 보내지 않는다. detail이 최신 `re_observation` correction 조건을 명시할 때만 exact decision ID/revisions를 보낸다.

  저장 confirmation 뒤 mutation 구간만 saving 상태로 잠그고 실패 시 선택값을 유지한다. 성공 표시는 `예약 저장됨`과 `고객 안내: 미발송`을 별도 행으로 렌더링한다. customer send button, provider 성공 badge, attendance/feedback/decision controls는 만들지 않는다. completed/feedback-pending 상태는 core에서 read-only status만 표시한다.

- [ ] **Step 6: track editor orchestration과 refresh를 연결한다**

  `registration-track-editor.tsx`의 기존 generic `changeWorkflowStatus`는 observation source/target을 받지 않도록 model guard를 둔다. shell의 observation prop에 editor를 전달하고 성공 시 manager detail과 fixed summary generation을 갱신한다. 다른 subject track의 선택/dirty state는 보존한다. 320px, 200% zoom에서 반→회차→저장 순서와 focus return을 기존 Dialog/Button primitives로 유지한다.

- [ ] **Step 7: Task 6 GREEN 및 commit**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-workspace.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  pnpm eslint src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-application-shell.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-subject-tabs.tsx src/features/tasks/registration-application-progress-stepper.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-workflow-status.js src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-case-list-model.ts src/features/tasks/registration-case-list.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-observation-workspace.test.mjs
  pnpm tsc --noEmit --pretty false
  git diff --check
  ```
  Expected: shell/order/runtime/list/editor/revision tests가 PASS하고 source scan에서 provider/feedback/decision mutation 연결은 0건이다.

  ```bash
  git add src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-application-shell.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-subject-tabs.tsx src/features/tasks/registration-application-progress-stepper.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-workflow-status.js src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-case-list-model.ts src/features/tasks/registration-case-list.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-observation-workspace.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  git commit -m "feat: add observation booking workspace"
  ```

---

### Task 7: Core 경계와 최종 회귀를 고정한다

**Files:** Modify `tests/registration-observation-schema.test.mjs`, `tests/registration-observation-booking.test.mjs`, `tests/registration-observation-workspace.test.mjs` only if a reproduced gap needs an assertion; no production interface is added in this task.

**Reviewer gate:** clean apply, focused pgTAP, TypeScript/UI regressions, boundary scan이 모두 같은 commit set에서 통과해야 한다.

- [ ] **Step 1: spec/interface coverage test를 실행한다**

  ```bash
  rg -n "reminder_due|feedback_due|google_chat|solapi|submit_registration_observation_feedback|decide_registration_observation" supabase/migrations/20260809100000_registration_observation_core_schema.sql supabase/migrations/20260809101000_registration_observation_reads.sql supabase/migrations/20260809102000_registration_observation_booking.sql src/features/tasks/registration-observation-editor.tsx
  rg -n "create or replace function (public|dashboard_private)\.(enter|save|cancel|withdraw)_registration_observation" supabase/migrations
  ```

  Expected: 첫 scan은 frozen comments/type names 외 executable provider/due/feedback/decision 구현 0건, 두 번째는 core migration의 각 public/private 함수 정의 한 건씩만 출력한다.

- [ ] **Step 2: DB를 마지막으로 clean apply한다**

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus schema
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus booking
  ```
  Expected: 두 isolated run 모두 exact `start→reset→committed setup→pgTAP→cleanup/fresh runtime0→stop` lifecycle로 PASS하고 runtime default 0, fixture 잔여 0, provider 호출 0, schema focus ceiling 101000/read-only와 booking ceiling 102000/mutations가 독립적으로 재현된다.

- [ ] **Step 3: core 전체 회귀를 실행한다**

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-*.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  pnpm eslint scripts/run-registration-observation-local-db-qa.mjs src/features/tasks/registration-observation-*.ts src/features/tasks/registration-observation-editor.tsx
  pnpm tsc --noEmit --pretty false
  pnpm build
  git diff --check
  ```
  Expected: test/lint/typecheck/build 모두 exit 0이다. build 성공은 DB apply/runtime activation/provider activation 증거로 보고하지 않는다.

- [ ] **Step 4: activation 전 운영 증거를 기록한다**

  Core 단독 완료 시 authenticated admin readiness JSON은 downstream feedback/enrollment object를 `missingObjects`로 보고 `schemaReady=false`, `runtimeVersion=0`이어야 한다. 이 계획에서는 production activation을 호출하지 않는다. Plan 2 enrollment focus가 full readiness와 실제 admin activation 0→1/concurrency/replay를 증명한 뒤에만 master rollout Gate B로 넘긴다. private runtime table 직접 UPDATE는 pgTAP rollback transaction 밖에서 금지하고, production apply, UI cutover, campus backfill, provider enable은 각각 별도 증거로 남긴다.

- [ ] **Step 5: final reviewer gate와 commit**

  reproduced gap 때문에 test를 추가했다면 그 test만 stage한다. 변경이 없다면 빈 commit을 만들지 않는다.
  ```bash
  git status --short
  git diff --check
  ```

## Final verification matrix

| Requirement | Owning evidence |
|---|---|
| exact schema/check/index/FK/RLS/ACL | Task 1 schema pgTAP |
| readiness independent of runtime + premature activation rejection + mutation runtime guard | Task 1 pgTAP, Task 5 probe/service test |
| full-readiness atomic admin activation concurrency/replay | feedback/enrollment Plan Task 6 enrollment pgTAP |
| explicit classroom campus management without name inference | Task 2 payload/UI tests |
| normalized/legacy key priority, `normal→active`, selected-session-only hash, teacher/profile/campus prerequisites | Task 3 resolver pgTAP |
| revision-only/content drift bounded refresh vs booking-fact `source_dirty` | Task 3 resolver pgTAP + Task 4 mutation contract |
| manager-only bounded detail, >50 history와 독립적인 exact single-attempt lookup, transactionally maintained attempt scalar, max-one open row | Task 1/3 pgTAP + Task 5 service test |
| first-screen O(1) plan: no history aggregate/scan, actual rows/loops/buffers ceilings | Task 3 10k/20k fixture EXPLAIN JSON assertions |
| request ledger, exact signatures/revision combinations, global lock order | Task 4 pgTAP + source contract |
| booking/reschedule/cancel/withdraw and generic transition guard | Task 4 pgTAP |
| stable domain event seam; no provider/due implementation | Task 1 schema + Task 4 events + Task 7 boundary scan |
| strict TS model, 12s abort, no retry, runtime probe | Task 5 Node tests |
| list/detail booking UI and explicit application shell order | Task 6 UI/model tests |
| teacher feedback/decision/enrollment/Google Chat/SOLAPI remain downstream | frozen interfaces + Task 7 boundary scan |
