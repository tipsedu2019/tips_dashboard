# 교재관리 UI 개선 최종 완료 보고

검수일: 2026-09-11 (KST)
브랜치: `codex/dashboard-apple-design-20260909`

사용자의 “작업 완료 때까지 목표로 달고 진행” 요청에 따라 시안3과 현재 승인된 교재관리 다섯 탭, 연결된 상세·입력·일괄·문서 창을 통합 감사했다. 기존 미커밋 변경을 보존하고 남은 실제 결함을 해결했다. 새 기능이나 별도 디자인 방향으로 범위를 늘리지 않았다.

## 단계와 완료 기준

- [x] 기존 구현과 검수 자료를 감사해 남은 결함 목록 확정
- [x] 기존 공용 컴포넌트 중심으로 결함 수정
- [x] 데스크톱·390px 모바일·키보드·초점·reduced-motion 검수
- [x] 최종 영향 범위 회귀 및 build·타입·lint·diff 검사 통합
- [x] 최종 화면·결과·검증 한계 보고 후 목표 완료

## 해결한 문제

| 문제 | 최종 동작 |
| --- | --- |
| 조회 오류가 탭·검색·표를 아래로 밀어냄 | 공통 DataTableReadFeedback을 기존 도구 영역에 표시. 재시도 때 검색창으로 초점 유지 |
| 조회 실패를 데이터 없음으로 표시 | 정상 빈 결과와 읽기 실패 구분, 해당 읽기의 재시도 제공. 보조 이력 오류는 해당 이력에 표시 |
| 모바일 긴 교재명이 상태 표시를 카드 밖으로 밀어냄 | 공통 DataTableDetailButton의 flex 축소를 허용해 가용 너비 안에서 줄바꿈 |
| 출고 처리 중 행·일괄 버튼 상태가 제각각 | 같은 출고 처리 중 관련 변경 작업·선택 해제·더보기의 비활성과 진행 상태 통일 |
| reduced-motion에서도 메뉴 애니메이션 실행 | 메뉴·하위 메뉴·선택·팝오버·툴팁 애니메이션을 기존 대화상자와 같이 0ms 처리 |
| 내부 서버 오류 노출 | 알려진 업무 안내 유지. 네트워크·권한·준비 상태·입력 오류는 한국어로 정규화하고 미분류 원문·내부 식별자 비노출 |

기존 Button, 도구 모음, 표·행 작업, 폼·상세·문서 프레임을 재사용했다. 고정 컬럼 순서·너비와 다섯 탭의 검색·필터·페이지 이동 구조를 유지한다. 기간·교재 정산 화면·불필요한 실사 상태·요청 판단·컬럼 커스터마이징을 재도입하지 않았다. 폼의 명시적 취소와 늦은 응답 격리 정책도 유지한다.

## 실제 브라우저 검수

로컬 `127.0.0.1:3137`의 합성 데이터, 데스크톱 1280×720 및 모바일 390×844 조건이다.

| 항목 | 측정 결과 |
| --- | --- |
| 다섯 탭 검색창 | 데스크톱 x297/y150, 579×36px; 모바일 x29/y214, 317×44px로 동일 |
| 조회 오류의 레이아웃 이동 | 출고 탭·검색·도구 영역·표 시작점 70px → 0px |
| 모바일 다섯 탭 조회 오류 | 검색 y214와 각 도구 영역 높이 유지, 페이지 가로 넘침 0px |
| 긴 교재명·상태 | 상태 오른쪽 끝 x547.51 → x333px로 카드 안에 표시; 제목 3줄 |
| 검색 결과 없음 | 검색·탭·도구 영역·목록 시작점과 검색 초점 유지 |
| 모바일 수정 실패 | 창 x16/y16, 343×812px; 저장 버튼 x191.5/y767, 146.5×44px 유지; 입력 보존 |
| 키보드 | 탭 방향키 초점 이동, Enter 선택; 필터 Escape·수정 취소 초점 복귀 |
| 조회 재시도 | 재시도 중·후 검색창 초점 유지; 정상 응답 후 오류 제거·목록과 작업 복구 |
| reduced-motion | 메뉴·선택·문서 창 애니메이션 0s; 버튼 transition-property:none |
| 최종 브라우저 error 로그 | 없음 |

검색 결과 수가 줄면 모바일 결과 높이와 뒤쪽 페이지 이동 위치는 콘텐츠에 따라 바뀐다. 긴 제목을 온전히 보여 주기 위해 카드 높이가 늘어나는 것도 의도된 동작이다. 탭별 필터 수만큼 모바일 도구 영역 높이는 다르다. 모든 요소의 이동이 0이라고 주장하지 않는다.

기존 모션 토큰인 제어 150ms/ease-out, 대화상자 200ms와 공간 전환 cubic-bezier(0.2, 0.8, 0.2, 1)을 유지한다. 이 수치는 프로젝트 선택 값이며 Apple 공식 수치가 아니다.

### 대표 화면과 측정 원본

- [최종 데스크톱 주문·입고](../../.codex-artifacts/textbook-final-20260911/desktop-purchase-final.png)
- [모바일 긴 교재명 수정](../../.codex-artifacts/textbook-final-20260911/mobile-title-after.png)
- [조회 오류 개선 전](../../.codex-artifacts/textbook-final-20260911/desktop-read-error-before.png) · [개선 후](../../.codex-artifacts/textbook-final-20260911/desktop-read-error-after.png)
- [모바일 수정 실패](../../.codex-artifacts/textbook-final-20260911/mobile-edit-error.png)
- [브라우저 측정](../../.codex-artifacts/textbook-final-20260911/browser-metrics.json) · [제목 너비 측정](../../.codex-artifacts/textbook-final-20260911/title-width.json)

초기 측정의 null 또는 숨겨진 표의 0 크기는 유효한 표 좌표로 사용하지 않았다.

## 기능·문서·성능 보존

- 최종 읽기 피드백 변경 직전 스냅샷과 비교해 기존 함수 208개와 textbookService 호출식 25곳이 동일하다. 변경 함수는 화면 구성·행 작업 표시이며 하나는 미사용 변수 제거이다. [AST 비교](../../.codex-artifacts/textbook-final-20260911/preservation.json).
- 이번 마감에서 데이터 서비스·API·권한·계산·저장 payload를 변경하지 않았다. 명시적 재시도는 기존 읽기를 호출한다. actor·선택·창 생명주기의 늦은 응답 억제, 중복 실행 차단, 실패 입력·선택 보존을 회귀로 확인한다.
- 기존 문서 내용·수량·금액·생성·capture 코드를 유지했다. 현재 주문 전달 창의 합성 데이터 4권/36,000원을 확인했다. [문서 검수](2026-09-10-textbook-document-dialogs.md)의 실제 PNG/PDF와 구조 보존 증거를 재사용했다. 이번에 새 파일을 생성해 픽셀 비교한 것은 아니다.
- 공용화만으로 속도 개선을 주장하지 않는다. 새로운 자동 읽기 경로를 추가하지 않고 중복 요청 차단을 회귀로 확인했다. 운영 응답 시간·전체 CLS·모든 렌더링 비용의 개선은 이번 결과로 입증하지 않았다. 기존 조건별 성능 측정은 [대표 구현 보고서](2026-09-10-apple-representative-implementation.md)를 재사용한다.

## 회귀와 검사

최종 로컬 회귀는 **고유 257개 통과, 미해결 실패 0개**다. 재실행한 검사를 중복 합산하지 않았다.

| 검사 범위 | 고유 통과 | 근거 |
| --- | ---: | --- |
| 화면·공용 UI | 205 | 최신 영향 범위 96개 재실행(reference 31, renderer 48, master 6, filter 2, document 5, surface 4), 나머지 최신 관련 109개 재사용 |
| 저장·선택·actor·취소 lifetime | 16 | numbered-pagination-final.tap |
| ledger·오류 매핑 | 20 | contracts-ledger.log |
| 출고 상태 전환·재고 실사 | 16 | contracts-error-mapping-dependents.log: 7+9 |

로그는 [.codex-artifacts/textbook-final-20260911](../../.codex-artifacts/textbook-final-20260911)에 보존했다. 화면 96개의 마지막 재실행은 하위 final-impact 폴더에서 확인한다. 이전 중간 결과 203/205는 최종 소스 검증과 구분한다.

[최종 UI 통합 검증](../../.codex-artifacts/textbook-final-20260911/final-integrated-validation.md) · [전체 검증 집계](../../.codex-artifacts/textbook-final-20260911/final-verification.json)

- production build·TypeScript: 통과.
- 변경 TSX/JS 대상 ESLint: 오류 0, 경고 0.
- 변경 공백 검사: 통과.
- 보존된 읽기 서비스와 실제 문서 출력은 기존 검수를 재사용한다.

원시 합성 메시지를 기대하던 테스트는 안전한 안내와 원문 비노출을 확인하도록 갱신했다. 빈 주문 집계 fixture는 실제 read-service가 거부하는 totalCount=0 그룹 대신 groups=[]로 바로잡았다. 공용 UI 테스트의 새 Button import 별칭과 변경된 retry/toolbar 선택자도 갱신했다. 기존 쓰기·actor·선택·복구 assertions는 유지했다. 일부 JSDOM 파일 worker가 assertion 없이 종료된 시도는 통과로 집계하지 않았고, 각 testcase를 독립 실행해 통과를 확인했다. 종료 원인을 확정한 것은 아니다. React act() 권고 로그와 제품 회귀 실패도 구분했다.

## 참조와 한계

Apple HIG·Design Resources·실제 화면 참조와 확인 날짜, 관찰 값과 프로젝트 선택의 구분은 [승인된 감사·제안](../design/2026-09-10-apple-principles-audit.md)을 재사용했다. 이번 마감에서는 [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)의 키보드·초점·reduced-motion·오류 복구 기준도 2026-09-11에 확인했다.

로컬 합성 데이터와 브라우저 크기 에뮬레이션 검수다. 실제 iOS 기기·스크린리더·운영 DB 저장·고객 발송·운영 배포의 증거가 아니다. 운영 데이터 변경·외부 발송·푸시·배포는 하지 않았다. 승인된 교재관리 UI 범위를 마감하며 추가 디자인 단계나 새 기능을 완료 조건에 덧붙이지 않는다.
