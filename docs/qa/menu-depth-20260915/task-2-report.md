# Task 2 — internal operation menus

Status: DONE_WITH_CONCERNS. Product changes committed as `cd39dcc1` and`bc02ece6` (only `src/features/tasks/ops-task-workspace.tsx`). Root subsequently authorized the remaining todo search remount repair; final commit and evidence are recorded below.

## Confirmed repair

- Transfer, withdrawal, word retest and todo create dialogs closed with Escape but lost their opener focus. Fresh before captures: `/tmp/tips-menu-review-20260915/ops/forms/manifest.json`, `closed:true`, `focusRestored:false` at 1440×900 and390×844. Registration's separate application host returned focus correctly.
- Capture the form opener before asynchronous option loading or input autofocus in create/edit/retry entry points. The normal form dialog restores only a connected, enabled, visible opener on the same pathname. Shared dialog primitives, auth, service writes and calculations are untouched.
- Search clear moved focus to body because the clear button disappears. The handler now focuses its associated search input. Registration and word-retest retained-input scenarios pass in fresh after evidence.
- A further current-run check found the todo search input unmounted while a zero-result server page was being cleared. Todo now keeps its search control mounted, including initial empty and restored loading states. The delayed recovery check verifies focus during and after reload.

## Source and test verification

Read AGENTS.md, DESIGN.md, `.agents/skills/tips-quality/SKILL.md`, `docs/agents/domain.md`, current routes and owners, current option services and fixture runtime. CONTEXT.md/ADRs absent. Applied the installed shadcn mechanics guidance to existing components only.

`node --test tests/ops-task-workspace.test.mjs tests/ops-task-list-navigation.test.mjs tests/ops-task-numbered-service.test.mjs tests/dialog-opener-focus.test.mjs`: **225 pass /0 fail**. Reran after both fixes: **225 pass /0 fail**. Final output: `/tmp/tips-menu-review-20260915/ops/focused-tests-final.txt`. `git diff --check` passed. No build/server restart/push/deploy performed.

## Current browser proof and exact limits

Every run used `http://127.0.0.1:3216` and fresh Playwright contexts at1440×900 and390×844. Synthetic admin transport; only known API/Supabase contracts fulfilled; unknown API requests failed with501; external requests aborted; websockets closed; real writes never reached the application. Registration used the actual development-only `registration-subject-tracks` adapter, word retest used `word-retest-expected-schedule` as admin. Other menus used explicit transport fixtures. Source fixture schedule sessions were made active with a session number following the canonical word-retest fixture shape. Existing real component routes were exercised; no temporary gallery/auth bypass.

### Registration

- Nonempty inquiry and other seeded queues; query zero→clear→restored; keyboard activation across inquiry, level-test request, consultation request/completed, waiting, observation request, enrollment request, admission processing, completed.
- List→calendar→list; actual inquiry student opens application detail; Escape closes; new application opens and clean Escape returns to toolbar.
- Final screenshots/DOM in `ops/final/registration-*`; search-clear focus true after versus false before.
- Not exercised: calendar appointment selection across historical fixture months; appointment edit/date save; level-test results; consultation routing; enrollment placement/payment completion; observation lifecycle; notification preview or send; dirty registration save/conflict recovery; failed calendar/list retry. Tab rendering and detail opening do not establish those flows.

### Transfer

- Empty list plus period buttons today/week/month/custom/all; create with required submit disabled; subject→previous teacher→previous class→student→next teacher→next class; long student label; active Sept16 date selected in both calendars; previous/next month; reason edit→Escape→keep editing preserves text→discard closes.
- Clean close and opener focus verified separately for both widths in `ops/forms-after/manifest.json`; linked/dirty flow in `ops/final/transfer-*`.
- Not exercised: nonempty persisted transfer detail/edit; alternate class/person filters; custom period date input values; cross-year/billing period schedules; real settlement arithmetic acceptance; save/RPC failure/retry; workflow approval/checklist transitions. No transfer was created.

### Withdrawal

- Empty list and period buttons; create with required submit disabled; subject→teacher→class→student; long student label; active Sept16 withdrawal date selection; previous/next month; reason edit and keep/discard confirmation.
- Clean close and opener focus both widths in `ops/forms-after/manifest.json`; linked flow in `ops/final/withdrawal-*`.
- Not exercised: nonempty persisted withdrawal detail/edit; custom date range values; actual withdrawal eligibility/billing result; future/past term boundary; save/RPC failure/retry or workflow processing. No withdrawal was created.

### Word retests

- Nonempty admin fixture, query zero/reset; all/today/week/month/custom period switches; branch switches; role tab, manual dialog and selection coverage finalized in supplemental word run.
- Create form clean close returns to opener both widths (`ops/forms-after/manifest.json`).
- Not exercised: score input/save/error, start/report/confirm/retry state mutations, expected-date quick editor, teacher/assistant authenticated role enforcement, persisted bulk delete, custom date input values, loading/failure retries. The fixture viewer role does not prove actual role authorization.

### Todo

- Nonempty numbered transport list with long title; query zero/clear/restored; create dialog, initial focus, clean Escape and opener focus both widths.
- Before the second fix, `ops/final/tasks-1440-progress.json` records searchClearFocus false. Supplemental and delayed-recovery evidence supersedes this result after keeping todo search mounted.
- Not exercised: saved detail/open/edit, selected list multi-action, quick-add parser submission, completion actor transition, due/team dropdown paths, saved filter widths, page2/page-size interaction, reload failure/retry or actual create save. Existing focused tests supplement but do not replace those browser paths.

## Evidence accounting

- `ops/discovery`: first inspection; missing option-table fixtures led to explicit501, so those create attempts are NOT passed workflows.
- `ops/forms`: corrected known empty option contracts; genuine before focus failures.
- `ops/deep-before*`/`ops/deep-after`: exploratory harness locator/timeouts; not blanket passes. Registration used a hidden duplicate student locator until corrected; period accessible names differed from visible text. Later runs corrected the selectors.
- `ops/forms-after`: all8 create/clean-close cases have zero unknown API contracts and focus restoration true.
- `ops/linked-after`: both transfer/withdrawal widths exercise linked choices, month navigation and dirty input preservation. This earlier fixture lacked active sessions, so it proves empty-calendar handling only. Final active-session run supersedes its date-selection claim.
- `ops/final`: authoritative detailed run; word branch-all selector collision is a harness error and is superseded by supplemental word run. Todo search focus is superseded by the final delayed-recovery run.
- Actual proof scripts: `/tmp/tips-ops-depth-final.mjs`, `/tmp/tips-ops-form-depth.mjs`, `/tmp/tips-ops-linked-final.mjs`.

No production, provider, recipient, persistence, deployment, performance or full-workflow pass claim is made.

## Final repair verification

- `bc02ece6` keeps todo search mounted independent of page rows/query presence.
- `/tmp/tips-menu-review-20260915/ops/task-search-final/manifest.json`: zero-result reset with a1500ms delayed numbered response, at both1440 and390. `searchClearLoadingFocus:true`, `searchClearFocus:true`, unknown API0, runtime errors0, all captured document overflow0.
- `/tmp/tips-menu-review-20260915/ops/final/manifest.json`: registration/transfer/withdrawal at both widths complete scripted sequences, clean opener focus true; transfer/withdrawal dirty draft preservation true. Word selector collision in this run is superseded by supplemental evidence.
- `/tmp/tips-menu-review-20260915/ops/supplement-final/manifest.json`: todo both widths search clear and dialog focus true; word1440 branch/period/role/manual/selection/create pass. Word390 period/branch/role/manual opened; subsequent checkbox lookup timed out while dismissing manual, so that run does not prove mobile selection/close.
- No additional code changed after `bc02ece6`; independent review remains root-owned.

- `/tmp/tips-menu-review-20260915/ops/detail-manual-final/manifest.json`: loaded registration application detail (including canonical form fields) captured at1440 and390 after waiting for loading text to disappear; clean close/create focus true. Word1440 detailed sequence passes. Word390 manual explicitly closed and dialog disappearance confirmed, but subsequent checkbox was unavailable; therefore mobile bulk selection remains unverified (not a product defect claim). No further expansion performed.
- Visually inspected PC transfer/withdrawal selected calendar and dirty confirmation, mobile transfer selected calendar, mobile registration loaded detail, mobile word/todo forms, and mobile todo clear-loading/restored screenshots. These sampled screenshots show no document overflow; internal tall dialogs scroll, and selected date/long labels remain readable. All recorded screenshot states carry zero document overflow in their manifests.
