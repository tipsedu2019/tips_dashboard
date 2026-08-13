# 등록 상담 내용 기록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상담 책임자가 상담 결과와 장문의 상담 내용을 함께 저장하고 다시 열어 확인할 수 있게 한다.

**Architecture:** 기존 `ops_registration_consultations` 행에 nullable `note text`를 추가한다. 기존 `save_registration_consultation_details_v1` RPC의 private 구현과 public wrapper, 서비스 타입·매퍼·fixture, 상담 결과 인라인 편집기를 동일한 `note` 계약으로 확장한다. 결과·내용은 하나의 요청 키 및 DB 트랜잭션으로 저장한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase/Postgres, pgTAP

## Global Constraints

- 상담 결과와 내용을 반드시 같은 상담 레코드와 같은 저장 요청으로 처리한다.
- `dashboard_private.assert_registration_mutation_access(..., 'complete_consultation')`의 기존 상담 책임자 권한 경계를 유지한다.
- 결과가 없으면 상담 내용만 저장할 수 없다.
- 공백만 있는 상담 내용은 DB에서 `NULL`로 정규화한다.
- 새 테이블·공개 API·RLS 정책·알림·외부 공급자 호출을 추가하지 않는다.
- 원격 DB 적용, 배포, 알림 발송은 이 작업 범위에서 제외한다.
- 코드보다 먼저 실패하는 테스트를 작성하고, 각 태스크는 독립 커밋으로 끝낸다.

---

## File structure

- `supabase/migrations/` 아래에서 `supabase migration new registration_consultation_notes` 명령이 생성·출력하는 `*_registration_consultation_notes.sql`: 상담 레코드 `note` 열과 5-인자 상담 저장 RPC를 정의한다.
- `supabase/tests/registration_consultation_notes_test.sql`: 스키마·RPC 서명·권한·저장 정규화 계약을 pgTAP으로 검증한다.
- `src/features/tasks/registration-track-service.ts`: 상담 읽기 모델과 저장 요청/응답에 `note`를 연결한다.
- `src/features/tasks/registration-track-model.js`: 결과와 상담 내용의 독립적인 dirty/save 상태를 계산한다.
- `src/features/tasks/registration-application-track-actions.tsx`: 다중 행 입력과 기존 저장 흐름을 결합한다.
- `src/features/tasks/registration-track-fixtures.ts`: 로컬 fixture의 상담 내용 저장 결과를 현실 모델과 맞춘다.
- `tests/registration-track-service.test.mjs`: 서비스 RPC payload·response mapping을 검증한다.
- `tests/registration-track-model.test.mjs`: 결과/상담 내용/권한 조합의 저장 상태를 검증한다.
- `tests/registration-track-workspace.test.mjs`: 인라인 편집기의 접근 가능한 다중 행 입력과 저장 연결을 검증한다.

### Task 1: 데이터 계약과 권한 유지

**Files:**
- Create: `supabase migration new registration_consultation_notes` 명령이 출력하는 `supabase/migrations/*_registration_consultation_notes.sql` (반드시 이 CLI 명령으로 생성)
- Create: `supabase/tests/registration_consultation_notes_test.sql`
- Test: `supabase/tests/registration_consultation_notes_test.sql`

**Interfaces:**
- Consumes: `public.ops_registration_consultations`, `dashboard_private.assert_registration_mutation_access`, `public.save_registration_consultation_details_v1(uuid, text, text, text)`.
- Produces: `public.ops_registration_consultations.note text`와 `public.save_registration_consultation_details_v1(uuid, text, text, text, text) returns jsonb`.

- [ ] **Step 1: SQL 계약 테스트를 먼저 작성한다**

`supabase/tests/registration_consultation_notes_test.sql`에 다음 pgTAP 계약을 작성한다.

```sql
begin;
select plan(6);

select has_column('public', 'ops_registration_consultations', 'note', '상담 내용 열이 존재한다');
select col_type_is('public', 'ops_registration_consultations', 'note', 'text', '상담 내용은 text다');
select col_is_null('public', 'ops_registration_consultations', 'note', '상담 내용은 선택 사항이다');
select has_function('public', 'save_registration_consultation_details_v1', array['uuid', 'text', 'text', 'text', 'text'], '상담 내용 저장 RPC가 5개 인자를 받는다');
select function_privs_are('public', 'save_registration_consultation_details_v1', array['uuid', 'text', 'text', 'text', 'text'], 'authenticated', array['EXECUTE'], '인증 사용자는 기존 RPC를 실행할 수 있다');
select is_empty($$
  select 1 from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'save_registration_consultation_details_v1'
    and grantee in ('PUBLIC', 'anon')
    and privilege_type = 'EXECUTE'
$$, 'PUBLIC과 anon에는 실행 권한이 없다');

select * from finish();
rollback;
```

- [ ] **Step 2: 실패를 확인한다**

로컬 Supabase가 준비된 환경에서 실행한다.

```bash
supabase test db --local --file supabase/tests/registration_consultation_notes_test.sql
```

예상: `note` 열과 5-인자 RPC가 아직 없어 실패한다.

- [ ] **Step 3: 최소 마이그레이션을 작성한다**

먼저 정확한 마이그레이션 파일명을 생성한다.

```bash
supabase migration new registration_consultation_notes
```

생성된 파일에 다음을 작성한다. 기존 4-인자 public wrapper를 revoke/drop하고, private 구현은 `p_note text`를 받아 `nullif(btrim(p_note), '')`을 저장한다. 기존 auth 검사, 행 잠금, `assert_registration_mutation_access`, 상태/결과 검증, 이벤트 기록은 보존한다.

```sql
alter table public.ops_registration_consultations
  add column note text;

drop function if exists public.save_registration_consultation_details_v1(uuid, text, text, text);

create function dashboard_private.save_registration_consultation_details_impl(
  p_consultation_id uuid,
  p_status text,
  p_outcome text,
  p_note text,
  p_request_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_consultation public.ops_registration_consultations%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
begin
  -- 기존 인증, 입력, 잠금, 상담 책임자 검증을 그대로 수행한다.
  update public.ops_registration_consultations
  set status = p_status,
      outcome = p_outcome,
      note = v_note,
      completed_at = case when p_status = 'completed' then coalesce(completed_at, pg_catalog.now()) else null end,
      updated_at = pg_catalog.now()
  where id = p_consultation_id
  returning * into v_consultation;

  return jsonb_build_object(
    'consultationId', v_consultation.id,
    'trackId', v_track.id,
    'status', v_consultation.status,
    'outcome', v_consultation.outcome,
    'note', v_consultation.note
  );
end;
$$;

create function public.save_registration_consultation_details_v1(
  p_consultation_id uuid,
  p_status text,
  p_outcome text,
  p_note text,
  p_request_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select dashboard_private.save_registration_consultation_details_impl($1, $2, $3, $4, $5);
$$;

revoke execute on function public.save_registration_consultation_details_v1(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_registration_consultation_details_v1(uuid, text, text, text, text) to authenticated;
```

이벤트 metadata에는 상담 원문을 넣지 않고, 기존의 `consultationId`, `status`, `outcome`만 유지한다.

- [ ] **Step 4: SQL 테스트를 다시 실행한다**

```bash
supabase test db --local --file supabase/tests/registration_consultation_notes_test.sql
```

예상: 6개 테스트가 모두 통과한다.

- [ ] **Step 5: 마이그레이션 경계를 검증하고 커밋한다**

```bash
node --test tests/supabase-migration-layout.test.mjs
git add supabase/migrations/*_registration_consultation_notes.sql supabase/tests/registration_consultation_notes_test.sql
git commit -m "feat: persist registration consultation notes"
```

### Task 2: 서비스·상태 모델·fixture의 note 계약

**Files:**
- Modify: `src/features/tasks/registration-track-service.ts: OpsRegistrationConsultation, mapConsultation, saveRegistrationConsultationDetails`
- Modify: `src/features/tasks/registration-track-model.js: getRegistrationConsultationOutcomeSaveState`
- Modify: `src/features/tasks/registration-track-fixtures.ts: 모든 OpsRegistrationConsultation 생성 및 saveRegistrationConsultationDetails fixture action`
- Modify: `tests/registration-track-service.test.mjs: consultation records use their dedicated data-only RPC`
- Modify: `tests/registration-track-model.test.mjs: consultation outcome save state distinguishes persisted, changed, and unauthorized views`
- Test: `tests/registration-track-service.test.mjs`
- Test: `tests/registration-track-model.test.mjs`

**Interfaces:**
- Consumes: Task 1의 5-인자 RPC와 반환 `note`.
- Produces: `OpsRegistrationConsultation.note: string | null` 및 `getRegistrationConsultationOutcomeSaveState({ savedOutcome, draftOutcome, savedNote, draftNote, canCompleteConsultation })`.

- [ ] **Step 1: 서비스와 상태 모델의 실패 테스트를 작성한다**

서비스 테스트의 기존 RPC assertion을 note가 포함된 정확한 payload로 바꾼다.

```js
assert.deepEqual({ ...args }, {
  p_consultation_id: "consultation-1",
  p_status: "completed",
  p_outcome: "waiting",
  p_note: "보호자가 다음 학기 반을 요청함",
  p_request_key: "consultation-details-request",
})
```

모델 테스트에는 다음 동작을 추가한다.

```js
assert.equal(getRegistrationConsultationOutcomeSaveState({
  savedOutcome: "waiting",
  draftOutcome: "waiting",
  savedNote: "기존 상담 내용",
  draftNote: "수정한 상담 내용",
  canCompleteConsultation: true,
}).canSave, true)

assert.equal(getRegistrationConsultationOutcomeSaveState({
  savedOutcome: "",
  draftOutcome: "",
  savedNote: "",
  draftNote: "결과 없는 내용",
  canCompleteConsultation: true,
}).canSave, false)
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --test --experimental-strip-types tests/registration-track-service.test.mjs tests/registration-track-model.test.mjs
```

예상: 서비스 RPC argument와 상태 함수가 note를 아직 처리하지 않아 실패한다.

- [ ] **Step 3: 최소 구현을 작성한다**

`registration-track-service.ts`에서 다음을 수행한다.

```ts
export type OpsRegistrationConsultation = {
  // 기존 필드
  note: string | null
}

const note = nullableText(value(row, "note"))

await callRpc<Row>("save_registration_consultation_details_v1", {
  p_consultation_id: input.consultationId,
  p_status: input.status,
  p_outcome: input.status === "completed" ? input.outcome : null,
  p_note: nullableText(input.note),
  p_request_key: requireRequestKey(input.requestKey),
})
```

저장 input/response에도 `note: string`과 `note: string | null`을 추가한다. fixture의 모든 상담 생성은 `note: null`을 명시하고, fixture save action은 trim 후 `null`을 저장한다.

`getRegistrationConsultationOutcomeSaveState`는 `savedNote`와 `draftNote`를 trim/nullable 기준으로 비교한다. `dirty`는 결과 또는 내용의 변경이고, `canSave`는 `editable && dirty && Boolean(draftOutcome)`이다. `label`은 저장 가능 또는 dirty일 때 `상담 결과 저장`, 그 외 `저장됨`을 유지한다.

- [ ] **Step 4: 테스트를 다시 실행한다**

```bash
node --test --experimental-strip-types tests/registration-track-service.test.mjs tests/registration-track-model.test.mjs tests/registration-track-fixtures.test.mjs
```

예상: note mapping, payload, 내용만 변경된 dirty 상태, 결과 없는 내용 차단이 모두 통과한다.

- [ ] **Step 5: 타입과 커밋을 검증한다**

```bash
npx tsc --noEmit
git add src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-model.js src/features/tasks/registration-track-fixtures.ts tests/registration-track-service.test.mjs tests/registration-track-model.test.mjs tests/registration-track-fixtures.test.mjs
git commit -m "feat: model registration consultation notes"
```

### Task 3: 상담 결과 화면에 장문 입력을 연결

**Files:**
- Modify: `src/features/tasks/registration-application-track-actions.tsx: RegistrationConsultationOutcomeEditor`
- Modify: `tests/registration-track-workspace.test.mjs: phone and visit consultation completion share one inline subject outcome editor`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Consumes: Task 2의 `consultation.note`와 note-aware 저장 상태, `saveRegistrationConsultationDetails({ consultationId, status, outcome, note, requestKey })`.
- Produces: 결과와 상담 내용을 함께 저장하는 접근 가능한 인라인 편집기.

- [ ] **Step 1: 화면 계약의 실패 테스트를 작성한다**

기존 화면 계약 테스트에 실제 UI 경계를 확인하는 assertion을 추가한다.

```js
assert.match(outcomeSource, /const \[note, setNote\] = useState\(consultation\.note \|\| ""\)/)
assert.match(outcomeSource, /<Label htmlFor=\{`\$\{subject\}-consultation-note`\}>상담 내용<\/Label>/)
assert.match(outcomeSource, /<Textarea[\s\S]*?id=\{`\$\{subject\}-consultation-note`\}/)
assert.match(outcomeSource, /value=\{note\}[\s\S]*?onChange=\{\(event\) => setNote\(event\.target\.value\)\}/)
assert.match(outcomeSource, /note,/)
assert.match(outcomeSource, /disabled=\{saving \|\| !saveState\.editable\}/)
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --test --experimental-strip-types tests/registration-track-workspace.test.mjs
```

예상: `note` state와 `Textarea`가 없어 실패한다.

- [ ] **Step 3: 최소 UI 구현을 작성한다**

`RegistrationConsultationOutcomeEditor`에서 `consultation.note || ""`로 초기화한 `note` 상태를 추가하고 note-aware save state에 전달한다. 결과 fieldset 바로 뒤에 다음 제어를 추가한다.

```tsx
<div className="grid gap-2">
  <Label htmlFor={`${subject}-consultation-note`}>상담 내용</Label>
  <Textarea
    id={`${subject}-consultation-note`}
    value={note}
    onChange={(event) => setNote(event.target.value)}
    placeholder="상담에서 확인한 내용과 다음 조치를 기록하세요."
    rows={6}
    disabled={saving || !saveState.editable}
  />
</div>
```

`normalizedDraft`에는 `note`를 포함해 내용 변경 시 다른 요청 키를 만들고, `saveRegistrationConsultationDetails` 호출에는 `note`를 전달한다. 권한 안내를 `상담 책임자만 결과와 내용을 수정할 수 있습니다.`로 바꾼다. 저장 버튼 라벨은 기존 `상담 결과 저장`을 유지한다.

- [ ] **Step 4: 테스트와 정적 검사를 실행한다**

```bash
node --test --experimental-strip-types tests/registration-track-workspace.test.mjs tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs
npx eslint src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-model.js tests/registration-track-workspace.test.mjs tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs
npx tsc --noEmit
```

예상: 결과·내용의 저장 연결과 접근성 계약, lint, 타입 검사가 모두 통과한다.

- [ ] **Step 5: 브라우저 확인 후 커밋한다**

로컬 fixture에서 상담 책임자 세션으로 등록 상세를 열어, 결과 선택·두 문단 이상의 상담 내용 입력·저장·닫기/다시 열기를 확인한다. 다른 상담 책임자 세션에서는 입력과 저장이 비활성인지 확인한다. 이 단계에서 알림 버튼, 외부 발송, 운영 레코드는 실행하지 않는다.

```bash
git add src/features/tasks/registration-application-track-actions.tsx tests/registration-track-workspace.test.mjs
git commit -m "feat: add registration consultation note editor"
git diff HEAD~3..HEAD --check
```

## Plan self-review

- Spec coverage: 데이터 저장/재표시(Task 1-2), 결과와 단일 저장(Task 1-3), 상담 책임자 권한(Task 1·3), 공백 정규화(Task 1-2), 결과 없는 내용 차단(Task 2), 접근성·장문 UI(Task 3), 무발송/비배포 경계(Global Constraints·Task 3)를 모두 포함한다.
- Placeholder scan: 실행 시 CLI가 생성하는 migration timestamp 외에는 미결정 값이나 추후 작업 지시가 없다.
- Type consistency: `note`는 DB에서 nullable text, 읽기 모델에서 `string | null`, 입력 상태·RPC input에서 `string`, 저장 응답에서 `string | null`으로 일관되게 사용한다.
