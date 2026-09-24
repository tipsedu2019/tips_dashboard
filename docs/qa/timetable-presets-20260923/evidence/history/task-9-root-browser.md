# Task9 root manual UI observations
Observed against in-progress Task9 over ed3e7a31, default Codex in-app browser viewport. Tab3 viahttp://127.0.0.1:3260/__fixture, syntheticmanager. Task9-owned localNext/strictfixtureproxy and isolatedDB only. Root performed READ/PREVIEW only, noimportcommit orotherDBmutation, nofaultinjection. Temporarytab3closedafterchecking.

- Operating timetable stillrenderedwithexistingfourviews,status/subject/resourcecontrols andthreeusualsyntheticteacherpanels.
- Existing초안가져오기 opens shared새프리셋으로가져오기 dialog. Initialfocus is새프리셋이름. Preparation source lists Task9준비A/B with accessiblecheckboxnames.
- Selectedboth, clicked선택한원본확인. Previewshows eachname+oneplacement. Thisisreadpreview, notasave.
- Changedsource to이전시간표초안. Fourdistinctcandidates preserved forclassroom-weekly/daily-classroom/daily-teacher/teacher-weekly, each1entryand2026-09-23. Foundrawinternalkeylabels planner:term:task9:영어:<surface>; reportedtoimplementerforhuman-friendlysubject/view/period/date/count labels withstableinternalidentity.
- Selectedteacher-weekly andpreviewed. UIshowedTask9옛수업·배치3개; no student/status/unknownprivatepayload inrenderedpreview. ReadonlySQLprivacyproof isseparateautomated28assertions, notinferredfromscreenshot.
- Actualscreenshotinspectedinline: existingsharedDialog/Input/Select/Button surface/layout, mainoperatingboardvisiblebehind; noimagefilewasretainedbyroot.
- Clicked취소 withoutnameorcommit. Returnedto운영시간표. AXfocusreportwasWebArea, sofocusedreadonlyDOMinspectionconfirmed document.activeElement isBUTTON text기존초안가져오기 (actualopenerfocusrestored). Nofocusdefect.
- Closedownvalidlocaltab3usingnormalclose. Priorstaleerrorpage tabs1/2wereuntouched.

Pending: implementerlegacylabelcorrection; completeactualtwoactor/importfault-browser/finalbuild/QA artifacts andtaskreview. Theseobservationsdonotproveproductionauth, providerRealtime, deploymentoractualoldsaveddatarecovery.

## Later artifact inspection
Rootopenedtask9-offscreen-export.png(actual3369square,toolresized1600)andtask9-import-desktop.png. Exportfull09–24axis/stamp/100slots retained; two-lane30mintitlesareonecompleteline, formerhalfsecondlinegone. Longtitlesremainintentionallytruncated; notclaimingfullnamesfit. JSONrecordsdevelopmentwebpackmode/forcedfullrendering/mutations0/provider0. Browser9checks andcleanSQL11suites657pass artifactsparsedseparately. Thisisartifactinspection, notanotherrootbrowserimportcommit.
