# AI 에이전트 요청 — API·DB 부록

작성일: 2026-10-03 · 갱신일: 2026-10-04 · 상태: 승인 계약 / 최종 로컬 구현 반영

2026-10-04 현재 상태: Tasks 1–5 로컬 구현은 accepted feature `471312763dd7c430c845504cd1fa85493d9e69e5`에 수용되었다. 통합 base는 `0bbc7593`, CI 소유자의 scoped 수락 HEAD는 `737dfd72f875008265dc98f2909924494bec3c11`이다. 아래 C20 시작점·계획 체크박스·당시 수치는 역사적 기록이며 현재 미구현 상태를 뜻하지 않는다. 현재 통합 QA와 마지막 수정의 검증은 별도로 기록하며, full DB·strict consumer·whole-branch 및 운영 수용을 완료했다고 선언하지 않는다. 운영 SQL 설치·설정·발급·scheduler·provider 증거는 별도 gate다.

주 문서: [AI 에이전트 요청 설계](2026-10-03-ai-agent-requests-design.md)

## 1. 역사적 C20 근거와 확인 수준

당시 source checkout: `/Users/hyunjun/Documents/Codex/2026-10-02/task-2/tips_dashboard-cycle-20-lesson-ordinal`, HEAD `8dcf4595181fb5615df7a5556e9202eff87be031`. 읽기 전용으로 HEAD·AGENTS·아래 source와 최종 ordered migration 정의를 확인했다. 운영 DB 행·credential 값·운영 ACL은 조회하지 않았다. parent가 전달한 운영 결과와 source 조사 결과를 구분한다.

| 계약 | C20 source 위치 |
| --- | --- |
| API entry | `src/app/api/v2/[...path]/route.ts:1` |
| runtime gate·server service client·handler 연결 | `src/features/agent-api/server/production.ts:8` |
| opaque Bearer 형식·SHA-256·DB RPC | `src/features/agent-api/server/http-v2.ts:63` |
| bounded JSON·no-store·안전한 오류 매핑 | `src/features/agent-api/server/http.ts:12`, `:31` |
| 최종 `public.agent_api_v2` verifier | `supabase/migrations/20261002130443_past_state_correction_reference_reuse.sql:284` |
| 발급자 active admin 검사 | `supabase/migrations/20260929110109_agent_api_scoped_schedule.sql:55` |
| 최종 credential v2 발급·scope allowlist | `supabase/migrations/20260930092804_agent_management_calendar.sql:70` |
| 별도 scope 계열 gateway 사례 | 같은 migration의 `agent_calendar_api_v1`, `:330` |
| private credential RLS·직접 접근 revoke | `supabase/migrations/20260929110109_agent_api_scoped_schedule.sql:50` |
| service-only v2 RPC ACL | `supabase/migrations/20261002114145_narrow_past_lesson_state_correction.sql:506` |

DB verifier는 `agent_api_v2` 내부에 있으며 별도 범용 인증 함수가 아니다. credential 행을 `FOR UPDATE`로 잠그고 hash, revoked/expiry, 발급자 현재 admin 및 auth 계정 삭제·ban 상태, 60회/분 예산을 검사한다. `class-details:read`를 health 이전부터 요구하므로 새 API의 인증 우회용으로 v2 health를 쓰거나 해당 gate를 완화하지 않는다. `all_classes/includesFutureClasses`는 수업 범위다.

당시 기존 class credential 발급 allowlist는 `classes:read`, `class-details:read`, `calendar:read`, `calendar:write`, `class-info:write`, `weekly-plan:write`, `lesson-plan:write`, `schedule:preview`, `schedule:write`다. 기존 class credential에 AI·Chat scope를 추가하지 않는다. 당시 credential inventory·만료는 Muse 전달 정보이며 실제 서버 행과 독립 대조한 결과가 아니다. Muse의 Secure Vault surrogate는 비밀 주입 transport로 취급하고, 서버 권한 검증과 구분한다.

현재 source의 standalone 전자결재는 폐기된 기능이다. 이전 조사에서 확인한 결재 코드를 신규 활성 feature의 기준으로 삼거나 부활시키지 않는다. UI 기준은 최신 `DESIGN.md`, `/admin/students`, 공통 data-table·form-dialog다.

## 2. 주체와 권한

| 주체 | 허용 | 거부 |
| --- | --- | --- |
| active `staff`/`teacher`/`assistant` | 자신의 생성·목록·상세·comment/answer·취소, 사용자별 허용 space 선택 | 타인 요청, 임의 requester, bot status/result 변경, 일반 Chat send |
| 검증된 `admin` | 본인 생성, 전체 목록·상세·comment/answer·취소, 만료 claim 검토·재개, 사용자별 space 정책 관리 | audit 덮어쓰기, 카탈로그 밖 송신, 설정 없는 space 송신 |
| `viewer`/fallback/비활성 계정 | 새 기능 접근 거부 | 로그인했다는 이유의 자동 권한 |
| bot credential | 명시 AI scope·request grant·claim과 Chat scope·space grant 범위 | 발급자 admin을 통한 무제한 접근, class/calendar scope의 AI·Chat 대체 |

사용자는 직원 본인 요청/admin 전체 요청과 강사·조교 포함/viewer 제외 보충을 승인했다. 따라서 직원 대상은 active `staff`·`teacher`·`assistant`이고 active `admin`은 전체, `viewer`·fallback·비활성 계정은 제외한다. source 역할 집합은 `admin/staff/teacher/assistant/viewer`(`src/lib/auth-utils.ts:3`, `supabase/migrations/20260525091554_assistant_dashboard_role.sql:6`)이며 UI에서 `teacher`는 선생님, `assistant`는 조교로 표시한다(`src/features/management/teacher-master-workspace.tsx:109`). 로컬 구현이 이 직원 계약을 반영하며 운영 DB 적용과 구분한다.

기존 `isStaff`와 `canManageAll`은 admin/staff만 포함한다(`src/providers/auth-provider.tsx:391`, `src/lib/auth-utils.ts:61`). 이를 새 직원 own capability나 admin-only 전체 열람 검사로 복사하지 않는다. `teacher`는 수업계획 capability가 있고 assistant 전용 경로 제한을 받지 않는다. `assistant`의 기존 AuthGuard 경로 제한을 보존하고 `/admin/ai-agent` 목록·상세만 추가했다. `resolveAiAgentRequestAccess`의 검증된 capability를 sidebar/command search에 전달한다. viewer/fallback deny와 직원 own/admin all은 UI·API·DB에서 각각 검사하며 운영 DB 적용 증거는 별도다.

직원 세션은 현재 로그인 계정을 서버 `getUser` 및 DB profile/active account로 검증한다. 확정된 직원 역할과 ownership 정책은 DB RPC에도 적용한다. 권한 조회 실패는 deny이며 `user_metadata`, 요청 body의 actor/role, 사용자 제출 이름은 권한 근거가 아니다. requester ID는 생성 시 고정하고 표시 이름은 identity와 분리한다.

UI 목록·상세·설정·비동기 응답은 사용자 ID와 검증된 역할에 묶는다. 계정/역할 변경이나 세션 종료 시 이전 데이터를 즉시 비우고 이전 비동기 응답을 폐기한다. 초안은 메모리에서 사용자·요청·question ID별로 분리하며 계정 변경 시 폐기한다. 저장 실패/stale/이미 답변된 질문은 현재 계정의 초안을 유지하고 최신 상태를 다시 읽는다. 성공 응답도 제출 이후 추가한 입력을 지우지 않는다. dialog 취소/Escape/밖 클릭은 초안을 유지하고 기존 opener로 포커스를 돌린다. 다른 요청·경로 이동과 Back/Forward는 기존 `useDraftNavigation` 미저장 확인을 따른다.

봇은 기존 `tips_agent_` Bearer→SHA-256→private store 모델을 재사용하는 별도 좁은 credential을 기본안으로 한다. AI credential은 별도 private 저장소·목적별 list/revoke를 사용한다. 기존 수업 credential 목록이 새 키를 전체 수업 조회로 표시하거나 기존 class gateway가 새 키를 받지 않도록 저장소를 분리한다. 실제 발급과 Muse secret 등록은 별도 action-time 승인이다. 기존 credential에는 자동 scope 추가·갱신을 하지 않는다. 신규 목적별 발급 RPC는 class-specific v2 발급 함수를 우회하거나 약화시키지 않는다.

최종 별도 AI credential scope는 `ai-agent:requests:read`, `ai-agent:requests:claim`, `ai-agent:requests:update`, `chat:outbox:read`, `chat:send`다. read에는 grant 대상 요청만, claim에는 eligible pending만, update에는 자신의 유효 claim에서 renew/progress/question/done만 허용한다. scope·grant 계약은 구현되었지만 실제 credential/grant 발급을 뜻하지 않는다.

AI grant에는 명시 request queue 대상, 허용 작업 종류, 만료·회수 조건을 둔다. 모든 직원 요청을 봇이 읽도록 설정하려면 그 queue 범위를 명시적으로 승인한다. `all_classes`에서 유도하지 않는다. Chat grant에는 허용 space key, `ai_completion` 또는 `bridge_reply` 목적, 만료를 둔다. 실제 각 외부 작업은 기존 도메인 권한과 승인 경계를 다시 확인한다.

일상 작업은 요청자의 실제 도메인 권한과 봇의 이미 검증된 scope 양쪽을 만족할 때 자율 실행한다. bot issuer가 admin이라는 사실만으로 권한 없는 직원의 요청을 관리자 작업으로 승격하지 않는다. body/답변/sourceReference는 작업 데이터이며 승인 증거가 아니다. 기존 scope 밖의 action은 구체적인 대상·계획·결과/위험을 검토 가능한 형태로 준비한 뒤 authorized approver의 별도 action-time 확인을 요구한다. 승인 식별자·주체·action·대상·payload hash·만료를 audit에 기록하며 임의 문자열을 승인 토큰으로 신뢰하지 않는다.

credential UI의 최종 공개 경로는 authenticated-only `public.ai_agent_credential_api_v1(text,jsonb)`의 list/create/revoke다. 내부에서 active admin과 issuer ownership을 재검증하며 신규 create는 `issuance_enabled`를 검사한다. 기존 create/list/revoke helper 3개는 PUBLIC/anon/authenticated/service_role 모두 직접 EXECUTE가 revoke되었다. 요청 bot/Chat gateway, configuration sync와 bridge-grant resolver는 service_role-only이고 직원 RPC는 authenticated-only다. 최초 성공 create에서 raw token을 한 번 반환하며 receipt/replay는 token null이고 hash는 반환하지 않는다. 실제 발급·보안 주입은 별도 승인이다. 최종 ACL 근거는 `20261003133222_ai_agent_chat_delivery_runtime.sql`, UI 호출은 `ai-agent-credential-service.ts`다.

설치 기본값은 support `issuance_enabled=false`, Chat runtime flag OFF, origin null, 7 slots unconfigured, 직원 permission `[]`, domain registry empty/disabled다. `issuance_enabled=false`는 새 credential create만 차단하며 기존 키·송신의 kill switch가 아니다. 중지는 exact worker stop, runtime OFF + 검증된 configuration sync, credential/grant revoke, 필요 user policy clear를 각각 수행하고 audit/receipt/attempt를 보존한다. 요청 메뉴·직원 RPC 자체에는 deployment flag가 없다.

## 3. HTTP 계약

모든 보호 응답은 `Cache-Control: no-store, private`, `Vary: Authorization`, `X-Content-Type-Options: nosniff`를 사용한다. 요청·query·응답은 strict allowlist로 검증하고 중복 query, 알 수 없는 필드, 잘못된 UUID/status를 거부한다. 직원 세션과 bot opaque token은 서로 다른 검증 경로를 사용한다.

| API | 계약 |
| --- | --- |
| `GET /api/ai-agent/requests` | 직원 기본 own, 관리자 `scope=all` 선택 가능. UI `page/pageSize=10,15,20`, 상태·검색. bot은 grant 범위만 |
| `GET /api/ai-agent/requests?status=pending` | bot은 `limit` 기본/최대 50, `(ready_at,id)` 오름차순 opaque cursor. 조회만 하며 claim하지 않음 |
| `POST /api/ai-agent/requests` | 직원/admin. `{title,body,notifyOnDone,notificationSpace?}`. `requester/status/actor` 입력 금지. 최초 pending |
| `GET /api/ai-agent/requests/{id}` | 소유자/admin/허용 bot. 요청, version, Q&A, 결과, 순번 cursor로 읽는 전체 audit, 알림 상태. `afterMessageSeq`/`afterEventSeq`, nullable `nextMessageSeq`/`nextEventSeq`, 각 최대 50개. secret/claim token은 일반 DTO에서 제외 |
| `PATCH /api/ai-agent/requests/{id}` | `{status,message?,result?}`. bot pending→processing claim, 유효 claim의 renew/progress/question/done. 직원/admin의 status 쓰기는 cancelled만 |
| `POST /api/ai-agent/requests/{id}/messages` | 소유자/admin. `{kind:"answer",questionId,text}` 또는 `{kind:"comment",text}`. answer는 열린 질문과 question 상태 검증. terminal에는 append 거부 |
| `POST /api/ai-agent/requests/{id}/resume` | admin만. 만료 claim의 처리 기록·외부 결과를 검토한 후 `{reason,confirmed:true}`. 의심스럽거나 unresolved effect가 남으면 거부 |
| `POST /api/ai-agent/requests/{id}/actions` | 유효 claim bot. stable `actionKey`, 작업 종류·정규화 대상·payload hash·권한 참조를 등록. scope와 요청자의 도메인 권한을 검사한 뒤 prepared receipt 반환 |
| `PATCH /api/ai-agent/requests/{id}/actions/{actionId}` | 유효 claim bot은 prepared를 `{state:"started"}`로 시작하거나 `{state:"cancelled",reason}`으로 미실행 취소. 결과는 등록한 credential의 `{state:"succeeded"|"failed"|"unknown",evidenceReferences}` append. payload/대상은 수정 불가 |
| `POST /api/ai-agent/requests/{id}/actions/{actionId}/reconcile` | admin만. `{outcome,evidence,reason,confirmed:true}`로 unknown의 구체적인 효과를 확인·해소. 일반 답변과 다른 경로 |
| `GET /api/ai-agent/spaces` | 직원은 허용 space, 관리자는 허용 카탈로그 전체. key/label/configured/selectable/reason과 정책 revision만 반환 |
| `GET/PATCH /api/ai-agent/space-permissions/{userId}` | admin만. active 대상 직원의 `{spaceKeys}` 정책 조회/저장. 허용 카탈로그 밖 key 거부, version/Idempotency-Key 필요 |
| `GET /api/chat/outbox?status=pending` | Chat outbox read scope의 bot. pending 및 재시도 가능한 retry_wait intent를 bounded cursor로 조회. delivery_unknown은 자동 dispatch 대상에서 제외 |
| `POST /api/chat/send` | 승인 Chat scope의 bot만. `{space,thread?,text}`. UI 직원의 일반 free-text send 금지 |

UI page query와 bot cursor query를 혼합하지 않는다. admin 목록 UI는 본인/전체 범위를 명시하고, requester 필터로 ownership을 우회하지 못한다. 다른 소유자의 ID는 내용이 없는 404로 처리한다.

쓰기에는 UUID `Idempotency-Key`가 필수다. 요청 상태·내용을 변경하는 호출에는 `If-Match: "r<version>"`도 필수이며 누락은 428, stale은 409다. action/outbox의 자체 상태는 각각의 revision과 등록된 attempt를 검사하며 늦은 결과 append가 요청 업무 version을 바꾸지는 않는다.

bot은 최초 claim 호출 전에 CSPRNG로 256-bit nonce를 만들고 `X-Claim-Token`으로 전송한다. 이후 같은 nonce로 자신의 claim 변경/renew를 증명한다. 서버는 nonce hash만 저장하고 raw nonce를 receipt·일반 DTO·로그에 저장하거나 반환하지 않는다. nonce는 bot 실행의 비공개 상태에서 해당 claim 동안 보관하며 직원 UI·일반 파일·비밀 설정에 복사하지 않는다. 최초 응답이 유실되면 최초 If-Match version·같은 Idempotency-Key·nonce로 retry해 현재 유효한 generation/lease/version metadata를 복구한다. expired/replaced claim은 409이며 bot 재시작으로 nonce를 잃은 경우 자동 복구하지 않고 만료/검토 경로를 따른다. 이 nonce는 승인된 claim의 단기 증명이며 새 영구 credential/grant가 아니다.

동일 principal·method·resource·key와 canonical payload hash가 같은 재요청은 저장된 receipt를 반환한다. 최초 claim fingerprint는 예상 version과 nonce hash에 결합하고, claim 이후 쓰기는 반환된 generation에도 결합한다. 같은 key에 다른 payload는 409다. replay 이전에도 현재 authz를 검사하고 유효 replay는 새 quota/외부 attempt를 소비하지 않는다. claim receipt가 있어도 현재 lease/token/generation이 유효하지 않으면 claim을 되살리지 않고 409로 응답한다.

완료 Chat은 `X-Chat-Intent-ID`로 서버가 만든 completion outbox에 결합한다. body의 space/thread/text는 저장된 목적·대상·payload hash와 일치해야 한다. bridge reply는 `X-Bridge-Event-ID`에 원본 Google `message.name`을 전송하며 server가 `bridge_reply` intent를 저장한다. 두 origin header는 상호 배타적이며 누락·동시 지정은 거부한다. bridge intent는 credential 교체 후에도 유지되는 server grant의 안정적인 `bridge_source_id`를 사용해 `(bridge_source_id,purpose,source_event_id)` unique로 저장하고 source event의 space·body thread가 허용 대상에 속하는지 검사한다. 같은 source에 다른 payload/space/thread는 409다. 같은 payload의 중복 호출은 기존 intent의 상태/receipt를 반환하고 새 attempt를 만들지 않는다. source ID는 audit·중복 방지 문맥이며 credential 권한을 생성하는 증거가 아니다. 기존 bridge 소유자가 안정적인 message.name 전달과 지원된 연결 계약을 확인한 뒤 통합한다.

요청 크기 기본값은 title 200자, body/result 20,000자, message 5,000자, JSON body 최대 128 KiB다. HTML 실행·첨부·외부 URL fetch·자동 명령 실행 API는 추가하지 않는다. 완료에는 비어 있지 않은 result, question에는 비어 있지 않은 message가 필요하다. API 응답에 고정 오류 코드와 요청 식별자만 노출하고 원시 예외를 노출하지 않는다.

## 4. 저장 구조와 트랜잭션

| 논리 테이블 | 책임 |
| --- | --- |
| `ai_agent_requests` | requester, title/body, 다섯 status, version bigint, created/updated/ready 시각, 열린 question, result, opt-in/space |
| `ai_agent_request_messages` | immutable question/answer/comment/progress, author 종류·검증된 ID, question 연결, 순번·시각 |
| `ai_agent_request_events` | append-only 생성·claim·전이·답변·취소·재개 audit. 이전/새 상태·version·credential/issuer·requester를 구분 |
| `ai_agent_request_claims` | credential, secret claim token hash, generation, lease expiry, renew 시각, 실행/효과 기록 연결 |
| `ai_agent_request_receipts` | principal·operation·idempotency key unique, payload hash, 안전한 결과 receipt |
| `ai_agent_credentials` | 별도 목적의 issuer·token hash·명시 scope·expiry/revoke·rate 상태. 기존 class credential 저장소·list와 분리 |
| `ai_agent_actions` | request·stable actionKey unique, 정규화 대상·payload hash·권한 참조·현재 효과 상태·domain receipt 연결 |
| `ai_agent_action_events` | prepared/started/결과/reconcile의 append-only 사건. 실행 credential·claim generation·증거 종류와 resource reference |
| `ai_agent_credential_grants` | 새 목적별 발급 RPC로 발급한 AI credential ID에 결합한 명시 queue/action 범위·만료·회수 정책 |
| `chat_user_space_permissions` | admin이 지정한 사용자별 허용 space, 설정자·revision·시각 |
| `chat_credential_space_grants` | credential ID에 결합한 명시 space·completion/bridge 목적·만료·회수 정책 |
| `chat_delivery_outbox` | immutable intent/원본 이벤트, 목적, space/thread, 안전한 payload·hash, stable upstream requestId, 전달 상태 |
| `chat_delivery_attempts` | immutable attempt ID·시작·결과 사건, provider 코드·message/thread resource name. secret URL 없음 |
| `chat_space_send_budgets` | 새 송신 경로의 space별 dispatch 시각·예산을 원자적으로 제한 |

위 신규 테이블은 모두 비노출 `dashboard_private` schema에 둔다. RLS를 켜고 `PUBLIC/anon/authenticated/service_role`의 직접 테이블 접근을 revoke한다. 요청/message/event의 방어용 ownership 정책과 목적별 RPC 내부의 명시적인 ownership 검사도 함께 둔다. 직원 호출은 직원 Bearer로 만든 authenticated client의 public 목적별 RPC가 `auth.uid()`와 active profile을 검사하는 경로다. 봇 호출은 server service client의 새 service-only gateway RPC가 opaque credential·scope·resource grant를 검사하는 경로다. 일반 직원 입력의 actor ID를 service-role 호출로 전달해 신뢰하지 않으며, bot issuer의 admin 역할로 직원 ownership을 대신하지 않는다. RPC로 요청·message·event·receipt를 함께 기록하고 ownership 조회 index, `(status,ready_at,id)` pending index, `(request_id,event_seq)` audit index, grant lookup/unique receipt/outbox index를 둔다.

상태 전이 표:

| 현재 | 다음 | 주체·조건 |
| --- | --- | --- |
| pending | processing | scope 있는 bot의 CAS claim |
| processing | processing | 유효 claim의 renew/progress. renew만이면 업무 version·updated 시각은 유지 |
| processing | question | 유효 claim, 질문 append 및 question ID 생성, claim 종료 |
| question | pending | 소유자/admin answer append와 질문 닫기. ready_at 갱신, 이전 claim 무효 |
| processing | done | 유효 claim, result 저장, 완료 event와 opt-in outbox를 같은 commit |
| pending/processing/question | cancelled | 소유자/admin, CAS, claim generation 무효화 및 미전송 intent 취소 |
| processing(lease expired) | pending | admin 검토·명시 resume, unresolved external effect 없음 |
| done/cancelled | 다른 상태 | 거부 |

요청 행 잠금 아래 예상 version·현재 state·authz·claim generation·lease를 검사한다. lock 순서는 credential/grant → request → claim/receipt/action → outbox → space budget으로 고정하고 네트워크 호출 동안 DB lock을 유지하지 않는다. GET은 변경하지 않는다. status와 audit 또는 outbox를 따로 commit하지 않는다.

claim 기본 lease는 15분, 실행 중 renew는 5분 간격이다. 30분 polling은 새 작업을 찾는 간격이며 실행 중 renew를 대신하지 않는다. token/generation이 바뀌면 이전 실행자의 쓰기는 거부한다. lease 만료는 processing을 유지하면서 `leaseState=expired`로 표시한다. 외부 행동이 시작되었는지 모르는 작업을 자동으로 pending 재등록하지 않는다.

취소와 done은 먼저 commit한 전이가 승리한다. cancel이 먼저면 이전 bot의 done/progress와 미시작 송신을 거부한다. done이 먼저면 cancel은 terminal conflict다. 이미 dispatch한 외부 행동은 결과를 기록하며 취소로 없었다고 처리하지 않는다. 일반 bot 작업의 started/unknown action이 하나라도 남으면 done/resume을 거부한다. 완료 이후에 발생하는 completion Chat의 pending/unknown은 요청 done을 되돌리지 않고 별도 전달 상태로 남긴다.

변경을 일으키는 모든 bot 작업은 먼저 actions에 등록하고, 실제 외부 호출 전 started를 durable commit한다. `actionKey`는 재개·claim generation과 무관한 stable 작업 ID이며 다른 key로 같은 준비 작업을 중복 실행하지 않도록 canonical step/target/payload도 검사한다. 등록과 started 시점 모두 서버는 현재 scope·request grant·요청자의 실제 도메인 권한, 취소 여부, 유효 claim과 작업의 정규화 target/hash를 검증한다. 기존에 허용되지 않은 action은 등록/실행을 거부하며 지원 설정과 별도 action-time 승인으로 정확한 grant가 준비되기 전에는 시작하지 않는다. 신규 credential 발급처럼 이 API 자체가 수행하지 않는 지원 설정도 직원 자유문으로 승인할 수 없다.

action 상태는 prepared/started/succeeded/failed/unknown/cancelled다. 외부 호출 전 취소된 prepared는 cancelled, 명확한 미적용 거부는 failed, 적용 증거가 있는 결과는 succeeded, dispatch 이후 timeout·실행 중단·응답 유실은 unknown이다. started 상태로 claim이 만료되면 unknown으로 표시한다. done에는 등록한 모든 변경 action의 확정 결과가 필요하며 실행하지 않을 prepared는 사유와 함께 취소한다. 요청 취소는 prepared도 원자적으로 취소하며 started/unknown은 별도 결과 확인 대상으로 남긴다. read-only 조사에는 외부 변경 action을 만들지 않으며 이력 summary만 남긴다.

늦은 외부 결과는 등록한 credential이 현재 인증을 통과하면 기존 action/attempt에만 append할 수 있다. 이전 generation, 요청 취소 또는 lease 만료 상태에서도 결과를 기록할 수 있지만 신규 started·요청 상태 변경·재전송은 허용하지 않는다. 등록된 target/payload를 바꾸는 결과나 상충하는 증거는 incident로 보존한다. credential 폐기 후에는 admin의 별도 reconcile 경로로 확인한다.

reconcile의 evidence는 해당 action의 target/payload hash에 결합한 기존 도메인 operation receipt 또는 관리자가 직접 확인한 결과의 resource name·확인 시각·관찰 내용을 포함한다. 서버가 읽을 수 있는 receipt는 실제 저장된 결과와 대조한다. 외부 결과의 관리자 관찰은 독립 자동 검증과 구분해 audit한다. 단순 `confirmed:true`, 직원 답변, 임의 URL은 증거로 수용하지 않는다. 불명확함이 해소되지 않으면 unknown을 유지하고 retry/resume/done을 거부한다. 확인은 새 외부 권한 부여를 대신하지 않는다.

질문 답변 재개는 created_at watermark와 독립적이다. GET detail은 nullable `nextMessageSeq`/`nextEventSeq`를 각각 `afterMessageSeq`/`afterEventSeq` query로 전달하며 최대 50개씩 두 흐름을 모두 null까지 drain한다. 요청 DTO의 `readyAt`은 queue-ready 시각으로 answer/admin resume에서 갱신되며 createdAt이 아니다. claim replay는 최초 If-Match version/key/nonce를 그대로 유지한다. 이후 renew/progress/question/done은 반환된 decimal `X-Claim-Generation`과 현재 request version을 사용한다. renew는 lease/audit만 바꾸고 업무 version/updatedAt을 바꾸지 않는다. bot은 매 polling마다 cursor 없이 eligible pending의 첫 페이지부터 시작한다. 한 실행에서 cursor로 전체 bounded 후보를 읽고 claim CAS를 수행한다. 중간에 새 pending이 생겨도 다음 polling 첫 페이지에서 다시 찾는다. 이력 cursor는 request ID·순번에 묶어 안정적인 append 탐색을 제공한다.

업무 전이/CAS/terminal 오류는 `23514` 또는 `55000`과 구체적인 domain code로 정의하고 HTTP 409로 매핑한다. 권한은 `42501`, 입력은 `22023`, 미인증 bot은 기존 모델의 `28000`을 사용한다. 실제 serialization collision 이외에 `40001`을 발생시키지 않는다. migration 완료 후 최종 함수와 정확 SQLSTATE를 pgTAP으로 검증한다.

## 5. Chat 전달과 복구

완료 event와 space에 대해 outbox unique를 둔다. 기본 완료 text는 제목·완료 상태·인증된 상세 링크이며 요청 본문/Q&A/전체 result를 자동으로 팀 공간에 복사하지 않는다. worker가 출력 text를 바꾸거나 목적·수신자 범위를 넓힐 수 없다.

내부 전달 상태는 `pending`, `sending`, `sent`, `retry_wait`, `failed`, `delivery_unknown`, `cancelled`, `incident`로 구분하며 요청 status와 섞지 않는다. attempt 사건은 append-only이고 outbox에는 현재 전달 projection을 둔다.

송신 순서는 grant·space 설정·취소 여부·payload/thread 검증 → durable attempt 등록/dispatch 시작 commit → 외부 호출 → 고정된 결과 기록이다. 등록에 실패하면 외부 호출하지 않는다. 같은 intent의 동시 송신은 한 worker만 시작할 수 있다.

- sent 재요청은 저장한 receipt를 반환하며 다시 보내지 않는다.
- timeout·connection reset·응답 유실·dispatch 이후 lease 만료·모호한 provider 실패는 delivery_unknown이다. 자동 재전송하지 않는다.
- provider의 definite HTTP 429만 retry_wait 대상이며 최대 **총 다섯 번의 dispatch attempt**다. 지연은 `2^attemptCount`초 + intent별 deterministic jitter [0,1)이고 반환된 readyAt을 따른다. API 429만으로 retry_wait 전이를 증명하지 않는다. due retry는 기존 intent ID를 `X-Chat-Intent-ID`에 넣고 immutable payload/upstreamRequestId를 유지하며 새 logical attempt UUID를 사용한다. 응답 유실 복구는 원래 key/body로 수행하고 새 fetch를 만들지 않는다. `X-Bridge-Event-ID`는 원본 message.name이며 반복 bridge-source 호출은 attempt를 만들지 않고 due existing bridge retry는 intent header를 사용한다. Chat send에는 If-Match/claim headers를 넣지 않는다. 명확한 입력/권한/없는 thread 오류는 failed로 종료한다.
- `requestId`는 intent에 저장한 stable UUID를 사용한다. 동일 credential·동일 payload를 유지하지만 incoming webhook에서 dedupe가 검증되기 전에는 이것만으로 unknown을 자동 재시도하지 않는다.
- unknown/incident의 재전송은 운영자가 실제 전달 결과와 수신자를 확인한 후 별도 명시적인 행동으로 수행한다. 확인 불가능하면 unknown을 유지한다.

bot의 매 30분 실행은 request queue와 Chat outbox를 각각 drain한다. 완료 직후 send가 실패하거나 응답을 못 받아도 다음 outbox 조회로 intent를 찾되 unknown은 재발송 대상에서 제외한다. 실제 scheduler 변경과 활성화는 지원 설정 승인 후 한다. 기존 bridge의 평일 13:30–22:30/토요일 10–19 KST 운영시간, 일요일 미실행, 기존 watermark를 변경하지 않는다.

직원 create 기본 예산은 계정당 10회/시간, messages 30회/분, bot gateway 60회/분으로 둔다. 새 Chat 경로는 credential/global 60회/분과 space별 최소 1초 dispatch 간격을 공유 DB budget으로 제한한다. Google space quota는 다른 앱과 공유되므로 로컬 제한 준수가 provider 수락을 보장하지 않으며 429를 처리한다. quota/설정 변경도 audit한다.

## 6. 공간·secret·thread

server-only 고정 카탈로그는 `spaceKey → 실제 spaces/{id} → incoming webhook env 참조`다. 값은 브라우저, DB 일반 DTO, 문서, 로그에 노출하지 않는다. public API는 허용 key·표시명·권한·configured 여부·안전한 이유 코드만 반환한다. 7개를 설정하기 전에 실제 수신자와 ID를 검토한다. parent가 제공한 읽기 전용 inventory에서 7개 기존 webhook의 존재를 확인했다. 실제 수신자·공간 유형(DM 제외)·secure env mapping·sender 권한은 모두 별도 확인·승인 대기이며 존재 확인을 configured/live 증거로 확대하지 않는다.

직원 notificationSpace는 사용자별 permission, admin은 허용 카탈로그, bot send는 Chat grant와 각각 교차 검증한다. 사용자별 정책은 `/admin/settings/agent-access`의 admin 전용 알림 공간 탭에서 `GET/PATCH /api/ai-agent/space-permissions/{userId}`로 관리한다. 실제 수신자 카탈로그와 secret env 참조는 지원 설정에서 별도 확인하며 이 화면에는 secret 편집·발급을 넣지 않는다. 미설정 space도 명시적인 사용자 허용 정책을 미리 저장할 수 있지만 configured가 될 때까지 선택·송신은 비활성이다. 전송 시에도 최신 권한·configured 상태를 재검증한다. opt-in off이면 space는 null이다. opt-in on으로 미설정/미허용 space를 제출하면 필드 오류를 반환하고 초안을 유지한다. 사용자는 알림을 끄고 요청을 저장할 수 있다. 완료 시 설정이 제거되면 결과는 done으로 남기고 outbox는 미송신 사유를 표시한다.

webhook은 기존 `notification-connection-crypto.ts`의 고정 HTTPS Google origin/path 검증 패턴을 참고하되 기존 공유 검증기를 느슨하게 바꾸지 않는다. server map만 URL을 선택하고 caller URL·host·임의 query를 받지 않는다. 검증된 base URL에 server가 정한 requestId/reply option만 구성한다. redirect는 거부하며 전체 serialized message를 32,000 bytes 이하로 제한한다. raw provider body/URL/Authorization과 제어 문자·위장 mention을 안전하게 처리하고 비밀은 로그·audit·일반 오류에서 제거한다. 요청 body URL을 server가 fetch하지 않는다.

| 송신 의도 | 처리 |
| --- | --- |
| 기존 thread 답글 | `thread.name=spaces/{sameSpace}/threads/{thread}` + `messageReplyOption=REPLY_MESSAGE_OR_FAIL` |
| thread가 다른 space/잘못된 형식 | 외부 호출 전 거부 |
| missing/unavailable thread | failed. 새 thread fallback, threadKey 변환, 다른 space 재송신 없음 |
| thread 없는 명시 top-level 완료 알림 | 별도 top-level intent로만 허용 |
| bridge reply에서 thread 없음 | 거부 |
| DM | 이번 정책 범위에서 거부 |

성공 응답의 `message.name`, `thread.name`을 저장하고 기대 space/thread와 대조한다. 성공 코드라도 잘못된 space/thread, 필수 resource name 누락 등 성공 증거가 불충분하면 sent로 확정하지 않고 incident 또는 delivery_unknown으로 보존한다. 자동 재전송하지 않는다.

공식 shared API는 사람/다른 앱 thread에 `thread.name`을 사용하도록 설명한다. webhook guide 예제는 threadKey 방식이며 임의 human thread 사용 및 webhook requestId dedupe는 승인된 실제 테스트 전 미검증이다. DM 제외는 기술적 불가능 주장이 아닌 사용자 scope 정책이다.

공식 근거: [Thread](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages#Thread), [create-message](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create), [webhook guide](https://developers.google.com/workspace/chat/quickstart/webhooks), [quota](https://developers.google.com/workspace/chat/limits). 조회일 2026-10-03. provider 지원·source 검사·실제 전송 결과를 별도 증거로 기록한다.

## 7. 구현 파일 소유 예상

- 화면: `src/app/admin/ai-agent/page.tsx`, `src/app/admin/ai-agent/[id]/page.tsx`.
- UI feature: `src/features/ai-agent/ai-agent-request-workspace.tsx`, `ai-agent-request-create-dialog.tsx`, `ai-agent-request-detail.tsx`, `ai-agent-request-activity.tsx`, `ai-agent-request-service.ts`, `ai-agent-request-contract.ts`.
- 서버: `src/features/ai-agent/server/ai-agent-auth.ts`, `ai-agent-repository.ts`, `ai-agent-routes.ts`; `src/features/chat/server/chat-send-route.ts`, `chat-outbox.ts`, `google-chat-transport.ts`.
- Routes: `src/app/api/ai-agent/requests/route.ts`, `src/app/api/ai-agent/requests/[id]/route.ts`, `src/app/api/ai-agent/requests/[id]/messages/route.ts`, `src/app/api/ai-agent/requests/[id]/resume/route.ts`, `src/app/api/ai-agent/requests/[id]/actions/route.ts`, `src/app/api/ai-agent/requests/[id]/actions/[actionId]/route.ts`, `src/app/api/ai-agent/requests/[id]/actions/[actionId]/reconcile/route.ts`, `src/app/api/ai-agent/spaces/route.ts`, `src/app/api/ai-agent/space-permissions/[userId]/route.ts`, `src/app/api/chat/send/route.ts`, `src/app/api/chat/outbox/route.ts`.
- 설정: `src/features/ai-agent/ai-agent-space-policy-settings.tsx`, `ai-agent-credential-issue-dialog.tsx`, `src/features/ai-agent/server/ai-agent-space-policy-route.ts`와 목적별 권한 설정/발급 RPC. `/admin/settings/agent-access`에 알림 공간 탭과 별도 AI credential 발급 흐름을 연결하기 위해 `src/features/agent-api/agent-access-workspace.tsx`, `src/app/admin/settings/agent-access/page.tsx`를 제한적으로 수정한다. 기존 class 발급 흐름은 유지하며 class 전용 발급 함수나 기존 credential은 확대하지 않는다.
- 메뉴/capability: `src/lib/navigation.ts`, 필요 시 `src/lib/auth-utils.ts`, `src/components/app-sidebar.tsx`, `src/components/command-search.tsx`. active staff/teacher/assistant의 own capability와 admin의 all capability를 구분한다. `src/components/auth/auth-guard.tsx`에 assistant의 새 AI 경로만 제한적으로 연결하며 기존 일반 경로 접근을 확대하지 않는다.
- SQL: 구현 단계에 CLI `migration new`로 생성한 `_ai_agent_requests.sql`, `_ai_agent_scoped_credentials.sql`, `_ai_agent_request_lifecycle.sql`, `_ai_agent_chat_outbox.sql`; 최종 ordered migration/manifest 연결은 C20/C22 source 통합 소유자와 조율한다. 과거 또는 이미 final로 확정한 migration을 수정하지 않는다.
- 검증: `supabase/tests/ai_agent_requests_authz_test.sql`, `ai_agent_requests_transition_test.sql`, `ai_agent_chat_outbox_test.sql`, `ai_agent_credentials_test.sql`; `tests/ai-agent-request-contract.test.mjs`, `ai-agent-request-service.test.mjs`, `chat-send-route.test.mjs`, `chat-outbox.test.mjs`, `ai-agent-navigation.test.mjs`.

공통 UI·globals와 기존 class/calendar/notification API를 feature 편의를 위해 변경하지 않는다. 실제 bridge/CLI 통합은 해당 소유자의 별도 작업이며 이 문서는 연결 계약만 정의한다. `.github/workflows`, 공개사이트, 기존 dirty 파일은 제외한다.

## 8. 수용 기준과 승인 단계

| 층 | 필요한 증거 |
| --- | --- |
| 권한 | active staff/teacher/assistant own, active admin all, 타인 요청 404, viewer/fallback/비활성 거부, sidebar·AuthGuard·API·DB의 같은 역할 매핑, bot scope/target/expiry/revoke/발급자 권한 상실, class scope로 AI·Chat 접근 거부, 직접 테이블/anonymous RPC 거부 |
| DB | final migration 함수·ACL·정확 SQLSTATE pgTAP, 2 bot claim 경합, claim 응답 유실 후 같은 nonce live replay/만료 후 거부, stale token/version, answer→pending 원자성, cancel/done 경합, append-only audit, receipt 동일 body replay/다른 body 거부, action 시작 기록 없으면 외부 변경 0, unresolved action의 done/resume 거부, 늦은 결과 기록과 상태 변경 분리 |
| 전달 | attempt 저장 실패 시 fetch 0, completion/outbox 원자성, 동시 send 1회, 완료 직후 crash 회수, timeout unknown·blind retry 0, quota·권한 회수·미설정 space·thread mismatch incident |
| UI | 기존 TIPS 기준과 일치하는 desktop/390px/다크 테마, 긴 본문/이력, 로딩/빈/오류, 답변 초안·포커스 복귀, 알림 설정 없이 생성·답변·완료 |
| 실제 종단 | 승인된 1건 poll→claim→처리→PATCH done→Chat 성공. request/event/attempt/message/thread ID로 연결하고 secret 없는 evidence |
| 실제 thread | 승인된 기존 human thread 답글 성공, 없는 thread 실패 시 root message 0, cross-space 로컬 거부. webhook dedupe는 별도 승인 시 실제 검증하며 미검증이면 unknown 정책 유지 |

외부 테스트 전 exact content·space·수신자·thread·negative-test 범위를 제시하고 승인받는다. 기존 관리팀 webhook이라는 사실만으로 발송 승인이 되지 않는다. 나머지 6개 webhook을 테스트 준비 과정에서 자동 생성하지 않는다.

현재는 **설계·실행 승인 → 격리 Tasks 1–5 로컬 수용 → 통합 QA·최종 gate 진행** 단계다. 운영 활성화·실제 provider 수용은 미실행이다.

일반 source push/PR merge/deploy는 parent/controller가 gates 이후 진행하도록 승인했다. 순서는 accepted branch source/preview + CI/whole-branch gates → exact hosted SQL 설치·ACL action-time 승인 → 여섯 개의 고정된 AI migration을 정렬 순서대로 설치하고 최종 schema/RPC/ACL 호환성을 읽기 전용으로 확인 → protected main merge/production app build다. main의 Supabase workflow는 isolated validation이며 hosted SQL push가 아니다. 문서화된 Vercel main production build는 자동이므로 SQL 호환성 확인이 먼저다. 실제 hosted target·pending migration ledger·Vercel project/environment·복원 artifact는 미확정이다. 보안 SQL 설치, credential/grant, secure webhook/config, scheduler와 live Chat에는 각각 정확한 대상의 action-time 확인을 유지한다.
