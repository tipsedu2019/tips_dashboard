# AI 에이전트 활성화·수용 packet

> Pending extension: [Internal Chat thread replies](chat-thread-replies.md) defines the separately reviewed multi-reply and Chat-only-key contract. It does not authorize or activate sending; historical single-room/completion packets below retain their original scope.

작성일: 2026-10-03 · 갱신일: 2026-10-04. 상태: **로컬 구현 수용 / 최종 통합 gate 진행 / 운영 활성화·실제 발송 미실행**.

2026-10-04 현재 상태: Tasks 1–5 로컬 구현은 accepted feature `471312763dd7c430c845504cd1fa85493d9e69e5`에 수용되었다. 통합 base는 `0bbc7593`, CI 소유자의 scoped 수락 HEAD는 `737dfd72f875008265dc98f2909924494bec3c11`이다. 아래 C20 시작점·계획 체크박스·당시 수치는 역사적 기록이며 현재 미구현 상태를 뜻하지 않는다. 현재 통합 QA와 마지막 수정의 검증은 별도로 기록하며, full DB·strict consumer·whole-branch 및 운영 수용을 완료했다고 선언하지 않는다. 운영 SQL 설치·설정·발급·scheduler·provider 증거는 별도 gate다.

최종 opt-in 생성 수정은 기존 여섯 AI migration을 보존하고 CLI 생성 `20261004030228_ai_agent_request_notification_optin.sql`을 추가한다. 현재 canonical manifest는 이전 146개 prefix·metadata를 보존한 147개, AI ordered chain은 일곱 개다. public create의 현재 configured·요청자 정책 검사와 receipt identity·알림 필드 저장을 연결하며, 격리 DB·strict consumer의 새 실행과 독립 재검토는 완료 증거가 나오기 전까지 진행 중이다. 아래 `737dfd72…`의 canonical 146·six 기록은 당시 수락 이력으로 보존한다.

이 문서는 Tasks 1–5의 구현을 운영자가 검토할 수 있는 설정 대상으로 연결한다. 이 문서 작성이나 로컬 테스트 통과는 키 발급, 권한 부여, 환경값 등록, scheduler, hosted SQL 설치·ACL 또는 Chat 발송 승인이 아니다. 일반 source publication/merge/deploy는 기존 승인과 최종 gates를 따른다. parent/controller가 각 항목의 구체적인 대상을 완성한 뒤 기존 승인 범위를 적용하거나 action-time 승인을 확보한다. 이 packet에서 실행한 외부 작업과 실제 발송은 0건이다.

근거: [승인 설계](../superpowers/specs/2026-10-03-ai-agent-requests-design.md), [API·DB 부록](../superpowers/specs/2026-10-03-ai-agent-requests-api-db-appendix.md), [구현 계획](../superpowers/plans/2026-10-03-ai-agent-requests.md). 아래 공간 inventory는 2026-10-03 parent가 전달한 기존 UI session의 읽기 전용 확인 결과다. 설계·계획의 이전 “관리팀 외 6개 UNKNOWN” 기록은 **webhook 존재 여부에 한하여** 이 7개 inventory로 대체한다. 수신자·보안 env 연결·thread 지원·송신 권한까지 확인된 것으로 확대하지 않는다.

## 1. 현재 확인 수준과 승인 대상

| 층 | 현재 증거 | 다음 gate |
| --- | --- | --- |
| Tasks 1–2 | controller 수락: 별도 private credential/권한, lifecycle, action journal, outbox. 최종 수정 `dea93e71`, `9ace382d`; **C20 기반 당시** AI pgTAP 313/313, 기존 baseline 1937/1937, 실제 auth/lifecycle/outbox lock checkpoint 12개, AI lint `[]`, disposable cleanup 성공 | 새 main 합류 후 full regression 및 integration owner의 최종 ordered migration/hash 등록 |
| Task 3 HTTP·policy | `7341d139` + `834dece4`; 보고된 **C20 기반 당시** 로컬 증거: 실제 DB producer 34개 → strict parser/handler, AI pgTAP 369/369, lock checkpoint 16개, covering Node 163/163, package lint/build 성공 | 독립 review 수락 및 새 main 합류 regression 결과를 controller가 기록 |
| Task 4 UI | Tasks 1–5 accepted feature `47131276…`에 수용. 기존 loopback 합성 browser 증거는 역사적 로컬 자료 | 최종 title·생성/수정 시각 수정 이후 matching desktop/390px light/dark browser 증거와 정확 source/build SHA 필요 |
| Task 5 Chat·발급 UI | accepted `47131276…`: 최종 runtime·credential gateway·config/bridge resolver·실제 로컬 DB producer 구현 수용. 초기 synthetic 18/18은 역사적 준비 기록 | 최종 통합 full DB/strict consumer 증거와 운영 설정·provider 증거는 별도. runtime 기본값은 OFF/unconfigured |
| 최신 운영 main | parent가 `e5a97507246a43d536d0e73345ce6041ed45ad0c`의 통합·production PASS를 전달함. 이 기능의 production 수용이나 이 packet 작성자의 독립 운영 검증은 아님 | Tasks 1–5 feature `47131276…`, 통합 base `0bbc7593`, CI scoped 수락 `737dfd72…`; full DB/strict consumer/whole-branch 및 마지막 수정 gate는 진행 중 |
| 이 AI 기능의 실제 운영 | production migration/deploy, credential/grant, env map, scheduler, 사용자 공간 허용 변경 없음 | 아래 각 승인 대상을 별도로 확정 |
| 실제 Google provider | 실제 메시지·human thread·webhook requestId dedupe 미검증 | 승인된 Task 7 실행과 provider resource evidence 필요 |

위 C20 숫자는 해당 task report의 역사적 로컬 증거 요약이다. 최신 main 합류 이후의 fresh regression 결과와 혼합하지 않는다. fresh baseline manifest/registration은 해당 통합 소유자가 확인하며 이 문서는 common CI/manifest를 수정하지 않는다. 이 packet 작성자가 QA를 재실행하거나 production/provider 결과를 검증한 것은 아니다. source/env 존재, HTTP stub 성공, DB fixture 성공을 실제 운영 수용으로 표시하지 않는다.

| 승인 대상 | 검토 가능한 정확한 대상 | 현재 상태 |
| --- | --- | --- |
| Production migration | 기존 여섯 개와 추가 opt-in 수정의 일곱 AI ordered migration frozen 파일·SHA-256, 운영 DB target/reference·pending ledger, stop/restore 계획 | **HOLD**: 로컬 등록 완료; exact hosted 설치·ACL 승인·호환성 증거 미확정 |
| 배포 | 새 main `e5a97507…` 합류와 fresh regression을 통과한 Tasks 1–5 accepted commit + 이 문서 commit의 immutable final HEAD/release SHA, 운영 project/environment, 해당 배포의 env/config revision | **HOLD**: 일반 source publication/merge/deploy 권한은 있음; 최종 gates·SQL 선설치·운영 target/restore 증거 미확정 |
| 새 AI key·지속권한 | §3의 발급자·5 scopes·queue/lifecycle grant·space/purpose·정확한 UTC 만료·회수 ID | **PROPOSED**: 발급/부여하지 않음 |
| Server env·공간 연결 | §2 inventory와 §4의 최종 Task 5 reference-name map·origin/config revision | **HOLD**: 최종 source reference 이름 확인; 실제 수신자·secure mapping·보안 주입 승인 대기 |
| 새 scheduler | §5의 Muse 소유 신규 queue/outbox job identity·실행 host·credential reference·30분 poll/5분 renew·시작 시각 | **PROPOSED**: 기존 bridge 변경 없음 |
| 합성 1건의 실제 외부 송신 | §6의 exact title/body/result·대상 계정·space/수신자·top-level·최대 1회 dispatch | **PROPOSED**: 수신자/계정·운영 origin 미확정, 미실행 |
| 기존 human thread/negative 수용 | §7의 별도 scope/purpose·정확한 원본 thread/source·negative 범위 | **HOLD**: 최초 1건 송신 승인에 포함하지 않음 |

현재 통합 QA receipt(controller 제공, `737dfd72…` 기준): migration/domain/query source guards 통과; Muse 계약 108 + 86 통과; lint 0 errors/기존 warnings 7개, types·main webpack build·public cache 1/1·client boundary 1/1 통과. genuine Linux fixture 10/10, skipped 0이며 별도 cleanup metadata에서 outer 부재·child namespaces 비어 있음·19 source hashes 불변을 확인했다. 원래 driver의 FAIL은 지원하지 않는 absence wording 때문에 발생한 것으로 원본 결과를 보존했다. Common DB attempt 1은 Mac internal relay timeout으로 db:start에서 SQL 실행 전에 실패했고 cleanup은 성공했으며 진단은 진행 중이다. 전체 static 결과는 6001개 중 5982 pass/19 fail(16 socket EPERM + 세 기존 guard 불일치)였다. 동일한 16개 socket EPERM assertion의 좁은 재실행은 16 tests/16 pass/0 fail/0 skipped이며 대상 7개 파일의 hashes가 전후 동일하다(`.codex-artifacts/final-static-environment-rerun-result.json`). 이는 원래 전체 결과를 덮어쓰거나 새로운 full-suite PASS를 뜻하지 않는다. 마지막 수정의 narrow suite는 별도 receipt로 기록하며 이를 full suite·full DB·strict consumer·whole-branch·production PASS로 확대하지 않는다.

일반 source push/PR merge/deploy는 parent/controller가 gates 이후 진행하도록 승인했다. 순서는 accepted branch source/preview + CI/whole-branch gates → exact hosted SQL 설치·ACL action-time 승인 → 기존 여섯 개와 추가 opt-in 수정으로 구성된 일곱 개의 고정된 AI migration을 정렬 순서대로 설치하고 최종 schema/RPC/ACL 호환성을 읽기 전용으로 확인 → protected main merge/production app build다. main의 Supabase workflow는 isolated validation이며 hosted SQL push가 아니다. 문서화된 Vercel main production build는 자동이므로 SQL 호환성 확인이 먼저다. 실제 hosted target·pending migration ledger·Vercel project/environment·복원 artifact는 미확정이다. 보안 SQL 설치, credential/grant, secure webhook/config, scheduler와 live Chat에는 각각 정확한 대상의 action-time 확인을 유지한다.

Task 6 문서 준비 완료와 Task 7 실제 수용 완료는 별도다. 미완성 필드가 있는 행은 실행 packet으로 사용할 수 없다.

## 2. 고정 7개 공간 inventory

아래 resource name은 secret이 없는 parent 제공 운영 inventory다. webhook URL, key/token, credential 원문, 환경값은 문서·대화·로그·commit에 넣지 않는다. opaque ID만으로 DM 여부나 구성원을 추론하지 않는다.

| 고정 symbolic slot | 팀 | 기존 UI resource name | 기존 webhook 표시명 | 존재 확인 | 실제 수신자·유형·server 연결 |
| --- | --- | --- | --- | --- | --- |
| `space_1` | 경영팀 | `spaces/AAQAZHFa_Yg` | 팁스 경영팀 로봇 | 기존 UI 읽기 전용 기록 | 미확인·미승인 |
| `space_2` | 관리팀 | `spaces/AAQAsD_g4DM` | 팁스 관리팀 로봇 | 기존 UI 읽기 전용 기록; parent 전달 기존 사용 이력 | 미확인·미승인 |
| `space_3` | 조교팀 | `spaces/AAQAXb8HMAo` | 팁스 조교팀 로봇 | 기존 UI 읽기 전용 기록 | 미확인·미승인 |
| `space_4` | 영어팀 | `spaces/AAQAxCv069Q` | 팁스 영어팀 로봇 | 기존 UI 읽기 전용 기록 | 미확인·미승인 |
| `space_5` | 전체공지 | `spaces/AAQAFfzkm6s` | 팁스 로봇 | 기존 UI 읽기 전용 기록 | 미확인·미승인 |
| `space_6` | 수학팀 | `spaces/AAQAfT66y5o` | 팁스 수학팀 로봇 | 기존 UI 읽기 전용 기록 | 미확인·미승인 |
| `space_7` | 과학팀 | `spaces/AAQAQ9dIWVQ` | 팁스 과학팀 로봇 | 기존 UI 읽기 전용 기록 | 미확인·미승인 |

**새 webhook 생성은 필요하지 않다.** slot 순서는 parent 제공 순서와 고정 팀 label의 deterministic mapping이다. 실제 resource/env/webhook secure mapping은 아직 활성화하지 않았고 모든 runtime slot은 `configured:false`다. 일반 UI/API는 symbolic key·label·configured/selectable·안전한 reason/revision만 노출한다.

승인 직전 확인할 비밀 없는 필드: slot별 현재 resource name·표시명·수신자 또는 접근그룹 확인 reference·공간 유형(DM 제외)·검토 주체/시각, secure webhook reference가 같은 space로 향한다는 설정 검증 receipt. 실제 구성원 목록이나 학생 정보를 이 문서에 복사할 필요는 없다. 관리팀의 과거 사용이 현재 수신자 동의나 새 sender 권한을 대신하지 않는다.

사용자별 기본 허용은 `[]`다. 최초 테스트에는 active synthetic test requester의 정확한 account ID와 `spaceKeys:["space_2"]`만 별도 검토한다. 기존 직원에게 7개 전체 권한을 자동 부여하지 않는다. admin도 고정 catalog 밖 공간을 선택할 수 없다. 허용 정책은 미설정 slot에 저장할 수 있지만 configured가 될 때까지 선택·송신이 차단된다.

## 3. 첫 credential·업무 범위 제안

초기 목적은 **합성 요청 수신 확인 및 요청 상태/결과 기록, 관리팀 opt-in 완료 알림**이다. 새 AI credential만 사용하며 기존 class/calendar key·scope·private verifier를 확대하지 않는다.

| 필드 | 검토안 |
| --- | --- |
| label | `Muse AI 요청 검증 2026-10-03` |
| 발급자 | 승인 시 특정하는 현재 active admin/해당 issuer account ID; 아직 미확정 |
| scopes | `ai-agent:requests:read`, `ai-agent:requests:claim`, `ai-agent:requests:update`, `chat:outbox:read`, `chat:send` |
| queue | `employee_requests`만 |
| lifecycle actions | `read`, `claim`, `renew`, `progress`, `question`, `done` |
| Chat space/purpose | `space_2` / `ai_completion`만 |
| bridge source | 최초 발급에는 `bridgeSourceId` 없음, `bridge_reply` 없음 |
| domain action kinds/targets | **없음**; registry는 비활성, domain grant 없음 |
| expiry | 발급 시각 + 24시간 제안. 승인 직전 절대 UTC `expiresAt`와 발급 대상에 고정; 자동 갱신/연장 없음 |
| 회수 | 발급 receipt의 credential ID로 새 목적별 revoke; queue/Chat grant도 함께 회수. 원문 token은 보안 주입 transport에만 전달 |

issuer RPC의 검토용 grant 구조(호출하지 않음):

```json
{
  "queues": ["employee_requests"],
  "actions": ["read", "claim", "renew", "progress", "question", "done"],
  "spaceKeys": ["space_2"],
  "purposes": ["ai_completion"]
}
```

현재 issuer의 queue grant는 `employee_requests` 전체다. **단일 synthetic request ID에 제한된 credential이라고 표시하지 않는다.** 이 grant는 해당 queue의 직원 요청 읽기와 lifecycle 처리권을 갖는 지속권한이므로 parent가 그 범위를 명시적으로 승인 대상으로 제시한다. 최초 worker의 실행 선택은 승인된 test request ID 1건에 고정하고 다른 요청은 처리하지 않는다. queue 전체 읽기 범위를 승인하지 않으면 이 issuer로 키를 발급하지 않는다. 필요한 좁은 queue/요청 grant는 별도 구현·review 대상이지 이 문서로 만들어지는 기능이 아니다.

`actions`는 lifecycle 동작이며 업무 변경 종류가 아니다. 일반 직원의 본문·답변·sourceReference·“승인됨” 문구는 관리자 승인 증거가 아니다. unsupported action kind는 계속 deny한다. 실제 업무 변경을 도입할 때는 등록된 enabled adapter, bot의 기존 API scope 및 exact kind/target/payload hash grant, 요청자의 현재 domain permission을 모두 교차 검증한다. stable action/step identity, 현재 claim, domain operation receipt/reconciliation producer와 action-time approver 증거까지 별도 검토한다. 발급자가 admin이라는 사실로 요청자의 권한을 승격하지 않는다. 이번 safe test는 수업·시간표·calendar·학사업무·학생정보를 변경하지 않으며 외부 업무 action을 등록/시작하지 않는다.

## 4. 보안 설정 hand-off

최종 production resolver와 지원 RPC는 구현됐지만 운영 설정은 미등록·미승인이다. 아래는 `chat-runtime-configuration.ts`·`chat-space-catalog.ts`의 reference **이름**뿐이다. 값·URL·token은 기록하지 않는다. Muse credential 보안 저장 reference는 아직 unresolved이며 환경변수 이름을 추측하지 않는다.

| 설정 대상 | 최종 reference 이름·검증 receipt | 현재 |
| --- | --- | --- |
| Muse 신규 AI opaque credential 보안 저장 reference | `PENDING_TASK5_MUSE_CREDENTIAL_REFERENCE` — placeholder, 환경변수 아님 | 미등록 |
| 인증된 dashboard absolute origin | `TIPS_AI_CHAT_PUBLIC_ORIGIN` | 운영 origin·승인 receipt 미확정 |
| `space_1` 경영팀 webhook reference | `TIPS_AI_CHAT_SPACE_1_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_1_RESOURCE_NAME` | 미설정 |
| `space_2` 관리팀 webhook reference | `TIPS_AI_CHAT_SPACE_2_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_2_RESOURCE_NAME` | 최초 1개만 활성화 검토 |
| `space_3` 조교팀 webhook reference | `TIPS_AI_CHAT_SPACE_3_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_3_RESOURCE_NAME` | 미설정 유지 |
| `space_4` 영어팀 webhook reference | `TIPS_AI_CHAT_SPACE_4_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_4_RESOURCE_NAME` | 미설정 유지 |
| `space_5` 전체공지 webhook reference | `TIPS_AI_CHAT_SPACE_5_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_5_RESOURCE_NAME` | 미설정 유지 |
| `space_6` 수학팀 webhook reference | `TIPS_AI_CHAT_SPACE_6_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_6_RESOURCE_NAME` | 미설정 유지 |
| `space_7` 과학팀 webhook reference | `TIPS_AI_CHAT_SPACE_7_WEBHOOK_URL` / `TIPS_AI_CHAT_SPACE_7_RESOURCE_NAME` | 미설정 유지 |
| Runtime→DB configured catalog synchronization·origin/config revision | service-only `ai_agent_chat_configuration_api_v1(get/sync)` | source 구현 수용; 운영 sync 미실행 |
| Stable bridge source resolver | service-only `ai_agent_chat_bridge_grant_v1` | 최초 completion credential에는 불필요; 유효 bridge_reply/source grant 없으면 deny |

Chat runtime flag reference는 `TIPS_AI_CHAT_ENABLED`다. configuration sync의 명시적 호출 계약은 `scripts/sync-ai-agent-chat-configuration.mjs --revision <current> --idempotency-key <UUID> --issuance-enabled <true|false>`이며 applied 응답 이후 current GET snapshot을 검증한다. 이 명령은 여기서 실행하지 않았다.

credential UI의 최종 공개 경로는 authenticated-only `public.ai_agent_credential_api_v1(text,jsonb)`의 list/create/revoke다. 내부에서 active admin과 issuer ownership을 재검증하며 신규 create는 `issuance_enabled`를 검사한다. 기존 create/list/revoke helper 3개는 PUBLIC/anon/authenticated/service_role 모두 직접 EXECUTE가 revoke되었다. 요청 bot/Chat gateway, configuration sync와 bridge-grant resolver는 service_role-only이고 직원 RPC는 authenticated-only다. 최초 성공 create에서 raw token을 한 번 반환하며 receipt/replay는 token null이고 hash는 반환하지 않는다. 실제 발급·보안 주입은 별도 승인이다.

설치 기본값은 support `issuance_enabled=false`, Chat runtime flag OFF, origin null, 7 slots unconfigured, 직원 permission `[]`, domain registry empty/disabled다. `issuance_enabled=false`는 새 credential create만 차단하며 기존 키·송신의 kill switch가 아니다. 중지는 exact worker stop, runtime OFF + 검증된 configuration sync, credential/grant revoke, 필요 user policy clear를 각각 수행하고 audit/receipt/attempt를 보존한다. 요청 메뉴·직원 RPC 자체에는 deployment flag가 없다.

운영자/Muse는 승인된 secret 경로로만 주입하고 일반 hand-off에는 reference 이름, configured 상태, 설정 revision, receipt ID, 검토 주체/시각만 반환한다. source에 reference가 생겨도 production mapping 완료나 provider 성공을 뜻하지 않는다. 고정 Google HTTPS origin/path·같은 space·허용 query·redirect 거부를 검사하며 caller URL/host/query를 받지 않는다. 기존 webhook 생성·수정, secret 조회·복사, credential 발급은 이 packet 작성 중 실행하지 않았다.

## 5. Muse worker 연결 계약

새 job 제안명은 `Muse AI employee_requests/outbox poll`이다. 실제 scheduler ID·host·endpoint base·credential reference·시작 시각은 Muse 소유자가 action-time packet에 고정한다. 활성화 전 disabled다. 새 queue/outbox 조회는 **30분마다**, 실행 중 claim 갱신은 **5분마다**, lease는 **15분**이다. 기존 bridge의 운영시간(평일 13:30–22:30, 토요일 10:00–19:00 KST, 일요일 미실행), polling 간격·createTime watermark·CLI·cron은 Muse 소유로 그대로 유지한다.

1. 매 실행 `GET /api/ai-agent/requests?status=pending&limit=50`의 cursor 없는 첫 페이지에서 시작하고 `nextCursor`를 따라 bounded drain한다. createdAt watermark를 복사하지 않는다. 초기 검증에서는 승인된 test request ID만 claim한다. 매 실행 Chat outbox도 독립적으로 `GET /api/chat/outbox?status=pending&limit=50` 첫 페이지부터 `nextCursor`로 drain한다. 이 view는 pending + due definite `retry_wait`이며 unknown/incident는 제외한다.
2. 원문 nonce는 CSPRNG 256-bit/64 lowercase hex로 만들고 실행자의 비공개 단기 상태에만 둔다. `PATCH /api/ai-agent/requests/{id}` `{ "status":"processing" }`에 UUID `Idempotency-Key`, `If-Match: "r<version>"`, `X-Claim-Token`을 넣는다. 최초 claim에는 generation header가 없다. 서버는 hash만 저장한다. 응답 유실은 동일 key·version·nonce로 현재 live receipt를 복구하며 nonce를 잃거나 lease가 만료된 경우 새 claim으로 자동 재실행하지 않는다.
3. 반환된 decimal-string generation을 이후 `X-Claim-Generation`에 사용한다. renew는 processing + message/result 없음, progress는 processing + nonempty message다. 현재 If-Match를 유지하고 renew가 실패하면 신규 효과를 중단한다. stale version만 최신 state/owner/intent와 동일 live generation을 재검증한 뒤 같은 논리 key로 제한적으로 재시도한다. 다른 409는 해당 동작을 중단한다. 일반 GET+새 key retry 정책은 없다.
4. 질문은 `{ "status":"question","message":"…" }`로 append하고 claim을 종료한다. 직원의 questionId-linked answer append와 pending 전이는 같은 commit이다. 재개된 요청은 detail의 `nextMessageSeq`/`nextEventSeq`를 끝까지 읽어 최신 답변을 찾는다. 50개 첫 페이지나 createdAt만 보고 답변 없음으로 판정하지 않는다. GET detail은 nullable `nextMessageSeq`/`nextEventSeq`를 각각 `afterMessageSeq`/`afterEventSeq` query로 전달하며 최대 50개씩 두 흐름을 모두 null까지 drain한다. 요청 DTO의 `readyAt`은 queue-ready 시각으로 answer/admin resume에서 갱신되며 createdAt이 아니다. claim replay는 최초 If-Match version/key/nonce를 그대로 유지한다. 이후 renew/progress/question/done은 반환된 decimal `X-Claim-Generation`과 현재 request version을 사용한다. renew는 lease/audit만 바꾸고 업무 version/updatedAt을 바꾸지 않는다.
5. safe read-only 작업 결과를 `{ "status":"done","result":"…" }`로 기록한다. completion event와 opt-in outbox는 같은 commit이다. 신규 상태/결과 응답이 유실되면 현재 권한 검사를 통과한 exact same-key receipt를 복구한다. expired/unknown action의 done/resume은 자동 실행하지 않는다. 이미 등록·시작한 action/attempt의 늦은 결과만 현재 인증 아래 해당 기록에 append할 수 있고 새 작업/전송 권한을 만들지 않는다.
6. `POST /api/chat/send`에는 UUID `Idempotency-Key`와 origin header **정확히 하나**를 사용한다. 저장된 intent drain은 `X-Chat-Intent-ID`, bridge event는 원본 canonical `message.name`인 `X-Bridge-Event-ID`다. body `{space,thread?,text}`는 서버가 저장한 immutable 목적·대상·payload와 일치해야 한다. completion은 임의 text로 바꾸지 않는다. bridge source dedupe namespace는 credential rotation에도 유지되는 server grant의 stable source ID다. 중복 source `created:false`는 새 prepare/fetch를 허용하지 않는다.
7. **새로 durable commit된 non-null prepared attempt만 fetch 1회 권한을 준다.** commit 후 lock을 해제하고 네트워크를 호출한다. prepare 응답 유실·result-save 실패·현재 sending은 authoritative state/receipt로 확인하고 두 번째 fetch를 만들지 않는다. same prepare-key replay의 attempt=null도 fetch 0이다. retry_wait에서 최신 revision을 넣어 옛 key를 재사용하면 idempotency conflict로 멈춘다. definite 429의 due retry만 immutable intent/requestId/payload를 유지하며 새 논리 attempt key를 사용할 수 있다. 초기 safe test packet은 자동 외부 재시도 없이 dispatch 최대 1회로 제한한다. provider의 definite HTTP 429만 retry_wait 대상이며 최대 **총 다섯 번의 dispatch attempt**다. 지연은 `2^attemptCount`초 + intent별 deterministic jitter [0,1)이고 반환된 readyAt을 따른다. API 429만으로 retry_wait 전이를 증명하지 않는다. due retry는 기존 intent ID를 `X-Chat-Intent-ID`에 넣고 immutable payload/upstreamRequestId를 유지하며 새 logical attempt UUID를 사용한다. 응답 유실 복구는 원래 key/body로 수행하고 새 fetch를 만들지 않는다. `X-Bridge-Event-ID`는 원본 message.name이며 반복 bridge-source 호출은 attempt를 만들지 않고 due existing bridge retry는 intent header를 사용한다. Chat send에는 If-Match/claim headers를 넣지 않는다.

보호 HTTP envelope는 성공 200 `{data:…,error:null}`, 실패 `{data:null,error:{code:…}}`이며 no-store/private다. missing precondition 428, stale/domain conflict 409, inactive/권한/scope/grant 거부 401/403, not-found 404, atomic budget 429를 구분한다. 요청 business version과 action/outbox 자체 revision은 별개이고 모든 bigint counter는 decimal string이다. bot 및 Chat credential/global 60회/분, space dispatch 최소 1초, 직원 create 10회/시간/messages 30회/분, title 200자·body/result 20,000자·message 5,000자·JSON 128 KiB·serialized Chat 32,000 bytes 제한을 유지한다.

## 6. 최초 safe E2E 1건 제안

이 실행은 **아직 승인되지 않았다**. parent가 아래 미확정 필드를 완성해 송신 내용과 수신 범위를 함께 제시한다. 첫 업무 종류 결정에 종속되지 않는 synthetic 수신 확인이며 domain mutation은 0건이다.

| 항목 | exact 제안 |
| --- | --- |
| 요청자 | 특정 active test account ID·role, 검토 주체/시각: **미확정** |
| 제목 | `[검증] AI 에이전트 종단 테스트` |
| 본문 | 아래 exact body |
| 결과 | 아래 exact result |
| opt-in | `notifyOnDone:true`, `notificationSpace:"space_2"` |
| 수신자 | 관리팀 `spaces/AAQAsD_g4DM`; 현재 실제 수신자/접근그룹 확인 reference: **미확정** |
| 사용자 허용 | 해당 test requester에만 `spaceKeys:["space_2"]`; current revision/CAS·설정 receipt: **미확정** |
| thread mode | explicit completion top-level, thread 없음. human-thread 검증 아님 |
| Chat payload | 구현된 completion producer의 sanitized title + 완료 상태 + 승인된 absolute origin의 authenticated `/admin/ai-agent/<requestId>` 링크. body/Q&A/result/nonce/token 제외. 생성된 requestId·최종 serialized text·byte length를 송신 승인 전에 고정 |
| 실제 외부 dispatch | 최대 **1회**, 성공 새 message 목표 **1건**. 자동 retry·새 key 재송신·dedupe 시험·negative send 없음 |
| 도메인 변경 | 0건; class/calendar/학사업무 API mutation 및 action registry/grant 활성화 없음 |

exact body:

```text
합성 검증 요청입니다. 이 제목과 본문을 읽고 수신 확인 결과만 기록하세요. 수업·시간표·학사업무·학생정보를 변경하거나 외부 업무를 실행하지 마세요. 완료 알림은 승인된 관리팀 공간으로 1회만 전송합니다.
```

exact result:

```text
수신 확인 완료. 제목: [검증] AI 에이전트 종단 테스트. 본문을 읽었으며 수업·시간표·학사업무·학생정보 변경 및 외부 업무 실행은 수행하지 않았습니다.
```

첫 poll→claim→수신 확인→PATCH done→outbox→Chat receipt를 하나의 evidence chain으로 기록한다. 송신 전 action-time 기록에 account ID, requestId, event ID, intent ID, exact serialized Chat text/hash/byte length, space/수신자, thread 없음, 단일 dispatch key/상한, approval reference·승인자·만료를 묶는다. 요청 생성 승인과 외부 송신 승인을 구분한다. 실행자가 아직 채워지지 않은 placeholder를 추측해 대체하면 안 된다.

성공 evidence는 requestId, done event/version, intent/upstreamRequestId, attempt ID, provider status, 기대 space의 `message.name` 및 반환 `thread.name`, 확인 주체/시각과 secret 없는 화면 reference다. 성공 HTTP 코드만으로 sent를 확정하지 않는다. 요청 done과 알림 sent는 각각 확인한다. 단 한 번이라도 ambiguous delivery가 생기면 중단하고 §8을 따른다.

## 7. 실제 thread·negative 수용의 별도 packet

최초 completion test는 실제 human-thread 지원을 증명하지 않는다. [Google create-message](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create), [Thread](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages#Thread), [webhook guide](https://developers.google.com/workspace/chat/quickstart/webhooks), [limits](https://developers.google.com/workspace/chat/limits)는 parent가 2026-10-03 확인한 설계 근거다. shared API 설명과 실제 incoming webhook의 임의 human-thread 지원/requestId dedupe는 구분한다. 이 packet에서 외부 조회나 provider 호출은 하지 않았다.

bridge test가 별도 승인되면 고정 `space_2`, server-verified stable `bridgeSourceId`와 `bridge_reply` purpose, 정확한 기존 human `thread.name`, 원본 Google `message.name`, 검토된 exact reply text·수신자·최대 dispatch 횟수를 먼저 고정한다. 원본 identity는 Muse가 기존 승인된 관찰 경로에서 제공하고 이 작업이 기존 bridge/CLI/poll/watermark를 바꾸지 않는다. source ID나 직원 입력 자체는 승인 증거가 아니다.

| 수용 대상 | 필요한 실제 증거·중단 조건 | 현재 |
| --- | --- | --- |
| 기존 human thread 답글 | 원본 같은-space `thread.name` + `REPLY_MESSAGE_OR_FAIL`, 반환 message/thread가 정확히 일치, 해당 thread에서 답글 확인 | **LIVE UNVERIFIED** |
| 없는 thread | 별도 승인된 없는 thread target의 definite failed; 동일 space의 root message 0건을 확인하는 독립 관찰 권한/증거 | **LIVE UNVERIFIED**; 관찰 수단 없으면 수용 보류 |
| cross-space thread | 승인된 safe local 입력으로 provider fetch 0인 preflight 거부 | accepted Task 5 로컬 handler/DB negative 증거; 최종 통합 receipt는 별도. actual send 금지 |
| source/intent 재호출 | 같은 event/논리 key에 현재 durable receipt, 새로운 attempt/message 0. provider 재호출 없는 검증부터 수행 | accepted Task 5 actual local DB parity; 최종 strict consumer receipt는 별도 |
| webhook requestId dedupe | 별도 승인된 provider 시험과 메시지 개수 증거가 있을 때만 판정 | **LIVE UNVERIFIED**; 시험 없이 보장하지 않음 |

human thread에 실패하면 새 글 fallback, threadKey 변환, 다른 space 재송신, 다른 credential/auth 방식의 임의 생성은 금지한다. 실제 webhook이 해당 thread를 지원하지 않으면 bridge activation을 차단하고 blocker로 기록한다. **Exactly-once delivery는 보장하지 않는다.** at-least-once 입력을 DB CAS/stable identity/receipt로 억제하며 provider 수락 후 응답 유실은 unknown으로 남는다.

## 8. Stop·회수·복구

| 상황 | 운영자가 수행할 승인된 중지·복구 |
| --- | --- |
| 발급/설정/scheduler 승인 없음 또는 gate 미수락 | 설정을 disabled/unconfigured로 유지; key 발급·env 주입·job enable·fetch를 시작하지 않음 |
| credential 회수/만료·issuer 비활성 | 새 AI 목적별 credential ID revoke/자동 만료 확인, 신규 poll/claim/dispatch 정지; 기존 class key/bridge credential은 건드리지 않음 |
| space 연결 또는 수신자 잘못됨 | 해당 runtime/configured slot off 및 승인된 catalog revision 반영, 해당 test user의 space permission 회수, 신규 dispatch 정지; done 결과는 보존 |
| claim renew 실패/lease 만료·취소 | 신규 효과 중지. expired를 자동 pending/재claim/done으로 바꾸지 않음; 이미 시작한 기록의 late-result append만 current auth 아래 허용 |
| provider timeout/response loss/5xx/모호한 성공·result 저장 실패 | sending/unknown 또는 incident 보존, 자동 retry·새 key·다른 space·root fallback 없음. 승인된 관찰로 전달 여부와 recipient를 확인 |
| definite 429 | 일반 운영 계약은 provider definite HTTP 429의 due retry_wait/new logical attempt key/총 dispatch attempt 최대 다섯 번. 첫 1회 test는 stop하고 추가 dispatch 승인을 확보 |
| unresolved action/delivery | 실제 domain operation receipt 또는 구체적인 admin observation을 exact target/hash와 대조. reason + confirmed만으로 해소하지 않음. 확인 불가능하면 unknown 유지 |
| production 배포 문제 | 특정 release/project의 stop/restore plan과 migration 적용 evidence를 parent/운영 소유자가 먼저 확정. 이 문서는 실행 가능한 운영 rollback target을 아직 제공하지 않음 |

key/space 회수와 scheduler disable은 이미 발송한 메시지를 되돌리지 않는다. grant 회수 후 bot late append를 인증할 수 없으면 admin의 별도 검토·reconcile 경로를 사용한다. DB audit/receipt/attempt를 삭제하거나 unknown을 실패로 가정해 재전송하지 않는다. 구현된 configuration sync/revoke 계약에 따라 실제 중지 receipt를 별도로 기록한다. issuance OFF만으로 기존 키·송신 중지를 증명하지 않는다.

## 9. 실행 후 채울 secret 없는 evidence

운영 실행 항목은 **미실행**이며 로컬 acceptance·통합 상태는 위 controller receipt와 별도로 기록한다. 아래 운영 기록란을 성공처럼 채우지 않는다. Task 7 acceptance 문서는 실제 실행 날짜의 `docs/reviews/<date>-ai-agent-requests-acceptance.md`에 별도로 작성한다.

| 기록 | 필수 비밀 없는 값 | 현재 |
| --- | --- | --- |
| 로컬 acceptance | Tasks 3/4/5 accepted SHA·review 결과·QA report·browser reference; 역사적 C20 기록과 새 main `e5a97507…` merge/fresh full regression·final HEAD를 별도 기록 | Tasks 1–5 `47131276…` 수용; `737dfd72…` 통합 QA는 위 receipt. 마지막 수정·fresh browser/full DB/strict consumer/whole-branch gate 대기 |
| 통합 등록 | integration owner identity·ordered filenames/SHA-256·immutable manifest receipt | CI scoped `737dfd72…` 수락; canonical 146/captures 24/frozen CI 17·six AI migrations 보존; 운영 설치 증거 아님 |
| production migration/deploy | 승인 reference·운영 target·release SHA·migration 결과·시각·stop/restore receipt | 미실행 |
| credential/grant | issuer·credential ID·scopes/grant·UTC expiry·승인 reference·보안 reference 이름·revoke receipt | 미발급 |
| runtime/catalog | slot/resource·recipient check reference·configured/revision·origin reference·검증 receipt | 미설정 |
| 사용자 허용 | test account ID·spaceKeys·revision·설정/회수 receipt | 미변경 |
| scheduler | Muse owner·job ID/host·30분/5분·start/stop receipt·권한 reference | 미활성화 |
| 최초 E2E | request/event/version/intent/upstreamRequestId/attempt/message/thread IDs·exact payload hash·provider 결과·dispatch/message count | 미실행 |
| thread·negative/dedupe | 각각의 별도 approval·exact target·provider/관찰 evidence·root count·fetch count | LIVE UNVERIFIED |
| 최종 수용 | 완료된 층·remaining blockers·whole-branch review·Task 7 acceptance reference | 미수용 |

남은 필드의 확정은 운영상 action-time target 구체화이며 이미 승인된 설계 결정을 다시 묻는 절차가 아니다. parent가 승인과 소유자 hand-off를 담당한다. 이 문서 준비자는 운영 설정·외부 전송이나 Task 7 수용을 실행/선언하지 않는다.
