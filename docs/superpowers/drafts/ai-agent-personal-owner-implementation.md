# 선생님 소유 AI 자격 증명 — 격리 구현 초안

기준: PR91 `0243fac336f578f7a5a89924eaeadd810c84e19e` 이후 로컬 branch `codex/ai-agent-personal-owner-20261005`. 운영 적용, key 발급, 권한 설정, push·병합·배포는 실행하지 않는다. 기존 7개 AI migration과 CI manifest는 이 초안의 변경 대상이 아니다.

## 구현 경계

`owner_profile_id`는 AI 자격 증명의 불변 소유자이며 `created_by`는 관리자인 발급자다. 발급자의 JWT나 관리자 역할을 소유자 또는 봇의 업무 권한으로 사용하지 않는다. 기존 자격 증명은 `central`로 유지하고 개인 키로 변환하지 않는다. 새 개인 키는 현재 유효한 `teacher` 계정에만 결속한다. 개인 키가 보는 행은 `requester_id = owner_profile_id`로 제한한다. 명시 scope·queue·action·Chat space grant는 이 범위를 더 좁힐 수 있다.

개인 키의 현재 권한은 매 요청마다 DB의 profile 역할과 Auth 계정 삭제·정지 상태를 다시 확인한다. 읽기·상세·질문답변 조회·claim·lease 갱신·진행·질문·완료와 저장된 receipt 재생에 같은 소유자 경계를 적용한다. 현재 역할이 `teacher`에서 변경되면 승진을 포함해 접근을 차단하는 보수적인 초기 계약이다. 직원의 본문과 질문 답변은 외부 업무 실행이나 새로운 권한 설정의 승인이 아니다.

완료 알림은 소유자의 요청, 현재 소유자 Chat 공간 권한, 자격 증명의 명시 공간·목적 grant를 모두 만족해야 한다. outbox 목록·상세·attempt 준비·결과 append·retry/replay에서도 이 교집합을 검사한다. 개인 키의 상세 응답은 과거 attempt 이력을 숨기고, 기존 sender가 검증하는 고정 payload·대상 및 현재 dispatch receipt만 제공한다. 이는 본인 opt-in 완료 알림 운송의 위임이며 일반 Chat 송신이나 임의 문구 전송 권한이 아니다. 개인 키의 `bridge_reply`와 domain action 등록·실행·결과 기록은 이 초안에서 차단한다. 실제 업무별 현재 권한 callback을 연결하기 전에는 큐 처리 권한이 다른 학생·수업·외부 앱 작업을 허용하지 않는다.

## 최소 수직 단위

별도 `ai_agent_personal_credential_api_v1` RPC는 관리자에게 명시 `ownerProfileId` 발급 요청을, 선생님에게 본인 키의 metadata 조회·폐기를 제공한다. 응답은 `credentialKind: personal`, `ownerProfileId`, `issuerProfileId`를 필수로 구분한다. 원문 key는 최초 발급 응답에서만 반환하고 idempotency replay는 `token: null`이다. support OFF는 기존 계약대로 신규 발급을 막으며, 현재 발급자·소유자 검증을 통과한 같은 key의 metadata readback은 허용한다. 기존 key의 실행 중지는 credential/grant 회수와 별도 runtime 중지 절차를 따른다. 실제 발급은 수행하지 않는다.

새 TypeScript client는 이 RPC만 호출한다. 다른 소유자·발급자의 응답, 중앙 key 응답, 내부 hash·알 수 없는 필드를 거부한다. 비동기 응답 전에 계정·역할이 바뀌면 원문 key와 목록을 반환하지 않는다. 기존 중앙 키 UI와 opaque bot token/JWT 분리 경로를 유지한다.

후속 로컬 단위는 기존 관리자 `AI 연결` 화면에 `개인 요청 키` 탭을 추가한다. 중앙 `AI 요청 키` 컴포넌트와 직원 메뉴 권한은 변경하지 않는다. 관리자는 현재 유효한 선생님을 직접 선택하며 기본 선택은 없다. 이름이 없거나 같아도 UUID를 함께 표시한다. 관리자 전용 `owners` 조회는 페이지와 크기만 받고, 현재 관리자 profile/Auth 상태를 잠근 뒤 유효한 선생님 후보를 반환한다. 후보 목록은 조회 당시 참고값이며 CREATE에서 선택한 선생님을 잠그고 현재 상태를 다시 검증한다. 발급·목록 DTO는 nullable `ownerName`/`issuerName`과 불변 UUID를 구분한다. 이름은 표시용이며 권한 근거가 아니다. 발급·재생 receipt의 이름은 당시 기록, 목록 이름은 현재 profile 표시값이다.

초기값은 본인 요청 읽기, 1일, 완료 알림 OFF다. 알림을 선택하면 현재 configured/selectable 공간 중 사용자가 명시한 공간만 `ai_completion` grant에 포함한다. 중앙 키와 별도 페이지 설정·idempotency journal을 사용한다. 불확실한 발급은 같은 소유자·payload·key를 고정하여 확인하고, 재생에는 원문 key가 없다. 취소·권한 거부·중복 클릭·탭 재진입·역할 변경 후 늦은 응답을 합성 검사한다. 이 UI는 실제 발급·폐기 실행 허가가 아니다.

합성 Next 개발 서버에서 기존 요청 service의 StrictMode effect cleanup 후 같은 memoized service가 폐기된 채 재사용되어 공간 조회가 실패하는 문제를 재현했다. effect setup의 명시 `mount()`와 lifecycle epoch로 같은 현재 actor의 재진입을 허용하면서 이전 session/fetch/JSON await는 차단한다. 기존 중앙 탭과 개인 탭의 StrictMode 읽기 회귀를 검증한다. 별도 request-list controller의 수명주기까지 수정·검증했다고 주장하지 않는다.

SQL은 `ai-agent-personal-owner.sql`에 추가 migration **초안**으로만 보존한다. 정식 migration 생성·번호 및 설치 manifest 편입은 후속 적용 검토에서 결정한다. PATH에서는 Supabase CLI를 확인하지 못했으며 설치·로그인·link를 진행하지 않는다.

## 검증과 적용 전 결정

Node synthetic 검증, 합성 loopback 브라우저, 외부 연결·포트·운영 설정이 없는 소유 Docker PostgreSQL의 focused integration을 구분한다. 로컬 PG는 기존 7개 migration 원문 뒤에 초안을 실행하고 최종 정의의 pgTAP 허용·거부 및 정확한 SQLSTATE를 검사한다. 최소 bootstrap은 전체 운영 catalog의 parity 증거가 아니다. 원격 CI, 운영 DB 설치, 실제 key, webhook, scheduler, Chat provider 종단 발송은 별도 미검증이다.

기존 로컬 milestone `9dab3fa8`의 86+483 pgTAP, 새 Node 25건과 원본 receipt/artifact는 그대로 보존한다. 이번 최종 focused PG 검증은 개인 124개, 변경하지 않은 기존 SQL 6개 suite 483개, 실제 네 경합의 pgTAP 8개로 **615/615**, skip 0이다. 최초 발급·metadata-only replay·비어 있지 않은 목록·관리자 소유자 조회의 실제 SQL DTO 4종을 production TypeScript schema/client 4회로 읽었다. 모든 source pin 26개와 실행 후 sourceStable, 소유 child/DB session/컨테이너 제거를 확인했다. 실패 attempt 1·2도 별도 보존한다.

실제 경합은 Lock wait와 blocker PID membership을 관측한 뒤 진행했다. 같은 요청의 두 claim은 승자 `00000`, 패자 `55000/ai_agent_conflict`로 단일 claim/event/receipt를 만든다. 먼저 역할을 낮춘 뒤 대기 중인 claim은 `42501/ai_agent_forbidden`이며 변경 0건이다. 먼저 claim이 profile을 잠근 경우 역할 변경은 대기 후 `00000`; 이후 같은 receipt 재생은 `42501`이다. 완료 attempt 준비 후 공간 권한을 철회하고 같은 key로 재시도하면 `42501/ai_agent_space_forbidden`이며 추가 attempt/receipt/rate/global quota/공간 dispatch clock 변경이 없다. 실제 DB collision이 아닌 domain 상태를 `40001`로 표시하지 않는다.

이 DB는 PG 17.6 / pgTAP 1.3.3의 focused bootstrap이다. legacy 발급기의 최종 함수·공개 ACL은 원문으로 재생하고 private table/helper ACL은 해당 대상의 권한 회수로 투영한다. 실제 legacy 발급기는 실행하지 않는다. legacy 알림 테이블은 빈 카운터이므로 전체 알림 subsystem의 no-send integration 증거가 아니다.

최종 전체 TypeScript와 변경 소스 ESLint가 통과했다. 관련 AI·기존 agent Node 파일 22개는 **267/269**, skip 0이며 실패 2개 모두 기존 정식 current-run capture receipt 부재다. 개인 UI 22개와 기존 중앙 UI 8개, lifecycle service 15개, QA runtime 음성 검사 21개는 이 결과에 포함된다. 공유 디자인 계약 9개 파일의 63개 검사도 통과했다. 실제 브라우저는 1440/390px × light/dark 네 조합 모두 통과했고, 기존 중앙 화면과 같은 조건의 스타일·포커스·overflow·에러·취소·복구를 확인했다. 외부 요청/페이지 오류/Chat provider 호출은 0건이며 실제 발급 0건이다. 브라우저 첫 실패는 기존 StrictMode 문제의 증거로 보존한다.

정식 parity 두 개는 기존 full-run capture chain의 reviewed 147개 baseline, SQL 88개 suite, probe 17개 및 original driver의 현재 실행 receipt를 요구한다. 승인된 focused network-none runner는 이 전체 closure를 재현하지 않는다. original driver/CLI/receipt guard를 변경하거나 focused receipt로 gate를 대체하지 않았다. 전체 baseline/필수 CI, 실제 provider JWT·Chat, 운영 적용은 미검증으로 남긴다.

| 범위 | 이번 검증과 권한 경계 |
| --- | --- |
| 개인 요청 inbox | 소유자 행만 조회·claim·진행·질문·완료; 현재 teacher/Auth 상태와 grant 재확인 |
| 본인 완료 알림 | opt-in 및 현재 공간 권한과 명시 grant 교집합; durable attempt/retry의 철회 검사, 실제 Chat 미전송 |
| 중앙 키 | 기존 컴포넌트·정책 유지; StrictMode 읽기만 추가 회귀, 실제 기존 발급기 실행 미검증 |
| 수업·학사일정·기타 업무 API | 기존 단위 계약 검사는 실행했지만 개인 키 permission callback·업무 실행은 구현/통합 검증하지 않음 |
| 기존 Chat bridge | polling·송신 경로 유지, 개인 키 `bridge_reply` 차단; provider 연결·발송 미검증 |

후속 결정은 (1) 선생님 역할 변경 시 보수적인 차단 정책과 직원 본인 설정 UI의 위치, (2) 업무별 permission callback과 action-time 승인 경계다. 이번에는 관리자 탭만 연결하며 직원용 새 메뉴 권한은 부여하지 않는다. 새 key 발급, 지속 scope/grant 확대, server credential 설정, 새 webhook, polling 활성화, SQL 적용 및 실제 종단 테스트는 정확한 대상과 내용을 검토한 뒤 별도 승인 단계로 남긴다. 이번 후속 작업은 로컬 커밋·보존까지만 진행하고 push/PR/병합/배포는 하지 않는다. PR97 hold와 고정 7개 migration은 유지한다.

RLS 및 privileged 함수의 정책·ACL 근거는 [Supabase RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)와 [PostgreSQL 17 RLS 문서](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)를 확인했다. repository의 최종 ordered migration 정의를 실제 판단 기준으로 사용하며 기존 no-send, CAS·lease, append-only audit와 idempotency 계약을 보존한다.
