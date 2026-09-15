# Task 4 — Settings, content, and administration audit

Date: 2026-09-15. Read-only audit of the current worktree at `http://127.0.0.1:3216`, desktop 1440×900 and mobile 390×900. No source edits, commits, builds, restart, provider activation, real messages, or real data writes were performed. Root `AGENTS.md`, `DESIGN.md`, `.agents/skills/tips-quality/SKILL.md`, affected callers/services, and the pinned Web Interface Guidelines were read. `CONTEXT.md` and `docs/adr/` do not exist here.

All screenshots and executable reproduction harnesses are in `/tmp/tips-menu-review-20260915/settings-audit/`. Browser auth/API calls were fulfilled with synthetic fixtures; unknown API/external traffic was blocked. Native GET assets came from local dev only. Post requests used to exercise save failure were intercepted with 501 responses, never forwarded. No performance claims, production claims, or backend contract changes follow from these fixtures.

## Confirmed fixes worth making

### P2 — School search hides the newly added row and blocks saving

Owner: `src/features/management/school-master-workspace.tsx:279` (search projection), `:298` (handleAdd), `:484` (invalid-row save guard).

Reproduction on both widths:

1. Load 42 synthetic schools (includes `합성찾을학교`).
2. Search `합성찾을학교`; one existing row remains.
3. Click `학교 추가`.
4. Total count increases to 43, `저장 전` and `되돌리기` appear, but only the original matching row remains. New blank input is absent. `변경 저장` is disabled because the invisible new row is invalid.
5. Clear search; new blank row becomes available. `되돌리기` reloads the 42 originals.

Evidence: `settings-flow.mjs`, `settings-flow.json`, inspected `1440-schools-filter-add.png` and `390-schools-filter-add.png`.

Minimal fix: clear the query when adding and focus the new visible school-name input after render, retaining the chosen category and whole-catalog save/reorder semantics. Alternatively deliberately include new drafts in the projection, as the classroom editor already does. Avoid a new backend or pagination contract. Recheck add under nonempty query, zero-result query, category filter, name sort, both widths, and keyboard focus.

### P2 — CMS edit draft is silently discarded on incidental dialog dismissal

Owner: `src/features/public-content/public-content-workspace.tsx:603` (`closeModal` clears editing/review), `:879` (`Dialog.onOpenChange` calls it without dirty check). All three content kinds share this dialog.

Reproduction on both widths:

1. Homepage management → `공개 후기` → open `합성후기0`.
2. Replace `후기 원문` with `보존되어야 하는 합성 편집`.
3. Press Escape. Dialog closes without a discard/continue decision.
4. Reopen the same item; the original repeated synthetic review text is back. The unsaved draft is gone.

Evidence: `extended.mjs`, `extended.json` (`draftAfterEscape` compares the reopened value), inspected `1440-cms-edit.png` and `390-cms-edit.png`.

Minimal fix: detect meaningful change against the opened entry and guard incidental Escape/outside/close-icon dismissal using the existing draft-navigation confirmation. Keep explicit cancel behavior clear and preserve current return-focus logic, preview → review → apply, upload locks, version checks, private media and public API boundaries. Repeat for teacher/review/result forms and the review stage; only review-edit Escape was directly exercised here.

### P3 — School search reset loses keyboard focus

Owner: `src/features/management/school-master-workspace.tsx:446`–`:454`.

After zero-result search, clicking `학교명 검색 초기화` removes the focused clear button and leaves `document.activeElement.tagName === "BODY"` at both widths. Results recover correctly. `settings-flow.json` records `clearFocus`; inspected `1440-schools-zero.png`, `390-schools-zero.png`.

Minimal fix: keep a search input ref and restore focus when clearing. Can be included with the first school fix. This is narrower than redesigning filtering.

## Per-menu coverage and health

| Menu / actual owner | Exercised current workflows | Health / finding | Evidence and limits |
| --- | --- | --- | --- |
| Schools — `school-master-workspace.tsx`; page `admin/settings/schools/page.tsx` | 42 rows; search→one→add; clear→new row; reset changes; search→zero→clear; desktop and mobile | Hidden new row and reset focus findings above. Existing search is present; do not claim missing search. | `settings-flow.*`, school screenshots. No successful save, duplicate-name correction, delete/restore, initial-read retry, cross-tab write, or DB proof. |
| Subjects — `subject-master-workspace.tsx`, `academic-subject-settings-service.ts`; page `admin/settings/subjects/page.tsx` | Three subject forms; toggle English operation; intercepted failed save; checkbox/draft retained; desktop and mobile layout | Failure feedback says input is preserved and retained checked state matches. No confirmed fix needed. | `final-flow.*`, `*-subjects.png`, `*-subjects-save-failure.png`. Save success, director selector changes, role-denied and reload retry not completed. |
| Teachers — `teacher-master-workspace.tsx`, `management-service.js:listTeacherAccountSettingsData`; page `admin/settings/teachers/page.tsx` | 18 teachers across English/math, math filter gives 9 matching names; account fields visible; desktop/mobile layout | Team grouping works. No confirmed domain defect. Identity panel fixture is insufficient for its complete contract, so that panel is not passed. | `settings-flow.*`, `final-flow.*`, `1440-teachers-math.png`, `*-teachers-filter.png`. Initial mobile test queried a desktop-only name attribute and timed out; corrected follow-up uses visible inputs. Account/role changes, identity verification, save, audit paging not exercised. |
| Classrooms — `classroom-master-workspace.tsx`; page `admin/settings/classrooms/page.tsx` | 42 rows; name edit→intercepted save failure; value retained; subject→zero→add reveals new row; desktop/mobile | Filtered add is healthy (new drafts retained even when default subject differs); do not generalize the school defect. No search or revert control in this full-catalog editor, but absence alone is not a mandatory finding. | `settings-flow.*`, `classroom-add.*`, inspected `1440-classrooms-save-error.png`, `390-classrooms-save-error.png`, `*-classroom-filter-add.png`. No successful save, collision checks, reorder save, or measured user find-time. |
| Class groups — `class-group-master-workspace.tsx`; page `admin/settings/class-groups/page.tsx` | 42 groups; edit name→intercepted save failure; draft retained; desktop/mobile | 42 rows render inside desktop scrolling frame / stacked mobile list; no search/revert control. Search is an optional usability follow-up only if real frequent lookup is established. No confirmed correctness fix. | `settings-flow.*`, inspected `settings-class-groups-initial.png`, `390-class-groups-save-error.png`. No role-denied, successful save, default group behavior, delete recovery, or real lookup timing proof. |
| Textbook settings — `textbook-supplier-settings-workspace.tsx`, `use-textbook-settings-pages.ts`, owner/subsubject services; page `admin/settings/textbook-suppliers/page.tsx` | 24 publishers/24 suppliers; all three primary subtabs; 10-row page; publisher search→zero→clear restores 10; corrected empty subsubject response with four subject counts; desktop/mobile | Publisher/supplier list and zero recovery healthy. No confirmed fix. | `extended.*`, `extra-fixture.mjs`, `final-flow.*`, `*-textbook-zero.png`, `*-textbook-총판.png`, `*-textbook-subsubjects-corrected.png`. Initial subsubject RPC mismatch was a fixture issue and excluded. Owner relation picker, cross-page drafts, save, reorder, nonempty subsubjects not completed. |
| Notifications — `notification-settings-workspace.tsx`, `notification-control-panel.tsx`, `registration-notification-settings-groups.tsx`, customer settings hub; page `admin/settings/notifications/page.tsx` | Safe enabled-UI fixture with provider connections empty and rule disabled; registration group detail→template editor→invalid body→Escape; required-variable validation and continue/discard confirmation; customer section with all five settings off; desktop/mobile | Existing nested template draft guard works and focuses `계속 편집`. Customer controls correctly show off state. No confirmed fix. | `notification-flow.*`, `extra-fixture.mjs`, `final-flow.*`, inspected `*-notification-group.png`, `*-notification-template-editor.png`, `*-notification-after-escape.png`, `*-notifications-customer-off.png`. Initial disabled/error gate alone was not counted as review. Other workflow rules, receiver connections, save/revisions/preview API and customer send are not passed. Raw event label in screenshot is missing optional fixture metadata, not a product-label finding. |
| Homepage CMS — `public-content-workspace.tsx`, `content-contract.ts`; page `admin/public-content/page.tsx` | Teacher/review/result subtabs with 12 synthetic entries each; review edit and Escape/reopen; desktop/mobile | Shared dismissal loses draft as above. Kind switching and long review layout render without page overflow. | `extended.*`, `*-public-content-ready.png`, `*-cms-edit.png`. Search/filter zero recovery, import, upload, review/apply, save failure and public propagation not exercised. |
| Recruiting — `recruiting-inbox.tsx`; page `admin/recruiting/page.tsx` | 24 applications; open first detail; long multiline experience and motivation; enter delete confirmation then cancel; close restores exact opener; both widths | Detail/cancel/focus flow healthy. No confirmed fix. | `extended.*`, inspected `1440-recruiting-detail.png`, `390-recruiting-detail.png`; `closeFocusRestored:true` both widths. Actual delete not invoked, no provider/external links opened. Error/retry, page-size changes and retention-stale state not exercised. |
| Approvals — `approval-workspace.tsx`, `approval-numbered-service.ts`, `approval-service.ts`; page `admin/approvals/page.tsx` | All five list tabs on valid empty page contract; free-form composer opens; title/body/attachments/checklist and disabled submission visible; desktop/mobile | Empty subtabs/composer healthy in exercised state. No confirmed fix. | `extended.*`, inspected `*-approvals-composer.png`, `*-approvals-ready.png`. Earlier wrong tabCounts fixture caused raw contract error, excluded. Nonempty selected request, checklist editing, draft save, action failure/retry, submit/transition and comments not tested. |
| Makeup — `makeup-request-workspace.tsx`, numbered/request services; page `admin/makeup-requests/page.tsx` | Valid empty list/reservation context; request dialog, ordered dependent form controls; reason edit→Escape confirmation in follow-up; both widths | Missing class catalog intentionally prevents completing dependent fields. No confirmed fix. | `extended.*`, `final-flow.*`, inspected `*-makeup-form.png`, `*-makeup-draft-dismiss.png`. Initial reservation-context 501 was fixture gap, excluded. Nonempty request/detail, class/teacher scheduling, collision, approval/refund and actual submit not tested. |

## Verification boundaries and reproducibility

Run using `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` followed by the absolute script path. Scripts use the installed Playwright runtime via `createRequire` and retain exact transport definitions:

- `probe.mjs`: common auth, dense school/room/group/teacher fixtures, deny-by-default routing and broad initial surfaces.
- `settings-flow.mjs`: school defect, zero reset, room/group failure retention, subject and teacher initial checks.
- `classroom-add.mjs`: counterexample proving filtered classroom add remains visible.
- `extended.mjs`: publisher/supplier tabs/search, CMS Escape/reopen, recruiting cancel/close, approvals and makeup form paths. Its subsubject mock is intentionally superseded by `extra-fixture.mjs` / `final-flow.mjs` corrected fixture; do not interpret its one unhandled subsubject request as a product defect.
- `notification-flow.mjs`: actual nested notification group/template draft guard. Complete final run has zero unhandled calls/page errors.
- `final-flow.mjs`: corrected subsubject RPC, all-off customer hub, subject save failure, mobile teacher controls, makeup dirty Escape.

Transport-harness mistakes fixed during audit: custom route override originally fell through after fulfill; corrected to return an explicit handled sentinel. Wrong approval tab-count keys and subsubject RPC spelling were corrected before health conclusions. Earlier invalid snapshots/screenshots remain in the directory for provenance but are not evidence of app defects.

No post-fix evidence exists because this assignment is read-only. Root may implement the school issue and separately decide whether to adopt the CMS dismissal guard. Missing search in full-catalog settings is documented as an observation, not automatically ranked as a required change.
