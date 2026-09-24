# Task6 fix round1 scoped rereview — review_timetable_ui
BASEbddfcdc4 HEADc4f47281. Spec FAIL; taskquality Needsfixes.

## Prior findings
1. Unknown create/clone duplicateintent ADDRESSED (picker43,76,137): immutable submittedcommand separatefromeditedinput; close/reopenpreserves; actualDB4casesone record; receipt→separaterename.
2. Late actor/dialogcallback ADDRESSED (picker51,82,tests66): serviceownership/operationepoch/mounted andabortshare. Success/failure/actorchange/dialogreplacement tests.
3. Wholeitem weekday/teacher ADDRESSED (interaction188,204): explicititem/slot/add scopes, existingdays, opt-inwholefields, differingvalues/IDs preserved, actualrootCUA/DBmatches.
4. LongJSX/inlinehandlers ADDRESSED (placementeditor68): touchedform/pickerreadablegroups; untouchedworkspace neednotrestructure.
5. discardRejectedsuccesscoverage ADDRESSED (controller.node.ts45): onlyheadremoved, laterqueue/independentitem/promisecompletion/dirtyclear asserted.

## New Important — reviewer wording
**공유 요청 복구가 후속 권한 입력을 버립니다.**
`src/features/academic/timetable-plan-picker.tsx:143`
변경 비교에는 `name/start/end`만 있고 `members`는 없습니다. 또한 후속 입력을 유지하는 분기는 create/clone/rename에만 적용됩니다.
재현 경로:
1. 선생님에게 `보기` 권한을 저장하고 응답을 잃습니다.
2. 유지된 폼에서 해당 권한을 `편집`으로 바꿉니다.
3. `원래 요청 재시도`가 원래의 `보기` 명령을 회수합니다.
4. 대화상자가 닫히며 후속 `편집` 입력이 사라집니다.
실제 수정된 컴포넌트를 사용하는 focused JSDOM probe 결과:
```
identicalRetry: true
submittedMembers: [{ userId: "teacher", access: "viewer" }]
dialogRemainsOpen: false
calls: 2
```
원래 요청을 그대로 재시도하는 것은 맞습니다. 회수 후에는 변경된 members를 유지하고, 반환된 metadata revision을 사용하는 별도 share 저장을 제공해야 합니다. `보기→편집`뿐 아니라 권한 철회 후속 입력도 검증하십시오. DB나 파일은 변경하지 않았습니다.

## New Minor — reviewer wording
**확정 거절 분류의 근거 설명이 최종 SQL 정의와 다릅니다.**
`src/features/academic/timetable-plan-picker.tsx:16`, `task-6-report.md:83`
보고서는 storage migration이 최종 정의이며 모든 해당 거절이 receipt 조회 이후라고 설명하지만, `supabase/migrations/20260923085008_timetable_operational_conflict_guards.sql:2712`에 후속 재정의가 있습니다. 이 정의는 receipt 조회 전에도 부분 날짜 입력을 `22023/timetable_invalid`로 거절합니다.
확인한 경로에서 분류 자체의 새 오류는 발견하지 않았습니다. 코드 주석과 보고서의 근거를 실제 최종 정의에 맞게 정정해야 합니다.

## Out-of-scope observation
Picker43 metadata unknowncommand memoryonly, fullpagereload/remount recovery unsupported. Priorclose/reopenfindingresolved; Task6brief doesn't explicitly requiremetadatareload, notnewblocker. Finalreviewmustrelate specsection7sessionStorage tothisboundary; don'tclaim allrecoverycomplete.

## Checks
Readfixpackage/report/rootactualrecords; retained62/62focused and4/4actualDBreceipt,emptytsc/lintlogs. No repeatedsuites. OnefocusedactualcomponentJSDOMprobe replacedsharedSelectboundaryonly forshareinputloss, noDB/twoactorproof. NarrowfinalorderedSQLdefinitionreadforclassificationclaim, noSQLwrites/tests. Original16matrix/pointer/PNGnotrelabelednewfixcoverage. No source/index/HEAD/branch/DBmutation.
