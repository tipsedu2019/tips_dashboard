# Task6 root manual browser observations

Observed against uncommitted Task6 work over05c0e487, synthetic localhost fixture only. CUA browser1/tab2, real dashboard + allowlisted RPC bridge→network-none tips_timetable_20260923. No production/provider operations. Root screenshots were inspected inline only, not saved PNG files. Implementer-owned PNG/JSON artifacts are separate evidence.

## Runtime
Original fixture session95896 stopped at implementer request. Next3261session94061 retained, replacementproxy3260/API3262 session90139. First oldtab1 attempt hit a stale local networkerror page after replacement; localHTTP health200 and documentedfresh-tab recovery succeeded. Currentroot CUA binding timetableTab is tab2. viewport override390×844,dark, currentdaily-classroom view, scrollnearTuesday09. Browserviewportcap binding timetableBaselineViewport. Resetoverride beforefinalhandoff.

## Actual UI and DB outcomes
- Selected2027 1학기 검토안, initial one item 중2 영어 새 수업 idae260000-0000-4000-8000-000000000501, Mon601/Wed602 (sameprefix).
- EditedMonday only17:13–18:13→09:10–10:10 in realdialog. Savedstatus. ActualSQLread revision2:Mon601 weekday1 start550/end610,Wed602 weekday3 start1033/end1093. Bothteacher101,room201. IDsunchanged.
- Switchedall4views, DOMrendereddata-plan-slot601/602stable. Weeklyteacherpanel101/daycolumns1,3; weeklyroompanel201/daycolumns1,3; dailyteacherpanels1,3/column101; dailyroompanels1,3/column201. Minuteproportionaltop10.6667px and525.867px on32px/30min grid, no rounding17:13.
- Initialrealdragfailed: handlecenter hit DIV.block-name; agentfixedhandlez10. RetestedactualelementFromPoint hits BUTTON with exactmovearia-label.
- FouractualCUA drags succeeded, sameY acrossresources: teacherweeklyMonKim101→Lee102; classroomweeklyroom201→202; dailyteacherLee102→Kim101; dailyclassroom202→201. EachcanonicalDOMupdatereflectstarget andpreservesotherresource/minutes. FinalSQL revision6 retainsMon601550–610 andWed6021033–1093, originalIDs; Wednesdayneverchanged.
- Created24시 종료 검증 viaformwithLee102/room202, Fri+Sat23:30–24:00, oneSave. DBrevision1 hasFriid14a75278-96ec-4229-a147-e98ad421d7b7 andSatid26864014-05bd-4397-af43-22f25a110712, bothstart1410/end1440. Reloadreselectretainsbothclassesandtimes.
- FormattemptMon15:13–16:13 rejectedbeforecommit with 고2 심화수학과 선생님 시간이 겹칩니다. Inputretained, Savefocus. Escapeopenssharedunsaveddialog; 계속 편집 returns15:13/16:13 andSavefocus.
- Sameformrecommendationwindow09–12,duration60:exact5buttonsMon09:00–10:00,09:05–10:05,09:10–10:10,09:15–10:15,09:20–10:20. Click09:10candidateclosesdialog,savedstatus,originalMon/Wedmaintained.
- 390×844:수업목록 opensSheet; itemtitlepickclosesSheet. OutsideTue09cell opensselecteditemform; no outsideSheetdragrequired. Correctedform09:00–10:00 thenSaveaddsTuesday. SQLrevision8:Mon601550–610,Tu8defbd70-233c-4fb0-99a1-80bd25fbcf49 540–600,Wed6021033–1093. AllpreviousIDsretained.
- Mobilemouseclick issue: clicking buttonlabel 화 본관1강09:00배치 initiallyprefilled09:15–09:45, becausepointerrange path ranonsimplecenter click. Reportedtoimplementer; notclaimedfixedyet. Thiswasmouseat390viewport, notactualtouchproof.
- Mobiledark theme: viewport390,document.scrollWidth375,no pageoverflow; internalhorizontalgridscrollvisible andpermitted. Dark shadowandnewblockvisualsinspected. Existingdesktoplightfirstviewalsoinspected.
- DisplayweekdayfirstSunday changedtoMondayfirst byagent, verifiedafterreload. StoredweekdaySunday0unchanged. Rootproposedautomaticaxisdefault thenwithdrew:approvedspecexplicitlysetsplanningdefault09–24; keepitanddocumentlimitedexception, operationalaxisremainsactual±30.

## Pending separate gates
Agentautomatic: actualtouchscroll/cancel/resize/palette-drop, remaining16viewport/theme/viewimages,60chartitle,emptycatalog/preset, actualimageexport. Task6 definitive-rejection recovery API fix and scopedreview stillpending. Task7transfer,Task9imports/2actors/capabilityfallback,liveRealtime/mainCI/prodmigration/deploy/actualoperatingpromotion are notprovedhere. Rootstoppedfixturemutations afterrevision8.

## Additional preset-management UI check
- On synthetic localhost fixture only, root created a separate empty preset `수동 관리 QA`, renamed it to `수동 관리 QA 수정`, then cloned it to `수동 관리 QA 수정 복사` through actual CUA UI actions. Clone's picker name verified; no existing main/automatic QA items changed.
- Archived the clone through the menu/dialog. Actual UI displayed `(보관됨)` and `보관됨 · 읽기 전용`, with add-class and grid-placement buttons disabled.
- Restored through the menu/dialog. Actual picker returned `수동 관리 QA 수정 복사` and add-class button isEnabled=true. These are UI checks; no claim of populated-clone ID/membership assertions here (covered separately by storage tests).
- Reset the temporary browser viewport override afterwards. No sharing/real-user access changes performed.

## Actual exported artifact inspection
- Root independently opened `docs/qa/timetable-presets-20260923/panel-export.png` with the image viewer (native artifact 3369×3369, display resized to1600×1600). Visible preset name, teacher-weekly view, output timestamp, Mon–Sun columns and complete09:00–24:00 axis verified. Synthetic draft and readonly shadow positions are visibly distinct. `panel-export.json` records the actual downloaded filename and499332byte size. This is actual export evidence, distinct from page screenshots.

## Fix-round1 whole-item editing — actual CUA + isolated DB
- Root used only separate `수동 관리 QA 수정 복사` preset. Created `전체 변경 검증` item e446fbd2-fa5b-4b4d-b244-96a997d896cd with Mon/Wed09:13–10:13, teacher101/room201, revision1.
- Slot IDs: Mon c49499af-12b5-4958-9f1c-75eb9fc503b0, Wed5ab32d96-5d55-407e-8ede-c6a35217bda4. Start553/end613 on both.
- Opened new `수업 전체 편집`: existingMon/Wed were preselected, resource/day/time controls disabled until matching whole-change checkbox. Checked only `전체 담당 변경`, selectedLee102, saved once. DBrevision2 retained both IDs, days1/3, start553/end613 androom201; only bothteachers became102.
- Reopened and checked only `전체 요일 변경`, removedMon/Wed andselectedTue/Thu, saved once. DBrevision3 retained bothIDs/start553/end613/teacher102/room201; days became2/4 respectively. No extra Mon/Wedslots persisted.
- Root found the four new scopecheckboxes initially lacked accessible names in AX. Implementer connected sharedFormControl/aria-label; afterreload rootverified exactAXDescriptions `전체 담당 변경`, `전체 강의실 변경`, `전체 요일 변경`, `전체 시각 변경`, with currentTue/Thu andLee retained.
- Closed untouched form and reset temporaryviewport override. Main2027fixture and automaticQA records untouched. InitialreadonlySQL used an incorrectteacher_id column, failedwithoutwrites; information_schema established teacher_catalog_id/classroom_catalog_id and correctedqueries produced the results above.
