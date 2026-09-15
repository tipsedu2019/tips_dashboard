# Task 3 accepted calendar fixes — 2026-09-15

Implementation commit: `6a9cfcab91e7af1d0d1d477b3980a1e53107afd8` (`fix(calendar): keep accepted ranges and restore keyboard detail access`). Local branch `codex/internal-dashboard-only-20260915`; no push/deploy/build/server restart performed.

## Scope and accepted findings

Only A1/A2 from `task-3-audit.md` were implemented. Other academic menus remain covered by the audit's exact executed/untested branches, not by this report.

- A1: list event title is now a named native button. The annual-board link remains outside that button. Desktop/mobile control height tokens and visible keyboard focus are used. Exact detail fetching remains required. An optional EventForm close-focus callback restores the invoking event button after dismissal. Pending exact detail is still invalidated by controlled month navigation.
- A2: `useOperationsWorkspaceData` already preserves the accepted response and rejects obsolete requests. The workspace now uses its accepted request together with its rows instead of an independent last-month ref. Optional calendar navigation props separate requested and accepted dates. Main month/list, mini-calendar month and selectedDate stay in the accepted month while fetching or failing. The alert names the requested date range and retries `refresh()` for that same request. Accepted seven-day data remains visible while returning to a month, including failure and retry. URL date changes and ordinary date selection still request their intended month.
- Owned source: `academic-calendar-workspace.tsx`; calendar `calendar-main.tsx`, `calendar.tsx`, `calendar-sidebar.tsx`, `date-picker.tsx`, `event-form.tsx`, `types.ts`. The shared operations hook, services, common UI primitives, auth, mutations, annual board and other menus were not changed.

## Current-run reproduction and validation

Before: `/tmp/tips-academic-calendar-repro.mjs` passed the defect assertions: non-focusable DIV list card, pointer-only detail, October title with September list after range failure, and no retry. The current-run before screenshot `academic-calendar-1440-range-error-confirmed.png` was opened and visually inspected.

After tests:

- `node --test tests/academic-calendar-ui.test.mjs tests/academic-calendar-range-interaction.test.mjs tests/operations-scoped-reads.test.mjs`: **52 passed**, 0 failed. Log `/tmp/tips-calendar-focused.log`.
- Two new mounted tests exercise the real workspace and range hook with deferred service transports, and the real Calendar controller with bounded child stubs. Assertions cover accepted range/data retention, error range labeling, same-range retry, reverse responses, dense-month to seven-day recovery, failed month return preserving seven days, subsequent retry, pending detail invalidation and focus restoration/accepted sidebar selection.
- ESLint on all 8 owned source/test files: **0 errors, 0 warnings**. Log `/tmp/tips-calendar-lint.log`.
- `git diff --check`: passed.
- Browser runner `/tmp/tips-calendar-after.mjs`, transport harness `/tmp/tips-calendar-fix-harness.mjs`: **PASS 1440px and 390px**. Log `/tmp/tips-calendar-after.log`. Both use Chromium with Korean locale/Seoul timezone and fixed September 15, 2026 clock.

The browser script actually executes Enter and Space opening exact detail, Escape with focus returning to the invoking button; September success → October deferred response → failure while September title/sidebar/list remain → exact failed-range retry → October success; month/list switching; November and December requests with December response first and stale November response last; dense month → seven-day success → failed monthly return retaining all seven day sections → exact monthly retry success. Desktop mini-calendar month and mobile accepted-month agenda are asserted. Every captured document has zero horizontal overflow. Final successful transport logs have zero undefined requests and zero page runtime errors.

One final capture attempt stalled before fixture API requests during development-server entry; a retry completed both viewport runs. This is recorded as development harness startup uncertainty, not a product defect or performance finding. The earlier calendar fixture used a constant year after navigating to January; it was corrected to follow the requested year before the successful final runs.

## Screenshot evidence

Directory: `/tmp/tips-menu-review-20260915/academic/`. PNGs were generated from the live 3216 development route; corresponding `academic-calendar-1440.json` and `academic-calendar-390.json` contain requests, assertions, states and overflow.

Opened and visually inspected:

- `academic-calendar-1440-range-error-confirmed.png` — before: October header and September content.
- `academic-calendar-1440-after-keyboard-focus.png` — native title focus ring after Escape.
- `academic-calendar-1440-after-error.png` — September header, selected September day, September list and failed October range retry.
- `academic-calendar-390-after-error.png` — wrapping failure text, retry, retained month/list and long event title.
- `academic-calendar-1440-after-month-view.png` — October header, mini-calendar and selected October 15 after acceptance.
- `academic-calendar-390-after-month-view.png` — October mobile agenda only.
- `academic-calendar-390-after-seven-day-retained.png` — seven-day accepted range remains labeled during failed month return.

Additional captured assertions/states: `after-loading`, `after-retry`, `after-reverse-responses`, `after-seven-day`, `after-month-recovered`, for both widths.

## Limits

All API/auth/DB transports are synthetic and strict: unknown API calls fail 501; other origins abort; app-origin writes abort; WebSockets close; service workers are blocked. No real saves, data edits, provider actions, messages or deployment occurred. The browser data is one synthetic school event with a long title, plus empty seven-day recovery; mounted tests separately preserve a nonempty seven-day result. These tests are not real-device, production, saved-data or dense-volume performance evidence. Full-repository type/lint/build checks belong to root integration. Other academic menu branches, drag/drop writes, dirty-draft save/cancel branches, exports and actual persistence were not newly exercised by this bounded fix.

## Final scoped review follow-up: form opener ownership

Implementation commit: `bae83ea9b9c34c46084b2e7178cc10758e3e740b` (`fix(calendar): scope focus restoration to each form opener`). Only `calendar.tsx` and its existing mounted regression test changed.

The final reviewer reproduced one P2: failed/pending event detail left its opener reference behind, so a subsequent new-event form could restore focus to the old event. The fix stores the pending detail opener separately from the active form opener. New single-date and range forms capture their own opener; successful detail requests promote their original opener into the form session. Request invalidation discards the pending detail opener, while retrying the same failed detail preserves its original opener. Close restores focus only when the form's opener is connected, on the same URL, visible, enabled and not inert; otherwise ordinary dialog restoration remains in control.

Evidence:

- The expanded mounted test executed against the pre-fix committed Calendar source fails specifically with `failed detail then new must restore its own opener`. Log: `/tmp/tips-calendar-focus-before.log`. The temporary baseline test file was removed after execution.
- The fixed code passes failed and pending detail → new single-date/range form → close; late detail cannot replace the new form; same-detail retry success restores the original detail opener. Additional assertions cover hidden attribute, CSS visibility, zero layout, inert, disabled, aria-disabled, detached and changed-URL targets.
- Same 52 focused tests pass, 0 failed: `/tmp/tips-calendar-focus-after.log`. Owned-file ESLint: 0 errors/warnings (`/tmp/tips-calendar-focus-lint.log`). `git diff --check` passed.
- This follow-up used source and mounted tests only. Port 3216 was left on root's immutable local production build `42567d74`; no rebuild/restart/browser claim is made for the opener follow-up. Root owns the next scoped review, rebuild and actual calendar browser verification.
