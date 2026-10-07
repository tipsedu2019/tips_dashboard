# 관리 조회의 인증 대기 복구 보강

기준 운영 main: `3dac9307732b1d66fddf95b62ed4ed08c1d70ed1` (PR #112). 독립 worktree에서 수정했다. 검증한 파일은 `manifest.json`의 SHA-256으로 고정한다.

## 문제와 변경

설치된 Supabase SDK 2.103.1은 REST fetch 전에 `auth.getSession()`/accessToken을 기다린다. 기존 fetch AbortSignal만으로는 토큰 대기 중인 호출자의 Promise가 종료되지 않아 화면 로딩이 지속될 수 있었다. 이 결함은 서버 DB/Auth 지연의 원인을 증명하지 않는다.

새 `withReadDeadline`은 토큰 획득을 포함한 읽기 Promise와 기존 deadline/호출자 취소를 함께 관찰한다. 관리 번호 목록, 통계·필터, 상세·관계 목록·교재 후보, 수업 교사·강의실 카탈로그에 적용했다. 카탈로그 전체 페이지는 하나의 8초 deadline을 공유한다. 이미 만료된 deadline도 동일한 한국어 오류로 처리한다. 실제 RPC에는 정적으로 추적 가능한 같은 deadline을 유지하며 무료 사용량 검사 정책은 수정하지 않았다.

- timeout/닫기/권한 변경 후 늦은 응답은 결과를 게시하거나 추가 카탈로그 페이지를 조회하지 않는다.
- 메타데이터 한쪽 RPC가 오류를 반환하면 다른 쪽도 취소하고 원래 오류를 보존한다. 이미 표시된 목록은 유지한다.
- 자동 재시도는 추가하지 않았다. 기존 `.retry(false)`와 화면의 명시적 재시도, 초안·수동 선택·편집의 기존 선택을 보존한다.
- 공유 인증 갱신 자체는 취소하지 않아 다른 읽기 소비자에게 전파하지 않는다. 저장·발송·인증 설정·권한/RLS·DB 계약은 변경하지 않았다.

기존 수업 등록/상세 화면과 공통 Alert/Button/Select를 그대로 사용한다. 새로운 시각 규칙은 없다. 오류와 복구 화면은 두 PNG에 있다.

## 검증

- 격리 Linux Node 22.18.0, 네트워크 없음, 소스/의존성 읽기 전용: **362/362** (`linux.log`). 관리 전체·timeout·번호 페이지 controller·과학 계약을 최종 제품 코드에서 확인했다.
- 집중 회귀 **77/77**: 영구 토큰 대기, 실제 SDK의 토큰 해제 후 취소된 fetch, 늦은 성공/실패, caller 취소, 자동 재시도 없음, 메타데이터 오류 즉시 취소.
- production webpack 빌드·TypeScript 통과. ESLint 오류 0, 기존 unused 상수 경고 1. 기존 전체 free-tier guard 통과.
- 실제 `/admin/classes` production 빌드 합성 브라우저 **1440/390px 통과**, 미처리 요청 0, 페이지 오류 0. 토큰 갱신 HTTP 응답을 보류하고 오류 안내·저장 차단·수동 재시도·초안/선택 보존을 확인했다. 각 크기에서 공유 refresh 1건, 늦은 auth 완료 후 만료된 카탈로그 HTTP 0건, 수동 재시도 후 교사/강의실 2건.
- 브라우저 오류 표시는 5388/5364ms였다. SDK의 기존 인증 lock 오류가 더 일찍 종료될 수 있으므로 정확히 8초를 기다린다는 뜻이 아니다. 영구 token Promise의 deadline 자체는 실제 SDK 합성 단위 검증이 담당한다.
- 독립 검토: 관련 42/42와 후속 대상 5/5, 독립 합성 5/5, 남은 P1/P2 없음. 검토 제품 4파일 hash가 최종 파일과 일치한다 (`independent-results.json`, `independent-review.md`).

첫 Linux 실행에서 기존 테스트 2개가 취소 뒤 늦은 성공을 허용하던 기대값 때문에 실패했다. 취소 시 즉시 실패와 다른 소비자 정상 완료를 검증하도록 강화한 뒤 최종 362/362를 확인했다. 첫 브라우저 실행은 오류가 정확히 8초여야 한다는 잘못된 기대값으로 실패했다. SDK의 조기 오류를 반영한 뒤 브라우저 검사만 재실행했다.

## 재현

```sh
node --experimental-strip-types --test tests/read-deadline.test.mjs tests/promise-timeout.test.mjs tests/numbered-page-controller.test.mjs tests/management-*.test.mjs tests/science-class-taxonomy.test.mjs
node scripts/verify-free-tier-query-contracts.mjs --surface all --base 3dac9307732b1d66fddf95b62ed4ed08c1d70ed1 --worktree
NEXT_PUBLIC_SUPABASE_URL=https://tips-internal-fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_TELEMETRY_DISABLED=1 npm run build
npm run start -- -p 3282 -H 127.0.0.1
# 기존 Playwright package.json 경로를 PLAYWRIGHT_PACKAGE에 지정
QA_AUTH_DEADLINE=1 QA_BASE_URL=http://127.0.0.1:3282 node scripts/qa/class-resource-catalog-browser.mjs
node --experimental-strip-types docs/qa/read-deadline-recovery-20261007/independent-repro.mjs "$PWD"
```

실행 전 포트가 비어 있는지 확인한다. 브라우저는 임시 프로필과 가짜 사용자/세션/데이터만 사용하고 외부 요청을 차단한다. 저장·발송하지 않는다.

## 운영 관측과 배포 판단

부모 승인과 독립 검토 후 2026-10-07 13:10 UTC 지정 프로젝트에서 READ ONLY/statement_timeout1500ms/pg_stat_activity 집계 LIMIT20을 한 번 실행했다. client idle14, active1, pg_cron1, pg_net1이며 Lock 대기 행은 없었다. MCP 왕복16.348초는 SQL 실행 시간으로 해석하지 않는다. 추가 관측·업무 테이블 조회·쓰기·설정 변경은 없다. 이 단일 순간 관측과 부모가 전달한 CPU9%/RAM47%/peak connections16/60 카드는 과거 DB/Auth 지연을 배제하거나 증설을 필수로 판단할 근거가 아니다.

**코드 기준 배포 후보 가능, DB migration 불필요.** 운영 merge/배포와 worker 중지·설정 변경은 수행하지 않았다. 로컬 커밋과 PR 본문을 준비하며 새 원격 PR/preview 배포는 만들지 않는다.

상한은 변경한 관리 읽기 단위에 적용한다. 앱 전체·공유 auth refresh·서버 DB 실행 종료를 보장하지 않는다. 레거시 기본 기간+후속 목록은 각각 제한되며 합산 8초 보장은 아니다. 브라우저 실행 정지를 포함한 엄격한 절대 시계 상한도 증명하지 않는다. 운영 DB/Auth 장애의 근본 원인과 실제 worker 중첩은 미확정이며 이 패치를 복구 완료로 표현하지 않는다.
