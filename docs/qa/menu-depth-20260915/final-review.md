# Final menu-depth SPEC + QUALITY review

Reviewed 2026-09-15. Scope: the complete product diff `fd1f52ae..42567d74`, including the first independent review of calendar commit `6a9cfcab`. Product files were read only. No build, server restart, real data write, external provider action, or deployment was performed by this reviewer.

## Verdict

- Task 3 SPEC: **APPROVED** after the scoped re-review of `bae83ea9`; range/data acceptance and native list-detail access meet the accepted A1/A2 scope.
- Task 3 QUALITY: **APPROVED WITH LIMITS**. The reproduced focus-lifetime P2 is resolved; no outstanding actionable finding remains.
- Whole branch: **APPROVED WITH LIMITS** for the complete reviewed product diff plus `bae83ea9`. No additional actionable introduced bug was found in the other scoped changes. Previous independent approvals and their explicit limits remain valid.
- Final TypeScript/build results belong to root integration and are not inferred from this review.

## Resolved P2 — Replace an obsolete detail opener when starting a new event form

Location: `src/app/admin/calendar/components/calendar.tsx:420-424`; origin and missing reset at `308-310`, `277-305`.

`handleEditEvent` captures the focused event before its asynchronous exact-detail request. If that request fails, or a new-event action invalidates it before completion, `detailTriggerRef` remains populated. `handleNewEvent` and `handleNewEventRange` start a separate EventForm session without replacing that reference. The close callback then prevents default focus handling and focuses the old event, even though the user opened the new form from a different action.

Independently reproduced by loading the real Calendar TSX with the bounded child stubs from `tests/academic-calendar-range-interaction.test.mjs`. Focus event A; invoke its detail handler; reject the synthetic detail promise; focus a connected new-event opener; invoke the actual sidebar new-event callback; invoke the actual form close-focus callback. The diagnostic recorded:

```json
{"scenario":"failed detail then new event close","expectedOpener":"New event opener","actualFocus":"detail","forcedOldFocus":true}
```

The single mounted diagnostic passed its defect assertions. It ran from an in-memory adaptation of the existing test: no product/test file changed, no real network, and no browser execution. This is source-plus-mounted-DOM evidence, not a full native dialog/browser reproduction.

Minimal correction: establish a fresh opener for each explicit new-form session, including range creation, or explicitly clear the detail opener when the new session should use default restoration. Preserve the original event opener during a retry of the same failed detail. Restore only an eligible connected, visible, enabled same-route target. Add a focused regression for failed detail → new event → close, and retain successful detail retry → original opener coverage.

### Scoped re-review of `bae83ea9`

Resolved by `bae83ea9b9c34c46084b2e7178cc10758e3e740b`. Independently inspected only this correction, its expanded existing mounted test, the relevant Calendar callbacks and the supplied before/after/lint logs; no already-passed test was rerun. Current Calendar and test files match that commit, and `git diff --check bae83ea9^..bae83ea9` passes.

Pending exact-detail opener state is now separate from the active form session. New single-date and range forms explicitly capture their own opener after invalidating pending detail. A current successful exact-detail response promotes its retained original opener into the form session. Same-detail retry retains the original opener, while navigation and new-form invalidation clear only the obsolete pending state. The existing request revision check still prevents a late response from replacing a new form. Active form closure consumes its own reference and leaves default restoration intact for disconnected, hidden, inert, disabled, zero-layout or changed-URL targets.

The expanded regression fails against the pre-fix source specifically at `failed detail then new must restore its own opener` (`/tmp/tips-calendar-focus-before.log`), then passes on the fix (`/tmp/tips-calendar-focus-after.log`: 52/52). Its mounted cases cover failed and pending detail → new and range forms, late response rejection, detail retry → original opener, and target eligibility guards. `/tmp/tips-calendar-focus-lint.log` is empty as reported for the successful lint run; no error or warning is recorded. These checks address the original finding and its immediate dependencies without changing range navigation, service calls, mutation behavior or the annual-board caller.

This resolution is based on reviewed source and mounted regression evidence. Root's rebuilt-app browser checks for the added failure/new/retry paths and final production build are separate integration gates and were still in progress at this re-review; they are not claimed as completed here.

## Task 3 review evidence

- Read the repository AGENTS.md, DESIGN.md, tips-quality routing skill, installed shadcn mechanics, plan globals, Task 3 audit/report, actual route/controller/main/sidebar/date-picker/EventForm callers, shared range hook, and new mounted tests. Consulted the pinned [official interface guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) for native semantics and focus mechanics; repository behavior contracts govern.
- `successfulRequest` and response rows come from the same accepted hook state. Request fingerprints, actor/service identity, and revision checks reject obsolete results. Failed month requests keep the accepted month/list/sidebar state and expose a same-request `refresh()` path. Requested navigation accumulates separately from the accepted header.
- Seven-day detection uses the accepted request, so returning to a monthly request does not remove the accepted seven-day agenda while loading or failing. The ordinary month path resumes only after acceptance. The separate seven-day UI labels the accepted dates; it does not depend on the inferred monthly display date.
- CalendarMain keeps its prior uncontrolled date behavior when optional navigation is absent. DatePicker optional month props leave the existing uncontrolled mode available. The annual-board EventForm caller omits the new optional callback and retains its existing behavior. Navigation and ordinary date selection invalidate pending exact detail; mutation, auth and service functions are unchanged.
- List titles are named native buttons; annual-board links remain separate. Enter/Space use the existing exact-detail handler. Existing successful-detail dismissal is supported by supplied browser assertions; the failure-to-new-session lifetime gap above is outside those assertions.
- Read `/tmp/tips-calendar-after.mjs`, its log and the Task 3 evidence manifest/report. Supplied actual development-route runs pass at 1440 and 390, including month failure/retry, reverse responses, month/list, seven-day recovery and month retry, with zero recorded undefined requests/runtime errors. No supplied suite was rerun.
- Independently viewed `academic-calendar-1440-after-keyboard-focus.png`, `academic-calendar-390-after-error.png`, and `academic-calendar-390-after-seven-day-retained.png`. The successful-detail focus ring, accepted September list with failed October range, and retained seven-day date labels are visible. These are supplied development-server fixtures, not production-build or device evidence.
- `git diff --check fd1f52ae..42567d74` passes.

## Whole-branch integration

- Dashboard link kinds still match the registration calendar route consumer; no new API or business computation was added.
- Persistent statistics panels retain the actual nested roster component tree while hidden. Query/viewer keys and abort-on-unmount still isolate a changed scope. The previous nested-roster finding is resolved; no broad performance claim follows from avoided repeated reads.
- WorkspaceTabs reveal changes only the tab strip scroll position. Management required-field checks precede writes and preserve the existing conditional science-area field and draft/save logic.
- Ops search reset keeps the actual input mounted during zero-result reload. Form opener capture and safe restoration remain scoped to the existing normal-form session; legacy registration/detail-entry limitations from its independent review remain unclaimed.
- School add clears the active search, prepends a row in the selected category and focuses the visible name input. CMS editor/review close uses the shared draft guard, retains failed drafts and bypasses confirmation after successful apply. Backend/auth/API/public ownership boundaries are unchanged.
- Read `root-review.md`, `task-2-review.md`, and `task-4-review.md`, including their resolved findings, source-only pathways, development manifest limits and untested branches. Their evidence is not presented as independently rerun here.
- The draft `docs/qa/menu-depth-20260915/REPORT.md` separates executed menu paths, incomplete branches, synthetic versus real writes, performance measurements and release status. No material overclaim was found. Its pending final-build/integration section must remain pending until those checks finish; the final calendar verdict can now cite the resolved P2 and its scoped re-review.

## Limits

This review is scoped to the current-turn diff, not a fresh exhaustive audit of every preexisting menu behavior. The new diagnostic covers only the identified focus lifetime; supplied calendar tests use child stubs, and supplied browser fixtures use one long event plus an empty seven-day recovery (the mounted range test has nonempty seven-day data). Source review does not prove real saves/readback, auth transitions, dense-volume performance, drag/drop writes, exports, all dirty-draft branches, production behavior, provider/send outcomes, or deployment. Existing academic and other menu audit limitations remain in force.
