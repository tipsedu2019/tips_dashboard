# 수업관리 목록 → 상세 → 학생 명단 검수

## 기준과 결과

- 기준: `9f962dfcd68d18788f68eb1754d61fe1c3b1d75f`. 시작과 최종 확인 시 원격 `main`이 이 SHA였다. 작업 브랜치: `codex/class-workflow-polish-20260921`.
- 기존 수업 목록은 검색·필터·선택·열 설정의 공통 구성이 이미 적용되어 있었다. 기존 목록을 유지하고 상세 안의 이동, 명단 찾기, 오류 확인, 학생 상세 왕복을 개선했다.
- 원본 체크아웃의 premium-dashboard audit/master-plan/task-cards 3개 문서는 읽기만 했다. 이 문서의 완료 상태는 과거 계획의 “미착수” 표시 대신 현재 코드와 실제 브라우저 결과를 기준으로 한다.
- 비교 기준: `DESIGN.md`, 공통 Button/Select/Dialog/SearchField/RowActions, `src/components/data-table/README.md`, `premium-dashboard/T12.md`, `T22.md`, `T23-release-review.md`, `2026-09-16-registration-workflow-polish.md`.

## 확인한 문제와 수정

| 문제 | 결과 |
| --- | --- |
| 긴 수업명·요일별 요약이 계속 고정되어 모바일 명단 공간을 차지함 | 제목·요약은 스크롤하고 작은 영역 이동 메뉴만 고정. 수업 정보·시간표·교재·학생 명단을 한 번에 이동. 편집 영역은 모두 유지 |
| 명단에서 학생을 찾으려면 순서대로 읽어야 함 | 공통 검색창으로 이름·학교·학년·연락처 검색. 수강·대기 각각 일치/불러온 인원 표시. 부분 로딩이면 검색 범위 표시와 기존 더 불러오기 유지 |
| 명단의 해제 행동이 모든 행에 반복됨 | 공통 행 메뉴로 수강/대기 해제 배치. 대기 학생의 등록 전환은 주 행동으로 유지. 기존 확인·권한·mutation callback 유지 |
| 저장 오류가 상단/상태 표시로 분산됨 | 고정 하단 저장 버튼 근처에 전체 오류 한 번 표시. 실패 후 입력과 재시도 유지 |
| 학생 상세 왕복 URL에서 목록 검색·정렬·페이지가 누락됨 | 기존 목록 query를 보존하며 classId/tab/studentId만 갱신. 오래된 section/sessionId 제거 |
| 수업 필드·행동 높이와 필수 표시가 공통 규칙과 다름 | 저장/추가 버튼은 `size="form"`(PC 36px, 모바일 44px). 필수 별표·스크린리더 이름·ARIA 검증 상태 연결 |

공유 변경은 `DataTableRowActions.menuLayer` 한 가지다. 기본 메뉴 z50은 유지하고 높은 관리 dialog 안의 메뉴만 명시적으로 z90을 사용한다. 같은 변경에 DESIGN과 공통 컴포넌트 README를 갱신했다. DB, RPC, 권한, 읽기 서비스, 저장 프로토콜, 발송 경로는 변경하지 않았다.

## 실제 브라우저 검수

Chrome의 실제 Next 화면을 1440×900 및 390×900으로 검수했다. 로컬 fixture transport는 합성 계정·24개 수업·20명 학생·60자 수업명·요일별 다른 담당/강의실·누락 연락처를 사용한다. UI 코드는 실제 구현이고 API 응답과 저장은 로컬 메모리 안에서만 처리한다. 모든 서버는 127.0.0.1에 바인딩하며 미정의 API는 501, 미정의 쓰기는 405로 차단한다.

| 검수 | 관찰 결과 |
| --- | --- |
| 긴 제목, 시간/담당/강의실, 연락처 | 제목 전체 줄바꿈, 월/수 각각의 시간·담당·장소 보존, 누락 연락처 `—`, 상세 가로 넘침 0 |
| 목록 선택 | PC 단일/현재 페이지 10개 선택·일괄 수정 열기·취소·해제. 검색·필터·첫 행 좌표 불변. 모바일 단일 선택·해제에서도 불변 |
| 명단 이동 | 스크롤 종료 시 메뉴 아래 간격 PC 16px(114→130), 모바일 16px(86→102). 저장 버튼은 계속 접근 가능 |
| 명단 검색 | 두 명단 동시 검색, 일치/전체 수 표시, 검색 결과 없음, 초기화 후 명단 복귀. 검색이 수업 초안이나 실제 소속 ID를 바꾸지 않음 |
| 일부 명단 로딩 | 처음 2명만 받은 상태에서 학생09 검색 → 0명. 다음 30건 클릭 후 같은 검색어로 학생09 표시, 1/10명. 더 불러올 항목이 없으면 범위 안내 제거 |
| 명단 행 메뉴 | 모바일 다크에서 메뉴가 상세 위에 표시. 수강 해제는 메뉴, 대기의 등록 전환은 직접 버튼. 학생 후보 선택→등록 추가 확인창→취소까지 확인, 소속 변경 확정은 하지 않음 |
| 학생 상세 왕복 | 검색 `합성`, 정렬, 목록 2페이지에서 수업11→학생02 확인창→학생 상세→수업 복귀→닫기. q/sort/page=2 보존, 원래 수업 버튼으로 초점 복원 |
| 저장 실패/재시도 | PC·모바일에서 합성 저장 첫 요청 500, 저장 중 비활성화, 전체 오류 1개, 입력 유지. PC 이탈 경고→계속 편집 확인. 재시도 성공과 갱신된 상세 읽기 확인 |
| 목록 조회 오류/빈 결과 | 검색·필터·표·페이지 제어 유지. 다시 시도 시 정상 목록 복구. 일치하지 않는 검색어는 0건과 조건 초기화 표시 |
| 공통 학생 화면 | PC 기본 행 메뉴 z50 유지. 학생 상세 추가 버튼 PC36/모바일44, 모바일 상세 넘침 0 |
| 테마/모션 | 수업 상세·명단·저장 오류의 라이트/다크 확인. 일반 스크롤 종료 위치 확인; reduced-motion 분기와 기존 CSS 계약 유지 |

좌표와 관찰 결과: [browser-checks.json](class-workflow-20260921/browser-checks.json). 합성 저장/조회 요청: [PC](class-workflow-20260921/fixture-requests.json), [모바일](class-workflow-20260921/fixture-requests-mobile.json).

### 같은 조건의 비교 이미지

| 조건 | 이전 | 변경 후 |
| --- | --- | --- |
| 1440×900, 라이트, 동일 60자 제목 | [상세 이전](class-workflow-20260921/before-detail-1440.png) | [상세](class-workflow-20260921/after-detail-1440.png), [명단](class-workflow-20260921/after-roster-1440.png) |
| 390×900, 라이트, 동일 60자 제목 | [상세 이전](class-workflow-20260921/before-detail-390.png) | [상세](class-workflow-20260921/after-detail-390.png), [명단](class-workflow-20260921/after-roster-390.png) |

추가: [모바일 다크 상세](class-workflow-20260921/after-detail-dark-390.png), [다크 명단 메뉴](class-workflow-20260921/after-roster-dark-390.png), [모바일 저장 오류](class-workflow-20260921/save-error-dark-390.png), [PC 저장 오류](class-workflow-20260921/save-error-1440.png), [부분 명단 검색](class-workflow-20260921/partial-search-1440.png), [조회 오류](class-workflow-20260921/read-error-1440.png), [학생관리 기본 메뉴](class-workflow-20260921/student-menu-reference-1440.png), [학생 상세 PC](class-workflow-20260921/student-detail-reference-1440.png), [학생 상세 모바일](class-workflow-20260921/student-detail-reference-390.png).

## 자동 검사

- 관련 회귀 검사 **407/407 통과**. 상세 요청 경쟁·초안·저장·권한, numbered pagination, 원자적 수강/대기/정원 계약, 공통 테이블·컨트롤·초점·명암 포함. 신규 동작 검사는 검색 중 소속/초안 보존과 실패 후 재시도를 실제 ManagementPage 렌더로 검증한다.
- 마지막 요약 헤더 스타일 정리 후 영향 범위 **56/56 재검사 통과**.
- 변경 파일 ESLint, `tsc --noEmit`, `git diff --check` 통과.
- `next build --webpack` **exit 0**. 합성 Supabase 주소 `http://127.0.0.1:9`로 외부 DB 연결을 차단한 빌드다. 공개 데이터 정적 생성 중 `public_classes_read_failed` network 기록은 이 의도적인 주소에서 발생했고 84개 정적 페이지 생성은 완료됐다. 운영 API 가용성 증거로 사용하지 않는다.
- **후속 작업에서 전체 lint 통과: 오류 0건, 기존 경고 5건.** 최초 검수에서 남았던 `tests/dialog-opener-focus.test.mjs`의 `react-hooks/refs` 오류 2건을 해결했다. 설치된 린터는 테스트의 `createElement`에 hook ref를 전달하는 것을 렌더 중 ref 접근으로 판단했다. 테스트 setup마다 `React.createRef()`를 한 번 만들어 마운트와 재렌더링 동안 유지하도록 정리했다. 규칙 비활성화나 제품 Dialog 변경은 없다. 기존 경고는 timetable의 불필요한 useMemo 의존성 1건, ops-task-service의 미사용 함수 3건, public-classes-cache 테스트의 미사용 import 1건이다.
- 후속 초점·탐색 회귀 검사 **27/27 통과**: `dialog-opener-focus`, `sidebar-focus-return`, `command-search-navigation`. 검색창으로 초점을 돌리는 기존 두 테스트에 상세 로딩 후 재렌더링을 추가하여 ref가 계속 유효한지도 확인했다. 수정은 테스트 fixture와 이 기록에만 적용했으므로 제품 빌드·브라우저 검수 결과는 앞선 실행과 구분한다.
- numbered pagination 테스트는 기본 숨김인 weeklyHours 열을 해당 테스트 안에서만 명시적으로 표시하도록 수정했다. 제품의 열 기본값이나 사용자 저장 설정을 바꾸지 않았다.
- 이전 `premium-class-browser.mjs`의 이름 필드 locator를 필수 접근성 이름에 맞췄다. 이번 실제 브라우저 검수는 CUA로 수행했으며 그 스크립트를 재실행한 것으로 기록하지 않는다.

실행 범위:

```sh
node --test --test-concurrency=1 --experimental-strip-types \
  tests/management-*.test.mjs tests/class-roster-search.test.mjs \
  tests/class-schedule-slots.test.mjs tests/student-class-picker-model.test.mjs \
  tests/class-textbook-picker-model.test.mjs tests/data-table-*.test.mjs \
  tests/common-controls-ui.test.mjs tests/dialog-opener-focus.test.mjs \
  tests/workspace-tabs.test.mjs tests/premium-semantic-contrast.test.mjs \
  tests/admin-shell.test.mjs tests/sidebar-brand.test.mjs
```

## 로컬 재현

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3222 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only \
  node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3221
node scripts/qa/class-workflow-fixture-server.mjs
```

별도 터미널에서 두 프로세스를 실행하고 `http://127.0.0.1:3220/__fixture`로 진입한다. `?theme=dark`, `?route=students`를 지원한다. `/__control`에 `{ "mode": "partial" }`, `save-error`, `read-error`, `empty`, `loading`, `normal`을 POST하면 로컬 응답 모드가 바뀐다. `save-error`는 모드 전환 후 첫 저장만 실패한다. `/__evidence`는 합성 요청 기록을 반환한다. 외부 비밀키나 운영 세션을 사용하지 않는다.

## 릴리스 경계

기준 SHA의 GitHub Vercel 상태는 success였고 운영 수업 목록·상세는 읽기 전용으로 관찰했다. 이번 Vercel 도구/CLI 경로에서는 deployment READY·alias를 새로 독립 확인하지 못했으므로 기존 배포 검증을 반복 완료했다고 쓰지 않는다.

이번 변경은 로컬 구현·검수 결과다. PR/main CI, 운영 DB 저장, 실제 기기 Safari, 운영 migration, 고객 발송, 새 Production 배포는 실행하지 않았다. 합성 저장 성공은 운영 저장 성공을 의미하지 않는다.
