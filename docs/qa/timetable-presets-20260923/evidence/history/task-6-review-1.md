# Task6 review 1 — review_timetable_ui, BASE05c0e487 HEADbddfcdc4

Spec compliance: FAIL. Task quality: Needs fixes. No Critical findings.

Strengths: canonical single-slot/sibling-ID preservation and shared4view adapters(interaction.ts45); narrow exact code/message controller recovery preserving unknown immutable intent(model.ts74,375); pointer lifecycle/cancel/capture/axis singleowner(workspace.tsx97); full-reference conflicts with unchanged-conflict metadata edits(interaction.ts151); parent-owned controller and dirty navigation(workspace.tsx205).

## Important findings (reviewer wording)

1. **미확정 프리셋 생성·복제 결과를 새 요청으로 대체할 수 있습니다.**
`src/features/academic/timetable-plan-picker.tsx:67`, `:52`
서버에서 create/clone이 성공했지만 응답을 잃으면 `commandRef`는 같은 입력일 때만 재사용됩니다. 이름을 수정하면 새 `requestKey`와 `planId`를 만들며, 대화상자를 닫았다 다시 열어도 기존 요청을 지웁니다. 따라서 사용자가 한 번의 생성을 복구하려다 프리셋을 두 개 만들 수 있습니다.
제출된 명령과 후속 입력을 분리하고, 결과가 불명확한 동안에는 원래 명령의 결과를 먼저 회수해야 합니다. 이후 수정은 확인된 프리셋에 대한 별도 명령으로 처리하십시오.
필요한 focused 검증: create/clone이 실제로 저장된 뒤 응답만 실패하도록 만들고, 이름 수정 및 닫기→재오픈 각각에서 원래 key/body/planId가 재시도되며 프리셋은 하나만 존재하는지 확인합니다.

2. **공유 조회와 관리 저장의 늦은 응답이 변경된 사용자 범위에 반영됩니다.**
`src/features/academic/timetable-plan-picker.tsx:51`, `:53`, `:89`
목록 조회에는 epoch 검사가 있지만 `shareCandidates().then(setCandidates)`와 `mutatePlan()` 이후 상태 변경에는 없습니다. 사용자 A의 요청 도중 로그아웃하거나 B로 전환하면 초기화 effect 이후에도 A의 응답이 후보·오류를 다시 채울 수 있습니다. 늦은 생성 응답은 현재 대화상자를 닫거나 A의 프리셋 ID로 선택을 바꿀 수도 있습니다.
사용자/service와 대화상자 작업 세대를 캡처하고, 완료 시 여전히 같은 범위인지 확인한 뒤 상태를 변경해야 합니다. 가능한 조회는 취소도 연결하십시오.
필요한 focused 검증: 공유 조회와 생성 응답을 각각 지연시킨 뒤 actor를 변경하고 새 대화상자를 엽니다. 이전 응답이 후보·오류·선택·새 대화상자의 열린 상태를 바꾸지 않는지 검사합니다. 실제 두 계정 없이 지연 Promise를 사용하는 컴포넌트 테스트로 재현할 수 있습니다.

3. **수업 전체의 요일·담당 변경 경로가 구현되지 않았습니다.**
`src/features/academic/timetable-plan-class-list.tsx:46`, `src/features/academic/timetable-placement-editor.tsx:52`, `:65`
월/수에 배치된 수업을 목록의 `편집·배치`로 열면 `slotId`와 `target`이 없어 요일은 빈 상태입니다. 담당을 바꿔 저장하면 기본 담당만 바뀌고 기존 슬롯 담당은 유지됩니다. 화/목을 선택하면 기존 월/수를 교체하지 않고 슬롯을 추가합니다. 이는 명세의 “수업 전체 요일/전체 담당 변경은 수업 편집 폼에서 명시적으로 실행” 요구를 충족하지 못합니다.
`단일 배치 편집`, `추가 배치`, `수업 전체 편집`의 적용 범위를 명시적으로 구분하고 전체 편집에서 변경 대상 슬롯을 구성해야 합니다.
필요한 focused 검증: 월/수 수업의 전체 담당 변경과 화/목으로의 전체 요일 변경이 각각 한 명령으로 저장되는지 검사합니다. 동시에 단일 월요일 편집과 셀에서 추가 요일 배치가 기존 수요일을 보존하는 회귀 검증을 유지합니다.

## Minor
- placement-editor.tsx106/workspace.tsx235: 여러 상태 분기와 비동기 처리까지 매우 긴 JSX 한 줄에 들어 있습니다. 폼·복구 행동·상태 표시를 읽기 가능한 JSX와 명명된 handler로 정리하면 후속 수정의 누락 위험을 줄일 수 있습니다.
- model.ts390: 추가된 테스트는 교체 성공과 불명확한 결과의 폐기 금지를 검증하지만, 확정 거절 폐기 성공은 직접 검증하지 않습니다. 실패 head만 폐기하고 뒤의 대기 편집과 독립 항목은 유지·진행되는 focused 테스트를 추가하는 것이 좋습니다.

## Evidence and boundaries
Reviewer read whole package in sections; re-read truncated test output only. Named outside-diff check controller refresh/runQueue for collaborator revision risk showed stale guard. Shared Form/WorkspaceTabs/useDraftNavigation/TimetableBlock checked; CONTEXT and ADR absent. Retained75/75logs no warningstrings, tsc/lint empty; no suite reruns. Read16matrix/16pointer/rootmanual/export records, visually inspected390-dark-0.png. No source/index/HEAD/branch/DB mutation. Cannotverify transfer/import/race/twoactor/Realtime assigned Tasks7–9; no productionmigration/deployment/send claims.
