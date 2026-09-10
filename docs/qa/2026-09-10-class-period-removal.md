# 수업 기간 UI 제거

## 결정 근거와 범위

사용자가 과거 기간 제거 결정을 확인하고 환경 설정·수업관리 필터·수업정보 등에 반영하도록 요청했다.

- `docs/superpowers/specs/2026-07-28-continuous-classes-session-snapshots-design.md` 3절/10절: 수업관리·수업계획의 혼합 기간 필터, 기본 학기 입력, 학기 미정 보조 문구 제거. 기존 기간 URL만 정리하고 다른 조건은 유지. 수업 그룹 데이터·시간표 기능과 학사일정·통계 등 실제 학기 기준은 보존.
- `docs/superpowers/plans/2026-07-29-continuous-class-schedule-release-2.md` 4.2절: 해당 UI 제거를 Release 3 또는 별도 제품 결정으로 미룸. 이번 요청으로 보류한 범위를 진행한다.
- 작업 브랜치: `codex/dashboard-apple-design-20260909`. 기존 Apple 계열 UI 개선을 보존하고 같은 worktree에서 진행했다.

## 구현

- 수업관리 표의 기간 선택·기본값·필터 칩·초기화 상태를 제거했다. 오래된 `period` URL은 검색·과목·학년·교사·강의실·상태·페이지·정렬·상세·해시를 보존하고 해당 키만 제거한다.
- 기본 기간을 먼저 조회하던 관리 목록 hook 경로를 제거했다. 기존 RPC의 엄격한 필터 키 계약에는 `periodId: null`을 보내며 실제 조건으로 사용하지 않는다. 사용 중이 아닌 예전 cursor 서비스의 명시적인 기간 API 호환 경로는 유지했다.
- 수업 상세·등록의 기간 입력과 신규 기본 그룹 자동 선택을 제거했다. 일반 수업 수정에서 그룹 멤버십을 다시 교체하지 않으므로 기존 그룹·학기 정보가 지워지지 않는다. 교재·명단·별도 기본 시간표 저장 계약은 유지했다.
- 환경 설정은 기간명/기본 기간 지정 기능을 제거하고, 독립 수업그룹의 이름·과목 관리만 유지한다. 옛 기간 설정 주소는 수업그룹 관리로 이동하며 학기 데이터를 삭제하지 않는다.
- 실제 수업계획 목록과 이전 일정 작업 화면에서 기간 및 대체 그룹 필터·학기 보조 문구를 제거했다. 일정 생성 구간, 수업그룹 동기화와 시간표, 학사일정·통계의 날짜 기준은 보존했다.
- DB의 신규 수업 그룹 필수 조건과 수업계획 조회의 숨은 기본 기간 주입을 제거하는 후속 migration 2개를 준비했다. 기존 함수의 권한·RLS·ACL·잠금·잘못된 그룹 검증·원자성은 유지했다. 수업계획 RPC의 혼합 기간 선택지는 빈 배열로 반환하고, 명시적인 기간 API 필터는 호환 목적으로 유지한다.

## 검증 중 확인한 문제

Next Router가 부모 effect에서 history 처리를 설치하기 전 자식 표가 기간 URL을 정리하면, 이후 Router가 원래 기간 URL을 복원했다. 기존 코드에서 실패하는 회귀를 먼저 재현하고, microtask에서 현재 경로·URL을 다시 확인한 뒤 정리하도록 고쳤다. cleanup 이후에는 실행하지 않는다. 수업 상세의 URL 작성부도 현재 URL을 읽고 기간을 제외해 오래된 조건을 재삽입하지 않는다.

별도로 수업계획 검색 X 버튼이 눌리는 순간 공통 Button의 `active:translate-y-px`가 세로 중앙 정렬용 `-translate-y-1/2`를 덮어썼다. 28px 버튼이15px 움직여 포인터 클릭이 취소됐다. 진단 로그에서 해당 클릭은 검색 handler에 도달하지 않았고, 키보드 삭제·버튼 Enter는 정상 동작했다. X 버튼에 `active:-translate-y-1/2`를 지정한 뒤 동일 포인터 클릭으로 검색 초기화·전체3행 복원을 확인했다. 조사 중 추가했던 검색 상태 보완 및 진단 로그는 제거했다.

## 검수 경계

브라우저는 3137의 실제 제품 컴포넌트에 합성 서비스만 연결한 로컬 fixture다. 운영 학생 데이터·실제 수강 변경·알림 전송을 수행하지 않았다. DB는 격리 환경에서만 검증하며 원격 migration 적용·푸시·배포는 하지 않는다. 배포할 때 새 migration을 먼저 적용해야 기간 없는 신규 수업 생성과 수업계획 전체 조회가 동작한다.

DB 함수 권한 검토는 [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)의 invoker 및 함수 실행 권한 원칙과 저장소의 최종 migration 정의를 대조했다. Supabase changelog를 확인했으며 이번 변경은 기존 PostgreSQL 함수·트리거 계약의 수정으로 새로운 제품 API를 도입하지 않는다.

## 결과

### 자동 검사

- 관리 화면 관련 Node 회귀 **184/184 통과**. 기간 없는 등록 RPC, 그룹 멤버십을 보존하는 일반 저장, 기간 URL 최초 진입과 Router history 설치 순서, 검색/페이지/정렬/상세, 권한 변경·지연 응답·재시도 계약을 포함한다. `management-tests.log`.
- 관리 화면 변경 대상 ESLint 통과. `eslint-management-final.log`.
- academic/operations pagination **52/52 통과**, 수업계획 필터·scoped read·번호 페이지 서비스·그룹 시간표·일정/수업설계 관련 회귀 **143/143 통과**. 이 묶음은 앞선 관리 검사와 일부 파일이 겹치므로 합산하지 않는다. 두 명령은 아래에 기록했다.
- 최종 변경 대상 ESLint, 제품 TypeScript no-emit, Next production build 및 `git diff --check` 통과. `eslint-academic-final.log`, `typecheck-final.log`, `build-final.log`. 최종 빌드에는 검색 X 버튼의 눌림 위치 수정과 조사용 코드 제거가 포함된다.
- 별도 전체 `admin-shell` 실행에서 기존 할 일 메뉴를 기대하는 테스트 2개가 실패했다. 이는 이번 기간 변경 전의 메뉴 제거와 맞지 않는 기대이며, 해당 메뉴를 복구하지 않았다. 추가한 환경 설정 기간 제거 계약 검사는 통과했다. 저장소 전체 테스트 성공을 주장하지 않는다.
- PostgreSQL 17 격리 DB lint 및 관련 pgTAP **231/231 통과**: 신규 선택 그룹 28개, 신규 무기간 수업계획 25개, 기존 academic scoped reads 44개, 기존 academic/operations numbered pages 134개. 격리 환경 중지·정리도 성공했다.
- DB 검사는 최종 migration 체인에 대해 수행했다. 잘못된 그룹 UUID의 `23503`, teacher/anon의 `42501`, 인증·RLS·실행 ACL, 원자성, 기존 연결 보존과 빈 연결 생성/교체를 검사했다.
- DB 증거는 `.codex-artifacts/apple-design-period-removal/db-final-evidence.md`, `db-final-contracts.log`, `db-final.log`에 있다. Runner는 성공한 개별 TAP stdout을 저장하지 않으므로 최종 성공 상태, 검사 파일별 plan 수, 최종 hash와 assertion 소스를 구분하여 보존했다.

### 브라우저

- 1357×987: 수업관리의 오래된 `period` 주소로 검색어와 상세를 함께 열어, 기간 값만 없어지고 `q`·`classId`·`tab`이 유지됨을 확인했다. 필터에는 수업 상태만, 빠른 필터에는 과목·학년·선생님·강의실이 남는다.
- 390×844: 기간 없이 수업 등록 → 목록 표시 → 상세 재진입을 확인했다. 등록의 9개 필드와 상세의 6개 기본 필드에 기간이 없고 문서 가로폭은390px이다. 기존 수업의 일반 저장도 합성 서비스에서 완료됐다. 이는 fixture 메모리 저장이며 새로고침 후 영구 저장 검증은 아니다.
- 수업계획에서 기간 선택·학기 미정 문구가 없고, 오래된 기간 주소 정리 시 검색어가 보존된다. 모바일 문서 가로폭은390px이다.
- 최종 수업계획에서 `period=retired-period&q=영어` 최초 진입 → 기간만 제거 → X 버튼 클릭 → 검색어와 q 제거 → 전체3행을 확인했다. 모바일에서도 같은 포인터 클릭이 정상이며 키보드 검색어 삭제와 X 버튼 Enter도 확인했다. 최종 검수 구간의 추가 브라우저 오류는0개다. `browser-final.json`, `curriculum-search-cleared-desktop.png`.
- 수업그룹 설정의 데스크톱 메뉴·목록과 모바일 카드에서 그룹명·과목만 확인했다. 기본 기간 지정과 기간 설정 메뉴는 없다. 옛 `/admin/settings/terms`, `/admin/terms`의 그룹 설정 이동은 제품 라우트 코드 및 테스트로 확인했다.
- 설정 fixture는 실제 제품 workspace에 읽기 전용 합성 그룹 2개를 연결했다. 그룹 저장·삭제는 차단하며 실행하지 않았다. 수업계획 fixture는 실제 기본 목록 workspace/model과 합성 수업 3개를 사용하며 `lessonDesign=1` 상세 편집기는 제공하지 않는다. 해당 기존 편집·일정 경로는 관련 코드·회귀 검사 범위다.
- 화면 증거: `.codex-artifacts/period-removal-20260910/`의 `class-detail-desktop.png`, `class-create-mobile.png`, `class-detail-mobile.png`, `curriculum-filter-desktop.png`, `curriculum-mobile.png`, `class-groups-desktop.png`, `class-groups-mobile.png`.

### academic/operations 검사 명령

```sh
node --test --experimental-strip-types tests/academic-operations-numbered-pagination.test.mjs

node --test --experimental-strip-types \
  tests/curriculum-filter-panel.test.mjs \
  tests/academic-scoped-reads.test.mjs \
  tests/academic-operations-numbered-service.test.mjs \
  tests/operations-scoped-reads.test.mjs \
  tests/class-group-timetable.test.mjs \
  tests/timetable-layout.test.mjs \
  tests/management-continuous-class-schedule.test.mjs \
  tests/lesson-design-page.test.mjs \
  tests/class-schedule-planner-calendar-toggle.test.mjs \
  tests/class-schedule-planner-textbook-ranges.test.mjs
```

기간 제거 요청의 구현과 로컬 검수는 완료했다. 원격 DB 적용·푸시·배포는 수행하지 않았다.
