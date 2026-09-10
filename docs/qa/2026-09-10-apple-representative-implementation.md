# Apple 원칙 대표 구현 · 검수 결과

- 날짜: 2026-09-10
- 브랜치: `codex/dashboard-apple-design-20260909`, 기존 누적 변경 보존
- 승인: 감사/제안 이후 사용자 “진행”
- 범위: 교재 재고 → 검색·분류·선택·컬럼 표시 → 교재 수정. 주문·입고에는 연결된 공용 컬럼 설정 수정이 적용됨.
- 현재 단계: 대표 구현 완료, 사용자 화면 검수 대기. 전체 확장·배포 미진행.

## 실제 화면

- [대표 화면](http://127.0.0.1:3137/admin/textbooks)
- [공통 상태 비교](http://127.0.0.1:3137/review/components)
- [동일 크기 전후 비교](http://127.0.0.1:3139/implemented.html)
- 증거 폴더: `.codex-artifacts/apple-principles-implementation-20260910/`
- 공식 참조, 관찰과 프로젝트 선택의 구분: [승인된 감사·제안](../design/2026-09-10-apple-principles-audit.md). 이번 수치는 Apple 공식 치수가 아니라 실제 프로젝트 측정/선택 값이다.

## 구현

1. 검색 UI를 `DataTableSearchField`로 통합했다. 검색 의미·단축키·자동완성 방지·입력 계약을 유지하고 native 검색 삭제 아이콘과 공용 삭제 버튼의 중복을 없앴다. 삭제 후 같은 입력으로 preventScroll 포커스 복귀.
2. 선택 시 검색과 필터는 유지하고 고정된 오른쪽 작업 영역만 교체한다. 속성 변경은 직접 보이고 사용 전환·미사용·삭제는 공용 작업 메뉴에 있다. 명시적으로 속성 변경을 누른 때만 일괄 편집 폼이 열린다. 선택 해제 후에도 이미 작성한 patch의 보존 계약은 기존 작업 수명/선택 revision을 따른다.
3. 짧은 과목·학교·학년은 공용 Select 필터, 동적인 세부과목은 기존 검색 가능한 선택기를 사용한다. 데스크톱은 라벨/값 한 줄, 모바일은 2열과 44px 입력 높이. 초기화 자리를 항상 유지한다.
4. master 표시 설정은 컬럼 표시만 제공한다. 서버 정렬 `quality-title`, 현재 그룹/집계, 페이지당 10/15/20 계약은 그대로다. 동적 재고 위치의 저장된 표시 설정은 summary 수락 전에는 지우지 않는다.
5. 컬럼 설정이 기존 공용 `DataTableSettings`의 화면 가용 높이와 내부 스크롤을 사용한다. 필수 컬럼을 간결하게 표시하고 변경 가능한 컬럼만 체크 목록으로 제공한다.
6. desktop master 표는 일정한 viewport 높이와 안정된 scrollbar gutter를 사용한다. 빈 결과·로딩·오류에서도 도구 막대·표·페이지 이동이 유지된다. 목록/집계 오류의 재시도는 같은 작업 영역에 표시한다. 모바일 본문은 자연스럽게 스크롤한다.
7. 긴 교재명은 줄 수 제한 없이 표시한다. 행 수직 여백을 8px 줄여 정보 밀도를 높였다. 제목 클릭과 연필 편집 진입을 유지하고 수정 폼은 기존 공용 FormDialogContent 안에서 분류, 출판사/가격, 식별자를 정렬했다.
8. 기존 control 150ms / dialog 200ms를 공통 토큰으로 옮겼다. 버튼의 이동/확대는 없고 색·테두리·그림자·opacity·brightness만 전환한다. 기본 dialog zoom 0.95→1은 기존 동작이다. reduced motion에서 dialog duration 0s, 버튼은 transition-property:none을 사용한다.

## 브라우저 측정

CUA in-app Chromium, 로컬 합성 데이터. desktop 1280×720, mobile 390×844. 최종 원본은 `measurements.json`.

| 조작/항목 | 변경 전 감사 | 실제 구현 |
|---|---:|---:|
| 체크 선택 시 작업 영역 추가 | 53px 추가, 문서 scroll 0→29 | 검색/표/pager 이동 0px, scroll 0 유지 |
| 빈 결과로 전환 | 표 폭 +15px, pager 위로 207px | 표 폭/높이 및 pager x/y 변화 0px |
| 모바일 필터 적용 | 필터 영역 +44px | 초기화 전후 140px 유지, 추가 0px |
| 주문·입고 설정 하단 | y828, 화면 밖 108px | y708, 화면 안 12px; 내부 scroll 318/382px |
| 긴 교재명 행 | 81px, 완전 표시 3행 | 73px, 완전 표시 4행 |
| master 초기 loading/목록 error | 별도 배치 | 검색 y150, 표 y247/h396, pager y652 동일 |
| 모바일 수정 폼 | 기존 공용 frame | x16/y16/w358/h812, body 내부 scroll |
| 저장 버튼 대기/진행 | 공용 동작 기준 | 실제 같은 label에서 x850.875/y643/w100.125/h36 유지 |

추가 확인:
- 컬럼 숨김/기본값 복원, 필수 컬럼 유지, Escape 닫기와 포커스 복귀.
- 선택/선택 해제, 고정 옵션 변경, 초기화, 검색 결과 없음, 최초 목록 오류/로딩.
- 키보드 focus-visible, 실제 포인터 hover/pressed, reduced motion에서 수정 dialog 동작.
- 공통 갤러리의 저장 중 비활성, 오류 시 입력 유지, 재시도 성공. 이것은 합성 UI 상태 전환이며 운영 저장 성공의 증거가 아니다.
- 초기 구현에서 외부 min-height 때문에 남던 29px 스크롤과 갤러리의 busy label 변경으로 생긴 12.11px 너비 변화를 발견해 수정한 뒤 재측정했다.

## 기능·출력 보존

- AST 비교: 기존 함수 208개 동일. 바뀐 기존 함수는 workspace 구성, 목록 필터, 일괄 작업 presentation, master table 4개다.
- `textbookService` 호출 25곳의 호출식이 변경 전과 동일하다.
- 문서 카드 구조/내용 AST 동일. 수량·금액·문서 생성/내보내기 함수는 변경하지 않았다.
- `textbook-document-dialog.test.mjs` 5개를 재실행했다. 이전 단계의 실제 PNG/PDF 시각 비교는 출력 구현이 영향을 받지 않아 재사용했다. 이번 단계에서 새 PNG/PDF를 생성해 픽셀 단위로 다시 비교했다고 주장하지 않는다.
- 로컬 테스트의 서비스 쓰기는 mock이다. 운영 DB·계정·인증·API·알림 발송·배포에는 접근/변경하지 않았다.

## 검증 기록

| 검증 | 결과 |
|---|---|
| master 렌더러 + 새 검색/선택/필터 동작 | 50 통과 |
| 공용 columns + pager + table surface | 20 통과 |
| 작업/서비스 source 계약 | 91 통과 |
| 참조·수정·저장/복구 | 30 통과 |
| 문서 dialog 회귀 | 5 통과 |
| 출고/주문·입고 필터 | 각 1 통과 (독립 프로세스) |
| 실제 공통 상태 화면/토큰 계약 | 2 통과 |
| 제품 TypeScript / 대상 ESLint / production build | 통과 |

총 200개 고유 관련 검사. 과거 phase의 통과 수는 합산하지 않았다. 초기 실패했던 stale markup assertions는 새 공용 컴포넌트/표현을 검증하도록 갱신했고, 저장·정렬·권한·출력 계약 검사는 보존했다.

추가로 훅 단독 SSR→hydrate 검사에서 저장된 숨김 설정이 서버 기본값과 달라 hydration 복구를 일으키는 경계를 재현했다. 첫 hydration은 서버 기본값을 유지하고 이후 저장값을 적용하며, hydration과 비동기 컬럼 정의가 모두 준비된 뒤 저장하도록 수정했다. 실제 fixture 새로고침 경로에서는 콘솔 오류가 관찰되지 않았고 숨김 설정 복원을 확인했다.

`textbook-filter-controls.test.mjs` 두 JSDOM workspace 시나리오를 한 프로세스에서 실행하면 약 21초 후 SIGKILL이 발생했다. 각 시나리오를 독립 프로세스로 실행하면 통과한다. 전체 suite 일괄 실행의 자원 문제 해결을 완료했다고 주장하지 않는다. 별도의 오래된 baseline fixture 전체 타입 오류와 범위 밖 기존 admin/navigation 검사는 이번 제품 빌드 통과와 구분한다.

## 성능

같은 최신 공용 primitives 아래에서 변경 직전/직후 workspace를 React 개발 Profiler + JSDOM으로 비교했다. 10개 동일 row, 6회 warmup 후 선택 토글 30회. 브라우저/운영 응답 시간과 구분한다.

| 항목 | 변경 전 | 변경 후 |
|---|---:|---:|
| 추가 조회 | 0 | 0 |
| React commit 수 | 105 | 105 |
| 30회 actual render 합계 | 191.43ms | 153.50ms |
| interaction 중앙값 | 10.79ms | 13.20ms |
| interaction p95 | 24.28ms | 16.50ms |

렌더 시간은 줄었지만 중앙값은 늘었고 개발 환경 변동이 있다. 전체 속도가 개선됐다고 결론 내리지 않는다. 확정 개선은 불필요한 요청을 추가하지 않은 채 화면 이동을 제거한 것이다. 원본/재현 스크립트: `performance-{before,after}.json`, `performance.test.mjs`.

## 남은 검수

- 사용자: 대표 실제 화면의 밀도, 필터·표 설정·수정 동선 확인.
- 이후 승인된 범위에서 검증된 공용 UI를 다른 화면으로 확장.
- 범위 밖 API schema 장애/일괄 작업 전역 알림, 모든 OS/브라우저 조합의 위치 안정성은 이번 측정으로 일반화하지 않는다.
