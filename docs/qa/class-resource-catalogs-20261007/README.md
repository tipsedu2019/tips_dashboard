# 수업등록 교사·강의실 후보 누락 수정

구현 SHA: `bc23e412408e1340db171673661e634012e88209`  
기준 main: `afddea0ea5534fe435e95d121758fc74559cf927` (PR #111)

2026-10-07 12:23 UTC 요청을 별도 worktree에서 구현했다. DB migration, 권한·RLS 변경, 운영 데이터 저장, merge·배포는 수행하지 않았다. 기존 프로세스와 다른 담당자의 worktree는 보존했다.

## 원인과 수정

신규 등록은 수업 상세 조회를 하지 않는데, 기존 hook은 상세 응답에서만 교사·강의실·과학 영역 카탈로그를 확보했다. 영어·수학은 현재 목록 페이지의 수업값으로 후보를 보충하여 미배정 자원과 다른 페이지의 자원이 누락됐다. 과학은 엄격한 카탈로그 소속 검사가 있어 후보가 비었고, 공통 폼의 `options.length === 0` 분기가 Select를 Input으로 바꿨다. 화면의 ‘한지현’, ‘별5’는 입력 예시 placeholder다.

이 경로는 PR #111 이전에도 존재한다. `pr111-comparison.diff`에서 해당 PR의 이 파일 변경은 학년 registry 합집합뿐이고 참조 hook/service는 같음을 확인할 수 있다. 보존된 PR #111 빌드의 세 관련 소스 파일은 기준 main과 동일하며, 동일 합성 데이터로 영어 후보가 `이전 교사` 하나, 과학 교사·강의실이 `INPUT`인 것을 1440px/390px에서 재현했다.

수정은 다음 기존 계약을 사용한다.

- 폼을 열 때 기존 authenticated SELECT로 `teacher_catalogs`와 `classroom_catalogs`의 `is_visible=true` 행을 읽는다. 교사 계정의 임의 활성 상태나 현재 수업 배정 여부를 추가 조건으로 추정하지 않는다.
- 기존 자원 설정 화면처럼 필요한 5개 컬럼만 `sort_order, name, id` 정렬과 30개 페이지로 끝까지 조회한다. 215개 합성 카탈로그로 200개 제한이 없음을 검증했다. 잘못된 페이지·중복 ID·중간 실패는 부분 성공으로 처리하지 않는다.
- 과학 교사는 정확히 `과학팀`, 강의실은 `과학` 소속을 요구하는 기존 함수를 유지한다. 영어·수학의 소속 정규화 및 빈 소속 공용 자원 허용도 유지한다. 과학 영역은 기존 `list_active_science_subject_areas_v1`을 사용한다.
- 교사·강의실은 항상 Select로 유지하고 로딩·실패·정상 빈 목록을 구분한다. 실패 시 명시적 재시도가 가능하다. 준비 전 과목·자원·기본 시간표 편집과 수업/기본 시간표 저장을 차단한다.
- 과목 변경 시 새 과목과 호환되지 않는 자원은 빈 후보에서도 해제한다. 편집 중 기존 미등록/숨김 자원값은 화면에 보존한다. 과학 저장의 기존 엄격한 후보 검사도 유지한다.
- 폼 종료·재개방·사용자/권한 변경의 늦은 응답을 차단한다. 상세 응답은 독립 조회한 카탈로그를 덮어쓰지 않는다. 사용자 수동 입력과 선택은 조회 완료나 재시도로 바뀌지 않는다. 같은 사용자·권한의 마지막 완료 카탈로그는 기존 bulk 컨텍스트를 위해 보존하고, 폼 재개방 시에는 반드시 새 조회 완료를 기다린다.

## 검증

| 검증 | 결과 및 증거 |
|---|---|
| 격리 Linux / Node 22.18.0 / 네트워크 없음 / 소스·의존성 읽기 전용 | 관련 관리·과목·공통 디자인 계약 **402/402** (`linux-final.log`) |
| 실제 production 경로 `/admin/classes` 합성 브라우저 | **1440px/390px 통과**, 처리하지 않은 요청 0, 페이지 오류 0 (`browser-results.json`) |
| production webpack 빌드 및 TypeScript | 통과 (`build.log`, `manifest.json`) |
| 변경 파일 ESLint | 오류 0, 기존 `ARCHIVED_CLASS_STATUS` unused 경고 1 (`lint.log`) |
| 기존 무료 사용량 전체 guard | `--surface all` exit 0. 초기 shallow checkout의 기준 객체 누락을 해당 객체의 읽기 전용 fetch로 해결. 검사/정책 파일 변경 없음 (`manifest.json`) |
| 새 조회 정적 검사 | 기존 대비 추가 위반 0 (`query-delta.json`) |
| 독립 리뷰 | 구현 SHA 재검토, 직접 핵심 테스트 8/8, 남은 P1/P2 없음 |

브라우저는 외부 요청을 차단하는 별도 임시 Chrome 프로필과 가짜 Supabase 주소를 사용했다. 실제 학생·교사·강의실·교재·인증 정보를 사용하지 않았고 저장·등록·발송 버튼을 누르지 않았다. 실제 폼을 사용하여 영어→수학→과학 전환, 현재 수업 없는 활성 자원, 숨김 제외, 과학의 정확한 소속, 강의실 숫자 자연정렬, 오류/빈 목록, 재시도 후 초안 보존, 지연 중 편집 잠금, 기존 편집값 보존을 검증했다. 실제 hook 테스트는 재개방·권한 변경·로그아웃·늦은 상세 응답을 포함한다. 실제 page 테스트는 카탈로그와 기본 시간표가 함께 지연되어도 기존 자원 ID가 보존되는지 확인한다.

독립 리뷰에서 지적한 준비 전 과목 변경과 시간표 자원 ID 소실 가능성을 수정하고 회귀 검증했다. 과학 bulk 목록 DTO의 `subjectAreaKey` 누락은 기존 별도 문제로 식별됐으며 이번 범위를 확장하지 않았다.

기존 수업등록/상세 화면을 기준으로 공통 `Select`, `Label`, `Button`, `Alert`, `Dialog`를 유지했다. 새 전역 스타일·예외는 없다. 동일 밝은 테마의 변경 전후 모바일 PNG, 수정 후 데스크톱 PNG와 빈 목록·오류 PNG를 포함했다. `build.log`의 공개 수업 조회 경고는 정적 빌드 중 가짜 Supabase 주소의 읽기 실패이며 빌드는 성공했다.

## 재현

기존 설치된 Node·의존성·Chrome·Playwright를 사용한다. 아래 주소와 키는 합성 값이며 운영 환경 파일을 복사하지 않는다. 지정 포트가 비어 있는지 먼저 확인한다.

```sh
node --experimental-strip-types --test tests/management-*.test.mjs tests/science-class-taxonomy.test.mjs tests/academic-subject-registry.test.mjs tests/admin-shell.test.mjs tests/sidebar-brand.test.mjs tests/premium-semantic-contrast.test.mjs tests/common-controls-ui.test.mjs tests/data-table-surface.test.mjs tests/data-table-selection-actions.test.mjs tests/data-table-pagination.test.mjs tests/data-table-search-field.test.mjs tests/workspace-tabs.test.mjs
NEXT_PUBLIC_SUPABASE_URL=https://tips-internal-fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_TELEMETRY_DISABLED=1 npm run build
npm run start -- -p 3279 -H 127.0.0.1
# 별도 터미널: PLAYWRIGHT_PACKAGE에 기존 playwright/package.json 절대 경로 지정
QA_BASE_URL=http://127.0.0.1:3279 node scripts/qa/class-resource-catalog-browser.mjs
```

기존 화면 비교는 관련 소스가 같은 PR #111 빌드의 별도 로컬 서버(3280)에 `QA_BASELINE=1 QA_BASE_URL=http://127.0.0.1:3280`을 지정한다. 브라우저 스크립트는 로컬 주소만 허용한다. Linux 검증은 기존 `public.ecr.aws/supabase/studio:2026.08.17-sha-0c1da8f` 이미지에서 `--pull=never --network none --rm`으로 실행하고 위 테스트 파일 목록을 사용했다. 기존 DB 컨테이너에는 연결하지 않았다.

## 판정과 미확인 범위

코드 기준 배포 가능한 후보이며 **DB·권한 변경이 필요 없다**. 운영 merge/배포는 부모 조율 후 수행한다. 커밋에 `[skip ci]`를 넣어 추가 GitHub Actions 비용을 방지했고, 보호 규칙 변경·체크 위조·유료 서비스·키/OAuth 설정 변경은 없다.

이번 실행 환경에는 운영 브라우저 도구가 없어 실제 운영 UI와 현재 카탈로그 데이터는 재확인하지 못했다. 두 첨부는 Library 메타데이터·OCR만 읽었고 원본의 승인된 다운로드 URL은 403으로 실패했다. 같은 승인 동작을 한 번 재시도한 뒤 중단했으며 다른 경로로 우회하지 않았다. 따라서 원본 픽셀 확인이나 운영 저장 성공을 주장하지 않는다. 소스와 합성 재현·검증 결과를 운영 반영 사실과 구분한다.
