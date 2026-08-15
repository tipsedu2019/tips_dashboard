# SOLAPI Verification Evidence Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 SOLAPI 7종의 미리보기와 실제 공급자 요청이 동일했음을 비식별 증빙으로 보존하고, 검증용 등록 업무와 메시지를 삭제해도 해당 유형의 `live` 활성 상태가 유지되게 한다.

**Architecture:** 검증 중에는 기존 `verification_task_id`와 수신번호 해시로 한 유형의 발송 범위를 제한한다. 성공 발송과 수신 확인 뒤에는 공개 업무/메시지 행을 참조하지 않는 `dashboard_private.registration_customer_solapi_activation_evidence` 스냅샷을 생성하고, `live` 활성 행은 이 증빙만 참조한다. SOLAPI SDK 호출 직전의 정규화 요청을 한 번 만들고 SHA-256 체크섬을 계산하여, 같은 요청 객체를 실제 HTTP 본문과 증빙에 사용한다.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Node test runner, Supabase Postgres/PLpgSQL/pgTAP, SOLAPI REST API, Vercel.

## Global Constraints

- 실제 SOLAPI 발송은 7종 미리보기를 사용자에게 제시하고 별도 최종 승인을 받은 뒤에만 실행한다.
- 검증 번호는 실행 중에만 사용한다. 저장소, 증빙 테이블, 업무 이력, 문서, 테스트 fixture, 로그에는 평문 번호를 남기지 않는다.
- 증빙에는 학생명, 본문, 버튼 원문, 등록 업무 UUID, 공개 메시지 UUID를 저장하지 않는다. 체크섬과 공급자 식별자만 저장한다.
- 기존 운영 이벤트를 소급 발송하지 않는다. `observation_reminder`의 기준 시각은 새 증빙으로 `live` 전환한 시각이다.
- 한 유형의 템플릿/버튼/고정 문구/변수 구조/템플릿 ID가 바뀌면 그 유형만 차단·재검증한다. 일반 변수값 변화는 재검증 사유가 아니다.
- DB 마이그레이션 파일은 임의 타임스탬프로 만들지 않는다. 구현 시 저장소의 Supabase CLI로 `supabase migration new registration_customer_solapi_activation_evidence`를 실행해 생성된 `supabase/migrations/*_registration_customer_solapi_activation_evidence.sql`을 사용한다.
- 각 작업은 RED 확인, 최소 구현, GREEN 확인, 커밋 순서로 진행한다.

---

### Task 1: 공급자 요청을 단일 정규화 객체로 고정하고 체크섬을 반환한다

**Files:**

- Modify: `src/features/tasks/server/registration-customer-message-solapi.ts`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Test: `tests/registration-customer-message-solapi.test.mjs`
- Test: `tests/registration-customer-message-route.test.mjs`

- [ ] **Step 1: 최종 SOLAPI 요청 일치 계약의 실패 테스트를 작성한다**

  `tests/registration-customer-message-solapi.test.mjs`에 다음을 검증하는 테스트를 추가한다.

  - 정규화된 요청은 `messages[0].to`, `type`, `kakaoOptions.pfId`, `templateId`, `disableSms`, `variables`, 정규화된 buttons, `customFields.registrationRequestKey`, 최상위 `strict`, `allowDuplicates`, `showMessageList`를 정확히 포함한다.
  - `providerPayloadChecksum`은 64자리 소문자 SHA-256이고, HTTP `body`로 전송된 JSON을 키 정렬 canonical JSON으로 계산한 값과 같다.
  - 수신번호, 변수, 버튼, 템플릿 ID, PF ID, request key 중 하나라도 바뀌면 체크섬이 달라진다.
  - 같은 의미의 입력은 매번 같은 체크섬을 만든다.
  - `accepted` 결과에는 체크섬이 반드시 존재하고, 네트워크 오류 결과에도 호출을 시도한 요청의 체크섬이 유지된다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test --experimental-strip-types tests/registration-customer-message-solapi.test.mjs`

  Expected: `providerPayloadChecksum`과 단일 요청 빌더가 아직 없어 새 테스트가 실패한다.

- [ ] **Step 3: 정규화 요청 빌더와 결과 타입을 최소 구현한다**

  `registration-customer-message-solapi.ts`에 다음 계약을 추가한다.

  ```ts
  export type RegistrationCustomerMessageProviderResult = Readonly<{
    outcome: ProviderOutcome
    evidence: RegistrationCustomerMessageProviderEvidenceInput
    providerPayloadChecksum: string | null
  }>

  export function buildRegistrationCustomerMessageSolapiPayload(
    input: SendInput,
    pfId: string,
  ): Readonly<{ payload: JsonRecord; checksum: string }>
  ```

  빌더는 정렬 canonical JSON과 SHA-256을 사용한다. `send()`는 빌더가 만든 `payload`를 그대로 `JSON.stringify`하여 한 번만 전송하고 정상·공급자 거부·네트워크 오류 반환 경로에 같은 `checksum`을 넣는다. provider adapter 자체가 요청 객체를 만들기 전에 예외를 던진 방어 경로만 null을 허용하며, 이 결과는 절대 `accepted`가 될 수 없다. 인증 헤더와 타임아웃 값은 체크섬 대상에서 제외한다.

- [ ] **Step 4: 라우트가 체크섬을 DB finalize 경계까지 전달하는 실패 테스트를 쓴다**

  `tests/registration-customer-message-route.test.mjs`에서 `sendProvider`가 반환한 체크섬이 `finalizeMessage({ providerPayloadChecksum })`에 그대로 전달되는지, 공급자 호출 전 실패에는 finalize가 호출되지 않는지, 예외 fallback 결과는 `accepted`로 오인되지 않는지 검증한다.

- [ ] **Step 5: RED를 확인한다**

  Run: `node --test --experimental-strip-types tests/registration-customer-message-route.test.mjs`

  Expected: 현재 `RouteDependencies.finalizeMessage`에 체크섬 필드가 없어 새 assertion이 실패한다.

- [ ] **Step 6: 라우트 전달 타입과 RPC 인자를 최소 구현한다**

  `RouteDependencies.finalizeMessage`에 `providerPayloadChecksum: string | null`을 추가하고 `finalize_registration_customer_message_v1` 호출의 `p_provider_payload_checksum`으로 전달한다. `accepted`에는 non-null checksum을 강제하고, 예외 fallback은 null checksum의 `unknown`으로만 finalize한다. public 응답에는 체크섬이나 공급자 payload를 추가하지 않는다.

- [ ] **Step 7: 단위 테스트를 GREEN으로 만든다**

  Run: `node --test --experimental-strip-types tests/registration-customer-message-solapi.test.mjs tests/registration-customer-message-route.test.mjs`

  Expected: PASS, provider 호출 횟수는 기존과 동일하고 민감정보 public payload 검사가 계속 통과한다.

- [ ] **Step 8: 커밋한다**

  ```bash
  git add src/features/tasks/server/registration-customer-message-solapi.ts src/features/tasks/server/registration-customer-message-route.ts tests/registration-customer-message-solapi.test.mjs tests/registration-customer-message-route.test.mjs
  git commit -m "feat: bind SOLAPI sends to payload checksums"
  ```

### Task 2: 비공개 불변 증빙 스키마와 live 활성 행 형태를 추가한다

**Files:**

- Create via Supabase CLI: `supabase/migrations/*_registration_customer_solapi_activation_evidence.sql`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`

- [ ] **Step 1: Supabase CLI로 마이그레이션 파일을 생성한다**

  Run: `/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_customer_solapi_activation_evidence`

  Expected: 저장소 다음 순번의 빈 `*_registration_customer_solapi_activation_evidence.sql`이 생성된다. 생성된 정확한 파일명을 이후 명령에 사용한다.

- [ ] **Step 2: 스키마 실패 테스트를 먼저 작성한다**

  `tests/registration-customer-solapi-db.test.mjs`와 pgTAP에 다음 계약을 추가한다.

  - `dashboard_private.registration_customer_solapi_activation_evidence`에 `id`, 7종 `message_kind`, `template_id`, `pf_id`, 5개 체크섬(`template`, `rendered_variables`, `rendered_body`, `rendered_buttons`, `provider_payload`), `recipient_hash`, `provider_message_id`, `provider_status_code`, `verified_at`, `verified_by`, `created_at`이 존재한다.
  - 모든 체크섬과 수신번호 해시는 정확히 64자리 소문자 hex이며 공급자 ID/상태는 빈 문자열을 거부한다.
  - 테이블에는 task/message UUID, 평문 전화번호, 학생명, 본문/버튼/변수 JSON, 원본 공급자 response가 없다.
  - RLS가 켜져 있고 `PUBLIC`, `anon`, `authenticated`, `service_role` 직접 권한이 모두 철회된다.
  - 활성 행은 `verification`일 때만 임시 `verification_task_id`와 `verification_recipient_hash`를 가지며, `live`일 때는 둘을 비우고 `activation_evidence_id`만 가진다.
  - `verification_task_id`의 `ops_tasks` 외래키와 `live_test_message_id`의 공개 메시지 외래키가 제거된다.
  - `off`는 증빙을 보존할 수 있으나 발송 권한을 부여하지 않는다.

- [ ] **Step 3: RED를 확인한다**

  Run: `node --test tests/registration-customer-solapi-db.test.mjs`

  Expected: 새 테이블과 새 활성 행 제약이 없어 실패한다.

- [ ] **Step 4: 테이블과 제약을 최소 구현한다**

  생성된 migration 안에서 다음 순서를 지킨다.

  1. 새 증빙 테이블과 인덱스를 만든다.
  2. `ops_registration_customer_messages.provider_payload_checksum` nullable 컬럼과 64-hex 제약을 추가한다.
  3. 활성 테이블에 `activation_evidence_id`를 추가하고 비공개 증빙 FK를 건다.
  4. 기존 활성 shape constraint와 공개 task/message FK를 제거한다.
  5. `live_test_message_id`, `live_test_confirmed_at`을 제거하고 새 mode별 shape constraint를 건다.
  6. 모든 신규 객체의 owner, RLS, revoke를 명시한다.

  현재 7종이 모두 `off`이므로 기존 행을 `live`나 새 증빙으로 backfill하지 않는다.

- [ ] **Step 5: 구조 테스트를 GREEN으로 만든다**

  Run: `node --test tests/registration-customer-solapi-db.test.mjs`

  Expected: PASS.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add supabase/migrations/*_registration_customer_solapi_activation_evidence.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
  git commit -m "feat: add private SOLAPI activation evidence"
  ```

### Task 3: finalize·수신확인·활성화 RPC를 새 증빙 계약으로 전환한다

**Files:**

- Modify: `supabase/migrations/*_registration_customer_solapi_activation_evidence.sql`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`
- Modify: `src/features/tasks/registration-customer-message-rollout.ts`
- Test: `tests/registration-customer-message-rollout.test.mjs`

- [ ] **Step 1: RPC 동작 실패 테스트를 먼저 작성한다**

  SQL 정적 계약과 pgTAP에서 다음을 검증한다.

  - `finalize_registration_customer_message_v1`은 nullable `p_provider_payload_checksum text`를 받고, 공급자 시도 행에 체크섬을 원자적으로 기록한다.
  - `accepted` finalize는 체크섬 누락/오형식을 거부한다.
  - `record_registration_customer_solapi_live_test_receipt_v1`은 `verification` 모드의 accepted 메시지, 현재 유형/임시 task/수신 해시, 현재 template receipt, 4개 렌더링 체크섬, 공급자 payload 체크섬, 공급자 message ID를 검증한 후 새 비식별 증빙을 만든다.
  - 증빙 행은 공개 task/message FK를 만들지 않는다.
  - 같은 request key replay는 같은 증빙 ID를 반환하고, 다른 내용의 replay는 충돌한다.
  - `set_registration_customer_solapi_activation_v1(..., 'live', ...)`는 현재 유형·템플릿·PF·catalog checksum과 일치하는 증빙 없이는 실패한다.
  - live 전환은 `activation_evidence_id`를 설정하고 임시 verification scope를 null로 지운다.
  - off→live 건너뛰기, 다른 유형 증빙 재사용, drifted 증빙 사용을 거부한다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/registration-customer-solapi-db.test.mjs tests/registration-customer-message-rollout.test.mjs`

  Expected: 기존 RPC가 공개 메시지 FK와 `live_test_message_id`를 요구하여 실패한다.

- [ ] **Step 3: RPC를 최소 구현한다**

  새 migration에서 최신 공개 함수 시그니처와 권한을 명시적으로 교체한다.

  - `public.finalize_registration_customer_message_v1`
  - `public.record_registration_customer_solapi_live_test_receipt_v1`
  - `public.set_registration_customer_solapi_activation_v1`

  수신 확인 RPC의 public 반환은 `{ recorded, messageKind, evidenceId, receivedAt }`처럼 비식별 값만 허용한다. `ops_registration_mutations`의 request key idempotency는 유지한다.

- [ ] **Step 4: rollout 액션을 증빙 ID 기반으로 바꾸고 테스트한다**

  `registration-customer-message-rollout.ts`에서 `record_receipt_and_live`가 수신 확인 결과의 `evidenceId`를 live 전환 evidence에 전달하게 한다. 공개 업무 UUID나 메시지 UUID를 live 전환 evidence에 다시 넣지 않는다.

- [ ] **Step 5: RPC·rollout 테스트를 GREEN으로 만든다**

  Run: `node --test tests/registration-customer-solapi-db.test.mjs tests/registration-customer-message-rollout.test.mjs`

  Expected: PASS.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add supabase/migrations/*_registration_customer_solapi_activation_evidence.sql supabase/tests/registration_customer_solapi_messages_test.sql tests/registration-customer-solapi-db.test.mjs src/features/tasks/registration-customer-message-rollout.ts tests/registration-customer-message-rollout.test.mjs
  git commit -m "feat: activate SOLAPI from immutable evidence"
  ```

### Task 4: 수동·예약 발송 게이트를 증빙 기반으로 통일한다

**Files:**

- Modify: `supabase/migrations/*_registration_customer_solapi_activation_evidence.sql`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`
- Modify: `supabase/tests/registration_observation_solapi_dispatch_test.sql`
- Modify: `tests/registration-observation-solapi-db.test.mjs`

- [ ] **Step 1: 게이트 실패 테스트를 먼저 작성한다**

  다음 행위를 SQL 정적 테스트와 pgTAP에 추가한다.

  - `verification`: 임시 task와 수신 해시가 정확히 일치하는 검증 발송만 허용한다.
  - `live`: 현재 activation evidence의 유형, template ID, PF ID, template checksum이 현재 template receipt와 일치할 때만 허용한다.
  - 공개 검증 메시지 행을 삭제한 뒤에도 수동 발송 readiness와 예약 worker gate가 `live`를 유지한다.
  - 테스트 task를 삭제한 뒤에도 activation evidence와 `live`가 유지된다.
  - 현재 receipt checksum을 한 유형에서만 변경하면 해당 유형은 `template_drift`로 막히고 다른 여섯 유형은 유지된다.
  - `off`는 과거 증빙이 남아 있어도 발송을 막는다.
  - `observation_reminder`는 새 live 전환 이전 domain event/job을 발송하지 않는다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/registration-customer-solapi-db.test.mjs tests/registration-observation-solapi-db.test.mjs`

  Expected: 최신 readiness와 reminder 함수가 `live_test_message_id`를 조회하여 삭제 후 실패한다.

- [ ] **Step 3: 공통 증빙 검증 helper와 최신 함수들을 교체한다**

  migration에 비공개 helper를 추가한다.

  ```sql
  dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    p_message_kind text,
    p_template_id text,
    p_pf_id text,
    p_template_checksum text
  ) returns boolean
  ```

  helper는 activation row와 evidence row를 직접 비교하며 public 메시지/task를 조회하지 않는다. 다음 최신 함수가 이 helper를 사용하게 다시 정의한다.

  - `dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1`
  - `public.get_registration_customer_solapi_readiness_v1`
  - `public.claim_registration_customer_reminder_job_v1`
  - `public.begin_registration_customer_reminder_dispatch_v1`

  observation의 verification 분기에서는 임시 scope를 계속 사용하고, live 분기에서는 증빙과 `automatic_delivery_cutoff_at`만 사용한다. 함수 owner/revoke/grant를 모두 재적용한다.

- [ ] **Step 4: pgTAP과 정적 테스트를 GREEN으로 만든다**

  Run: `node --test tests/registration-customer-solapi-db.test.mjs tests/registration-observation-solapi-db.test.mjs`

  Expected: PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add supabase/migrations/*_registration_customer_solapi_activation_evidence.sql supabase/tests/registration_customer_solapi_messages_test.sql supabase/tests/registration_observation_solapi_dispatch_test.sql tests/registration-customer-solapi-db.test.mjs tests/registration-observation-solapi-db.test.mjs
  git commit -m "fix: gate SOLAPI delivery with private evidence"
  ```

### Task 5: 관리자 API 계약과 민감정보 비노출을 고정한다

**Files:**

- Modify: `src/features/tasks/registration-customer-message-contract.ts`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/registration-customer-message-rollout.ts`
- Modify: `tests/registration-customer-message-contract.test.mjs`
- Modify: `tests/registration-customer-message-route.test.mjs`
- Modify: `tests/registration-customer-message-rollout.test.mjs`

- [ ] **Step 1: 관리자 흐름 실패 테스트를 작성한다**

  - verification 진입에는 임시 task ID가 필요하다.
  - receipt 기록 결과의 evidence ID만 live 전환에 사용한다.
  - live 전환 요청은 verification task/message ID를 받거나 전송하지 않는다.
  - 응답에는 evidence ID를 제외한 recipient hash, provider payload checksum, provider message ID, template/PF ID가 노출되지 않는다.
  - 한 유형 실패가 다른 유형의 활성화 요청을 취소하거나 묶지 않는다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test --experimental-strip-types tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-message-rollout.test.mjs`

  Expected: 기존 live action이 공개 message/task 기반이라 실패한다.

- [ ] **Step 3: contract parser, route adapter, rollout을 최소 수정한다**

  `record_live_test_receipt`는 기존 message ID와 수신 확인 시각을 입력으로 받되, 결과의 증빙 ID만 다음 live 전환에 전달한다. `set_activation`의 live evidence는 `requestKey`, 현재 template/PF/catalog checksum, `activationEvidenceId`만 포함한다. `off`와 `verification` 입력 형식은 기존 안전장치를 유지한다.

- [ ] **Step 4: API 테스트를 GREEN으로 만든다**

  Run: `node --test --experimental-strip-types tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-message-rollout.test.mjs`

  Expected: PASS, public payload forbidden-field 검사도 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add src/features/tasks/registration-customer-message-contract.ts src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/registration-customer-message-rollout.ts tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-message-rollout.test.mjs
  git commit -m "refactor: decouple SOLAPI activation API evidence"
  ```

### Task 6: 로컬 DB 회귀·전체 빌드·배포 전 증빙을 닫는다

**Files:**

- Modify: `scripts/run-registration-observation-local-db-qa.mjs`
- Modify: `tests/registration-observation-local-db-runner.test.mjs`
- Verify unchanged baseline: `scripts/run-registration-customer-solapi-local-db-qa.mjs`
- Verify unchanged baseline: `tests/registration-customer-solapi-local-db-qa.test.mjs`
- Modify: `docs/superpowers/specs/2026-08-16-solapi-verification-evidence-design.md`

- [ ] **Step 1: 로컬 runner가 새 migration과 삭제 회귀를 포함하는 실패 테스트를 작성한다**

  observation runner의 `FOCUS_REGISTRY`에 `solapi-evidence` focus를 추가한다. ceiling은 CLI가 생성한 migration version이고, 기존 `solapi` migration/test 묶음에 새 evidence migration, `registration_customer_solapi_messages_test.sql`, `registration_observation_solapi_dispatch_test.sql`을 추가한다. synthetic DB에서 `verification → evidence → live → 공개 message/task 삭제 → live 유지` 시나리오를 실행하며 provider 호출 횟수는 0이어야 한다. 기존 customer SOLAPI runner는 새 migration 이전 baseline 전용으로 계속 통과해야 한다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/registration-customer-solapi-local-db-qa.test.mjs tests/registration-observation-local-db-runner.test.mjs`

  Expected: `solapi-evidence` focus가 아직 없어 실패한다.

- [ ] **Step 3: runner 목록과 안전 검사를 최소 수정한다**

  loopback 전용, production 환경변수 거부, provider-zero, synthetic rows only 조건을 유지한다. 새 focus만 generated migration version까지 선택하고 다른 focus의 ceiling이나 fixture는 바꾸지 않는다.

- [ ] **Step 4: 대상 단위 테스트 전체를 실행한다**

  Run:

  ```bash
  node --test --experimental-strip-types \
    tests/registration-customer-message-contract.test.mjs \
    tests/registration-customer-message-rollout.test.mjs \
    tests/registration-customer-message-route.test.mjs \
    tests/registration-customer-message-solapi.test.mjs \
    tests/registration-customer-solapi-db.test.mjs \
    tests/registration-customer-solapi-local-db-qa.test.mjs \
    tests/registration-observation-solapi-db.test.mjs \
    tests/registration-observation-local-db-runner.test.mjs
  ```

  Expected: PASS.

- [ ] **Step 5: 실제 격리 DB pgTAP을 실행한다**

  Run: `pnpm verify:registration-customer-message:isolated-db -- --execute --approved-local-db`

  Run: `pnpm verify:registration-observation:local-db -- --execute --approved-local-db --focus solapi-evidence`

  Expected: loopback DB에서 PASS, 외부 provider 호출 0, 임시 컨테이너 정리 완료.

- [ ] **Step 6: lint와 production build를 실행한다**

  Run: `pnpm lint`

  Run: `pnpm build`

  Expected: PASS. `pnpm build`에는 추가 webpack 인자를 붙이지 않는다.

- [ ] **Step 7: placeholder와 타입 일관성을 자체 검토한다**

  Run: `rg -n "TODO|FIXME|placeholder|similar to|\.\.\." src/features/tasks/server/registration-customer-message-solapi.ts src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/registration-customer-message-contract.ts src/features/tasks/registration-customer-message-rollout.ts supabase/migrations/*_registration_customer_solapi_activation_evidence.sql tests/registration-customer-* tests/registration-observation-solapi-db.test.mjs`

  Expected: 구현 누락을 뜻하는 결과 0건. 이어서 설계 문서의 모든 테스트·완료 조건을 체크하고, 변경된 TypeScript 함수의 호출자/반환 타입과 SQL 함수 시그니처의 revoke/grant가 일치하는지 검토한다.

- [ ] **Step 8: 설계 문서에 구현 파일과 검증 결과를 연결하고 커밋한다**

  ```bash
  git add scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs docs/superpowers/specs/2026-08-16-solapi-verification-evidence-design.md
  git commit -m "test: verify deletable SOLAPI activation evidence"
  ```

### Task 7: 배포 후 7종 검증은 사용자 최종 승인 경계에서 수행한다

**Files:**

- No repository changes unless a defect is found.

- [ ] **Step 1: 소스·테스트 게이트를 보고한다**

  구현 커밋, 대상 테스트, 격리 pgTAP, lint, build 결과를 각각 분리해 보고한다.

- [ ] **Step 2: 사용자 승인 후에만 main과 Production에 배포한다**

  main push, Supabase migration 성공, Vercel Production `READY`, production HTTP/browser smoke를 별도 게이트로 확인한다. migration 실패 시 SOLAPI 모드를 바꾸지 않는다.

- [ ] **Step 3: 실제 발송 없이 7종 미리보기를 생성해 제시한다**

  수신 대상은 `010-****-8607`로만 표시한다. 각 항목에 메시지 유형, 템플릿 버전, 본문, 버튼을 제시하고 공급자 요청 체크섬은 내부 비교에만 사용한다.

- [ ] **Step 4: 사용자의 최종 발송 승인을 기다린다**

  이 체크박스 전에는 SOLAPI send API를 호출하지 않는다.

- [ ] **Step 5: 승인 후 유형별로 독립 검증한다**

  각 유형을 `verification`으로 전환하고 승인된 미리보기 1건만 발송한다. provider accepted, 사용자 수신 확인, evidence 기록, live 전환을 유형별로 분리한다. 실패한 유형은 `verification` 또는 `off`에 남기며 다른 성공 유형을 되돌리지 않는다.

- [ ] **Step 6: 임시 데이터 삭제와 유지 증빙을 확인한다**

  7종 live가 확인된 뒤 검증용 공개 메시지와 임시 등록 업무를 삭제한다. 이어서 증빙 7행, activation 7종 live, test task/message 0행, observation cutoff, 신규 이벤트만 자동 발송 대상임을 read-only 쿼리로 확인한다.

- [ ] **Step 7: 완료 게이트를 분리 보고한다**

  `소스/테스트 → migration → main/Vercel → runtime/worker → SOLAPI provider accepted → 사용자 실제 수신` 순서로 증빙을 분리한다. provider accepted만으로 사용자 수신까지 완료했다고 보고하지 않는다.
