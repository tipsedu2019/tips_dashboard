# 공개 수업 Supabase 장애 재발 방지 설계

**작성일:** 2026-08-15  
**상태:** 사용자 설계 승인 완료  
**대상:** `/api/public-classes`, 공개 수업 서버 조회, Vercel Production

## 1. 배경

2026-08-15 15:17~15:19 KST에 Supabase Postgres statement timeout, Auth 500/504, 연결 종료, 분 단위 cron 시작 실패가 같은 구간에 발생했다. 부하가 내려간 뒤 프로젝트 상태와 DB 연결은 회복했지만, `/api/public-classes`는 계속 `503`을 반환했다.

지속 장애의 직접 원인은 배포 코드와 운영 스키마의 불일치다. 배포 코드는 `classes.tuition`과 `progress_logs.completed_lesson_ids`를 조회하지만 운영 DB에는 두 컬럼이 없다. Supabase Data API가 `400`을 반환하고, 공개 API가 이를 빈 fallback payload와 `503`으로 변환한다.

순간 부하의 단일 유발원은 현재 증거만으로 확정하지 않는다. 이번 변경은 확인된 스키마 불일치와 공개 조회 실패 전파를 제거하고, 기존 Free/Nano 보호 장치를 유지하는 데 한정한다.

## 2. 목표

1. 공개 수업 전체 조회가 운영 DB에 실제로 존재하는 컬럼만 요청하게 한다.
2. 공개 projection을 명시적으로 유지해 `select("*")`로 인한 I/O 증가와 공개 범위 확대를 막는다.
3. Supabase가 일시적으로 실패해도 24시간 이내의 검증된 마지막 정상 정적 snapshot을 제공한다.
4. 같은 스키마 불일치가 테스트와 배포 전 검증에서 다시 검출되게 한다.
5. 성공 응답의 10분 캐시, 8초 쿼리 제한, 자동 재시도 금지로 장애 시 요청 폭증을 막는다.

## 3. 비목표

- 운영 DB에 `tuition` 또는 `completed_lesson_ids` 컬럼을 추가하지 않는다.
- Supabase 프로젝트를 재시작하거나 compute 요금제를 변경하지 않는다.
- cron, 알림 worker, SOLAPI, Google Chat 설정을 변경하거나 외부 메시지를 발송하지 않는다.
- 증거가 부족한 순간 부하 원인을 추정해 인덱스나 RLS 정책을 함께 변경하지 않는다.
- 공개 수업 응답 계약이나 UI를 재설계하지 않는다.

## 4. 검토한 접근

### 4.1 채택: 운영 스키마 기반 projection과 마지막 정상 snapshot

전체 조회용 projection을 상수로 고정하고 존재하지 않는 두 컬럼을 제거한다. 매퍼는 이미 `fee`를 `tuition` 호환 출력으로 변환하고, `completed_lesson_ids`가 없으면 빈 배열을 사용하므로 공개 응답 계약은 유지된다.

성공한 live payload만 캐시한다. live 조회가 실패하면 저장소에 포함된 `public/data/public-classes.json`을 검증한 뒤 전체 공개 payload로 반환한다. snapshot도 유효하지 않을 때만 기존 `503` fallback을 사용한다.

### 4.2 제외: 누락 컬럼을 운영 DB에 추가

현재 공개 응답에 필요하지 않은 중복 컬럼을 영구 스키마로 만들고 migration 위험을 추가한다. 확인된 문제를 데이터베이스 변경으로 우회하므로 제외한다.

### 4.3 제외: 모든 테이블을 `select("*")`로 조회

스키마 변경에는 느슨하지만 Free/Nano에서 전송량과 I/O를 늘리고, 새 컬럼이 자동으로 공개 경로에 포함될 수 있다. 공개 범위와 성능 계약을 약화하므로 제외한다.

## 5. 설계

### 5.1 Projection 계약

`src/server/public-classes-payload.js`에 summary, classes full, textbooks full, progress logs full projection을 각각 이름 있는 상수로 둔다. full projection에서 다음 필드를 제외한다.

- `classes.tuition`
- `progress_logs.completed_lesson_ids`

반환 매핑은 유지한다.

- `tuition` 응답 값은 `fee`에서 계산한다.
- `completedLessonIds`는 원본 배열이 없으면 `[]`다.

각 쿼리는 기존 `AbortSignal.timeout(8_000)`과 `.retry(false)`를 계속 사용한다.

### 5.2 성공 전용 캐시

기존 summary cache와 같은 규칙으로 full payload 성공 결과만 Next Data Cache에 저장한다.

- revalidate: 600초
- 고정 cache tag 사용
- fallback payload는 캐시에 저장하지 않음
- live 오류를 즉시 재시도하지 않음

공개 API responder는 직접 Supabase를 호출하지 않고 성공 전용 full cache loader를 사용한다.
기존 수업·교재·진도·일정 변경 후 cache invalidation은 summary tag와 full tag를 함께 무효화한다.

### 5.3 Snapshot fallback

live full payload를 얻지 못하면 `public/data/public-classes.json`을 읽는다. 현재 저장소 snapshot은 2026-04-15 생성본이라 운영 fallback으로 사용하기에는 너무 오래됐다는 구현 중 점검 결과를 반영한다. 다음 조건을 모두 만족할 때만 사용한다.

- 객체이며 `source === "supabase"`
- `classes`, `textbooks`, `progressLogs`가 배열
- full payload의 필수 공개 구조를 보존
- `generatedAt`이 유효한 시각이며 현재보다 오래되지 않음
- 현재 시각 기준 최대 24시간 이내

검증된 최신 snapshot은 `200`과 성공 cache header로 반환한다. 민감한 내부 오류 원문은 응답에 포함하지 않는다. snapshot이 없거나 유효하지 않거나 24시간보다 오래됐을 때는 기존의 일반화된 사유와 `503 no-store`를 반환한다. warm Next Data Cache에 이전 성공 payload가 있으면 정적 snapshot보다 먼저 그 값을 유지한다.

### 5.4 배포 격리

현재 루트 폴더는 Git `core.worktree`가 임시 경로를 가리키고 대규모 변경이 표시되므로 수정하지 않는다. 최신 `origin/main`에서 만든 `codex/public-classes-recurrence-prevention` worktree에서만 작업한다.

DB migration은 없으며 Vercel 코드 배포만 수행한다.

## 6. 테스트 전략

TDD 순서를 지킨다.

1. full mode가 정확한 projection 네 개를 사용하는 회귀 테스트를 먼저 추가하고, 현재 `tuition` 및 `completed_lesson_ids` 때문에 실패하는 것을 확인한다.
2. live full 조회 실패 시 24시간 이내의 유효한 snapshot을 반환하는 테스트를 추가하고 실패를 확인한다.
3. fallback payload, 잘못된 snapshot, 24시간보다 오래된 snapshot이 성공 캐시에 들어가지 않는 테스트를 추가한다.
4. 최소 구현 후 대상 테스트, 관련 public classes cache 테스트, 전체 Node 테스트, ESLint, Next webpack build를 실행한다.

테스트는 내부 구현 문자열만 검색하지 않고 주입된 Supabase query builder와 cache/snapshot 경계를 통해 실제 동작을 검증한다.

## 7. 배포 및 검증 게이트

완료 판단은 다음을 분리한다.

1. **Source/tests:** 대상 회귀 테스트, 관련 테스트, ESLint, build 통과
2. **Migration:** 해당 없음. 운영 DB 변경 0건 확인
3. **GitHub:** 변경 commit을 `main`에 반영하고 원격 SHA 확인
4. **Vercel:** Production 배포가 해당 `main` SHA로 `READY`
5. **Runtime:** 홈 `200`, `/api/public-classes` 연속 3회 `200`, 응답 `source === "supabase"` 또는 검증된 snapshot
6. **Supabase:** 배포 후 관찰 창에서 `classes.tuition`과 `progress_logs.completed_lesson_ids` 신규 Data API `400`이 없는지 확인
7. **Provider/recipient:** 범위 밖이며 발송하지 않음

## 8. 성공 기준

- 정상 DB 상태에서 `/api/public-classes`가 full payload와 `200`을 반환한다.
- 스키마에 없는 두 컬럼을 공개 조회가 요청하지 않는다.
- 짧은 Supabase 장애에서 warm cache 또는 24시간 이내의 검증된 snapshot이 있으면 공개 API가 `503` 빈 응답으로 퇴행하지 않는다.
- 24시간보다 오래된 snapshot은 `200` 응답으로 제공하지 않는다.
- timeout과 retry 금지로 장애 시 요청 증폭을 만들지 않는다.
- DB, cron, 알림 provider에는 변경이 없다.
