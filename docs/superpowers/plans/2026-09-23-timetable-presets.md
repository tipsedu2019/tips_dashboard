# 여러 학기 시간표 프리셋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 수강 수업의 자리를 그림자로 비워 두고 여러 미래 시간표를 네 보기에서 편성·저장하며, 선택한 새 수업을 수강으로 이동·복사한다.

**Architecture:** 프리셋의 새 수업/주간 배치를 정규화한 별도 저장소로 두고 기존 수강의 주간 자리를 읽기 전용 그림자로 합성한다. 하나의 배치 모델을 네 보기로 투영하고 모든 변경을 revision·멱등성·서버 충돌 검증으로 처리한다. 선택한 초안의 신규 수강 수업 생성만 원자적 전환 RPC로 수행하며 기존 운영 수업은 그대로 유지한다.

**Tech Stack:** 현재 저장소의 Next.js 16.1.1, React 19.2.3, TypeScript, Supabase/PostgreSQL, 공용 shadcn UI, 기존 시간표 그리드와 CSS. 별도 달력 라이브러리 도입을 전제로 하지 않는다.

**Spec:** [여러 학기 시간표 프리셋 설계](../specs/2026-09-23-timetable-presets-design.md). 구현자는 이 문서와 spec을 함께 읽는다.

## Global Constraints

- 구현 기준은 저장된 `origin/main` `eb23d7d8e1e629ffcf58d0f286aafa1d33deec72`이며 착수 시 원격 최신 상태를 재확인한다. 현재 checkout `9f962dfc`에 바로 구현하지 않는다.
- 현재 작업 폴더의 기존 문서 변경은 보존한다. 구현 착수 시 격리 worktree와 `codex/` 브랜치를 사용한다.
- 프리셋은 독립 계획이다. `개강 준비`, `class_terms`, 옛 수업그룹을 프리셋 저장소로 재사용하지 않는다.
- 선생님 주간·강의실 주간·일별 선생님·일별 강의실은 동일 새 배치+그림자 ID 집합의 네 투영이다.
- 요일은 일요일 0–토요일 6. 저장 시간은 정수 분, 구간은 `[start, end)`, 0 ≤ start < end ≤ 1440.
- 폼의 분 정확도를 보존한다. 눈금은 30분, 드래그 이동 거리는 5분 단위이며 원래 분 오프셋과 길이를 보존한다.
- 모든 학생·대기·출결·수납·교재·회차 이력과 기존 운영 class ID를 보존한다. 신규 복사 수업에는 학생/이력을 복사하지 않는다.
- 이동/복사는 선택 묶음 전체 원자적 처리, 같은 requestKey 재시도는 같은 결과를 반환한다.
- 사용자 후속 설명에 따라 수강→프리셋 실제 이동을 제거한다. 수강은 계속 진행하고 모든 프리셋에서 그림자로 자리를 점유한다. 그림자의 드래그/상태 변경은 불가하다.
- 자동 배치는 사용자가 선택한 '요일·시간 입력 시 즉시 배치 + 빈 시간 추천' 범위다.
- 프리셋 editor 권한과 운영 반영 admin/staff 권한을 분리한다. DB RLS/ACL 및 서버 검사로 강제한다.
- 고객/직원 알림 생성·발송, 학생 자동 이관, 기존 회차 자동 재작성은 하지 않는다.
- 기존 `WorkspaceTabs`, `DataTableFilterPanel`, `TimetableTargetFilter`, Button/Input/Select/Dialog/Sheet, 의미 토큰을 사용한다. 새 커스텀 단축키는 만들지 않는다.
- 기존 최신 디자인과 1440px/390px, 동일 fixture·테마·조건으로 비교한다. 테스트와 브라우저 증거를 구분한다.
- DB 도메인 충돌에 `40001`을 수동 사용하지 않는다. 최종 마이그레이션 정의와 실행 pgTAP으로 SQLSTATE를 검증한다.
- 계획 문서 작성과 기능 구현·운영 migration·배포는 별개다. 이 작업은 계획 작성 단계까지다.

## Review Focus

1. 잘린 시간축에서 09:10/17:13/23:30을 이동할 때 화면 상대 좌표가 실제 저장 시각을 바꾸지 않는가 — Task 2, 6.
2. 과목 필터 밖의 수업 또는 다른 쓰기 경로와 동시에 저장할 때 같은 교사/강의실을 이중 예약하지 않는가 — Task 4, 8.
3. 일부 반영에서 최신 그림자 변경·미배치 요일·응답 유실이 발생할 때 초안·기존 운영 수업이 보존되고 신규 수업이 중복 생성되지 않는가 — Task 7.
4. 두 사용자가 다른 수업/같은 수업을 편집할 때 최신 결과와 실패한 사용자 초안을 둘 다 잃지 않는가 — Task 3, 5.
5. 프리셋이 비어 있거나 자원이 숨겨짐/삭제됨/미해결 이름일 때 잘못된 빈 상태나 조용한 데이터 손실이 발생하지 않는가 — Task 3, 6, 9.

---

## A. 작업 순서와 출시 묶음

```text
Task 1 저장 기반 검증·수정 ───────────┐
Task 2 모델·좌표·충돌 순수 함수 ──────┼→ Task 4 운영 쓰기 공통 보호
Task 3 프리셋 DB·권한·읽기/쓰기 ──────┘            │
         └→ Task 5 서비스·공동 편집 → Task 6 네 보기 편집
                                        │        │
                                        └→ Task 7 이동·복사
Task 8 경쟁 저장·부수효과 통합 검증 ←───────────────┘
Task 9 옛 초안/준비 수업 가져오기·출시 검증 ← Task 8
```

- Task 1/2는 독립 조사·구현을 병렬 진행할 수 있다. Task 3 스키마 작업과 Task 4 운영 DB 변경은 migration 순서를 합의한 뒤 한 담당자가 통합한다.
- Task 5/6은 Task 2/3의 타입/명령을 따른다. UI마다 독립 데이터 모델을 만들지 않는다.
- 기능 노출은 DB capability 확인 뒤 단계적으로 켠다. 프리셋 편집을 먼저 검증할 수 있으나, 사용자 요구의 최종 완료는 Task 9까지다.
- 선행 결함 수정, 저장·충돌 기반, 프리셋 UI, 전환·검증으로 리뷰 가능한 변경 묶음을 나눈다. 최종 통합 리뷰에서는 모든 묶음의 조합을 확인한다.

## B. 파일과 책임

| 경로 | 작업/책임 |
| --- | --- |
| `src/features/academic/timetable-plan-contract.ts` | 신규: 타입, RPC 인자/응답, 오류코드 |
| `src/features/academic/timetable-plan-model.ts` | 신규: immutable item/slot 명령, 그림자 합성, projection 입력 |
| `src/features/academic/timetable-placement-adapter.ts` | 신규: 셀/절대 분 좌표, 네 보기 축, ID 매핑 |
| `src/features/academic/timetable-conflicts.ts` | 신규: 순수 주간 충돌/빈 시간 추천 |
| `src/features/academic/timetable-plan-service.ts` | 신규: 인증된 RPC, response 검증, requestKey 보존 |
| `src/features/academic/use-timetable-plan.ts` | 신규: canonical state, 저장 큐, 초안, revision 갱신 |
| `src/features/academic/timetable-plan-picker.tsx` | 신규: 운영/프리셋 선택·생성·관리·공유 |
| `src/features/academic/timetable-plan-class-list.tsx` | 신규: 검색·미배치·수업 단위 선택·드래그 원본 |
| `src/features/academic/timetable-placement-editor.tsx` | 신규: 과목/수업/자원/복수 요일/정확한 시각 폼 |
| `src/features/academic/timetable-transfer-dialog.tsx` | 신규: 목적지·복사/이동·선택 신규 수업·그림자 충돌 검사 |
| `src/features/academic/timetable-workspace.tsx` | 수정: 모드, 기존 네 보기, 공용 작업 영역, 편집 연결 |
| `src/features/academic/records.js`, `records.d.ts` | 수정: 읽기 전용 회귀 보존, 안정 슬롯 ID와 축 메타데이터 |
| `src/features/academic/components/legacy-timetable-grid.jsx` | 수정: pointer 드래그·키보드 폼 연결·겹친 블록 누락 방지 |
| `src/features/academic/timetable-grid-skin.module.css` | 수정: 시간표 배치 좌표·상태; 공통 토큰 재정의 금지 |
| `src/features/academic/academic-read-service.js` | 수정: 기존 운영 조회 보호, 편집 계약과 scope 분리 |
| `src/features/academic/continuous-class-schedule-contract.ts`, `continuous-class-schedule-service.ts` | 수정: 재사용 mutation 오류/권위 소스 계약 |
| `src/features/management/management-service.js`, `management-page.tsx` | 수정: 일정/상태 직접 쓰기 우회 제거·충돌 오류·캐시 갱신 |
| `src/features/operations/class-schedule-workspace.tsx`, `use-continuous-class-schedule.ts` | 수정: 회차 저장/생성 충돌 피드백 |
| `src/features/tasks/ops-task-service.ts` | 수정: 실제 일정 쓰기 경로만 공유 검증으로 연결 |
| `src/lib/public-classes-cache-invalidation.js` | 필요 시 수정: 기존 반영 후 무효화 재사용, 실패 재시도 |
| `supabase/migrations/` | 신규: CLI로 생성한 순서 있는 기반 수정/프리셋/운영 보호/전환 migration |
| `supabase/tests/timetable_*_test.sql` | 신규: 아래 task별 실행 pgTAP |
| `tests/timetable-*.test.mjs`, `tests/timetable-*.node.ts` | 신규/수정: 모델·서비스·UI 행동·fixture 계약 |
| `scripts/qa/timetable-fixture-server.mjs` | 수정: 비어 있는 프리셋·다중 프리셋·오류·경쟁 상태 |
| `scripts/verify-timetable-concurrency.mjs` | 신규: 격리 DB 두 연결 경쟁 검증 |
| `docs/operations/timetable-presets-runbook.md` | 신규: 출시·오류 복구·읽기 전용 복귀 절차 |
| `docs/qa/timetable-presets-20260923/REPORT.md` | 신규: 검증 환경/명령/결과/화면 증거 |
| `DESIGN.md` | 수정: 프리셋, 미배치 목록, 편집 상태·접근성 기준 |

`supabase migration new <name>`은 착수 시 `--help`로 확인한 CLI를 사용한다. 아래 각 task의 고유 이름으로 생성된 실제 경로를 작업 기록에 남긴다. 과거 적용 migration을 수정하지 않는다.

## Task 1. 기존 저장 함수의 범위와 SQLSTATE를 먼저 검증한다

**Files:** 신규 migration 이름 `timetable_schedule_mutation_safety`; `supabase/tests/timetable_schedule_mutation_safety_test.sql`; 기존 `supabase/tests/continuous_class_schedule_release2_test.sql`; `tests/continuous-class-schedule-release2-service.test.mjs`; `continuous-class-schedule-model.ts`의 오류 매핑.

**Interfaces:** 기존 `save_class_schedule_defaults_v1` 인자/응답을 유지한다. `class_schedule_stale`를 앱에서 자동 재시도하지 않는 도메인 오류로 매핑한다. 내부 `save_continuous_schedule_defaults_rows_v1`은 해당 class만 수정한다.

- [ ] 최신 main과 최종 함수 재정의/동적 `pg_get_functiondef` 패치를 조사한다. 관련 함수 정의를 격리 DB에서 추출하여 QA 기록에 고정한다.
- [ ] 기존 pgTAP fixture의 admin과 서로 다른 A/B 수업을 사용해, A 저장 전 B의 핵심 컬럼을 JSON으로 저장한다. A 저장 후 아래 검증을 추가한다.

```sql
select is(
  (select jsonb_build_object('schedule', schedule, 'teacher', teacher,
    'room', room, 'revision', schedule_revision) from public.classes where id = :'class_b'),
  :'class_b_before'::jsonb,
  'saving A preserves B schedule metadata and revision'
);
```

- [ ] 수요일은 교사 B/강의실 2, 월요일은 교사 A/강의실 1인 A를 저장하고 정규화 슬롯과 기존 문자열 소비자가 동일 정보를 반환하는지 실행 검증한다. 과거 회차 snapshot은 이전 값이어야 한다. 같은 수업 두 슬롯의 합법적인 시간 맞교환도 테스트한다.
- [ ] 격리 DB에서 해당 테스트가 실제 결함으로 실패하는지 확인한다. 최신 main에서 이미 수정되었다면 중복 수정 없이 회귀 테스트만 유지한다.
- [ ] 대상 조건을 추가한다. 문자열 투영은 슬롯별 자원 차이를 보존하도록 현재 파서 계약에 맞춘다.

```sql
update public.classes
set schedule_revision = schedule_revision + 1,
    schedule = v_projected_schedule,
    teacher = v_projected_teacher,
    room = v_projected_room
where id = p_class.id;
```

여기서 `v_projected_schedule/teacher/room`은 함수에서 해당 class 슬롯만 집계해 만든 값이다. 저장 후 기대 행 수가 1인지 확인한다. 슬롯은 전체 삭제/재삽입 대신 기존 ID를 보존한다. 현재 `class_schedule_slots_class_time_key`가 즉시 unique이므로 유효한 최종 슬롯 집합의 맞교환은 최종 집합 검증+지연 가능 제약으로 처리한다. 관련 upsert의 ON CONFLICT 의존을 먼저 확인하고 회차 FK를 보존하는 migration/pgTAP을 함께 둔다.

- [ ] 접촉하는 최종 stale 예외를 `P0001`로 수정하고 기존 메시지 `class_schedule_stale`는 유지한다. 실제 `40001` serialization failure를 잡아 다른 의미로 바꾸지 않는다.
- [ ] admin/staff·권한 없는 역할, 슬롯 소유권, stale revision, 멱등 재실행을 실제 호출로 검사한다. 최종 정의에 대해 `throws_ok(..., 'P0001', 'class_schedule_stale', ...)`를 사용한다.
- [ ] 실행: `supabase test db supabase/tests/timetable_schedule_mutation_safety_test.sql` 및 `node --test --experimental-strip-types tests/continuous-class-schedule-release2-service.test.mjs tests/management-continuous-class-schedule.test.mjs`.
- [ ] 통과 후 독립 커밋: `fix: scope continuous schedule writes to the target class`.

**Stop gate:** 비대상 수업 변경, 기존 회차 변경, 권한/멱등 회귀 중 하나라도 있으면 뒤 단계 운영 mutation 재사용 금지. 이 task 결과로 운영 데이터 피해나 운영 복구 완료를 주장하지 않는다.

## Task 2. 공통 배치 타입, 좌표 변환, 충돌·후보 함수를 만든다

**Files:** 신규 `timetable-plan-contract.ts`, `timetable-plan-model.ts`, `timetable-placement-adapter.ts`, `timetable-conflicts.ts`; 신규 `tests/timetable-plan-model.node.ts`, `tests/timetable-placement-adapter.node.ts`, `tests/timetable-conflicts.node.ts`.

**Interfaces:** 다음 타입/함수 이름을 이후 모든 task가 사용한다.

```ts
export type TimetableView = 'teacher-weekly' | 'classroom-weekly'
  | 'daily-teacher' | 'daily-classroom';
export type PlanSlot = {
  id: string; itemId: string; planId: string; weekday: number;
  startMinute: number; endMinute: number;
  teacherId: string; classroomId: string; sourceSlotId: string | null;
};
export type ShadowSlot = {
  id: string; classId: string; sourceSlotId: string | null; weekday: number;
  startMinute: number; endMinute: number;
  teacherId: string; classroomId: string; classRevision: number;
};
export type PlanItem = {
  id: string; planId: string; revision: number;
  name: string; subject: string; subjectAreaKey: string | null;
  grade: string; capacity: number | null; tuition: number | null;
  defaultTeacherId: string | null; defaultClassroomId: string | null;
  durationMinutes: number | null; sourceClassId: string | null;
  state: 'draft' | 'applied'; appliedClassId: string | null;
  appliedTransferId: string | null; appliedAt: string | null;
  pendingSlots: PendingSlot[];
};
export type PendingSlot = {
  id: string; sourceText: string; reason: 'missing_resource' | 'conflict' | 'invalid_time';
  weekday: number | null; startMinute: number | null; endMinute: number | null;
  teacherId: string | null; classroomId: string | null;
};
export type OccupancyBlocker = {
  classId: string; label: string;
  scope: 'all' | 'resource'; resourceId: string | null;
  reason: 'unresolved_time' | 'unresolved_resource' | 'incomplete_read';
};
export type DropTarget = {
  weekday: number; startMinute: number;
  teacherId?: string; classroomId?: string;
};
export type TimetableConflict = {
  kind: 'teacher' | 'classroom' | 'same_class';
  slotId: string; otherSlotId: string;
};
export type GridTarget = {
  view: TimetableView; panelKey: string; columnKey: string;
  visibleStartMinute: number; rowPosition: number; slotMinutes: number;
};
export function resolveGridTarget(input: GridTarget): DropTarget;
export function moveSlot(slot: PlanSlot, target: DropTarget): PlanSlot;
export function findConflicts(slots: readonly PlanSlot[], shadows: readonly ShadowSlot[]): TimetableConflict[];
export function suggestPlacements(input: {
  slots: readonly PlanSlot[]; shadows: readonly ShadowSlot[]; itemId: string; planId: string;
  teacherId: string; classroomId: string; durationMinutes: number;
  weekdays: number[]; fromMinute: number; toMinute: number;
}): DropTarget[];
```

- [ ] 위 네 함수에 대한 실행 테스트를 먼저 작성한다. 서로 다른 프리셋은 비교하지 않되 선택 프리셋의 모든 새 슬롯과 그림자는 함께 검사한다.
- [ ] 아래 기대값을 fixture가 아니라 실제 함수 호출로 검사한다.

```ts
const slot: PlanSlot = {
  id: 'slot-a', itemId: 'class-a', planId: 'plan-a', weekday: 1,
  startMinute: 1033, endMinute: 1123,
  teacherId: 'teacher-a', classroomId: 'room-a', sourceSlotId: null,
};
assert.deepEqual(moveSlot(slot, { weekday: 3, startMinute: 1038, teacherId: 'teacher-b' }),
  { ...slot, weekday: 3, startMinute: 1038, endMinute: 1128, teacherId: 'teacher-b' });
assert.deepEqual(resolveGridTarget({ view: 'classroom-weekly', panelKey: 'room-b',
  columnKey: '1', visibleStartMinute: 540, rowPosition: 1 / 3, slotMinutes: 30 }),
  { weekday: 1, startMinute: 550, classroomId: 'room-b' });
assert.equal(findConflicts([slot, { ...slot, id: 'slot-b', itemId: 'class-b',
  startMinute: 1123, endMinute: 1213 }], []).length, 0);
assert.ok(findConflicts([slot, { ...slot, id: 'slot-b', itemId: 'class-b',
  startMinute: 1122, endMinute: 1212 }], []).length > 0);
const shadow: ShadowSlot = { id: 'live:class-x:slot-x', classId: 'class-x',
  sourceSlotId: 'slot-x', weekday: 1, startMinute: 1020, endMinute: 1140,
  teacherId: 'teacher-a', classroomId: 'room-x', classRevision: 3 };
assert.ok(findConflicts([slot], [shadow]).some(value => value.kind === 'teacher'));
```

- [ ] 동등한 월/수 배치를 네 view로 투영해 동일 ID 집합을 검증한다. panelKey/columnKey는 표시 이름이 아니라 catalog ID/weekday 키다.
- [ ] `moveSlot`은 `{...slot, ...target, endMinute: target.startMinute + duration}`로 새 객체를 만들고 범위 초과·NaN을 거부한다. 같은 수업의 다른 슬롯과 겹치는지는 전체 집합을 받는 `findConflicts`와 명령 검증에서 확인한다. 원본 slot을 직접 수정하지 않는다.
- [ ] `findConflicts`는 planId별로 분리하고 각 집합에 같은 그림자를 합쳐 weekday·resource별 중첩을 찾는다. 여러 원인이면 teacher/room 둘 다 반환한다. 화면 필터 인자를 받지 않는다. 출처가 같은 수업의 새 초안도 그림자와 정상 충돌한다.
- [ ] `suggestPlacements`는 가능한 요일/시간의 5분 후보를 순회하여 그림자+새 슬롯 검사 후 최대 5개를 반환한다. 해가 없으면 빈 배열. 기존 슬롯을 이동/삭제하지 않는다.
- [ ] 실행: `node --test --experimental-strip-types tests/timetable-plan-model.node.ts tests/timetable-placement-adapter.node.ts tests/timetable-conflicts.node.ts`.
- [ ] 통과 후 커밋: `feat: define canonical timetable placement commands`.

## Task 3. 프리셋 저장소·권한·원자적 명령을 만든다

**Files:** 신규 migration 이름 `timetable_plan_storage`; `supabase/tests/timetable_plan_storage_test.sql`, `timetable_plan_permissions_test.sql`; spec의 6개 테이블; `timetable-plan-contract.ts` 응답 타입.

**Interfaces:** spec 8절의 list/get/revision/mutate RPC. 수업 저장은 다음 계약을 사용한다.

```ts
export type PlanItemDraft = Pick<PlanItem,
  'id' | 'planId' | 'name' | 'subject' | 'subjectAreaKey' | 'grade'
  | 'capacity' | 'tuition' | 'defaultTeacherId' | 'defaultClassroomId'
  | 'durationMinutes' | 'pendingSlots'>;
export type SavePlanItemCommand = {
  planId: string; expectedMetaRevision: number;
  expectedShadowFingerprint: string;
  item: PlanItemDraft; expectedItemRevision: number | null;
  slots: PlanSlot[]; requestKey: string;
};
export type PlanMutationResult = {
  planId: string; metaRevision: number; changeSequence: number;
  shadowFingerprint: string;
  item: PlanItem | null; slots: PlanSlot[]; removedItemIds: string[];
};
export type PlanSnapshot = {
  plan: { id: string; name: string; state: 'draft' | 'archived';
    metaRevision: number; changeSequence: number;
    targetStartDate: string | null; targetEndDate: string | null };
  items: PlanItem[]; slots: PlanSlot[]; shadowSlots: ShadowSlot[];
  appliedSnapshots: Array<{ itemId: string; slots: PlanSlot[] }>;
  unresolvedOccupancies: OccupancyBlocker[];
  shadowFingerprint: string;
  catalogs: { teachers: ResourceOption[]; classrooms: ResourceOption[] };
  complete: boolean;
};
export type ResourceOption = {
  id: string; name: string; isVisible: boolean; subjects: string[];
};
```

- [ ] 기존 fixture에서 admin/staff, teacher, 다른 teacher, anon을 준비한다. 테이블/RPC 부재로 실패하는 것을 확인한 뒤 DDL과 RPC를 추가한다.
- [ ] spec의 테이블을 만든다. receipt/transfer 내부 이력은 `dashboard_private`에 두고 필요한 결과만 RPC로 반환한다. 공개 4테이블은 RLS와 명시 ACL을 설정한다. 그림자를 복제 저장하는 테이블은 만들지 않는다.
- [ ] `plan_slots`에 `(plan_id,item_id)` 복합 FK와 요일/시간 CHECK를 둔다. 다른 프리셋 item을 참조하는 입력, 중복 slot ID, 동일 item 중복 입력을 거부한다.
- [ ] `mutate_timetable_plan_item_v1`은 actor→운영 자원 잠금→plan 잠금→meta/item revision→최신 그림자→catalog→변경 슬롯 충돌→delta→revision/changeSequence→audit/receipt 순의 단일 transaction이다. 조회는 프리셋과 그림자를 일관된 하나의 snapshot으로 반환한다.
- [ ] 운영 변경으로 이미 충돌한 미수정 슬롯은 보존한다. 이름 변경 등 비점유 수정은 허용하고 변경한 슬롯의 새 점유만 전체 그림자+초안에 검사한다. 충돌 슬롯의 안전한 이동/해제가 가능해야 한다.
- [ ] 저장 slot ID를 보존하고 추가만 새 ID로 만든다. requestKey의 payload hash 일치를 검사한다. 같은 키/다른 본문은 `22023`, 타인의 receipt는 조회 불가다.
- [ ] state/appliedClassId/appliedTransferId/appliedAt/sourceClassId는 서버 관리 필드다. 일반 item 저장 payload에서 거부하고 현재 DB item이 applied이면 편집/재반영을 차단한다. 출처는 가져오기/복제 명령이 서버에서 기록한다.
- [ ] `PlanSnapshot.slots`는 draft item의 슬롯만 반환한다. applied 슬롯은 `appliedSnapshots`에만 보관하며 주 그리드·충돌·추천의 입력에 넣지 않는다. pendingSlots 해결/삭제는 일반 편집 명령의 명시적 변경으로 처리한다.
- [ ] 실행 pgTAP으로 아래 계약을 고정한다.

```sql
-- Build calls using the fixture plan/item IDs and the public RPC signature.
select throws_ok(:'teacher_conflict_call', '23P01', 'timetable_resource_conflict',
  'hidden subject teacher conflict is rejected');
select throws_ok(:'stale_item_call', 'P0001', 'timetable_stale',
  'stale item does not overwrite the newer placement');
select throws_ok(:'unshared_teacher_call', '42501', 'timetable_forbidden',
  'unshared teacher cannot read or mutate the plan');
select is(:'replayed_item_id'::uuid, :'first_item_id'::uuid, 'same key creates one item');
```

여기서 psql 변수는 테스트 상단의 합성 fixture setup이 만든 실제 RPC 호출 문자열/결과다. 테스트를 문자열 정규식 검사로 대체하지 않는다.

- [ ] ID/name이 같은 자원, 숨겨진 자원, 교사 과목 별칭, 비어 있는 보드, 500/2000 용량 초과, 다른 plan의 동일 시각을 검사한다. 용량 초과 시 `complete=false`와 오류를 반환하고 조용히 자르지 않는다.
- [ ] 관리자·직원은 관리/편집, 지정 teacher editor는 plan만 편집, viewer는 조회만 가능한지 검사한다. teacher의 운영 전환 및 직접 DML은 항상 거부한다.
- [ ] 실행: `supabase test db supabase/tests/timetable_plan_storage_test.sql` 및 `supabase test db supabase/tests/timetable_plan_permissions_test.sql`.
- [ ] 통과 후 커밋: `feat: persist shared timetable plans with revision guards`.

## Task 4. 운영 그림자 조회와 일정 쓰기의 충돌 규약을 연결한다

**Files:** 신규 migration 이름 `timetable_operational_conflict_guards`; `supabase/tests/timetable_operational_conflicts_test.sql`; `tests/timetable-operational-service.test.mjs`; 기존 academic/management/operations/tasks 서비스 중 파일맵의 관련 진입점.

**Interfaces:** 신규 `get_timetable_operational_reference_v1`은 stable class/slot/catalog IDs + status/revision + shadowFingerprint를 반환한다. 기존 저장 RPC 인자는 유지하고 private `assert_timetable_operational_conflicts_v1`과 `lock_timetable_operational_resources_v1`을 공용으로 사용한다. 운영 관리 화면의 정상 변경은 초안 때문에 막지 않는다.

- [ ] `save_class_schedule_defaults_v1`, `initialize_new_class_schedule_v1`, `generate_class_lesson_sessions_v1`, `save_class_lesson_session_v1`, 수강 상태 변경, 등록/전반/휴보강의 실제 일정 변경 및 legacy direct writes를 목록화한다. 조회/교재-only 쓰기에는 불필요한 일정 잠금을 넣지 않는다.
- [ ] 두 교사/두 방/수학·영어 수업 fixture로 기존 경로별 충돌 삽입이 통과하는 실패 테스트를 작성한다. 회차는 실제 날짜별 검사, 기본값은 주간 검사다.
- [ ] 운영 조회는 normalized slots를 우선한다. legacy 문자열은 보존하되 파싱/ID 매핑이 불완전하면 `확인 필요` 점유로 반환한다. 해당 자원/시간 범위를 확정할 수 없으면 관련 신규 배치/반영을 차단한다. 자료 전체가 불명확하면 검증 범위를 좁힐 수 없으므로 반영 전체를 차단한다. 확인 없이 정규화 저장소를 활성화하거나 이름으로 ID를 추정하지 않는다.
- [ ] 그림자 ID는 `live:${classId}:${slotId}`이며 이름/시각으로 합치지 않는다. fingerprint에 수강 상태, 슬롯 revision/값, 자원 이름/숨김, 미해결 상태를 포함한다. 프리셋 기간 예외 회차 검토를 위한 별도 회차 fingerprint도 preview에 포함한다.
- [ ] 일반 class update의 schedule/teacher/room/status 변경을 원자적 gateway로 이동시킨다. 일정과 관계없는 class metadata update는 기존 계약을 유지한다. DB guard로 우회 경로를 차단하여 오래된 클라이언트도 충돌을 만들지 못하게 한다.
- [ ] 운영 자원 advisory lock을 모든 해당 entrypoint의 row lock보다 먼저 얻고 class IDs를 정렬하여 잠근다. 기존 클래스 잠금 후 뒤늦게 이 잠금을 요청하는 경로가 없어야 한다.

```sql
-- One transaction-scoped key for operational timetable writes in this installation.
perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tips:timetable:operational', 0)
);
```

- [ ] 실데이터에서 이미 존재하는 충돌은 읽기 전용 진단 결과로 남긴다. 운영 기본값의 새 점유는 다른 운영 수업과 검사한다. 미래 프리셋과 겹친다는 이유로 운영 변경을 막지 않는다. 변경 후 프리셋 조회에서 해당 초안 충돌을 표시한다.
- [ ] 기본 슬롯과 동일 class/source_slot/date 회차는 실제 회차가 그날의 권위 데이터라는 규칙으로 중복 제거한다. source 없는 legacy 회차는 이름/시각 유사성으로 자동 제외하지 않는다.
- [ ] 생성/휴보강/직접 회차 수정에서도 `active/exception/makeup` 점유를 검사하고 `skipped/tbd`를 제외한다. 종강/준비 상태 아래에도 남은 실제 유효 회차는 무시하지 않는다.
- [ ] 현재 consumer의 오류처리·입력 보존·requestKey 재시도를 연결한다. 운영 반영 성공 후 캐시 실패는 `저장됨 · 화면 갱신 재시도`로 분리한다.
- [ ] 실행: `supabase test db supabase/tests/timetable_operational_conflicts_test.sql`; `node --test --experimental-strip-types tests/timetable-operational-service.test.mjs tests/continuous-class-schedule-release2-service.test.mjs tests/management-continuous-class-schedule.test.mjs`.
- [ ] 통과 후 커밋: `feat: enforce shared teacher and room conflict checks`.

**Stop gate:** 기존 쓰기 진입점 하나라도 수강 반영과 경쟁하면서 검증/잠금 우회가 가능하면 수강 반영은 켜지 않는다. 그림자 읽기/초안 편집만으로 운영 충돌 보장이 완료되었다고 보고하지 않는다.

## Task 5. 저장 상태·공동 편집·초안 복구 서비스를 만든다

**Files:** 신규 `timetable-plan-service.ts`, `use-timetable-plan.ts`; `tests/timetable-plan-service.test.mjs`, `tests/timetable-plan-controller.node.ts`; 필요 시 기존 unsaved-navigation hook 사용부.

**Interfaces:** `createTimetablePlanService({client, actorScope})` → `readPlan`, `saveItem`, `mutatePlan`, `readRevision`, `previewTransfer`, `commitTransfer`. `useTimetablePlan(planId)` → `{snapshot, draft, saveState, conflicts, dispatch, retry, refresh}`. saveState는 `idle/saving/saved/error/stale`.

- [ ] deferred RPC Promise로 먼저 A→B 두 이동, 역순 응답, 실패→재시도, 프리셋 전환, actor 전환 테스트를 작성한다.

```ts
const firstPending = controller.dispatch(firstMove);
const queued = controller.dispatch(secondMove);
firstResponse.resolve({ ...serverResult, item: { ...item, revision: 2 } });
await firstPending;
secondResponse.resolve({ ...serverResult, item: { ...item, revision: 3 } });
await queued;
assert.equal(controller.snapshot().draft.slots[0].startMinute, secondMove.slots[0].startMinute);
assert.equal(rpcCalls[1].expectedItemRevision, 2);
assert.equal(rpcCalls[0].requestKey, retryCalls[0].requestKey);
```

이 테스트의 `controller`, `firstMove/secondMove`, deferred responses는 같은 task에서 생성하는 in-memory service harness이다. hook 로직을 테스트하기 위해 React 내부 state를 직접 조작하지 않는다. `createTimetablePlanController`를 hook이 소비하는 순수 controller로 `timetable-plan-model.ts`에서 export한다.

- [ ] actorScope+planId별 캐시를 분리한다. 새 scope에서는 이전 프리셋을 편집 가능한 상태로 노출하지 않는다. RPC에는 AbortSignal을 전달하고 stale 응답을 revision/epoch로 무시한다.
- [ ] 같은 item 명령은 직렬화하며 성공 결과 revision으로 다음 명령을 보낸다. 다른 item 변경으로 meta revision이 바뀌지 않아야 하며 changeSequence만 갱신한다.
- [ ] 초안은 sessionStorage에 actor/plan namespace로 보존한다. 새로고침 후 서버 revision과 비교하여 복구하고, 로그아웃/공유 해제 때 제거한다.
- [ ] 접근 제한된 변경 신호로 다른 사용자 편집 및 운영 그림자 변경을 재조회한다. 신호에는 planId/changeSequence 또는 운영 invalidation만 포함한다. 20초 revision 확인은 문서가 보일 때만 실행하며 plan changeSequence와 shadowFingerprint를 둘 다 비교한다. 재활성화 때 즉시 재조회한다.
- [ ] 운영 변경으로 저장 초안이 충돌한 경우 새 그림자와 초안을 함께 보존한다. 그림자 조회 실패는 이전 자료+확인 불가 상태로 유지하고 새 배치/반영을 막는다. 운영 반영 결과의 draft/applied/removed 항목과 새 그림자는 단일 canonical update로 적용한다.
- [ ] 같은 item stale이면 최신값/본인초안 모두 남긴다. 실패한 요청을 성공 toast로 표시하지 않는다. 실행 취소도 revision 검사하는 역명령으로 처리한다.
- [ ] 실행: `node --test --experimental-strip-types tests/timetable-plan-service.test.mjs tests/timetable-plan-controller.node.ts tests/academic-scoped-reads.test.mjs`.
- [ ] 통과 후 커밋: `feat: synchronize shared timetable edits and recover failed drafts`.

## Task 6. 네 보기 직접 편집과 자동 배치를 연결한다

**Files:** 신규 picker/class-list/placement-editor 컴포넌트; 수정 workspace, records, legacy grid, skin; `tests/timetable-plan-interaction.test.mjs`, 기존 layout/image 테스트; fixture server.

**Interfaces:** 모든 UI는 `SavePlanItemCommand`를 dispatch한다. 그리드는 `GridTarget`과 source slot ID를 반환하고 서버 객체를 직접 수정하지 않는다. projection은 `visibleStartMinute`, `slotMinutes`, absolute minutes, stable IDs를 반환한다.

- [ ] 네 보기 × 신규 drop/새 수업 block move 테스트를 작성한다. 월/수 두 슬롯 중 월만 이동한 후 네 projection에서 월의 ID/자원/시간만 바뀌어야 한다. 그림자는 네 보기 모두 조작 불가이고 점유 충돌에 포함한다.
- [ ] 공용 탭·조건은 최신 main 것을 재사용하고 프리셋 selector·미배치 수업 목록을 추가한다. 빈 preset은 카탈로그로 빈 패널을 생성한다. 준비/종강 legacy 운영 읽기 상태는 유지한다.
- [ ] sharedDragState의 moved 판정에 source panel/target panel/ID를 포함한다. 좌표가 같아도 다른 교사/강의실 패널로 이동한 경우 저장 명령을 만든다.
- [ ] Pointer Events로 새 수업 핸들에서만 drag를 시작하고 touch scroll과 구분한다. drag cancel/Escape/pointer capture loss에서 원래 상태로 돌아온다. 모바일 Sheet에서는 항목 선택→닫기→셀 선택/폼 배치로 진행한다. 키보드 사용자는 같은 폼으로 모든 편집을 끝낼 수 있다.
- [ ] 시각 높이를 실제 분 비율로 계산하고 30분 `floor()` 값을 저장하지 않는다. 축은 drag lifetime 동안 고정한다. grid의 Map이 겹친 블록을 하나로 덮지 않도록 겹친 항목 선택 UI를 제공한다.
- [ ] 과목/수업/교사/방/요일/시간 폼은 공용 Form·Select·Input을 사용한다. 입력값이 완성되면 같은 저장 명령을 호출한다. 수업 길이·가능 시간 기반 최대 5개 후보는 `suggestPlacements`로 그림자와 다른 새 수업 모두 피해 제시한다.
- [ ] 라벨/오류/상태를 한국어로 표시하고 저장 실패 입력·focus를 보존한다. 단축키 힌트를 추가하지 않는다. 날짜가 바뀌어도 프리셋을 자동 적용하지 않는다.
- [ ] 이미지 출력은 기존 품질을 유지하고 프리셋명/보기/시각을 포함한다. 선택된 보드의 저장 중 상태를 내보내려면 저장 완료를 먼저 확인한다.
- [ ] 실행: `node --test --experimental-strip-types tests/timetable-plan-interaction.test.mjs tests/timetable-layout.test.mjs tests/timetable-image-export.test.mjs`.
- [ ] 브라우저: 1440/390px 라이트/다크, 09:10·17:13·23:30, 빈 프리셋, 다른 panel 동일 시간 이동, 스크롤/drag/폼 접근성, 60자 제목. 기존 `docs/qa/timetable-cells-refine-20260922`와 같은 fixture 조건으로 비교한다.
- [ ] 통과 후 커밋: `feat: edit timetable plans from all four views`.

## Task 7. 선택·일괄 수강 반영과 프리셋 간 이동/복사를 구현한다

**Files:** 신규 migration 이름 `timetable_plan_transfers`; `supabase/tests/timetable_plan_transfers_test.sql`; 신규 transfer dialog; `tests/timetable-transfer-service.test.mjs`, `tests/timetable-transfer-interaction.test.mjs`.

**Interfaces:** 아래 타입은 `timetable-plan-contract.ts`에 두고 미리보기/commit이 같은 selection을 사용한다.

```ts
export type TimetableSpace = { kind: 'operational' } | { kind: 'plan'; planId: string };
export type TransferRequest = {
  source: { kind: 'plan'; planId: string }; target: TimetableSpace;
  mode: 'copy' | 'move'; itemIds: string[];
  onConflict: 'reject' | 'keep_pending';
};
export type TransferPreview = {
  fingerprint: string; shadowFingerprint: string; request: TransferRequest;
  mappings: Array<{ sourceId: string; action: 'create_active_class' | 'create_plan_item' }>;
  blockers: Array<{ sourceId: string; code: string; label: string; relatedIds: string[] }>;
};
export type TransferResult = {
  transferId: string; shadowFingerprint: string;
  mappings: Array<{ sourceId: string; targetId: string; targetClassId: string | null }>;
  appliedItems: PlanItem[]; removedItemIds: string[]; addedShadowSlots: ShadowSlot[];
  createdItems: PlanItem[]; createdSlots: PlanSlot[];
};
```

- [ ] 프리셋→수강/다른 프리셋 × copy/move × 1개/3개/전체 fixture를 작성한다. source/target/selection/revisions/권한/catalog/shadows/관련 회차 fingerprint를 서버가 계산한다. 클라이언트의 `noConflict=true`는 받지 않는다.
- [ ] preview에서 `새 수업 3개를 수강에 만들고 원안은 반영 완료로 보관` 또는 `새 수업 3개를 수강에 만들고 프리셋에서 이동`처럼 최종 효과를 표시한다. 그림자/반영 완료 항목은 선택 대상이 아니다.
- [ ] commit은 운영 자원→plan ID 정렬→관련 class ID 정렬 순으로 잠그고 preview fingerprint를 다시 계산한다. receipt를 먼저 확인하고 동일 본문 재시도는 기존 결과를 반환한다. 새 요청 키를 써도 applied 항목 재반영은 차단한다.
- [ ] 중복 item ID, 동일 source/target plan, applied 항목, 미배치 슬롯 또는 슬롯 0개를 거부한다. 신규 class에는 metadata+weekly slots만 생성하고 명단/대기/교재사용/회차/수납을 복사하지 않는다.
- [ ] 기존 수강 수업의 상태/기본값/학생 배열/claims/student status/history/session IDs는 전부 불변이어야 한다. 프리셋→수강을 위한 기존 운영 수업 업데이트나 `close_class_atomic_v1` 호출은 없다.
- [ ] target plan의 copy/import에서만 실행자가 명시한 `onConflict=keep_pending`을 허용한다. 충돌 배치 원본은 pending_slots로 보존한다. move/운영 반영은 `onConflict=reject`만 허용하며 슬롯이 완전하지 않으면 거부한다.
- [ ] 프리셋→운영은 선택 슬롯끼리+전체 운영 그림자+미래 실제 회차를 검사한다. source_class_id가 같다고 그림자를 제외하지 않는다. 선택하지 않은 초안의 기존 충돌/pending은 안전한 선택의 반영을 막지 않는다.
- [ ] **운영 대상으로 copy** 성공 후에만 원본 item을 `state=applied`, appliedClassId/TransferId/At으로 보존한다. 주 그리드·충돌·추천에서 applied 슬롯을 제외하고 운영 그림자만 사용한다. **프리셋 A→B copy**는 A/B 모두 draft로 유지하고 B의 새 item/slot ID를 반환한다. move는 source item을 제거한다. 응답의 applied/removed/addedShadowSlots를 한 canonical update로 적용한다.
- [ ] applied 항목에서 `새 초안으로 복제`하면 새 ID와 state=draft, applied 필드 null, 슬롯은 pending으로 생성한다. 원래 그림자와 겹친 채 새 확정 슬롯을 만들지 않는다. 운영 수업이 종강/삭제되어 FK가 null이 되어도 applied 상태를 유지한다.
- [ ] 마지막 신규 class 삽입에 강제 실패를 넣고 앞선 생성/원본 applied 처리/삭제/receipt가 모두 rollback되는지 검사한다.

```sql
select is((select count(*) from public.classes where name like 'fixture-transfer-%'),
  :'before_class_count'::bigint, 'failed batch leaves no generated classes');
select is((select status from public.classes where id = :'source_class'),
  '수강', 'referenced operational class keeps running');
select is((select count(*) from public.timetable_plan_items where plan_id = :'source_plan'),
  :'before_plan_count'::bigint, 'failed promotion keeps all selected source items');
```

- [ ] 응답 유실 재실행, 복사 두 번째 실행, 그림자 수정/종강/삭제, catalog 숨김, 공유 해제, 일부 선택 제외 후 재검사를 UI/DB 양쪽에서 검증한다. 수강 반영 후 다른 프리셋에도 새 그림자가 나타나 필요한 충돌을 표시해야 한다.
- [ ] 실행: `supabase test db supabase/tests/timetable_plan_transfers_test.sql`; `node --test --experimental-strip-types tests/timetable-transfer-service.test.mjs tests/timetable-transfer-interaction.test.mjs`.
- [ ] 통과 후 커밋: `feat: promote selected timetable drafts without changing running classes`.

**사용자 설명 반영:** 수강을 개강 준비로 내리는 mutation, 기존 수강 수업 덮어쓰기, 관련 미래 회차 취소는 이 task에서 구현하지 않는다. 현재 수강을 계속 운영하면서 그림자로 비워 두는 것이 확정 요구다.

## Task 8. 실제 경쟁 저장·부수효과·완전성 검증을 통과시킨다

**Files:** `scripts/verify-timetable-concurrency.mjs`; `supabase/tests/timetable_plan_no_send_test.sql`; `tests/timetable-release-contract.test.mjs`; QA REPORT.

**Interfaces:** script는 명시적인 격리 DB URL과 합성 actor fixture를 받는다. production URL이면 중단한다. 두 독립 연결로 실행하며 실제 데이터의 경쟁 결과를 검증한다.

- [ ] 두 연결이 동일 teacher/room 시간에 동시에 저장하게 barrier를 설정한다. 허용 결과는 성공 1·충돌 1이다. 최종 데이터에서 중첩이 0인지 별도 SELECT로 확인한다.
- [ ] 프리셋 editor 두 명이 서로 다른 item을 동시에 저장하면 모두 유지, 같은 item이면 stale 하나가 발생해야 한다. 권한 해제와 재시도도 같은 실행에서 확인한다.
- [ ] 신규 planner commit 대 기존 management save, session generate 대 makeup save의 경쟁을 검사한다. 테스트 DB의 최종 실행 함수가 동일 advisory lock을 실제 사용함을 데이터 결과로 증명한다.
- [ ] 운영 저장 대 프리셋 저장 경쟁을 검사한다. 운영이 먼저면 최신 그림자로 초안 저장이 거부되고, 초안이 먼저면 후속 운영 저장은 다른 운영 수업과의 충돌만 검사하여 성공하며 해당 초안에 충돌 해결 상태가 생겨야 한다.
- [ ] 각 copy/move 전후 학생·claims·출결·수납·교재·회차·notification queue/outbox 행 수와 핵심 JSON을 비교한다. 신규 반영이 과거 참조를 바꾸거나 알림 작업을 enqueue하면 실패한다.
- [ ] 실제 provider 호출은 하지 않는다. provider mock/spies의 호출 0과 DB 큐 증가 0을 별도로 기록한다.
- [ ] 순수 projection/drag의 합성 200수업/600슬롯, 상한 500/2000에서 입력 지연을 측정한다. 1440px 기준 drag frame p95 32ms 이하를 목표로 두며, 지속 초과 시 보이는 panel 렌더만 최적화한다. 시간표 행 pagination으로 잘라 충돌 계산을 줄이지 않는다.
- [ ] 실행: `node scripts/verify-timetable-concurrency.mjs --local`; `supabase test db supabase/tests/timetable_plan_no_send_test.sql`; `node --test --experimental-strip-types tests/timetable-release-contract.test.mjs`.
- [ ] 통과 후 커밋: `test: verify timetable concurrency and preserved operational history`.

## Task 9. 이관·복구·브라우저·배포 절차를 완성한다

**Files:** 신규 `docs/operations/timetable-presets-runbook.md`, `docs/qa/timetable-presets-20260923/REPORT.md`; 수정 DESIGN.md/fixture server; 필요한 capability flag와 UI 진입부.

- [ ] `개강 준비` 수업을 선택하여 새 프리셋으로 복사하는 첫 진입 흐름을 검증한다. 기존 상태/그룹 데이터 자동 변경 없이 목적 프리셋만 생성되어야 한다.
- [ ] 옛 app_preferences 키를 읽기 전용으로 조사한다. 있는 경우 key/저장 버전/수업 건수/파싱 결과만 기록하고 원본을 보존한다. 보기별 초안 내용이 다르면 별개 복구 후보로 둔다. 충돌/미해결 자원은 pending으로 가져온다.
- [ ] DB capability가 부족하거나 조회가 실패하면 현재 운영 읽기 화면은 유지하고 프리셋 편집/반영만 비활성화한다. 프리셋/그림자 DB 장애를 비어 있는 안전한 자리처럼 표시하지 않는다.
- [ ] DESIGN.md의 시간표 절에 프리셋과 기존 기간 필터가 다른 개념임을 기록한다. 공용 토큰 변경이 있으면 해당 공용 구현과 다른 소비 화면도 같은 변경에서 검증한다.
- [ ] 회귀 묶음 실행: `tests/timetable-layout.test.mjs`, `tests/timetable-image-export.test.mjs`, `tests/academic-scoped-reads.test.mjs`, `tests/management-continuous-class-schedule.test.mjs`, `tests/continuous-class-schedule-release2-service.test.mjs`, 새 timetable 테스트. 현재 CI의 `Verify shared dashboard design contracts`도 실행한다.
- [ ] TypeScript, 변경 파일 ESLint, 배포용 build를 실행한다. 기존 실패가 있으면 비교 증거와 영향 경계를 기록하고 신규 실패를 기존 문제로 넘기지 않는다.

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/features/academic src/features/management/management-service.js
pnpm build
```

- [ ] 브라우저 2세션에서 저장/동시 수정/재접속/초안 복구, 네 보기 전체 이동, 전체/일부 transfer, 빈 상태·초기 조회 실패·stale scope·모바일 touch/scroll·키보드 폼·Escape/초점 복귀를 확인한다. 개인정보 없는 합성 화면을 QA REPORT에 연결한다.
- [ ] runbook에 schema→backfill 없음→권한/최종 함수 검사→capability→UI 배포→운영 읽기 smoke 순서를 적는다. 운영 DB 데이터 변경/이관은 승인된 선택만 실행하며 이 계획 작성 중에는 수행하지 않는다.
- [ ] rollback은 UI capability off와 읽기 전용 복귀다. 이미 만들어진 프리셋/운영 수업/이력을 지우는 down migration은 하지 않는다. 반영한 class는 감사 기록과 현재 상태를 비교하여 별도 복구한다.
- [ ] 최종 보고에 다음을 각각 기록한다: 코드, 단위/계약 테스트, 로컬 pgTAP, 두 연결 경쟁, 브라우저, main CI, 운영 migration, 배포, 실제 운영 수업 전환. 미실행 항목을 완료로 표시하지 않는다.
- [ ] 통과 후 커밋: `docs: finish timetable preset rollout and verification evidence`.

## C. 요구사항 추적

| 사용자 요구 | 구현 task | 최종 판정 |
| --- | --- | --- |
| 다음/다음다음/그 이후 학기 저장 | 3, 5, 6 | 독립 프리셋 3개 생성·재접속·서로 불변 |
| 네 보기 어느 곳에서나 직접 배치 | 2, 6 | 4×신규 drop/이동, 같은 stable ID |
| 입력으로 자동 셀 배치 | 2, 6 | 복수 요일 폼 저장 및 빈 시간 후보 |
| 배치한 수업 드래그 이동 | 2, 5, 6 | 시간 길이/다른 자원/다른 요일 보존 |
| 선생님/강의실 충돌 방지 | 3, 4, 8 | UI·DB·다른 쓰기 경로·두 연결 경쟁 |
| 여러 수업 또는 일부 수강으로 올리기 | 7, 8 | copy/move × 1/일부/전체, 전부 rollback |
| 현재 수강 수업의 자리 비워 두기(후속 설명) | 2–8 | 네 보기의 읽기 전용 그림자, 같은 교사/방 점유 차단, 실제 수강 불변 |
| 같이 편성·저장 | 3, 5, 8 | 역할/공유, 서로 다른 수정 병합, 같은 수정 stale |
| 기존 기능보다 개선 | 1–9 | 실패 무시 제거, stable ID, 빈 보드, 시간 정확도, DB 원자성 |

## D. 문서 자체 검토

- [x] 사용자 요구를 C절에 모두 연결했다.
- [x] 기준 checkout과 최신 저장된 원격 ref 차이를 명시했다.
- [x] 사라진 구현의 복원 범위와 재사용하지 않을 저장/적용 구조를 구분했다.
- [x] 기본 시간표와 이미 생성한 회차, 운영 그림자와 편집 초안, 복사/이동 결과의 의미를 구분했다.
- [x] API/모델/화면 task별 책임, 입력·기대 결과·명령·중단 조건을 명시했다.
- [x] 실제 데이터 migration·외부 알림·운영 배포를 계획 작성 완료와 구분했다.

사용자의 두 후속 답변(운영 그림자, 요일·시간 배치+빈 시간 추천)을 반영했다. 교사 공유 범위 등 추가 설계 선택은 spec의 제안이다. 구현 방법은 작업 난도와 병렬 가능성에 맞게 조정할 수 있으며 이 문서 작성으로 구현을 시작하지 않는다.

## Task 9 실제 통합 결과 안내

사용자의 `진행` 승인 이후 구현한 최종 결과와 미실행 운영 gate는 `docs/qa/timetable-presets-20260923/REPORT.md`, 출시/rollback 명령은 `docs/operations/timetable-presets-runbook.md`를 따른다. 원래 계획의 체크리스트 문장은 당시 계획 기록이며 현재 검증 완료 여부를 대신하지 않는다.
