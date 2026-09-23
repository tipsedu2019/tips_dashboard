# Task4 review1 — review_operational_guards
Base6abe3b39..e1240a77. Spec compliance: FAIL. Task quality: Needs fixes.

## Important findings (reviewer text)

1. **정규화된 반의 일괄 수정이 항상 gateway 검증에 걸립니다.**
management-service.js:1710에서 `scheduleOwnership: "normalized"`가 있어야 schedule/teacher/room을 제거합니다. 하지만 실제 management-page.tsx:2790 일괄 수정 호출은 이 옵션을 전달하지 않습니다. `compact()`는 기존 row 값을 합치므로 status 및 일정 필드가 payload에 들어가고, gateway는 normalized 반에서 해당 키가 존재하기만 해도 `22023/class_schedule_validation`을 반환합니다. migration20260923085008:2642.
영향: 정상적인 일괄 상태 변경과 메타데이터 수정이 막힙니다. bulk consumer도 각 행의 authoritative storage mode를 확인하고 schedule-owned 필드를 제외해야 합니다. 기존 tests/management-continuous-class-schedule.test.mjs:124는 payload builder만, 신규 tests/timetable-operational-service.test.mjs:53는 일반 단건 호출만 확인합니다. 실제 normalized bulk payload의 상태 변경·메타데이터 변경을 검증하는 회귀 테스트가 필요합니다.

2. **날짜를 아는 레거시 미해결 회차까지 날짜 미상으로 만들어 무관한 기간을 차단합니다.**
reader는 날짜를 먼저 파싱하지만, 뒤에서 자원 누락이나 잘못된 시간이 발견되면 catch에서 항상 `date:null`을 반환합니다. migration:77,87.
영향: 날짜가 확정된 과거 회차 하나의 teacher/room 누락도 모든 미래 기간의 completeness를 false로 만들고 새 운영 점유를 차단합니다. 날짜는 독립적으로 파싱하여 보존하고, 날짜 자체를 확정할 수 없을 때만 null을 사용해야 합니다. 알려진 과거 날짜, 기간 안·밖 날짜, 실제 날짜 미상의 blocker를 구분하는 테스트가 필요합니다.

3. **레거시 초 단위 시간을 조용히 절삭하여 실제 겹침을 놓칠 수 있습니다.**
migration:78는 time을 `extract(epoch)::int / 60`으로 변환하면서 초 단위를 검증하지 않습니다. 같은 reader의 normalized 경로에는 초 단위 검사가 있지만 레거시 경로에는 없습니다.
영향: `09:00:00–10:00:30` 회차를 `540–600`으로 판단해 10:00부터 시작하는 같은 자원의 수업과30초 겹침을 놓칩니다. 이는 정수 분 canonical 및 불완전 파싱 fail-closed 요구에 어긋납니다. 원본을 유지하고 초·소수초가 있는 회차는 `확인 필요` blocker로 반환해야 합니다. 읽기 전용 SQL 확인에서 `10:00:30`이 실제로 `600`분으로 변환되었습니다.

4. **malformed 레거시 session 원소는 blocker가 아니라 전체 조회 실패를 일으킵니다.**
migration:75의 `v - array[...]`는 보호용 `BEGIN … EXCEPTION` 밖에 있습니다. 따라서 `sessions:[null]`이나 scalar 원소를 만나면 `cannot delete from scalar`가 발생합니다. catch 안의 fingerprint 계산에도 같은 식이 있습니다.
영향: 기존 malformed 행 하나로 운영 참조·프리셋 조회 및 baseline을 읽는 운영 쓰기가 모두 실패할 수 있습니다. 먼저 `jsonb_typeof(v)='object'`를 검사하고, 비객체 원소는 안전하게 fingerprint한 미해결 blocker로 반환해야 합니다. null/string/number 원소에 대한 회귀 테스트가 필요합니다. 해당 JSON subtraction의 오류는 읽기 전용 SQL로 확인했습니다.

## Minor
제출 Task1 회귀로그 task-4-task1-regression.log:2에 NOTICE: extension pgtap already exists, skipping. 제품 오류는 아니지만 pristine output 기준에 맞지 않음.

## Strengths / checks
Private txbaseline/deferred constraint finalguard covers direct DML and zero-row/immediate/rollback. Changed occupancy keys include coordinates/resources/date. Outer makeup locks before permission/row locks. RR writes exact25001. Retry receipt/cache pending separate.
Full diff read, cut-off hunks only reread.43 installed function bodies exactly match migration; owner/search_path/privateACL checked. SQL88+60+73+24 and Node47 logs checked, not rerun. Concrete lock-order callsites/create/no preinsertrowlock, ops-task roster/textbook writes, bulk compact+payload builder+caller checked. Read-only DB SELECT results600|30.000000 and cannot delete from scalar.

## Cannot verify / later gates
Task8 actual two-connection races; Task9 browser error recovery; actualRealtime websocket/provider delivery; productionmigration/deploy. Keep operating transfer stopgate until later verification.
