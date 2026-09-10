# 교재관리 필터·화면 안정성 · 2026-09-10

사용자가 주문·입고 필터 내부 버튼과 출고 필터를 조작할 때 화면이 흔들리고 UI 통일감이 부족하다고 보고했다. 인터넷 자료 조사, 실제 재현, 구현 및 검수를 진행했다. 작업 범위는 교재관리의 공통 필터와 목록 조작 위치다.

## 조사와 판단

| 확인한 공식 자료 | 이 화면에 적용한 판단 |
| --- | --- |
| [Apple HIG Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers?changes=_9) | 임시 창에는 소수의 관련 작업만 담는다. 세 종류의 지속적인 조회 조건을 한 창에 숨기기보다 기존 관리 화면처럼 라벨이 있는 선택 상자로 노출하기로 판단했다. 이는 TIPS에 대한 설계 판단이며 Apple이 이 제품 구성을 직접 권고한 것은 아니다. |
| [web.dev: Optimize CLS](https://web.dev/articles/optimize-cls?hl=en) | 동적 내용의 추가·제거와 크기 변화가 이동을 일으킨다. 검색·조건·주 행동이 빈 결과에서도 자리를 유지하도록 했다. 사용자 입력 직후 이동은 CLS 점수에서 제외될 수 있으므로 클릭 전후 실제 좌표도 측정했다. |
| [Radix Select](https://www.radix-ui.com/primitives/docs/components/select) | 기존 controlled Select의 키보드 탐색과 초점 복귀를 재사용했다. 표시 값은 라벨, 메뉴 항목의 부가 정보는 건수로 분리하고 `textValue`로 이름 기반 탐색을 유지한다. |
| [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) | 라벨·초점 표시, 비동기 상태 안내, reduced-motion 대응, 가로 넘침을 점검했다. |
| [MDN scrollbar-gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter) | 스크롤바 유무도 원인 후보로 조사했다. 실제 선택 메뉴의 스크롤 잠금은 본문 위치를 이동시키지 않아 전역 gutter나 modal 동작을 바꾸지 않았다. |

프로젝트 설치본은 React 19.2.3, Next 16.1.1, Radix Select 2.2.6, Popover 1.1.15다. 기존 스택으로 해결할 수 있어 새 라이브러리나 플러그인을 설치하지 않았다. Apple pop-up-buttons 문서는 직접 열기에서 JavaScript 요구 응답만 받아 판단 근거로 사용하지 않았다.

## 재현된 원인

- 출고 완료 0건으로 바꾸면 `activeProcessHasRows` 조건 때문에 검색창이 사라졌다. 같은 1280px 화면에서 도구 모음 y좌표가 202→154px로 바뀌었다.
- 출고의 `outline`과 `default` 버튼 변형은 테두리 유무가 달라 선택 시 너비가 2px 변하고 옆 버튼도 이동했다.
- 주문·입고의 필터 라벨·조건 개수 배지가 바뀌면 트리거 폭이 약 101→149px로 변했다. ‘기본 보기’ 버튼이 추가되면 열린 창 높이가 218→262px로 늘어났다. 건수에 따라 선택지 자체를 제거하는 코드도 있었다.
- 결과가 없어지면 열 설정·추가·문서 버튼이 다른 위치로 사라지거나 다시 나타났다. 모바일에서는 합계 문자열 길이가 작업 버튼의 줄바꿈에도 영향을 줬다.

## 적용 내용

- `DataTableSelectFilter`를 추가하고 주문·입고의 범위/단계/교재 등록과 출고 상태에 함께 사용했다. 기존 Label/Select/공통 필터 폭과 테마를 재사용한다. 선택 라벨이 바뀌어도 제어 크기는 같다.
- 모든 유효한 선택지를 유지한다. 0건과 미확정 건수(—)를 구별하며 건수는 메뉴 안에서만 보인다. 초기화는 같은 자리에 두고 기본값이면 비활성화한다.
- 요청·주문·입고·출고의 검색과 표 도구 모음은 조회 결과 수와 무관하게 유지한다. 공통 프레임과 도구 모음으로 맞추고, 빈 상태의 별도 ‘바로 추가’는 상단의 같은 추가 버튼으로 통합했다.
- 목록 갱신 중에는 수락된 조건의 기존 행과 그룹을 유지한다. 새 조건은 선택 상자에 반영하고 조회 상태는 live region과 기존 새로고침 표시로 알린다. 실패하면 기존 결과와 선택한 조건을 유지한다.
- 필터가 바뀌는 동안 주문서·청구 자료를 이전 조건으로 만들지 않게 해당 진입 버튼을 비활성화한다. 빈 결과에도 버튼 위치는 유지한다. 자료 조회·작성 함수와 저장 규칙은 그대로다.
- 모바일 합계와 작업 버튼은 고정된 두 줄로 배치했다. 정산을 가리키던 오래된 빈 상태 안내도 교재 재고/이력으로 수정했다.

## 검증

관련 자동 검사 **201/201 통과**. 8개 파일은 textbook numbered renderers/workspace/reference UI/numbered pagination/numbered read model/ledger와 data-table surface/shared-row-actions다. 화면 표시를 요구하던 이전 소스 단언과 버튼 이름은 새 공통 제어에 맞췄으며 저장 보호 검사는 유지했다.

새 동작 검사는 검색·필터·추가 버튼의 동일 DOM 유지, 빈 결과, 0건 선택지, 선택→지연→실패의 기존 행 보존, 연속 선택의 오래된 응답 폐기, 필터 초기화의 단일 페이지 요청, 초점 복귀 및 갱신 중 자료 생성 차단을 확인한다. 유효한 빈 summary는 `groups: []`로 공급했다.

- TypeScript, 변경 파일 ESLint, production build 및 `git diff --check` 통과.
- 함수 대조에서 기존 함수 201개가 공백 정규화 후 동일했다. 바뀐 함수는 상위 화면, 두 처리표, 두 빈 상태 안내다. 서비스·DB·인증·권한·실사/입출고 저장 함수는 변경하지 않았다.
- 1280px: 출고 도구 모음은 일반/빈 결과 모두 y202px이고 검색·상태 선택·추가 버튼 위치를 유지했다. 기존 48px 이동이 해당 재현에서 0px다. 메뉴를 열 때 문서 clientWidth는 1265→1280px로 바뀌지만 스크롤 잠금 보정으로 본문 x좌표는 유지됐다.
- 1280px 주문·입고: 기본/최근 입고 선택 후 필터 y214px, 각 제어 y236px·너비160px가 동일했다. 열린 팝업 높이를 변경하는 복합 필터는 제거됐다.
- 390×844: 주문 필터 변경·초기화, 긴 제목, 출고 상태 메뉴와 ArrowDown/Escape 초점 복귀를 확인했다. 페이지 내용 폭375px로 가로 넘침이 없다.
- 4.5초 지연의 390px 출고: 조회 전/진행 중/빈 결과에서 검색 y213px, 도구 모음 y266px·높이151px, 상태 제어 y300px가 동일했다. 진행 중 기존 행1개와 선택값을 유지하고 청구 준비는 disabled였으며 완료 후 행0개로 바뀌었다.
- 다크 테마 선택 메뉴를 직접 검수하고 라이트 테마·뷰포트 설정을 복원했다. 새 선택 메뉴의 reduced-motion 무애니메이션 클래스는 소스로 확인했으며 OS 설정 전환이나 모션 시간 계측은 하지 않았다.

브라우저는 실제 제품 컴포넌트에 합성 서비스를 연결한 3137 fixture다. 요청 인자·응답 경쟁·실패는 자동 하네스가 검증한다. fixture의 주문 샘플은 일부 조건에 대해 동일 행을 반환하므로 실제 운영 데이터 필터의 완전성 검증으로 해석하지 않는다. 이 결과는 전체 사이트 CLS 점수, 실제 재고 변경, 운영 인증/DB 검증, 외부 전송 또는 배포를 뜻하지 않는다. 푸시·배포하지 않았다.

증거: `.codex-artifacts/textbook-control-stability-20260910/`의 `before-metrics.json`, `after-metrics.json`, 전후 jpg, `tests-final.log`, `stability-tests.log`, `typecheck.log`, `lint.log`, `build.log`, `function-comparison.json`.

다음 우선순위는 요청→주문→입고→출고의 등록·편집 창을 같은 입력/저장 구조로 검수하는 것이다. 이번에는 그 업무 입력 흐름을 변경하지 않았다.
