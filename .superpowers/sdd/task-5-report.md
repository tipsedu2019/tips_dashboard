# 작업 5 구현 결과 보고서

상태: 비공개 공통 알림 스키마, 개인별 읽음 경계, 내구성 큐와 안전 기본값 구현을 완료했습니다.

구현 커밋: `d7a285f` (`feat: add notification control plane schema`)

## 구현 범위

- `dashboard_private`에 알림 이벤트, 규칙, 불변 템플릿, 전달, 감사 로그와 세 종류의 내구성 작업 큐를 추가했습니다.
- 요청 원장, 워커 heartbeat, 12개 런타임 플래그, 발송 소유권 claim을 추가했습니다.
- 모든 private 알림 테이블에 RLS를 켜고 `anon`·`authenticated` 직접 권한을 닫았으며, `service_role`에 필요한 테이블·schema 권한만 부여했습니다.
- `public.dashboard_notification_read_receipts`를 `(notification_id, profile_id)` 복합 기본 키로 만들고, 로그인 사용자는 자기 receipt만 조회할 수 있으며 브라우저 직접 쓰기는 할 수 없게 했습니다.
- 기존 `dashboard_notifications.read_at`은 역사적 호환 값으로 그대로 보존하고 `source_delivery_id`, `revoked_at`, `revoked_reason`만 전진 확장했습니다.
- Google Chat 호환 행에는 암호문·마스크·연결 상태·revision·수정자·검증 결과 필드를 추가하면서 기존 `webhook_url NOT NULL`과 기존 reader/writer 권한을 유지했습니다.
- 라이브 환경에만 있을 수 있는 `ops_task_notification_deliveries`, `ops_task_automation_runs`는 `security_invoker` 비공개 view와 `to_regclass`로 존재 여부만 감지하며 행을 복사하거나 수정하지 않습니다.
- 정확한 12개 런타임 플래그를 모두 `false`로 설치하고, 공통 런타임 marker나 전달 행은 만들지 않았습니다.

## 닫힌 데이터 계약

- event occurrence, rule identity, template version, delivery target generation, target reconciliation, 발송 소유권 identity를 unique index로 고정했습니다.
- rule과 활성 template의 양방향 관계는 같은 rule의 template만 참조하도록 복합 deferred FK로 고정했습니다.
- 사용자 actor는 profile ID가 필수이고 시스템 actor는 profile ID가 null이어야 합니다.
- 전달 상태별 허용 reason을 정확히 분리해 잘못된 `failed/shadow_mode`, `retry_wait/connection_missing` 같은 조합을 거절합니다.
- `retry_wait`는 `next_attempt_at`이 필수이고, `claimed`·`sending`만 완전한 lease 3종을 가질 수 있습니다.
- fan-out·규칙 재계산·수신자 재계산 큐는 `pending`, `claimed`, `succeeded`, `failed`별 next-attempt와 lease 형태를 강제하고, 일곱 개 업무 외 workflow를 거절합니다.
- 규칙 재계산은 처리·취소·재생성 건수를 별도로 기록합니다.
- 한 worker run은 시작 기록과 성공 또는 실패 중 하나의 종료 기록만 가질 수 있습니다.
- 발송 소유권의 업무 `target_generation`과 handoff `owner_generation`을 분리하고, 실제 발송 이후 검증할 `dispatch_token`을 저장합니다.

## TDD와 독립 검토 보강

최초 RED는 마이그레이션 파일이 없는 상태에서 실행했으며 7개 중 6개가 `ENOENT`로 실패했습니다. 구현 뒤 source 계약을 통과시킨 다음 독립 검토에서 다음 빈틈을 찾아 스키마와 pgTAP을 함께 보강했습니다.

- 핵심 컬럼의 타입·nullability·default·PK/FK를 source 단계에서도 검증
- 상태와 reason의 단순 전체 집합 검사가 아닌 정확한 상태별 매핑
- materialized rule 양방향 pair, actor 의미, 요청 원장 PK
- 규칙 재계산 처리·취소·재생성 건수
- heartbeat 숫자 map, 단일 terminal, PII 금지
- delivery와 세 queue의 영구 고립 방지 상태·lease 불변식
- receipt policy가 자기 조회 policy 정확히 하나뿐인지 검증
- service-role 실제 권한과 기존 등록 SOLAPI RPC 권한 보존
- 두 optional live table의 존재·부재 fixture와 원상 복구
- pgTAP fixture 생성 전 설치 직후 delivery 0건 검사
- 실제 Supabase 카탈로그에서 schema가 생략되는 FK 출력 차이 호환

최종 독립 검토는 P0/P1/P2 잔여 문제 없이 통과했습니다.

## 최종 검증

- 작업 4 모델 + 작업 5 source 집중 테스트: 26/26 통과
- 작업 6의 의도된 RED 파일을 제외한 전체 회귀: 1058/1058 통과
- 작업 5 source 계약: 8/8 통과
- `tsc --noEmit`: 통과
- 대상 ESLint: 오류·경고 없이 통과
- `git diff --cached --check`: 통과
- 로컬 `/admin/registration`: HTTP 200
- Supabase 플러그인 읽기 전용 검증: 예약 migration 번호 충돌 없음, optional live table 2개 존재, 기존 schema/RPC 권한 유지 확인

## 외부 상태

- Supabase 원격 마이그레이션 적용, 원격 데이터 변경, 런타임 플래그 변경, provider 호출, 배포는 수행하지 않았습니다.
- 실제 pgTAP DB 실행은 승인된 local/preview DB에 마이그레이션을 적용하는 단계에 남겨 두었습니다. source packet과 실제 카탈로그 read-only 검증은 완료했으며 이를 실행한 것처럼 보고하지 않습니다.
- 작업 트리 전용 개발 서버는 `http://localhost:3001`에서 계속 실행 중입니다.
