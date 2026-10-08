# 에이전트 API 응답 계약

이 계약은 기존 인증·RPC·scope·대상 검사와 응답 본문을 유지한다. 상주 AI, 키 발급, 새 DB 함수/권한, 교사 업무 쓰기, 승인 증명, Chat 활성화를 추가하지 않는다.

## 키 종류와 현재 권한 확인

| 종류 | 소유권 기준 | 확인 가능한 기존 정보 | 한계 |
| --- | --- | --- | --- |
| 업무 연결 키 | 현재 유효한 관리자 발급자 | `/api/v1/health`의 credentialId, 연결 이름, scopes, classIds/classAccess, expiresAt. v2 health는 class-details:read도 필요 | 발급자 profile ID는 제공하지 않는다. `all`은 미래 수업도 포함하고 `legacy_all_read`는 전체 수업 쓰기를 뜻하지 않는다. 학교별 grant는 이 종류에 없다. |
| 개인 업무 읽기 키 | DB에 저장된 현재 교사 본인 | 기존 v2 담당 수업/허용 학교 GET 결과와 읽기 전용 capabilities | 실제 소유자 UUID·전체 grant·만료 시각은 응답에 없다. 내부에서 현재 소유권·담당 연결·scope·만료를 검사한다. health·업무 쓰기·영수증·발급 경로는 없다. |
| 중앙/개인 AI 요청 키 | 저장된 큐/행동 정책; 개인 키는 본인 요청 추가 제한 | 기존 요청·활동·행동 조회 결과 | 중앙/개인 subtype, 전체 scope, 만료를 추측하지 않는다. 공통 `ai_request` family만 표시한다. 업무 연결 키와 접두사가 같아도 서로 호환되지 않는다. |
| 직원 로그인 세션 | 현재 인증된 사용자 | 기존 본인 요청, 관리자에게 이미 허용된 전체 요청/정책 | 세션을 업무 키 또는 관리자 권한으로 바꾸지 않는다. |

scope는 기능의 허용 범위다. 실제 작업에는 현재 대상 grant, 소유권, 상태, 버전, 만료 검사가 그대로 필요하다. 요청 본문에 적힌 사람의 이름이나 `sourceReference`는 승인 증명이 아니다. 기존 업무 결과의 `requesterVerified=false`를 유지한다.

성공한 인증 응답에는 `X-Agent-Credential-Kind`, `X-Agent-Owner-Binding`, `X-Agent-Authorization-State: accepted-for-request`를 추가한다. 이는 방금 게이트웨이가 받아들인 요청만 설명한다. 영구 활성 상태, 다른 작업 권한, 사람의 승인을 보증하지 않는다. 실패 응답과 공개 OpenAPI에는 이 헤더를 넣지 않는다. 신규 메타데이터에는 사용자 식별값·이름·키 원문·키 해시를 넣지 않는다.

공개 명세는 `/api/v1/openapi`, `/api/v2/openapi`다. 개인 Authorization 헤더 없이 명세를 조회한다. `x-tips-credential-contracts`가 종류별 한계를 설명한다. 개인 키의 security 대안은 기존의 세 읽기 경로에만 존재한다.

## 공통 진단·복구 헤더

`data/error`, HTTP 상태, 도메인 오류, 저장된 영수증, `Retry-After`와 cache/auth 헤더는 그대로 유지한다. 변경은 다음 헤더 추가다.

| 헤더 | 의미 |
| --- | --- |
| `X-Request-Id` | 서버가 새로 만든 요청 UUID. 호출자가 보낸 값은 반영하지 않는다. idempotency key와 다르다. 기존 v2 503 로그/본문의 requestId와 같다. |
| `X-Agent-Retryable` | 같은 GET을 반복해 확인할 수 있는 일시 오류(429/503) 또는 unknown 영수증이면 true. 비활성 응답과 확정 실패 영수증은 false. 모든 변경 요청은 false다. 자동 재시도는 구현하지 않는다. |
| `X-Agent-Recovery` | `none`, `retry-read`, `lookup-receipt`, `inspect-state`, `stop`. 실행 성공 판정은 항상 기존 본문을 확인한다. |
| `X-Agent-Result-Path` | 확인 가능한 경우에만 기존의 상대 조회 경로. 호스트·쿼리·본문 문자열은 복사하지 않는다. |
| `X-Agent-Result-Kind` | `receipt`: 영속 업무 결과. `state`: 현재 AI 요청/행동 상태이며 영수증과 동등하지 않다. |

- 업무 commit의 결과 불명: 같은 key의 기존 `/operations/{key}` 또는 `/calendar/operations/{key}`를 조회한다. unknown은 실패/미반영 증거가 아니다. 새 key로 변경을 재제출하지 않는다.
- 확정 실패 영수증: HTTP 200 조회이든 실패 commit 응답이든 기존 `state=failed`, error/SQLSTATE를 보존하며 재시도를 안내하지 않는다.
- AI 변경의 결과 불명: 이미 검증한 요청/행동 UUID가 있을 때만 기존 상태 조회 경로를 안내한다. 현재 상태만으로 특정 변경의 성공을 확정하지 않는다. 생성 결과가 불명이라 UUID가 없으면 경로를 만들지 않는다.
- 조회 경로도 각 경로의 기존 scope가 필요하다. 예를 들어 v1 업무 영수증은 `schedule:write`, AI 상태 조회는 요청 read 권한을 요구한다. 조회에 401/403을 받으면 중단한다. 다른 키/브라우저로 우회하거나 조회 권한이 생겼다고 해석하지 않는다.
- 인증/권한/대상 거절(401/403/404)에는 결과 경로를 제공하지 않는다. malformed 요청은 기존 검사에서 중단한다.
- 일시 오류 헤더는 읽기 반복의 안전성 안내다. 성공 가능성이나 복구 시한을 보장하지 않는다. 원래의 고정 `Retry-After: 60`과 DB rate budget은 변경하지 않는다.

적용 범위는 v1 업무, v2 수업/학교 일정, 개인 업무 읽기, AI 요청/행동, AI 공간 정책 HTTP 핸들러다. Chat 전송·키 관리 RPC는 이번 변경 대상이 아니다. 기존 키 발급 OFF 및 각 활성화 상태를 변경하지 않는다.
