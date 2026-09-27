# 성능 리뷰 증거

[리뷰와 개선 계획](../2026-09-22-performance-review.md)의 근거다. 소스 기준은 `b0f16bf5e5001edcdb25410fd68a8be3297adde3`이며 운영 앱의 배포 SHA는 확인하지 못했다.

| 파일 | 의미 |
| --- | --- |
| `browser-evidence.json` | 인증된 운영 Chrome CDP 관측에서 경로·집계·시간만 보존. 실패와 회복 포함 |
| `db-evidence.json` | 읽기 전용 운영 DB 통계, 함수 hash, 인덱스 catalog. 누적값과 구간 차이를 구분해야 함 |
| `initial-js.json` | 최신 production build HTML의 초기 modern JS. 원본 및 파일별 gzip, 실제 전송량 아님 |
| `frontend-probe.json` | 실제 React hooks/services와 mock transport의 요청 수·취소 상태 |
| `server-probe.json` | 실제 서버 함수와 mock transport의 미디어 서명·catalog 조회 수 |
| `build.log` | production build 성공 기록 |
| `performance-tests.log` | 조회·캐시·성능 계약 247/247 통과 |
| `frontend-tests.log` | 화면 테스트 144개 중 123 통과/21 실패. 최신 fixture 계약 불일치 |
| `server-tests.log` | 서버·공개 API·통계 관련 31/31 통과 |
| `measure-initial-js.mjs` | HTML script 목록과 파일별 크기 재현 도구 |
| `frontend-probe.cjs` | 요청 개수·취소 상태 재현 도구. DB에 연결하지 않음 |
| `server-probe.mjs` | 미디어 처리 재현 도구. 가짜 env와 mock fetch만 사용 |

브라우저 자료에 headers, token, 검색값, 사용자별 데이터, 응답 본문은 보존하지 않았다. DB 자료는 집계와 catalog이고 schema/함수 이름을 포함한다. `pg_stat_statements` 누적값을 현재 p95로 해석하지 않는다.

## 재현 방법

기록 당시 Node v24.19.0 및 저장소에 설치된 의존성을 사용했다. 최신 코드의 별도 checkout을 준비하고 그곳에서 실행한다. 원래 작업 디렉터리의 오래된 코드를 기준으로 비교하지 않는다.

```sh
# Node가 PATH에 있는 셸, 검사할 checkout의 루트에서 실행
node node_modules/next/dist/bin/next build --webpack
node /absolute/path/to/measure-initial-js.mjs "$PWD" /tmp/tips-initial-js-review.json
node /absolute/path/to/frontend-probe.cjs "$PWD" /tmp/tips-frontend-review.json
node --experimental-strip-types /absolute/path/to/server-probe.mjs "$PWD"
```

스크립트는 이 리뷰의 고정 커밋에서 재현한 도구다. 코드가 바뀐 뒤 사용하려면 fixture의 DTO와 기준 커밋 표기도 갱신해야 한다. 최신 build 경로에는 `.next/server/app/admin/*.html`과 대응 chunk가 있어야 한다.

성능 계약 테스트:

```sh
node --test --experimental-strip-types \
  tests/query-surface-budget.test.mjs \
  tests/performance-migration-scopes.test.mjs \
  tests/management-progressive-loading.test.mjs \
  tests/management-numbered-service.test.mjs \
  tests/academic-scoped-reads.test.mjs \
  tests/operations-scoped-reads.test.mjs \
  tests/ops-task-page-stats-cache.test.mjs \
  tests/dashboard-snapshot-cache.test.mjs \
  tests/statistics-snapshot-cache.test.mjs
```

이 테스트 중 일부는 Git의 과거 기준 commit을 읽는다. 처음 단순 archive에서 실행했을 때 Git metadata 부재로 4개가 실패했고, 실제 Git object와 최신 기준 index를 갖춘 별도 checkout에서 다시 실행한 결과가 보존된 247/247이다. 최초 환경 오류를 제품 결함으로 집계하지 않았다.

화면 및 서버 테스트 명령:

```sh
node --test --experimental-strip-types \
  tests/management-numbered-pagination.test.mjs \
  tests/academic-operations-numbered-pagination.test.mjs \
  tests/academic-operations-numbered-service.test.mjs \
  tests/textbook-numbered-data.test.mjs \
  tests/statistics-snapshot-cache.test.mjs \
  tests/statistics-snapshot-hook.test.mjs

node --test --experimental-strip-types \
  tests/public-content-contract.test.mjs \
  tests/public-class-detail-next-cache.test.mjs \
  tests/statistics-aggregate-auth.test.mjs \
  tests/statistics-resource-pressure.test.mjs
```

운영 브라우저/DB 통계는 당시 정상 화면 탐색과 read-only catalog 조회로 수집했다. 재현 스크립트에 운영 로그인, 실제 승인, 알림 발송, migration 적용이나 부하 발생 명령은 포함하지 않는다.
