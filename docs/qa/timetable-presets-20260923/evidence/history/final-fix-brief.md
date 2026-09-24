# One consolidated final fix wave

Read final-review-1.md FIRST: its I1-I6 text is the full requirements/failure evidence. Base75585a5f4bbb266af7c9ac38147b3eb4c0a39371, branchcodex/timetable-presets-20260923. Approved user scope is local implementation; never production, push, deployment, real operating promotion or sends. No subagents; one implementer owns all changes.

Implement I1-I6 and MinorM2 together, without broad refactoring or extra feature expansion. Preserve all exact invariants in review-global-constraints.md and approvedspec. Original immutable submitted request must reach server receipt/currentauth before local CAS. Unknown deletion must remain replayable; confirmed stale/deletion/capacity must have usable rendered recovery actions. Pending/confirmed/applied boundaries and current no-history/no-send remain. Preserve explicit empty comma sides while restoring historical teacher-only fallback. Preserve only supported original schedule text/placement fields for importrepair, never entire legacy entry or students/status/unknown properties.

## Required acceptance and scope

- I1: existing AND new item editor explicitexpectedrevision -> commit response loss -> refresh/reload -> exact originalbody/key replay -> single committed result, pending queue settles and later local input preserved. Confirm unchanged known stale and receipt-superseded/currentauth semantics.
- I2: rendered recovery for stale delete and confirmed rejection, plus successful-but-lost delete originalreceipt; tests must see usable acceptserver/reapplydelete or definite discard controls despite optimistic item removal. No discard of unknown outcomes. Preserve surrounding items/queues.
- I3: exact22023/timetable_capacity treated definite, Korean message, correction/discard. Cover501stitem and>2000slots rejected paths; ambiguous code/message pairs remain uncertain. PreventiveUIcheck optional, not replacement forserverchecks.
- I4: teacheronly/classroomonly/fullpair/explicitblankteacher/explicitblankroom/dayfallback/slash historicalforms. Check management editor parseddata boundary as well as pureformatting.
- I5: supportedlegacy punctuation includingendash preservesweekday/exactminutes, genuinelymalformedtime safelyretainsoriginalsource forpreview+commit+pendingrepairdisplay. Keep oldunknownproperty/student/statusprivacy assertions. Finalordered SQL definition andactualpgTAP required, no source-regex-only claim.
- I6: retain everyoriginal19class-schedule-draft-navigation behavior and update harness to actual guardedRPC + p_patch. No skip/remove/weaken. Truefeaturebase19PASS evidence isalreadyretained; do notlabelbranch4FAILpreexisting.
- M2: candidate date unbroken at390dark andlonglabels, withinsharedcontrols. No globalstylefork.

M1 syntheticbuild403 output remainsanexplicitdocumentedlimitation; no credentials/publiccontrolplanechanges tosilenceit. M3capperformance32mstargetremainsunmet33.6msunderexistingRuling; no newperformancework. Finalreview consideredaside17same-revisionautomaticselfhealing and18expandedappliedsnapshotdetails aredeferred; existingexplicitrefresh andstoredsummary retained.

## Implementation and verification

Read repositoryAGENTS/DESIGN/tips-quality andrelevantsharedcomponents. FinalSQLcomesfromorderedmigrationchain. PreferadditiveCLI-generatedmigrationforimportfix ratherthan rewritinghistoricalfeaturemigrations; updatecurrentmanifesthashes andfinalprovenance. No backfill/datarewrite. ExistingnetworknoneDBtips_timetable_20260923/manual3fixtures mustneverbereset. Replaycontainer tips_timetable_20260923_replay alsoexists: ifcleanreplayneeded, useanewuniquename andexplicitparameters to existingQA scripts, neverstop/removetheexistingones. Newcatalog/schemaonlytests mayapplynewmigrationtoexistingisolatedDBincoordination, recordingstate. Preservemanualfixtures.

UsemeaningfulfocusedRED/GREEN, relevantregressiongate including19lifecycle tests andnewtimetable tests, fulltsc/touchedlint/releasebuild. PriorcurrentCIshared63passes; repeatonlyifsharedcontractchanged. Run coveringimportpgTAP andexactfinalSQL/hashes. A finalcleanreplayandfulltimetableSQLcanbe justifiedbytheadditivemigration; no repeatedactual10races unlesslock/operationalguardchanges requireit. Actualsafe localbrowser losteditorresponse/reload andstale-deletecontrolsrequired; nativeexistingreceipt/dirtyguardbehaviorpreserved. M2same390viewportproof. Do notclaim oldwhole notification suitespass.

RuntimeatlastTask9handoff: proxyAPI PID51424/session83624 ports3260/3262; releaseNext PID51931/session62682 port3261, ownedbypriorimplementerandmayhaveended. Verifylsof/currentcommandsbeforeuse/stop; rootownsnone. Safeenvbuildusesenv-i loopbackSupabase3262/fixture-onlyanon, noprodenvfiles. ExistingQA scriptsuse bundledPlaywright cachedChromium, noinstall. Docker /Users/hyunjun/.local/bin/docker; Node /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node. SupabaseCLI /Users/hyunjun/.npm/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase.

## Report/handoff

Write .superpowers/sdd/2026-09-23-timetable-presets/final-fix-report.md withI1-I6/M2 per-finding changes, exactcommands/results/RED/GREEN/limitations, commits/runtimeownership. DurableQA REPORT/runbook/evidenceandhistorymustreflectfinalstatewithout erasinghistoricallimits orfailedcomparisons. Preservefinal-review-1 andlatesttask9rereview/ledger incommittedhistory. Do notforceaddscratch. Commitslocalonly. ReturnshortDONE/CONCERNS/HEAD/tests. Thisisoneconsolidatedwave; independent scopedrereviewcomesfromrootafteryourreport. Doallnecessaryself-reviewwithintheonewave; rootdoesnotfixproductcode.
