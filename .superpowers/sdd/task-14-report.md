# 작업 14 구현 결과 보고서

상태: 7개 workflow의 배타적 어댑터 등록과 공통 Worker API 경로를 구현하고 독립 검토까지 완료했습니다.

코드 커밋: `c824a2a` (`feat: complete notification adapters and registration reminders`)

## 배타적 소유권과 렌더

- `tasks`, `word_retests`, `registration`, `transfer`, `withdrawal`, `makeup_requests`, `approvals`를 정확히 한 어댑터씩 고정 순서로 등록했습니다.
- 등록 어댑터만 예약 규칙·대상 재계산을 소유하며 나머지 workflow는 임의 추측 없이 즉시 알림만 처리합니다.
- 실제 설치된 템플릿 변수와 동일 출처 관리자 딥 링크를 사용합니다. 휴보강은 `?request=<UUID>`를 사용합니다.
- UUID 기반 즉시 이벤트는 `sourceRevision=null`만 허용합니다.

## 권위 재검증과 Chat 대상

- provider 호출 전에 service-role 단일 RPC 경계로 원본·현재 수신자·규칙·대상을 다시 검증합니다.
- RPC가 없거나 오류·비정상 응답이면 알림을 보내지 않고 실패 폐쇄합니다.
- 휴보강 과목 Chat은 권위 `approval_group`의 `english`, `math_middle`, `math_high`만 허용하고 `unknown`만 대상 없음으로 처리합니다.
- 관리팀·경영진·과목팀 audience와 Google Chat connection이 다르면 실패 폐쇄합니다.

## Worker API

- `NOTIFICATION_WORKER_SECRET` Bearer 값을 timing-safe 방식으로 확인한 뒤에만 작업 claim을 시작합니다.
- 어댑터가 없거나 재계산 소유자가 아니면 provider나 apply를 실행하지 않고 정해진 오류로 종료합니다.

## 검증 결과

- 7개 workflow registry 집중 테스트: `10/10` 통과
- 작업 11·13·14 통합 집중 Node 테스트: `192/192` 통과
- 최신 독립 검토 통합 테스트: `123/123` 통과
- TypeScript: 통과
- 대상 ESLint: 오류 0건
- 변경 공백 검사: 통과
- 독립 코드 검토: P0/P1/P2 `0/0/0`

## 남은 운영 연결

- `revalidate_immediate_notification_delivery_v1`의 DB 권위 재조회 RPC는 작업 20 최종 운영 마이그레이션에 포함합니다.
- 이 RPC가 설치되기 전에는 즉시 알림이 provider를 호출하지 않도록 이미 실패 폐쇄되어 있습니다.
- 원격 DB·플래그·스케줄·공급자는 변경하지 않았습니다.
