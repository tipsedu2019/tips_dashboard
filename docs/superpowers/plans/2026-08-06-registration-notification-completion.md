# Registration Notification Completion Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Follow `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before reporting completion.

**Goal:** 등록 관리팀 Google Chat 알림을 복구하고, 알림 설정의 한국어 변수·미리보기와 공통 링크 버튼, 고객 알림톡 발송 감사·프로세스 단위 중복 잠금을 완성한다.

**Architecture:** 기존 notification control plane과 SOLAPI claim/finalize state machine을 유지한다. 사용자 편집 경계에서만 한국어 변수 별칭을 영문 저장 키로 변환하고, Google Chat provider는 모든 workflow에 공통 `cardsV2` payload를 만든다. 등록 이벤트는 새 콘텐츠 계약·canonical 규칙으로 추가하며, 고객 알림톡은 DB의 의미 기반 dedupe와 불변 발송자 이름 snapshot을 source of truth로 삼는다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase PostgreSQL/pgTAP, Google Chat incoming webhook, SOLAPI AlimTalk

---

## Task 1: Google Chat 공통 링크 버튼 카드

**Files:**

- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
- Modify: `tests/notification-google-chat-content.test.mjs`
- Modify: `tests/notification-content-no-send-qa.test.mjs`

### Step 1: 실패하는 provider 계약 테스트 작성

다음을 검증한다.

- payload가 `cardsV2`를 포함한다.
- 제목과 본문에는 raw URL이 없다.
- 버튼 텍스트는 `대시보드에서 보기`다.
- `openLink.url`만 allowlist를 통과한 절대 URL을 가진다.
- 본문 `<`, `>`, `&`, 따옴표는 HTML escape 된다.
- 직렬화된 payload가 32KB를 넘으면 provider 호출 전에 실패한다.

Run:

```bash
node --test --experimental-strip-types tests/notification-google-chat-content.test.mjs tests/notification-content-no-send-qa.test.mjs
```

Expected: 기존 `{ text }` payload 때문에 FAIL.

### Step 2: 최소 카드 builder 구현

`buildGoogleChatTextPayload`를 공통 카드 payload builder로 교체하되 기존 링크 allowlist와 transport 오류 상태 기계는 유지한다. provider fetch body는 builder가 반환한 JSON 객체를 직렬화한다.

### Step 3: 집중 테스트 실행

Run the Step 1 command.

Expected: PASS, fake transport 호출만 기록되고 실제 provider 호출 0.

### Step 4: 커밋

```bash
git add src/features/notifications/server/providers/google-chat-provider.ts tests/notification-google-chat-content.test.mjs tests/notification-content-no-send-qa.test.mjs
git commit -m "feat: add Google Chat dashboard buttons"
```

## Task 2: 등록 관리팀 Google Chat 이벤트 4종

**Files:**

- Modify: `src/features/notifications/notification-content-manifest.ts`
- Modify: `src/features/notifications/notification-content-contract-registry.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Modify: `src/features/notifications/server/presentation/registration-notification-presentation.ts`
- Modify: `tests/notification-content-contract.test.mjs`
- Modify: `tests/notification-content-manifest.test.mjs`
- Modify: `tests/notification-content-contract-db.test.mjs`
- Modify: `tests/registration-notification-adapter.test.mjs`
- Modify: `tests/notification-google-chat-content.test.mjs`
- Modify: `tests/fixtures/notification-content-contracts.json`
- Modify: `tests/fixtures/notification-content-coverage-manifest.json`
- Modify: `tests/fixtures/notification-content-golden.json`
- Create: `supabase/migrations/20260806120000_registration_management_google_chat_events.sql`

### Step 1: 실패하는 콘텐츠 계약·adapter 테스트 작성

네 업무 의미를 검증한다.

- 상담 신청 → `registration.case_created`
- 상담 완료 → `registration.consultation_completed`
- 대기 신청 → `registration.waiting_transitioned`
- 등록 신청 → `registration.admission_started`

새 세 이벤트는 관리팀 Google Chat target, `taskId` deep link, 학생·과목·친절한 현재 상태를 렌더링해야 한다. raw status, UUID, 내부 경로는 본문에 없어야 한다.

Run:

```bash
node --test --experimental-strip-types tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-google-chat-content.test.mjs
```

Expected: 새 contract identity와 presentation이 없어 FAIL.

### Step 2: 앱 콘텐츠 계약과 presentation 구현

- 새 이벤트를 별도 canonical dispatch group으로 manifest에 추가한다.
- 필수 토큰은 `학생`, `과목`, `현재상태`로 제한한다.
- presentation은 이벤트별 한국어 상태 문구를 생성한다.
- registration adapter의 presentation event set과 schema validation에 새 이벤트를 포함한다.

### Step 3: DB 마이그레이션 구조 테스트 작성

마이그레이션이 다음을 수행하는지 구조적으로 검증한다.

- 새 event registry label·sort order 추가
- 새 content contract JSON 추가
- 관리팀 Google Chat rule/template 생성
- `registration.case_created` 라벨을 `상담 신청`으로 정비
- 과거 event backfill이나 runtime flag 활성화를 수행하지 않음

Run:

```bash
node --test --experimental-strip-types tests/notification-content-contract-db.test.mjs
```

Expected: migration이 없어 FAIL.

### Step 4: additive migration 작성

기존 deterministic UUID/checksum helper를 사용해 idempotent하게 registry, contract, rule, template을 추가한다. 새 규칙은 활성 상태로 준비하되 runtime dispatch flag는 건드리지 않는다.

### Step 5: fixture와 golden message 갱신

계약·coverage·golden fixture를 새 네 이벤트와 정확히 일치시킨다.

### Step 6: 집중 테스트 실행

Run the Step 1 and Step 3 commands.

Expected: PASS.

### Step 7: 커밋

```bash
git add src/features/notifications tests/notification-content-contract*.test.mjs tests/notification-content-manifest.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-google-chat-content.test.mjs tests/fixtures/notification-content-*.json supabase/migrations/20260806120000_registration_management_google_chat_events.sql
git commit -m "feat: add registration management chat events"
```

## Task 3: 알림 설정 한국어 변수와 실시간 미리보기

**Files:**

- Create: `src/features/notifications/notification-template-editor-model.ts`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `tests/notification-control-plane-model.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `scripts/verify-notification-content-browser.mjs`

### Step 1: 실패하는 순수 모델 테스트 작성

다음을 검증한다.

- `{subjects}`가 화면에서 `{과목}`으로 보인다.
- `{과목}` 입력이 저장 draft에서 `{subjects}`로 돌아간다.
- 여러 변수와 중복 변수의 round trip이 안정적이다.
- 불완전한 `{과`는 강제로 바꾸지 않는다.
- 예시 preview가 제목·본문의 모든 허용 변수를 안전한 한국어 값으로 치환한다.
- 미상 변수는 preview 성공으로 위장하지 않는다.

Run:

```bash
node --test --experimental-strip-types tests/notification-control-plane-model.test.mjs tests/notification-control-plane-ui.test.mjs
```

Expected: editor model과 preview UI가 없어 FAIL.

### Step 2: editor model 최소 구현

콘텐츠 계약의 `{ key, token, piiClass }`만 사용해 양방향 변환과 결정론 예시 렌더링을 구현한다. 저장 모델의 영문 키와 checksum 계약은 바꾸지 않는다.

### Step 3: TemplateEditor 연결

- 제목·본문 input은 한국어 alias 값을 표시한다.
- onChange에서 내부 영문 key draft로 변환한다.
- 변수 badge는 `{과목}`처럼 한국어 하나만 표시한다.
- 같은 다이얼로그에 `알림 미리보기` 카드를 추가하고 편집 시 즉시 갱신한다.
- 미리보기임을 분명히 표시하고 실제 전송 동작은 추가하지 않는다.

### Step 4: 집중 테스트와 browser verifier 실행

Run:

```bash
node --test --experimental-strip-types tests/notification-control-plane-model.test.mjs tests/notification-control-plane-ui.test.mjs
node scripts/verify-notification-content-browser.mjs
```

Expected: PASS. browser verifier는 로컬 UI만 확인하고 provider 호출 0.

### Step 5: 커밋

```bash
git add src/features/notifications/notification-template-editor-model.ts src/features/notifications/notification-control-panel.tsx tests/notification-control-plane-model.test.mjs tests/notification-control-plane-ui.test.mjs scripts/verify-notification-content-browser.mjs
git commit -m "feat: preview notification templates in Korean"
```

## Task 4: 고객 알림톡 발송 감사와 프로세스 단위 1회 잠금

**Files:**

- Modify: `src/features/tasks/registration-customer-message-contract.ts`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Modify: `tests/registration-customer-message-contract.test.mjs`
- Modify: `tests/registration-customer-message-route.test.mjs`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`
- Create: `supabase/migrations/20260806121000_registration_customer_message_audit_dedupe.sql`

### Step 1: 실패하는 공개 계약·UI 테스트 작성

- send result와 operator history에 `confirmedByName`이 있어야 한다.
- 공개 payload allowlist가 이 필드만 추가로 허용해야 한다.
- preview dialog가 발송자와 KST 발송 요청 시각을 표시해야 한다.
- `duplicate_locked`면 기존 감사 정보와 함께 `확인 후 발송` 버튼이 disabled 상태여야 한다.

Run:

```bash
node --test --experimental-strip-types tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-route.test.mjs
```

Expected: `confirmedByName` 계약이 없어 FAIL.

### Step 2: 실패하는 DB 의미 잠금 테스트 작성

다음을 migration source와 pgTAP에서 검증한다.

- outbox가 `confirmed_by_name` snapshot을 저장한다.
- 같은 예약 버전은 한 번만 claim 된다.
- 예약 `source_revision` 증가 후 새 버전은 한 번 claim 된다.
- 대기·입학은 source fingerprint가 달라도 같은 source/customer면 잠긴다.
- 기존 outbox 행도 의미 기반 잠금 소유자로 인식된다.
- `unknown`, `failed_hold`도 잠금을 유지한다.

Run:

```bash
node --test --experimental-strip-types tests/registration-customer-solapi-db.test.mjs
```

Expected: 새 migration이 없어 FAIL.

### Step 3: additive audit/dedupe migration 작성

- `confirmed_by_name`을 기존 profile 이름으로 backfill한 뒤 non-null check를 건다.
- result/list RPC에 `confirmedByName`을 추가한다.
- readiness duplicate check와 claim RPC의 dedupe key/legacy lookup을 프로세스 의미 기준으로 교체한다.
- 기존 attempt marker, claim/finalize/reconcile, activation/template gate는 그대로 유지한다.

### Step 4: TypeScript 계약과 dialog 구현

응답 parser, allowlist, `toHistory`, KST formatter, 감사 문구를 추가한다. 중복 잠금 버튼 제어는 DB readiness를 source of truth로 유지한다.

### Step 5: 집중 테스트와 isolated DB QA 실행

Run:

```bash
node --test --experimental-strip-types tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-solapi-db.test.mjs tests/registration-customer-solapi-local-db-qa.test.mjs
npm run verify:registration-customer-message:isolated-db -- --execute --approved-local-db
```

Expected: 모든 계약·pgTAP PASS, SOLAPI provider 호출 0, disposable DB 정리 완료.

### Step 6: 커밋

```bash
git add src/features/tasks/registration-customer-message-contract.ts src/features/tasks/registration-alimtalk-preview-dialog.tsx tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql supabase/migrations/20260806121000_registration_customer_message_audit_dedupe.sql
git commit -m "feat: lock and audit registration customer messages"
```

## Task 5: 전체 회귀·브라우저 검증

**Files:**

- Modify if required: `scripts/verify-notification-content-browser.mjs`
- Modify if required: `scripts/verify-registration-customer-message-browser.mjs`

### Step 1: 집중 회귀 실행

```bash
node --test --experimental-strip-types \
  tests/notification-google-chat-content.test.mjs \
  tests/notification-content-contract.test.mjs \
  tests/notification-content-contract-db.test.mjs \
  tests/notification-content-manifest.test.mjs \
  tests/notification-control-plane-model.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/registration-notification-adapter.test.mjs \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-customer-solapi-db.test.mjs
```

Expected: PASS.

### Step 2: 정적 검증

```bash
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/eslint \
  src/features/notifications/server/providers/google-chat-provider.ts \
  src/features/notifications/notification-content-manifest.ts \
  src/features/notifications/notification-content-contract-registry.ts \
  src/features/notifications/notification-template-editor-model.ts \
  src/features/notifications/notification-control-panel.tsx \
  src/features/notifications/server/adapters/registration-notification-adapter.ts \
  src/features/notifications/server/presentation/registration-notification-presentation.ts \
  src/features/tasks/registration-customer-message-contract.ts \
  src/features/tasks/registration-alimtalk-preview-dialog.tsx
npm run build -- --webpack
git diff --check
```

Expected: PASS.

### Step 3: localhost 브라우저 QA

- `/admin/registration`: 레벨테스트 저장 확인 단계, 알림톡 미리보기, 중복 잠금·발송자·시각 표시
- `/admin/settings/notifications`: `{과목}` 편집, 실시간 미리보기, desktop/mobile overflow와 44px action target
- fake Google Chat payload: 네 등록 이벤트의 카드 본문과 버튼 경로

실제 Google Chat·SOLAPI 전송은 수행하지 않는다.

### Step 4: 최종 검증 커밋

검증 과정에서 verifier를 수정한 경우에만 커밋한다.

```bash
git add scripts/verify-notification-content-browser.mjs scripts/verify-registration-customer-message-browser.mjs
git commit -m "test: verify registration notification completion"
```

## Task 6: 로컬 완료 보고와 운영 전환 게이트

다음 증거를 분리해 보고한다.

- 선행 레벨테스트 저장 커밋
- 각 기능 커밋과 테스트 결과
- isolated DB 적용·pgTAP·cleanup 결과
- provider-zero 증거
- 아직 수행하지 않은 운영 DB migration, push, Vercel Production, Google Chat dispatch flag, SOLAPI activation/provider send

운영 전환은 사용자의 별도 승인 후 다음 순서로만 진행한다.

1. 운영 DB read-only preflight
2. migration 적용
3. GitHub `main` push
4. Vercel Production `READY` 확인
5. production UI·logs 확인
6. Google Chat registration dispatch flag 활성화
7. SOLAPI 승인 receipt·env·activation gate 확인
8. 명시적으로 허가된 테스트 대상에만 실제 전달 확인
