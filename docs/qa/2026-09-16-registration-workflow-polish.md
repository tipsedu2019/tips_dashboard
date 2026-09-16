# 등록 목록·상세 개선 검증

- 기준: `7e7a7ff1f46ef8b9f0067fac5c0e5f46b286e231`, `/admin/students`의 공통 표 구성 및 `DESIGN.md`.
- 범위: 등록 목록/상세 배치, 자동 스크롤, 상태 변경 오류 안내, 닫기 후 초점. DB/RPC, 권한, 업무 상태 전이, 발송 계약 변경 없음.
- 검증 환경: 로컬 Next dev, 기존 `registration-subject-tracks` / `english_admin` 합성 데이터. Supabase 주소는 `127.0.0.1:9`, 알림 토큰은 fixture에서 비활성화. 운영 DB 저장·고객 발송·배포 검증이 아님.

## 변경

- 단계 탭 아래 검색/등록 행동 → 담당 범위 → 데이터 → 페이지 이동을 공통 표 외곽면 안에 합성.
- 담당 범위는 `내 담당`/`전체 담당`으로 표시하고 0건도 유지. 내 담당이 비어 있고 전체에는 데이터가 있으면 전체 상담으로 이동 가능.
- 학생 이름과 학교/학년 계층 구분, `빠른 처리`를 `과목 · 진행상태`로 명확화, 헤더와 본문 열 시작점 일치.
- 모바일은 상담 방식과 책임자 등 비교 가능한 필드를 두 열로 배치하고 학생 라벨 중복 제거. 여러 과목의 desktop subgrid 정렬 유지.
- 상세의 과목 탭과 상태 제어를 같은 행에 두고 알림 행동을 다음 행으로 이동. 진행상태는 공통 `NativeSelect` 사용.
- 자동 이동은 고정된 track offset 대신 shell이 실제 헤더 높이를 측정한 section 시작점으로 이동. 동작 줄이기 설정에서는 즉시 이동.
- 새 상태 변경 시 이전 오류 안내 초기화. 공통 Dialog의 선택적 fallback ref로 사라진 행/직접 링크에서 닫으면 검색창에 초점 복귀. 기존 행, 중첩창, 경로 변경 규칙 유지.

## 브라우저 확인

Chrome CUA에서 1440×1000, 390×844 및 키보드 노출을 대신한 390×520 뷰포트 사용. 라이트/다크 확인.

- 검색어 `김예린`, 전체 담당 선택 → Enter로 행 열기 → 닫기: 검색어·담당 범위 유지, 원래 행으로 초점 복귀.
- 검색 지우기: 검색창 초점 유지, 전체 목록 복구.
- 상담 완료의 빈 목록에서 검색, 등록 추가, 0건 범위 버튼, 페이지 이동 상태 확인.
- 상담 상세 PC 헤더 높이 244px. 모바일 자동 이동 후 header bottom 317px, section top 333px, 상담 제목 top 350px로 제목/상담 방식이 가려지지 않음.
- 상담 내용 입력 → 닫기 → 계속 편집: 입력 유지. 합성 초안을 버리고 닫은 뒤 목록 정상 표시.
- 높이 520px에서는 `data-registration-compact-viewport=true`, header position `static` 확인.
- 확인한 PC/모바일 화면에서 문서 가로 넘침 없음. 등록 신청 단계의 표와 공통 footer 정렬, 등록 추가 창 열기/닫기 및 예약 달력 전환 확인.
- 상태 변경의 1회 실패는 `fixtureActionType=setRegistrationWorkflowStatus&fixtureActionError=forced_failure&fixtureActionDelayMs=400`로 재현. 실패 시 상세 및 원래 상태 유지, 같은 동작으로 재시도 가능.
- 수정 후 재시도에서 `consultation_completed` 저장, 오류 안내 없음, 직접 링크로 연 상세를 닫으면 `등록 검색`으로 초점 복귀 및 상담 신청 단계 유지 확인.

브라우저 확장 프로그램이 `<html>`에 넣은 `data-hwp-extension` 속성 때문에 baseline부터 React hydration 경고가 발생했다. 이 작업에서 앱 오류로 간주하여 전역 hydration 경고를 숨기는 처리는 하지 않았다.

## 자동 검증

`node --test --experimental-strip-types`로 아래 관련 suites를 실행하고 변경된 부분은 수정 후 다시 실행했다.

- `registration-list-toolbar`, `premium-registration-list`, `premium-registration-detail`
- `registration-case-list-model`, `registration-workspace-route`, `registration-track-workspace`, `registration-observation-draft-navigation`
- `ops-task-list-navigation`, `ops-task-workspace`, `dialog-opener-focus`
- `data-table-surface`, `workspace-tabs`, `common-controls-ui`

검증 항목에는 3과목별 셀 정렬/빈 시간 값, 미저장 폼 유지, 권한별 변경 차단, no-send 경계, 페이지/스크롤 복원, 중첩창 및 행 제거/직접 링크의 초점 복귀가 포함된다. 툴바의 범위 전환으로 검색 입력 노드가 다시 마운트되지 않는 것도 확인한다.

변경 TS/TSX 및 테스트 ESLint, `tsc --noEmit`, production build 모두 통과했다. 빌드는 외부 접속을 막은 합성 환경이라 public-class prerender 조회의 network 경고가 발생했으며 운영 API 검증을 대체하지 않는다. 이번 작업은 성능 개선 수치를 주장하지 않는다. 운영 배포는 진행하지 않았다.
