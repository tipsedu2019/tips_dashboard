# 작업 2 구현 결과 보고서

상태: 등록 이력의 행위자와 발생 시각을 명시적으로 기록하는 version-2 계약을 구현하고, 기존 version-1 읽기 호환성과 한 번 기록·롤백 계약을 검증했습니다.

구현 커밋: `e505d3a`

## 구현 내용

- 비공개 `write_registration_track_event_v2`가 `user`, `system`, `migration`만 허용하고 생성한 원본 이벤트 UUID를 반환하도록 했습니다.
- 사용자 이력은 현재 인증 프로필을, 시스템 이력은 안정된 시스템 출처를 명시적으로 요구합니다. 시스템·마이그레이션 이력에는 사용자 프로필을 기록하지 않습니다.
- 기존 7개 인자 작성기 서명은 유지하되, 별도 insert 없이 version-2 작성기를 정확히 한 번 호출하도록 바꿨습니다.
- 새 payload는 `event_type`, `actor_profile_id`, `actor_kind`, `system_source`, `track_id`, `reason_code`, `occurred_at`을 서버에서 작성합니다.
- 서비스 DTO에 `actorKind`, `systemSource`, `reasonCode`, `payloadVersion`을 추가했습니다. 과거 version-1의 null 행위자는 현재 담당자나 시스템으로 추측하지 않고 그대로 null로 유지합니다.
- 문의 과목 동기화의 과거 이력 판정은 version-1 `eventType`과 version-2 `event_type`을 함께 읽도록 보완했습니다.

## 정확히 한 번 기록과 롤백 근거

- pgTAP 소스 패킷을 `160/160` 항목으로 확장했습니다.
- 핵심 업무 변이에서 만들어진 `(track, event_type, entity/revision key)` 14개를 고정하고, 같은 요청 키로 실제 mutation 12건을 다시 실행해 이력 수가 늘지 않는 계약을 검증합니다.
- 실제 과목 필드를 변경하고 version-2 이력을 기록한 뒤 의도적으로 예외를 발생시켜, 업무 데이터와 이력 행이 함께 원복되는 계약을 검증합니다.
- 사용자·시스템·마이그레이션 행위자, 잘못된 종류, 인증 없는 사용자, 비어 있거나 불안정한 시스템 출처, 비공개 실행 권한을 각각 검증합니다.

## 검증 결과

- 최종 집중 Node 테스트: `60/60` 통과
- Task 3 RED 테스트 추가 전 전체 Node 회귀: `1203/1203` 통과
- TypeScript: 통과
- 대상 ESLint: 통과
- `git diff --check`: 통과
- 별도 임시 복사본 Next.js 프로덕션 빌드: 통과, 정적 페이지 `75/75` 생성
- 독립 검토: P0/P1/P2 `0/0/0`

## 현재 실행 상태와 외부 상태

- 작업 트리 개발 서버는 `http://localhost:3001`에서 계속 실행 중입니다.
- Docker는 요구하거나 실행하지 않았습니다.
- 원격 마이그레이션·데이터·플래그 변경, 배포, 실제 알림 공급자 호출은 수행하지 않았습니다.
- 실제 DB pgTAP은 승인된 로컬 또는 미리보기 DB가 없어 실행하지 않았습니다. 이번 완료 보고는 SQL 소스 계약과 정적·애플리케이션 검증 결과를 기준으로 합니다.
