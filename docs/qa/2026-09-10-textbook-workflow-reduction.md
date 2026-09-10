# 교재관리 업무 축소 검수 · 2026-09-10

사용자가 교재 목록과 재고의 중복된 인상, 실사 분류, 요청의 판단, 모호한 정산 기능을 제거하도록 요청했다. 17단계는 앞선 12·15·16단계에서 남겼던 실사 분류와 정산 UI 보존 기준을 대체한다.

## 적용 내용

- 업무 탭은 **교재 재고 · 요청 · 주문·입고 · 출고 · 재고 실사** 다섯 개다. 위치별 수량을 이미 제공하는 교재 목록을 교재 재고로 바꾸고 표·페이지 탐색의 접근성 이름도 맞췄다.
- 실사의 실사 권장·대기·완료·전체 버튼, 상태 열/모바일 배지, 추천 사유와 기한 안내를 제거했다. 조회에는 항상 `audit: "all"`을 사용하며 실사 반영 후 완료 필터로 전환하지 않는다. 위치 선택, 검색·교재 분류, 현재 수량, 실사 입력, 차이, 실제 최종 실사일, 메모, 선택·일괄 반영, 재고 이력을 유지한다.
- 요청·주문 공통 처리표의 판단 열과 모바일 부족/여유 표시, 입력 창의 중복 수업 인원·판단 요약을 제거했다. 학생용·교사용 요청/주문/입고 수량, 합계, 처리 상태와 행 작업은 유지한다. 기존 공통 컬럼 훅이 저장된 `decision` 설정만 버리고 다른 열 설정은 유지한다.
- 정산 탭, 목록, 생성·저장·확정, 상세 비교, 내역 조회·복사 UI와 관련 상태/훅을 제거했다. 정산 목록·상세·미리보기·이동 내역 reader를 화면에 연결하지 않는다. 예전 정산 URL은 첫 조회 전에 교재 재고 1페이지로 이동하고 정산 상세·이동 내역 쿼리를 제거한다. 유효한 페이지 크기와 무관한 URL 값은 유지한다.
- 기존 저장 기록, 재고 원장, 서비스·DB 계약은 삭제하거나 변경하지 않았다. 정산을 운영 UI에서 사용할 수 없게 한 것이며 기존 데이터를 지우는 변경은 아니다.

## 자동 검사와 코드 보존

최종 **194/194 통과**: `tests/textbook-workspace.test.mjs`, `tests/textbook-numbered-renderers.test.mjs`, `tests/textbook-reference-ui.test.mjs`, `tests/textbook-numbered-pagination.test.mjs`, `tests/textbook-ledger.test.mjs`, `tests/textbook-numbered-read-model.test.mjs`.

새 동작 검사는 실제 제품 훅과 렌더러에서 다음을 확인한다.

1. 폐기된 정산 북마크와 브라우저 뒤로/앞으로 복원은 교재 재고를 조회하고 정산 dialog/read/write를 호출하지 않는다.
2. 저장된 판단 열 설정이 사라져도 다른 열 설정 및 데스크톱·모바일의 학생용/교사용 수량은 유지된다.
3. 실사는 전체 교재 범위로 조회하고 서버가 제공한 추천 사유를 표시하지 않는다. 0권 입력도 유효하며 차이가 계산된다.

폐기된 기능의 UI 존재를 요구하던 검사는 제거/갱신했다. 재고·출고 writer의 권한, 최신 잔고 재조회, 진행 중 새 입력 보존, 중복 처리 보호 및 원장의 기존 계산 검사는 유지했다. AST 함수 비교에서 196개 함수가 공백 정규화 후 유지됐고, 단건·일괄 실사 writer는 폐기된 완료 필터 설정 두 줄을 제외하면 동일하다. 변경 함수는 해당 UI 구성과 탭/상세 상태 처리다.

제품 TypeScript 검사, 최종 대상 ESLint(오류·경고 0), production build, `git diff --check`를 확인했다. 정산 독립 reader와 표시용 계산을 제거했지만 이번 단계에서는 렌더 시간이나 운영 속도 향상 수치를 측정하지 않았다.

## 실제 브라우저 검수

실제 제품 컴포넌트에 합성 서비스를 연결한 `http://127.0.0.1:3137`에서 확인했다.

- 데스크톱 1280px: 교재 재고 명칭과 위치별 수량, 다섯 탭, 요청의 수량·처리 상태·수정/더보기, 판단이 없는 컬럼 구성, 실사의 8열 구성과 추천 표시 제거를 확인했다.
- 모바일 390×844: 긴 교재명이 줄바꿈하고 문서 가로 넘침이 없다. 실사 0권 초안과 체크박스 Space 선택, 조건부 선택 반영, 요청 학생용/교사용 수량과 수정/더보기에 접근할 수 있다. 실사 카드 내부 폭은 315px로 내용 가로 넘침이 없었다.
- `textbookTab=closing`·7페이지·정산 상세·이동 내역이 들어 있는 주소에서 교재 재고 1페이지/15개 보기로 정리되고 정산 dialog가 열리지 않는다.
- 실사 최초 로딩 문구, 빈 결과의 `교재가 없습니다`/`재고 이력이 없습니다`, 조회 실패의 오류/재시도와 `집계 확인 필요`를 확인했다. 실패를 0권 또는 빈 목록으로 표시하지 않는다.
- 저장·반영 버튼은 누르지 않았다. 운영 DB, 인증/RLS, 실제 재고 이동, 발송, 배포를 검증한 결과는 아니다. reduced motion과 다크 테마를 이번 단계에서 다시 측정하지 않았다. 브라우저 검수 후 화면 크기 재정의를 해제했다.

## 증거

`.codex-artifacts/textbook-simplification-20260910/`의 이번 단계 파일:

- `workspace-before.tsx`, `navigation-before.ts`: 17단계 시작 소스.
- `requests-desktop.jpg`, `request-columns-desktop.jpg`, `requests-mobile.jpg`.
- `inventory-desktop.jpg`, `inventory-mobile.jpg`, `inventory-empty-desktop.jpg`, `inventory-error-desktop.jpg`.
- `legacy-closing-stock-desktop.jpg`, `retired-controls-browser.json`.
- `tests-final.log`, `lint.log`, `typecheck.log`, `build.log`, `function-comparison.json`, `retired-ui-tests.json`.

동일 폴더의 `before-workspace.tsx`, `before-navigation.ts`, `before/after-desktop.jpg` 등은 앞선 12단계 기록이다. 최종 검사 수에는 이전 실행을 중복 합산하지 않았다. 변경은 `codex/dashboard-apple-design-20260909` 작업 브랜치에 있으며 푸시·배포하지 않았다.
