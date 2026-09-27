# 2026-09-27 성능 수정 검증

- 기준 HEAD: `062c8601f2b502f123661d8f13130cf51a012ec3`. 원본 `performance-20260922` 증거와 시점이 다르다.
- `regression.log`: 관련 839 tests. `design-contracts.log`: CI의 공유 UI 63 tests.
- `sql-results.json`: 5 suites, 384 assertions. `verify-local-sql.py`는 네트워크 격리 Docker만 허용한다.
- `clean-replay.log`: 최초 baseline + 기존 120 migration. `final-clean-replay.log`/`final-sql-verification.log`: 권한 수정 후 새 격리 DB에 최종 121 migration 처음부터 재생 + 384 assertions 통과. `manifest-check.json`은 121개 hash 확인이며 별도 실행 증거는 아니다.
- `textbook-before.sql`/`textbook-stored.sql`: 신규 migration 적용 전의 격리 baseline에서 순서대로 실행했던 비교 쿼리. 각각 rollback한다. 후자는 후보 생성 열/함수를 transaction 안에서 생성하므로 이미 최종 migration이 적용된 DB에는 그대로 실행하지 않는다. `.log`의 첫 측정과 warmed JIT off 측정을 구별한다.
- `workload-index-benchmark.sql`: 합성 이벤트 2만 건의 최신 상태 진입 쿼리. 인덱스 존재/부재를 한 transaction에서 비교한 후 rollback한다. fixture setup에는 `supabase_admin`이 필요하다.
- `baseline-initial-js.json`/`final-initial-js.json`: HTML script 파일별 gzip 합. 이번 실제 기준 SHA로 metadata를 수정했다. 원본 측정 script의 이전 SHA 하드코딩을 새 증거에 재사용하지 않았다.
- 브라우저: 기존 `scripts/qa/curriculum-scheduling-fixture-server.mjs`를 임시 복사해 포트 3240/1/2→3270/1/2로 바꾸고, `next dev --webpack` + 합성 Supabase URL로 검사했다. 임시 파일/서버는 종료했다. 사진은 합성 데이터만 포함한다. 개발 도구/네트워크 시간은 운영 성능 증거가 아니다.
- 등록 생성 폼/달력은 chunk 로딩 후 렌더 확인. 달력 API는 fixture 미구현으로 오류 상태만 확인했고, 실제 예약 조회 성공은 증명하지 않았다.
- `lint.log`: 변경 파일 오류 0. 기존 curriculum-filter-panel 테스트의 미사용 actionSource 경고 1건 유지.
- 실행한 외부 부작용: 없음. 운영 DB migration/배포/실제 휴보강 승인/알림 발송: 없음.
