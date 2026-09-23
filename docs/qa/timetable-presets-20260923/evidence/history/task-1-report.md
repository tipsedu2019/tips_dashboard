# Task 1: 기존 일정 저장 mutation 안전성

기준 checkout: `eb23d7d8`; 브랜치 `codex/timetable-presets-20260923`; Task 1 커밋 `939be514`. 변경은 지정된 격리 worktree와 네트워크 없는 `tips_timetable_20260923` PostgreSQL 17.6.1.159 컨테이너에서만 검증했다. 운영 DB 쓰기, 전송, push, 배포는 없다.

## 최종 함수 정의와 결함 증거

105개 기존 마이그레이션을 순서대로 적용한 격리 DB에서 `pg_get_functiondef`로 helper, 저장 RPC, shadow backfill RPC의 실제 정의를 추출했다. 적용 전후 전문은 `task-1-function-definitions.sql`에 있으며 각 SHA-256이 함께 기록돼 있다. 적용 전 helper에는 `UPDATE public.classes`의 `WHERE`가 없어 A 저장이 모든 수업의 `schedule_revision/schedule/teacher/room`을 변경했다. 슬롯 시간 튜플 UNIQUE는 즉시 검사라 같은 수업의 유효한 ID 보존 시간 맞교환이 실패했다. 저장 RPC의 stale 예외는 수동 `40001`이었다. Shadow backfill 최종 정의는 같은 UNIQUE를 `ON CONFLICT (class_id, weekday, start_time, end_time)` arbiter로 사용했다.

RED: `tests/continuous-class-schedule-release2-service.test.mjs`의 실제 serialization error 매핑 검사는 `'stale' !== 'unknown'`으로 실패(5개 중 1개). 새 `supabase/tests/timetable_schedule_mutation_safety_test.sql`은 수정 전 18개 중 9개 실패: 제약 지연 불가, B 수업 변경, 슬롯별 문자열 투영 누락, stale SQLSTATE `40001` 대 기대 `P0001`, 시간 맞교환 `23505`와 연쇄 ID/revision 실패. 테스트 fixture의 auth.users/profile 준비 오류를 먼저 해결한 뒤 관측한 행동 실패다.

## 구현

`20260923063151_timetable_schedule_mutation_safety.sql`은 대상 수업의 슬롯만 집계하고 `WHERE id = p_class.id`로 정확히 한 수업만 UPDATE하며 행 수가 1인지 검사한다. 슬롯 ID를 보존하고, 입력의 최종 시간 튜플 중복을 `22023`으로 거절한 뒤 UNIQUE 검사를 저장 중에만 지연하고 반환 전에 즉시 검사로 복구한다. 문자열 schedule/teacher/room은 기존 `parseClassScheduleSlots` 계약에 맞춰 슬롯별 교사·강의실을 보존한다. 이미 생성된 `class_lesson_sessions` snapshot과 `source_schedule_slot_id`는 변경하지 않는다.

UNIQUE를 DEFERRABLE로 바꾸면 기존 `ON CONFLICT`가 사용할 수 없어 shadow backfill의 최종 함수 정의를 정확한 원본 조각 확인 후 조건부로 패치했다. 새 private reconciliation helper는 기존 튜플 업데이트, 없는 튜플 삽입, 빠진 튜플 삭제를 수행하며 기존 슬롯 ID를 유지한다. 저장 RPC의 `class_schedule_stale`만 `P0001`로 변경했고 앱 매핑은 오류 메시지를 기준으로 stale을 분류해 실제 `40001` serialization failure를 도메인 stale로 오분류하지 않는다. 기존 `SECURITY DEFINER`, 빈 `search_path`, authenticated 실행 권한 및 private helper 비공개 실행 권한은 실제 catalog에서 확인했다.

## GREEN과 한계

- 새 rollback-only pgTAP: **21/21**. A 저장 후 B 핵심 JSON 불변, A revision, 월 교사 A/강의실 1·수 교사 B/강의실 2 투영, 과거 회차 snapshot/FK, 멱등 replay, stale `P0001`, 다른 수업 슬롯 소유권, 최종 중복 거절, ID 보존 맞교환, admin/staff·teacher·비인증·anon 경계를 실제 호출로 검증했다. Shadow reconciliation의 기존 튜플 갱신과 중복 없음도 검증했다. 이 테스트는 rollback-only runtime singleton version 1을 설치한다.
- 기존 backfill pgTAP: **21/21**. 기존 fixture가 기대하는 auth.users 행과 runtime singleton version 0이 격리 DB baseline에 없어, 테스트 SQL을 바꾸지 않고 별도 rollback-only wrapper에서 두 행을 준비했다.
- 기존 Release 2 pgTAP: **32/32**. 기존 6개 실패는 3인자 `has_column`이 `(name,name,text)`로, 2인자 `has_table`이 `(name,text)`로 해석되어 존재하는 컬럼/테이블을 검사하지 않은 테스트 자체의 오버로드 문제였다. 실제 catalog에서 4개 컬럼과 2개 테이블의 존재를 확인했고, 테스트를 `(schema,table,column,description)` / `(schema,table,description)` 호출로 고쳤다. rollback-only runtime singleton version 0 fixture를 사용했다.
- 지정된 Node 테스트 두 파일: **10/10**. DB가 반환하는 투영 문자열과 동일한 literal을 기존 `parseClassScheduleSlots`에 넣어 월·수 슬롯의 교사/강의실 해석을 검증했다. `git diff --check` 통과.

요청된 `supabase test db` 직접 호출은 이 격리 컨테이너에 host port가 없어서 실행하지 못했다. 같은 SQL 파일을 `docker exec ... psql -X -v ON_ERROR_STOP=1`로 실행하고 pgTAP의 `not ok`와 `finish()` 결과를 확인했다. 운영 DB나 실제 저장 UI/브라우저는 검증하지 않았다.

남은 `class_schedule_stale` 수동 `40001` 최종 함수는 아래 8개이며, Task 1의 접촉 범위 밖이다. 후속 운영 entrypoint 작업에서 각각 정확한 SQLSTATE와 pgTAP을 함께 변경해야 한다.

- `public.initialize_new_class_schedule_v1(uuid,bigint,text,jsonb,uuid)`
- `public.preview_class_lesson_session_generation_v1(uuid,bigint,date,date)`
- `public.generate_class_lesson_sessions_v1(uuid,bigint,date,date,uuid,text)`
- `public.save_class_lesson_session_v1(uuid,bigint,text,date,time,time,uuid,uuid,text,text,text,uuid,text)`
- `public.save_class_lesson_content_v1(uuid,text,jsonb,uuid)`
- `public.backfill_class_schedule_shadow_v1(uuid,text,jsonb,jsonb,uuid)`
- `public.verify_class_schedule_shadow_v1(uuid,text)`
- `public.activate_class_schedule_storage_v1(uuid,bigint,text,uuid)`

## 재현 명령과 보존한 원시 출력

아래 명령은 격리 컨테이너 `tips_timetable_20260923`에 기존 baseline, fixture prerequisites, 105개 기존 migration과 Task 1 migration을 순서대로 적재한 상태에서 실행했다. Docker 바이너리: `/Users/hyunjun/.local/bin/docker`. `psql`은 컨테이너 내부에서 실행했고 모든 pgTAP 파일은 `BEGIN`/`ROLLBACK`으로 닫힌다. 기존 backfill/Release 2 테스트에는 baseline에 빠진 runtime singleton 등을 준비하는 별도 rollback-only wrapper를 사용했다.

```sh
cd /Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < .superpowers/sdd/2026-09-23-timetable-presets/task-1-backfill-wrapper.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < .superpowers/sdd/2026-09-23-timetable-presets/task-1-release2-wrapper.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/continuous-class-schedule-release2-service.test.mjs tests/management-continuous-class-schedule.test.mjs
```

보존된 원시 출력: [새 pgTAP 21/21](./task-1-new-pgtap-green.tap), [backfill 21/21](./task-1-backfill-green.tap), [Release 2 32/32](./task-1-release2-green.tap). Rollback-only fixture: [backfill wrapper](./task-1-backfill-wrapper.sql), [Release 2 wrapper](./task-1-release2-wrapper.sql). [적용 전후 최종 함수 정의](./task-1-function-definitions.sql)에도 SHA-256과 전문을 보존했다. 격리 DB 구성의 정확한 파일 적용 순서는 [bootstrap-db.py](./bootstrap-db.py), 실제 출력은 [db-bootstrap.log](./db-bootstrap.log)에 있다. 해당 bootstrap 스크립트는 같은 이름의 격리 컨테이너를 중지하고 새로 생성하므로, 실행 전에 그 컨테이너에서 진행 중인 후속 작업을 확인해야 한다. 원본 RED SQL과 Node 실행 출력, Node GREEN 실행 출력은 당시 도구 응답으로 관찰했으며 별도 원시 로그 파일로 저장하지 않았다. 따라서 수치와 실패 메시지는 위 본문에 기록된 관찰 결과이고, 해당 원시 로그 파일 링크는 제공하지 않는다. `psql`은 pgTAP의 `not ok`만으로 비정상 종료하지 않으므로 보존된 출력의 `finish()`와 `not ok` 부재도 함께 확인해야 한다.

## 리뷰 수정 1: 부분 미지정 자원 투영

리뷰에서 월요일은 교사 A/강의실 1, 수요일은 두 자원 모두 미지정인 경우의 잘못된 fallback을 확인했다. 수정 전 `count(distinct nullif(...))`은 빈 자원을 variation에서 제외했고, 문자열 schedule에 상세가 없는 슬롯은 `parseClassScheduleSlots`와 `get_academic_timetable_range_v1`이 수업 요약의 A/1을 빌렸다. 정확한 비대상 자원 표시를 보존하기 위해 혼합 상태의 모든 슬롯에 두 자리 상세를 출력한다. 미지정 자리에는 표시용 `교사 미지정` 또는 `강의실 미지정`을 사용하며, 두 소비자는 이 표기를 빈 자원으로 해석한다. 기존 fully assigned 및 모든 슬롯의 자원이 동일한 경우는 기존 표현을 유지한다. `formatClassScheduleSlots`도 같은 투영을 사용한다. 수정 커밋은 `c570cfc1`이며 새 follow-up migration은 `20260923065331_timetable_schedule_partial_resources.sql`이고 기존 두 최종 함수 정의의 확인된 조각만 guarded patch한다. [적용 전후 최종 정의](./task-1-review1-function-definitions.sql)를 보존했다. 일정 저장 helper는 SECURITY DEFINER/빈 search_path/private 실행 ACL을, 시간표 RPC는 SECURITY INVOKER/빈 search_path/authenticated 실행 ACL을 유지함을 catalog에서 확인했다.

재현용 테스트를 먼저 추가했다. [SQL RED 원시 출력](./task-1-review1-sql-red.tap)은 34개 중 5개 실패(부분 미지정 투영 1개, 시간표의 잘못된 교사/강의실 fallback 4개)를 기록한다. Node 파서 RED는 6개 중 1개가 실패했고 실제 값에 `교사 미지정`/`강의실 미지정`이 자원 이름처럼 남았다. 이 Node RED 출력은 파일로 저장하지 않았으며 당시 도구 응답으로 관찰했다. 수정 후 [SQL GREEN](./task-1-review1-sql-green.tap)은 **34/34**, [지정 Node + 파서 GREEN](./task-1-review1-node-green.tap)은 **18/18**, [기존 시간표 SQL GREEN](./task-1-review1-timetable-green.tap)은 **12/12**다. 부분 미지정 4종(fully assigned, teacher-only, room-only, both-unassigned)을 같은 SQL fixture에서 저장한 후 실제 시간표 RPC 행과 관리 파서에서 검증했다. 기존 과거 회차 snapshot 검사는 그대로 통과했다.

```sh
cd /Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20260923065331_timetable_schedule_partial_resources.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_continuous_class_scope_test.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-continuous-class-schedule.test.mjs tests/continuous-class-schedule-release2-service.test.mjs tests/class-schedule-slots.test.mjs
```

위 migration 적용 명령은 최초 1회 적용용이다. 현재 격리 DB에는 이미 적용됐으므로 재실행하려면 새 격리 DB를 준비해야 한다. RED 결과는 첫 Task 1 migration을 적용하고 이 follow-up migration은 적용하기 전 상태에서 관측했다. 운영 DB·배포·실제 알림에는 변경이 없다. 정규화 수업의 admission 메시지는 정규화 슬롯/회차 경로를 사용하고, legacy 문자열 파서는 비정규화 수업 경로에서만 호출된다. 이 리뷰 수정의 실제 문자열 소비자인 시간표 RPC는 위 테스트로 검증했다.

## 리뷰 수정 2: 미지정 표기와 실제 카탈로그 이름의 충돌

리뷰에서 카탈로그 이름 자체가 `교사 미지정` 또는 `강의실 미지정`일 때 리뷰 수정 1의 문자열 소비자가 지정된 자원을 빈 값으로 해석하는 결함을 확인했다. `~41` 같은 기존 원문을 `~` 인코딩으로 잘못 해석할 수 있어, 이름을 예약하거나 인코딩하는 방식은 최종안에서 사용하지 않았다. **리뷰 수정 1의 placeholder 투영 계약은 이 수정으로 대체된다.** 혼합 슬롯의 `schedule` 상세는 교사와 강의실의 두 자리를 항상 유지한다: `(교사, 강의실)`, `(교사, )`, `(, 강의실)`, `(, )`. 두 자리가 있는 상세에서 각 빈 자리만 미지정이며, 모든 비어 있지 않은 이름은 원문 그대로 지정된 자원이다. 상세가 없는 기존 일반 일정은 기존 fallback을 유지한다. 기존 단일 상세 `(교사 미지정)`도 실제 이름으로 취급한다. 원본 카탈로그와 기존 저장 데이터는 변경하지 않았다.

수정 커밋은 `70d5bdb4`다. CLI로 생성한 follow-up migration은 `supabase/migrations/20260923070639_timetable_schedule_literal_resources.sql`이다. 최종 정의를 확인한 guarded patch로 저장 helper의 투영과 `get_academic_timetable_range_v1`의 실제 문자열 소비자를 바꾸며, 새 private helper나 권한은 추가하지 않는다. 관리 파서와 수업목록 표시도 빈 자리를 유지한다. 기존 fully assigned 두 자리 일정은 같은 문자열로 유지된다. [최종 운영 순서 함수 정의](./task-1-review2-final-definitions.sql)는 격리 DB에서 `pg_get_functiondef`로 다시 추출했다.

[초기 Node RED](./task-1-review2-node-red.tap)는 실제 이름이 미지정 표기일 때 실패한 최초 회귀다. 최종 구조적 SQL 회귀는 앞선 migration만 적용된 격리 DB에서 **45개 중 7개 실패**했고, [원시 RED](./task-1-review2-sql-red.tap)에 부분 미지정 투영, literal 이름, 인증 역할 시간표 RPC 실패가 남아 있다. 최종 migration을 그 상태에서 그대로 적용한 [출력](./task-1-review2-migration.log) 이후 [SQL GREEN](./task-1-review2-sql-green.tap)은 **46/46**, 기존 범위 [SQL GREEN](./task-1-review2-scope-green.tap)은 **12/12**다. 안전성 pgTAP 안에서 `SET LOCAL ROLE authenticated`와 synthetic JWT로 실제 시간표 RPC를 호출해 literal 이름 두 건을 확인했다. `~41`과 `~v1:41~`도 이름 그대로 반환하며, 기존 단일 상세의 literal 미지정 교사도 보존한다. 접촉 TypeScript·테스트 파일의 ESLint도 통과했다. Node는 [관리 7/7](./task-1-review2-management-green.tap), [Release 2 서비스 5/5](./task-1-review2-release2-green.tap), [슬롯 파서·표시 9/9](./task-1-review2-slots-green.tap)다. `git diff --check` 통과. `psql`은 pgTAP 실패에도 0으로 종료할 수 있어 각 출력의 `not ok` 부재와 `finish()` 계획 숫자를 확인했다.

```sh
cd /Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard
# RED: 20260923065331 migration까지 적용하고 아래 follow-up은 아직 적용하지 않은 격리 DB에서 실행
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
# Migration: 위 RED 상태에서 한 번만 적용
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20260923070639_timetable_schedule_literal_resources.sql
# GREEN: migration 적용 후
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_continuous_class_scope_test.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/management-continuous-class-schedule.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/continuous-class-schedule-release2-service.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/class-schedule-slots.test.mjs
```

SQL·Node RED 출력은 테스트를 먼저 작성한 시점의 결과다. 최종 구조적 SQL RED에서는 앞선 migration 상태를 정확히 재현하기 위해 격리 DB의 접촉 함수 두 개만 기존 정의로 복구하고 테스트했으며, 이후 위 follow-up 파일을 그대로 적용했다. 최초 Node RED는 같은 literal-name 결함의 인코딩 후보 테스트였고, 최종 구조적 테스트는 그 원인을 제거하는 계약으로 교체했다. 현재 격리 DB에는 최종 migration이 적용됐으므로 재현 명령의 RED 단계를 그대로 다시 실행하면 GREEN이 나온다. 운영 DB 쓰기, push, 배포는 하지 않았다.

## 리뷰 수정 3: 쉼표를 포함한 카탈로그 이름의 정규화 시간표 조회

리뷰에서 앞선 두 자리 문자열 투영이 `김, 민` 교사/`강의실 1` 슬롯을 `(김, 민, 강의실 1)`로 저장할 때, 시간표 RPC가 두 번째 토큰 `민`을 강의실로 해석하는 새 결함을 확인했다. 강의실 이름 자체가 `강의실 1, 별관`인 경우도 문자열 분할만으로 원래 경계를 복원할 수 없다. 원문 표시용 `classes.schedule` 투영은 유지하되, `schedule_storage_mode='normalized'`인 시간표 행의 교사·강의실은 같은 수업 ID·요일·시작·종료 시간의 `class_schedule_slots` 행에서 읽는다. 매치가 없거나 정규화 슬롯 자원이 비어 있으면 빈 값으로 두어 수업 요약을 빌리지 않는다. `legacy`와 `shadow`는 이 migration 직전의 SQL 문자열 파서 표현식을 그대로 사용한다. 모드 변경, 카탈로그 이름 변경, 별도 전송은 없다.

수정 커밋은 `429618c2`다. 새 CLI follow-up migration은 `supabase/migrations/20260923073614_timetable_normalized_slot_resources.sql`이다. 현재 최종 `get_academic_timetable_range_v1` 정의의 metadata 선택, 자원 표현식, FROM/JOIN 조각을 확인한 뒤 guarded patch하며 `SECURITY INVOKER`와 기존 authenticated 슬롯 SELECT/RLS 정책을 유지한다. [격리 DB에서 추출한 최종 함수 정의](./task-1-review3-final-definition.sql)를 보존했다.

[SQL RED](./task-1-review3-sql-red.tap)는 **55개 중 3개 실패**: 쉼표 교사의 이름/강의실 오배치와 쉼표 강의실 이름 절단. [migration 적용 출력](./task-1-review3-migration.log) 뒤 [SQL GREEN](./task-1-review3-sql-green.tap)은 **56/56**, [기존 범위 SQL](./task-1-review3-scope-green.tap)은 **12/12**다. pgTAP은 합성 staff JWT와 `SET LOCAL ROLE authenticated` 아래 실제 시간표 RPC에서 쉼표 교사·강의실, 반대쪽 정상 자원, 양쪽 빈 자원을 확인하고, `legacy`와 `shadow` 모드의 기존 문자열 경로도 검사한다. Node의 기존 정규화 defaults 경로는 [추가 전 8/8](./task-1-review3-node-existing-path.tap), [migration 후 8/8](./task-1-review3-node-green.tap): 쉼표를 포함한 이름 원문과 catalog ID를 그대로 유지했다. [Release 2 서비스 5/5](./task-1-review3-release2-green.tap), [슬롯 파서 9/9](./task-1-review3-slots-green.tap), [접촉 테스트 ESLint](./task-1-review3-eslint.log) 및 `git diff --check`도 통과했다.

```sh
cd /Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard
# RED: 20260923070639 migration까지 적용하고 새 follow-up 전의 격리 DB
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
# GREEN 시작: 새 migration을 격리 DB에 한 번 적용
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20260923073614_timetable_normalized_slot_resources.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_continuous_class_scope_test.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/management-continuous-class-schedule.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/continuous-class-schedule-release2-service.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/class-schedule-slots.test.mjs
```

기존 3인자 `parseClassScheduleSlots(schedule, teacher, room)`는 문자열에 쉼표가 들어간 이름의 경계를 원리상 확정할 수 없다. 이것은 이번 시간표 RPC 수정 전에 있던 legacy 문자열 한계이며, 정규화 편집 경로는 `fromContinuousClassScheduleDefaults`의 슬롯 배열을 사용한다. 후속 Task 4의 fail-closed reader 및 최종 검토에서 이 경계를 별도로 평가한다. 현 격리 DB에는 새 migration이 이미 적용됐으므로 같은 DB에서 위 RED 명령을 다시 실행하면 GREEN이 나온다. 운영 DB, push, 배포는 변경하지 않았다.

## 리뷰 수정 3 보완: legacy/shadow 다중 쉼표의 기존 강의실 판별 유지

수정 3 직후 `legacy`/`shadow` 문자열 분기는 여전히 수정 2의 `split_part(..., ',', 2)`를 사용했다. 따라서 `(김, 민, 강의실 1)`에서 이전 SQL의 강의실 유사 토큰 `강의실 1` 대신 `민`을 강의실로 반환했다. 수정 3의 정규화 슬롯 우선 조회와 별개로 남은 같은 회귀다. 수정 커밋은 `d35beb38`이다. 새 CLI migration `supabase/migrations/20260923074255_timetable_legacy_ambiguous_room_parser.sql`은 최종 함수 정의에서 두 자원 분기에 있는 정확한 조건 두 곳만 guarded patch한다. 쉼표가 정확히 하나이면 두 자리 상세를 해석해 빈 위치와 literal 이름을 보존한다. 쉼표가 둘 이상이면 직전의 분류기 표현식으로 돌아가 강의실 유사 토큰을 찾는다. 이 방식이 쉼표를 포함한 legacy 교사 이름 전체를 복원하지는 않으며, 그 한계는 이전부터 존재했다. 정규화 수업은 그대로 슬롯 행을 권위로 읽는다. [패치 후 최종 함수 정의](./task-1-review3b-final-definition.sql)를 보존했다.

[SQL RED](./task-1-review3b-sql-red.tap)는 **58개 중 2개 실패**(legacy/shadow에서 `민` 반환). [migration 적용 출력](./task-1-review3b-migration.log) 후 [SQL GREEN](./task-1-review3b-sql-green.tap)은 **60/60**이다. 추가 두 검사는 legacy `(, )`가 요약값으로 fallback하지 않는 것과 `(교사 미지정, 강의실 미지정)`이 실제 이름 두 개로 남는 것이다. [기존 범위 SQL](./task-1-review3b-scope-green.tap)은 **12/12**. 이번 보완은 SQL 함수와 pgTAP만 바꿨으며 수정 3의 Node 테스트 결과가 적용된다. `git diff --check` 통과.

```sh
cd /Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard
# RED: 20260923073614 migration까지 적용하고 아래 follow-up은 아직 적용하지 않은 격리 DB
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
# GREEN 시작: 후속 migration을 격리 DB에 한 번 적용
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20260923074255_timetable_legacy_ambiguous_room_parser.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_continuous_class_scope_test.sql
```

현재 격리 DB에는 migration이 적용돼 동일한 DB에서 RED 단계를 다시 실행하면 GREEN이 나온다. 운영 DB 쓰기, push, 배포는 없다.

## 리뷰 수정 4: 활성화 후 남은 한 자리 시각과 정규화 슬롯 연결

기준 HEAD는 `d35beb38`이다. 최종 실제 시간표 함수의 `to_char(slot.start_time, 'HH24:MI') = matched.parts[2]` 비교는 활성화가 그대로 유지하는 `월 9:00-10:00 (...)` 원문을 `09:00` 슬롯과 연결하지 못했다. 원문을 수정하지 않고 시작·종료 비교 두 곳만 **유효한 시각 문자열에 대한 guarded `::time` 비교**로 바꿨다. 시작은 00:00 이상 24:00 미만, 종료는 24:00까지 허용하며, 정규화 슬롯의 기존 `start_time < end_time` CHECK와 함께 `0 <= start < end <= 1440`인 튜플만 연결한다. CASE 내부에서 분 범위와 시 범위를 검사하므로 `8:60`, `9:60`, `24:01`, `99:00`은 형변환 예외를 내거나 유효한 슬롯으로 정규화되지 않는다. minute 1033인 `17:13`과 minute 1440인 `24:00`도 반올림/날짜 넘김 없이 비교한다.

CLI로 생성한 새 파일은 `supabase/migrations/20260923075249_timetable_normalized_slot_time_matching.sql`이다. 기존 마이그레이션은 수정하지 않았다. 패치는 원래 두 줄이 정확히 한 번 존재하는지 검사하며, 예상 정의가 아니면 SQLSTATE `55000`으로 중단한다. [최종 함수·권한·슬롯 제약·RLS 증거](./task-1-review4-final-definition.sql)를 다시 조회했고 이전 실제 정의와 비교해 변경이 이 두 비교식뿐임을 자체 검토했다. SECURITY INVOKER, 빈 search_path, `postgres/service_role/authenticated` 실행 ACL, 활성화된 슬롯 RLS와 authenticated SELECT 정책이 유지된다. 문자열 자원 표현식, legacy/shadow 분류기, 쉼표 이름 처리, 명시적 빈 자원 권위에는 변경이 없다.

새 rollback-only `supabase/tests/timetable_normalized_time_matching_test.sql`은 활성화의 `shadow → normalized` 단일 필드 변경 후 남는 원문 상태를 fixture로 구성한다. 실제 activation RPC 전체를 재실행하는 테스트는 아니며, 합성 staff JWT 및 `SET LOCAL ROLE authenticated` 아래 **실제 시간표 RPC**를 호출한다. [RED](./task-1-review4-sql-red.tap)는 **22개 중 3개 실패**: `9:00` 시작, 시작·종료가 모두 한 자리인 `8:00–9:00`, `0:00–0:30`의 자원이 비었다. [migration 출력](./task-1-review4-migration.log) 후 [GREEN](./task-1-review4-sql-green.tap)은 **22/22**다. 정확한 분, 자정 종료, 다른 시작·종료·요일 튜플의 자원 차용 방지, 불법 시각의 비매칭, 빈 자원, 원문 철자, 클래스 전체 JSON·슬롯 전체 JSON·과거 회차 JSON 불변을 확인했다. 부정확한 기존 문자열 행 자체를 제거하는 정책 변경은 하지 않고 자원 연결만 교정한다.

기존 [mutation 안전성](./task-1-review4-safety-green.tap) **60/60**, [시간표 범위](./task-1-review4-scope-green.tap) **12/12**도 통과했다. 모든 원시 로그의 `not ok`/`ERROR` 부재, 정확한 `finish()` 계획, assertion 수와 `ROLLBACK`을 Python assertion으로 검사했다. RED도 `not ok` 3건과 `failed 3 tests of 22`를 검사했다. 최종 migration의 단일 조각 가드를 강화한 뒤에는 같은 DB의 rollback-only transaction에서 이전 최종 정의를 임시 복구하고 정확한 최종 migration body를 적용했다. [출력](./task-1-review4-final-migration-check.log)은 `BEGIN / CREATE FUNCTION / SET / SET / DO / ROLLBACK`이며 상시 DB 정의는 GREEN을 유지한다. 소스 SQL과 보고서의 `git diff --check`는 통과했다. 전체 staged 검사에서는 원시 psql 표 출력의 trailing whitespace가 보고되었으며, 증거 로그 원문을 유지하기 위해 이를 제거하지 않았다. SQL만 변경하여 Node 검사는 재실행하지 않았다.

재현 명령(기존 baseline + 105개 manifest + 앞선 5개 feature migration을 적용한 네트워크 없는 PostgreSQL 17.6.1.159 컨테이너):

```sh
cd /Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard
/Users/hyunjun/.npm/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration new timetable_normalized_slot_time_matching
# RED: 새 migration 적용 전
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_normalized_time_matching_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-1-review4-sql-red.tap 2>&1
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20260923075249_timetable_normalized_slot_time_matching.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-1-review4-migration.log 2>&1
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_normalized_time_matching_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-1-review4-sql-green.tap 2>&1
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_schedule_mutation_safety_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-1-review4-safety-green.tap 2>&1
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_continuous_class_scope_test.sql > .superpowers/sdd/2026-09-23-timetable-presets/task-1-review4-scope-green.tap 2>&1
```

현재 DB에는 이미 적용되어 새 migration을 다시 적용하면 정의 drift guard가 작동한다. RED 재현은 이전 migration 상태의 DB가 필요하다. 운영 DB 쓰기, push, 배포, 실제 전송은 하지 않았다. 브라우저와 Next fixture는 부모 작업 범위로 남겨 두었다.
