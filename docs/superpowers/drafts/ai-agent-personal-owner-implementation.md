# 선생님 소유 AI 자격 증명 — 격리 구현 초안

기준: PR91 `0243fac336f578f7a5a89924eaeadd810c84e19e` 이후 로컬 branch `codex/ai-agent-personal-owner-20261005`. 운영 적용, key 발급, 권한 설정, push·병합·배포는 실행하지 않는다. 기존 7개 AI migration과 CI manifest는 이 초안의 변경 대상이 아니다.

## 구현 경계

`owner_profile_id`는 AI 자격 증명의 불변 소유자이며 `created_by`는 관리자인 발급자다. 발급자의 JWT나 관리자 역할을 소유자 또는 봇의 업무 권한으로 사용하지 않는다. 기존 자격 증명은 `central`로 유지하고 개인 키로 변환하지 않는다. 새 개인 키는 현재 유효한 `teacher` 계정에만 결속한다. 개인 키가 보는 행은 `requester_id = owner_profile_id`로 제한한다. 명시 scope·queue·action·Chat space grant는 이 범위를 더 좁힐 수 있다.

개인 키의 현재 권한은 매 요청마다 DB의 profile 역할과 Auth 계정 삭제·정지 상태를 다시 확인한다. 읽기·상세·질문답변 조회·claim·lease 갱신·진행·질문·완료와 저장된 receipt 재생에 같은 소유자 경계를 적용한다. 현재 역할이 `teacher`에서 변경되면 승진을 포함해 접근을 차단하는 보수적인 초기 계약이다. 직원의 본문과 질문 답변은 외부 업무 실행이나 새로운 권한 설정의 승인이 아니다.

완료 알림은 소유자의 요청, 현재 소유자 Chat 공간 권한, 자격 증명의 명시 공간·목적 grant를 모두 만족해야 한다. outbox 목록·상세·attempt 준비·결과 append·retry/replay에서도 이 교집합을 검사한다. 개인 키의 상세 응답은 과거 attempt 이력을 숨기고, 기존 sender가 검증하는 고정 payload·대상 및 현재 dispatch receipt만 제공한다. 이는 본인 opt-in 완료 알림 운송의 위임이며 일반 Chat 송신이나 임의 문구 전송 권한이 아니다. 개인 키의 `bridge_reply`와 domain action 등록·실행·결과 기록은 이 초안에서 차단한다. 실제 업무별 현재 권한 callback을 연결하기 전에는 큐 처리 권한이 다른 학생·수업·외부 앱 작업을 허용하지 않는다.

## 최소 수직 단위

별도 `ai_agent_personal_credential_api_v1` RPC는 관리자에게 명시 `ownerProfileId` 발급 요청을, 선생님에게 본인 키의 metadata 조회·폐기를 제공한다. 응답은 `credentialKind: personal`, `ownerProfileId`, `issuerProfileId`를 필수로 구분한다. 원문 key는 최초 발급 응답에서만 반환하고 idempotency replay는 `token: null`이다. support OFF는 기존 계약대로 신규 발급을 막으며, 현재 발급자·소유자 검증을 통과한 같은 key의 metadata readback은 허용한다. 기존 key의 실행 중지는 credential/grant 회수와 별도 runtime 중지 절차를 따른다. 실제 발급은 수행하지 않는다.

새 TypeScript client는 이 RPC만 호출한다. 다른 소유자·발급자의 응답, 중앙 key 응답, 내부 hash·알 수 없는 필드를 거부한다. 비동기 응답 전에 계정·역할이 바뀌면 원문 key와 목록을 반환하지 않는다. 기존 중앙 키 UI와 opaque bot token/JWT 분리 경로를 유지한다. 개인 키 발급 화면 및 직원용 설정 메뉴 연결은 이번 최소 단위에 포함하지 않는다.

SQL은 `ai-agent-personal-owner.sql`에 추가 migration **초안**으로만 보존한다. 정식 migration 생성·번호 및 설치 manifest 편입은 후속 적용 검토에서 결정한다. PATH에서는 Supabase CLI를 확인하지 못했으며 설치·로그인·link를 진행하지 않는다.

## 검증과 적용 전 결정

Node synthetic 검증과 외부 연결·포트·운영 설정이 없는 소유 Docker PostgreSQL의 focused integration을 구분한다. 로컬 PG는 기존 7개 migration 원문 뒤에 초안을 실행하고 최종 정의의 pgTAP 허용·거부 및 정확한 SQLSTATE를 검사한다. 최소 bootstrap은 전체 운영 catalog의 parity 증거가 아니다. UI 변경·브라우저 검증, 원격 CI, 운영 DB 설치, 실제 key, webhook, scheduler, Chat provider 종단 발송은 별도 미검증이다.

현재 로컬 검증은 새 Node 25건, 전체 TypeScript, 변경 소스 ESLint, 개인 소유자 pgTAP 86건 및 변경하지 않은 기존 SQL 6개 suite 483건이 통과했다. 실제 SQL 최초 발급·metadata-only replay·비어 있지 않은 목록 응답을 production TypeScript schema와 client로 읽는 검증도 통과했다. 이 DB는 PG 17.6 / pgTAP 1.3.3의 focused bootstrap이다. legacy 발급기의 최종 함수·공개 ACL은 원문으로 재생하고 private table/helper ACL은 해당 대상의 권한 회수로 투영한다. 실제 legacy 발급기는 실행하지 않는다. legacy 알림 테이블은 빈 카운터이므로 전체 알림 subsystem의 no-send integration 증거가 아니다. 개인 소유자 동시 잠금 대기 검증과 전체 baseline/필수 CI는 남아 있다. 별도 전체 Node 시도는 175/177 통과했으며 2개 parity test는 기존 current-run capture receipt가 없어 차단됐다. 이 초안의 focused receipt로 그 gate를 대체하지 않는다.

후속 결정은 (1) 선생님 역할 변경 시 차단 정책과 개인 설정 UI의 위치, (2) 업무별 permission callback과 action-time 승인 경계다. 새 key 발급, 지속 scope/grant 확대, server credential 설정, 새 webhook, polling 활성화, SQL 적용 및 실제 종단 테스트는 정확한 대상과 내용을 검토한 뒤 별도 승인 단계로 남긴다.

RLS 및 privileged 함수의 정책·ACL 근거는 [Supabase RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)와 [PostgreSQL 17 RLS 문서](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)를 확인했다. repository의 최종 ordered migration 정의를 실제 판단 기준으로 사용하며 기존 no-send, CAS·lease, append-only audit와 idempotency 계약을 보존한다.
