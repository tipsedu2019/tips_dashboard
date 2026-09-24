# Task5 review1 — review_timetable_controller
Base609cb7e7..2046d4e1. Spec compliance FAIL; taskquality Needs fixes.

## Important findings (reviewer text)
1. **An older successful receipt resurrects an item deleted in a newer authoritative snapshot.** timetable-plan-model.ts:100–108.
mergeReceipt accepts result.item whenever it is absent from the current snapshot, without comparing the receipt sequence in that branch. Reproduction: submit item revision2; refresh authoritative sequence3 snapshot where collaborator deleted item; then deliver sequence2 save receipt. Focused probe: {"seq":3,"items":["i"],"state":"saved"}. Controller reports a saved item the server deleted. Prevent old receipts reintroducing items missing from newer snapshots while preserving valid out-of-order saves on independent existing items. Add deletion/receipt ordering case.

2. **Effect cleanup permanently destroys the memoized controller subsequently reused by effect setup.** use-timetable-plan.ts:18–23,25–39; timetable-plan-model.ts:203–207,415.
Hook creates controller with useMemo, but effectcleanup calls destroy(), permanently setting disposed=true. React StrictMode setup→cleanup→setup reuses controller; subsequent reads discarded and queues cannotrun. Focused lifecycle reproduction returned snapshot:null after second load. Make controller ownership compatible with effectrestart, ensuring each active subscription/load uses livecontroller and retiredinstances stayisolated. Add actualhook lifecycle test; existing purecontroller tests neverexercise effectreplay. Browser reproduction notperformed.

3. **A signal confirming the user's own first save falsely blocks the next queued edit.** timetable-plan-model.ts:223–225,280–284.
Queue A→B; before A RPCresponse, signalrefresh sees A committed revision2. refresh compares with A submitted revision1 and marksitemstale. When A matching successfulreceipt arrives, B remainsqueued so staleflag retained and runQueue stops. Probe {"rpcCount":1,"state":"stale","dirty":true}. B never submits and originaldispatchpromise remains pending. Reconcile confirmedreceipt with latest authoritativeitem before deciding remainingintent genuinelystale. Preserve protection against oldreceipt followed by collaborator newerrevision.

4. **Logout cleanup removes only active plan's recovery key.** use-timetable-plan.ts:34–37; timetable-plan-model.ts:173–177,415.
SwitchP1→P2 destroysP1 controller and intentionally retainsP1 recovery. LogoutP2 clears onlyP2, leaving sensitiveP1 draft. Probe retained tips:timetable:draft:v1:actor:p1. Actor namespace prevents crossactor display but not explicitlogoutdeletion. Provide actor-wide recovery cleanup tied to auth lifecycle, including previouslyunmountedcontrollers. Ordinary sameactor planswitch staysrecoverable.

5. **Transfer validation accepts incomplete metadata/reference and labels mixed old/new snapshot verified.** timetable-plan-service.ts:59–74; timetable-plan-model.ts:386–411.
Delta validator requires only sourceplanID/sequence plus weeklyshadowarrays/fingerprint. MissingmetaRevision, planstate, catalogs, asOfDate, datedoccupancy and completeness passes. FocusedcommitTransfer accepted suchresponse. applyTransfer replaces entireplan with incomplete metadata and overlays incompletereference atop previoussnapshot, retainingolddateddata undernewfingerprint while referenceStatus verified. Validatecomplete source metadata/operatingreference, relevant elementshapes and responseconsistency. Add malformed-delta test alongside missing-label test. Task5 service/mergeissue, doesnot requireTask7 backend.

## Minor
Successfulundo test tests/timetable-plan-controller.node.ts:23 doesnot exerciseundo(). It manuallydispatches edit600, proving onlyanother save. Callc.undo() and assertrestored fields/slots andnewrequestkey. Collaborator-rejectiontest doesexerciseundo.

## Strengths/evidence/checks
Submittedkey/body preserved in ambiguousretry/recovery; separatelocaldraft; independentqueues andexplicitreapply; epochtimeguards; undorevision; minimal signals and20secvisiblepoll/focus. Retained41/41 logwarningfree, emptylint/tsc checked, no suitesrerun.
Full720lineprovided diffreadonce. Focusedinmemoryprobes forfivefindings only; unchanged authprovider inspected foridentity/loading, conflicts helper forcompleteness. No file/index/HEAD/DB/browser/provider mutations.

## Cannotverify / latergates
Task7 backend auth/locks/idempotency/SQLSTATE/transfer; Task6 navigation/browserpresentation; actualRealtime; productionmigration/deploy. Services callactualfutureRPCnames andactivate no transferUI.
