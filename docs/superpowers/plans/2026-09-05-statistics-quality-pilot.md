# Statistics Quality Pilot Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for this bounded, cohesive dashboard-to-statistics task. The controller owns browser verification and the wider review map.

**Goal:** 통계로 진입하고 탭·조건을 바꾸는 흐름의 재현된 세 가지 오류를 고친다.

**Architecture:** 기존 dashboard shortcut과 statistics workspace를 수정한다. 설치된 Radix 기반 공통 Tabs를 재사용하고 조회 조건을 결과 상태와 분리한다. 기존 통계 hook, 권한, cache key, 취소 처리와 RPC는 유지한다.

**Spec:** `docs/superpowers/specs/2026-09-05-quality-foundation.md`

## Global Constraints

- 기존 AGENTS.md와 DESIGN.md의 업무·디자인·권한 규칙을 유지한다. 새 의존성이나 전역 스킬을 설치하지 않는다.
- main/push/운영 배포/운영 DB 적용/실제 알림 발송을 하지 않는다. 로컬 소스 수정·검증·커밋만 수행한다.
- 수정 범위는 확인된 세 문제다. 무관한 UI 재설계, 데이터 hook 재작성, 캐시 변경, DB 변경은 하지 않는다.
- 운영 브라우저 재현: 대시보드 통계 바로가기의 href는 `/admin/classes`; 통계 탭 ArrowRight 후 포커스가 원래 탭에 남고 aria-controls/tabpanel이 없다; 학생·수업에서 영어 클릭 직후 로딩 중 영어 버튼이 사라지고 activeElement가 BODY로 바뀐다.
- WAI-ARIA Tabs 권고와 실제 원격 조회 지연을 고려해 `activationMode="manual"`을 쓴다. 화살표/Home/End는 포커스만 이동하고 Enter/Space/클릭으로 활성화한다. 활성화하지 않은 탭의 통계 hook/요청을 실행하지 않는다.

### Task 1: 통계 진입·키보드·조회 상태의 세 오류 수정

**Files:**
- Modify: `src/features/dashboard/dashboard-daily-brief.tsx`
- Modify: `src/features/dashboard/statistics-workspace.tsx`
- Modify: `tests/statistics-workspace.test.mjs` (기존 구현 문자열 의존 검사가 새 공통 컴포넌트와 충돌할 때만 실제 동작 검사로 대체)
- Create: `tests/statistics-workspace-interaction.test.mjs`
- Optional modify: 기존 dashboard UI 행동 테스트 또는 위 새 테스트 안에 실제 렌더된 바로가기 확인을 함께 둔다.

**Read first:** `DESIGN.md`, `.agents/skills/tips-quality/SKILL.md`, `src/components/ui/tabs.tsx`, `components.json`, `tests/data-table-pagination.test.mjs`의 React/JSDOM/TypeScript loader, `use-statistics-snapshot.ts`. shadcn skill의 CLI docs/info를 읽기 전용으로 사용한다. 현재 앱은 Radix Tabs이며 일반 shadcn 문서가 Base UI로 연결될 수 있으므로 Radix 공식 API를 확인한다.

- [x] 재현 가능한 React DOM 행동 회귀 테스트를 먼저 작성하고 현 코드에서 예상 이유로 실패하는지 확인한다. 실제 Tabs 컴포넌트를 로드하며 핵심 UI를 테스트에서 재구현하지 않는다. 네트워크 hook은 지연/성공/실패를 결정적으로 제공하되 필터 state와 포커스는 실제 컴포넌트에서 관찰한다.
- [x] 통계 바로가기 `/admin/statistics`를 수정하고 렌더된 링크를 검증한다.
- [x] role만 부여한 Button 탭을 기존 Tabs/TabsList/TabsTrigger/TabsContent로 교체한다. manual activation, roving tabindex, 연결된 panel id/aria-labelledby/aria-controls를 검증한다. 활성 패널만 mount/fetch하는 계약과 기존 선택 변경 시 패널 state 생명주기를 유지한다. 네 탭이 390px 화면에 들어가도록 기존 토큰으로 구성한다.
- [x] PanelState에 안정적인 controls 영역을 두고 과목·부서와 일정/교재 기간을 loading/error/success에서 계속 유지한다. 클릭한 버튼 DOM과 포커스를 보존하며 선택 상태가 보조 기술에도 전달되도록 한다. 결과 영역의 로딩/오류 상태를 전달하고 잘못된 조건의 낡은 결과는 표시하지 않는다. 일정 충돌의 기존 contextual error/retry를 보존한다.
- [x] 행동 검사: ArrowRight/Left/Home/End만으로 선택과 활성 hook이 바뀌지 않음; Enter/Space/클릭 활성화; 올바른 aria linkage; 초기 loading/조건 loading/error에서도 필터와 선택 유지; 영어 클릭 뒤 포커스 유지; 새 조건으로 데이터 갱신; 일정/교재 기간도 동일 계약. 테스트는 실제 사용자 동작을 확인하고 단순 소스 문자열 매칭을 늘리지 않는다.
- [x] 새 테스트와 기존 statistics workspace/snapshot-cache/drilldown/aggregate-auth/resource-pressure 및 dashboard-daily-brief 테스트를 실행한다. 타입/린트/빌드와 실제 브라우저는 controller가 최종 diff에 대해 수행하므로 중복 실행하지 않는다.
- [x] 자체 diff 리뷰, `git diff --check`, 지정 변경만 커밋한다. 보고서에 실패→수정→성공 명령/결과, 수정 파일, 기존 계약 유지 여부, 미검증 항목을 기록한다. 테스트 출력 경고는 숨기지 말고 원인을 해결하거나 정확히 보고한다.
