# Task 8 independent review 1 — fffe462c
Reviewer: /root/review_timetable_concurrency, gpt-6-astra high. Base36989ac5.
Spec compliance: FAIL. Task quality: Needs fixes.
No Critical. One Important, one Minor.

## Important: cancellation suppression cleared before physical release after refresh
src/features/academic/timetable-plan-workspace.tsx:107 removes the pending release listener and resets suppressClick whenever snapshot changes. Escape cancels a held gesture; replacing snapshot then permits the original handle generated click to open editor on physical release.
Actual existing release build, synthetic list/get/revision responses, loopback only, mutation/external requests blocked:
- Escape → release: dialogs0→0; preview0; mutations0; external0.
- Escape → keyboard 새로고침 → release: dialogs0→1; preview0; mutations0; external0.
Preserve canceled pointer suppression until matching physical release across snapshot replacement. Snapshot updates may still cancel active drag/clearpreview. Add combined regression.

## Minor: unsupported product-handler timing
scripts/qa/timetable-performance-browser.mjs:19 registers window pointermove timing end before mouse.down. Product listener is registered during pointerdown (workspace.tsx:257), so end runs BEFORE product handler. pointerHandlerP95Ms excludes actual productwork; handlerEndToReactCommitP95Ms includes omittedwork. Correct endpoint registration afterproducthandler or remove/relabel unsupportedmetrics. Independent frame/wholegesture measurements remain valid.

## Strengths/checks
Actual persistent independentconnections observe B advisorywait/blocker before Acommit and check finaloverlap (verify-timetable-concurrency.mjs:59,131).
Ordered migrationcomparison sixmakeupdefinitions changes only11domainSQLSTATEliterals plusauthorizedapprove/cancel5GUCcontextwrappers (20260923131454:173); all8finalsourcehashes matchprovenance.
Ordered fullhistoryaggregate and perdatekeymultiplicity/increasedoccupancy retain completeeffective-day semantics (20260923134651:9,79).
Nonemptyhistory fullrowJSON fourtransfers; providerspyseparatequeue (no_send_test.sql:36,release-contract.test.mjs:12).
Read supplied270KBdiffonceinpasses, recoveredtruncatedpointerhunks. Outsidechecks namedrisks: effective_date/occupancy_key/intersects helper finaldefinitions20260923085008:114–131; existing5GUChelper20260728233510:94; finalpublicwrapper20260923085008:742; ACL20260721131903:782; ordered8definitions/hashes; unchangedgridhandleonClick:timetable-plan-grid.jsx:21.
Existinglogs parsed25SQLSTATE+12guard+135operational(5+5+125)+132history withno notok/ERROR/warnings; finalconsumer44pass0fail. No passedsuitererun.

## Focused probe procedure
InstalledNode --input-type=module with bundledPlaywright createRequire; timetablePerformanceFixture(1,1), Chromium1440x1200/reducedmotion, loopbackonly, intercepted list/get/revision, blockedmutate/commit/external/WebSockets. Enter/__fixture, choosefixtureplan, actualdata-plan-handle pointerdown/move5px/Escape, wait100ms. Insecondcase keyboardEnter on새로고침 andawaitget_timetable_plan_v1 response+100ms. Originalpointerup; countdialog/preview/requests. Firstsandboxbrowserlaunchfailedbeforestartup, approvedescalatedexecutionpassed. Browser/contextclosed; no source/index/HEAD/branch/DBmutation.

## Evidence boundaries
Cap33.6–33.7ms remains explicitlyunmet32mstarget, rootacceptedobservation, notPASS. Historicalnotification wholesuites failed/incomplete underrecordedfixture/ACLlimits. Task9imports/reload/capability/twoactor/finalbuild/manifest/exporttitlework outside review.
