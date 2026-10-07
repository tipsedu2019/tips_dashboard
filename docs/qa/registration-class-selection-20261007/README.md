# 수업 학년·등록 반·교재 기본값 검증

기준 main: `bd7905b7d066f319ff424824314526c660142b6b` (PR #110). 2026-10-07 요청의 세 문제를 동일 합성 데이터로 재현하고 수정했다. 운영 읽기/쓰기, 실제 학생·수업·교재 변경, 알림 발송, DB migration, merge와 배포는 수행하지 않았다.

## 원인과 변경

- 수업등록의 영어·수학 학년 후보가 현재 페이지의 반에서만 만들어졌다. `academic-subject-registry.ts`의 기존 지원 범위(초1–초6, 중1–중3, 고1–고3)를 후보 값에 합친다. 과학의 고1–고3 제한은 유지한다. 알려지지 않은 기존 반 학년 문자열도 제거하지 않는다.
- 청강은 관리 상세 RPC의 반 목록 순서, 등록은 카탈로그 순서로 반을 보여주었다. 공통 `RegistrationClassSelect`에서 학년→반 순서로 탐색하며 학년 순서 및 한국어 숫자 자연정렬을 적용한다. 다중 학년은 해당 학년 모두에서, 빈 학년은 `학년 미지정`에서 찾는다. 필터만 변경해도 기존 반·교재·일정 선택은 유지된다. 청강 RPC의 적격 반 집합은 유지하고 기존 카탈로그에서 학년 표시값만 결합한다.
- `applyRegistrationEnrollmentClassSelection`이 `.slice(0, 1)`로 첫 교재만 골랐다. 실제 선택 반의 상세 DTO에 `textbook_usage`, 교재 카탈로그에 `status`를 전달하여 현재 유효한 전권을 중복 없이 기본 선택한다. 기존 교재관리 계약처럼 `inactive/미사용`을 제외하며, 사용 시작/종료일은 서울 날짜 기준 양 끝을 포함한다. 기간 미지정은 기존 연결 교재로 인정한다.
- 기본값은 사용자가 새 반을 선택한 초안에만 적용한다. 반 변경 후 늦은 응답, 수동 부분선택/전체 해제, 기존 편집값, 초안 재마운트, 저장 성공 이후 소유권을 분리한다. 필요한 상세 조회가 진행 중이거나 실패한 동안 자동 기본값이 비어 있는 상태를 저장하지 않는다. 기존 저장 payload, 권한, RPC 및 DB 스키마는 유지한다.

## 검증 결과

| 검증 | 결과 |
|---|---|
| 격리 Linux, Node 22.18.0, 네트워크 없음·소스 읽기 전용 | 관련 테스트 299/299 통과 (`linux-final.log`) |
| 공통 입력·등록 application·교재 사용기간 계약 | 42/42 통과 (`shared-contracts.log`) |
| production webpack build 및 TypeScript | 통과 (`build.log`) |
| 변경 파일 ESLint | 오류 0, 기존 서비스 unused 함수 경고 3 (`lint-final.log`) |
| 실제 `/admin/registration` | 1440px/390px 통과, 외부/API/저장 요청 0, 페이지 오류 0 (`browser-results.json`) |
| 실제 `/admin/classes` production build | 1440px/390px 영어·수학 12개 학년, 과학 3개 학년 확인 (`class-browser-results.json`) |
| 수정 전 main 재현 | 영어·수학 고1/고2/중1/중2만 표시, 반 10→2 순서, 교재 a 한 권 (`before/`) |

등록 브라우저는 실제 production 컴포넌트를 사용하는 기존 개발 fixture에 합성 목록만 주입했다. fixture 소스의 일시적 변환은 검증 후 원복했다. 수업등록 브라우저는 생산 빌드의 실제 경로에 유효한 합성 조회 응답을 주입했다. 저장·발송 버튼을 누르지 않았다. `build.log`의 public class 조회 경고는 명시한 가짜 Supabase 주소로 정적 생성하는 과정의 읽기 실패이며 빌드는 성공했다.

독립 읽기 전용 리뷰를 수행했다. 리뷰 중 찾은 학년 합집합 누락, 기존 활성 판정 차이, 적용 위치 오류를 수정했다. 실제 Radix 검사에서 찾은 자동/지정 라벨 전환 충돌도 수정했다. 최종 커밋의 재검토 결과는 부모 작업에 별도로 전달한다.

공통 `Label`, `RegistrationSelect`/기존 Radix `Select`, `RegistrationTextbookSelect`를 재사용했다. 새 전역 토큰·스타일 예외는 없다. 수정 전후 PNG는 동일 합성 데이터·밝은 테마·뷰포트 기준이다. 교재 스크린샷은 전권 기본값 확인 후 b를 수동 해제한 a,c 상태이며 기본값 검증은 실행 스크립트의 실제 checkbox/title assertion에 있다.

## 재현

기존 Node, 저장소 의존성, Chrome 및 Playwright 설치를 사용한다. 비용이 드는 Actions나 새 키/권한 설정은 필요 없다.

```sh
node --experimental-strip-types --test tests/registration-class-selection.test.mjs tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-service-loading.test.mjs tests/registration-observation-draft-navigation.test.mjs tests/academic-subject-registry.test.mjs tests/science-class-taxonomy.test.mjs
node --experimental-strip-types --test tests/common-controls-ui.test.mjs tests/registration-application-model.test.mjs tests/class-textbook-usage.test.mjs
NEXT_PUBLIC_SUPABASE_URL=https://tips-internal-fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_TELEMETRY_DISABLED=1 npm run build
```

등록 UI fixture를 사용할 **격리된 체크아웃**에서 다음을 실행한다. 지정 포트가 비어 있는지 확인한다. `PLAYWRIGHT_PACKAGE`는 설치된 `playwright/package.json`의 절대 경로다. 실 운영 환경 파일을 복사하지 않는다.

```sh
python3 scripts/qa/stage-registration-class-selection-fixture.py "$PWD"
NEXT_PUBLIC_SUPABASE_URL=https://tips-internal-fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_TELEMETRY_DISABLED=1 npm run dev -- --webpack -p 3277 -H 127.0.0.1
# 다른 터미널: PLAYWRIGHT_PACKAGE 설정 후
node scripts/qa/registration-class-selection-browser.mjs
node scripts/qa/registration-class-grade-browser.mjs
# 위에서 실행한 서버만 종료한 뒤
python3 scripts/qa/stage-registration-class-selection-fixture.py "$PWD" restore
```

기준 main 비교는 별도 main 스냅샷에 같은 fixture helper와 stage script를 적용하고 3278에서 실행한다. candidate의 browser scripts에 `QA_BASELINE=1 QA_BASE_URL=http://127.0.0.1:3278 QA_OUTPUT=output/playwright/registration-selection/before`를 전달한다. production class 화면 검증은 fixture 원복·build 후 `next start`에 대해 grade script만 실행한다.

## 배포 판단

코드상 배포 가능 후보이며 DB 배포가 필요하지 않다. 운영 merge/배포는 부모 조율 후 진행한다. GitHub 무료 분 소진과 추가 요금 금지에 따라 커밋에 `[skip ci]`를 명시하고 원격 Actions는 실행하지 않는다. 보호 규칙·필수 체크 변경이나 성공 체크 생성은 하지 않는다. 이는 로컬 검증 결과이며 운영 반영 또는 운영 데이터 저장 성공을 뜻하지 않는다.
