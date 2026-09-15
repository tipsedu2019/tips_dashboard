# Registration, schedule and remaining-route review

Review date: 2026-09-15. Scope starts at `48cfd77d`: T13 `0128da76`, T14 `2ad263a2`/`7e5fd931`, T15 `faae1875`/`2d71c353`, and T20 `fdb05f66`. Registration domain/model/service/API/migration logic was read where needed, not edited. No build, server restart or repeated suite was run.

## Verdicts

| Card | SPEC | QUALITY |
| --- | --- | --- |
| T13 registration list | PASS | PASS |
| T14 registration detail | PASS | PASS, within the recorded simulated-keyboard evidence |
| T15 class-schedule presentation | PASS | PASS |
| T20 remaining routes | PASS for the committed wrapper/focus scope and its documented route coverage | PASS |

No actionable source regression was found in the completed T13–T15/T20 scope. This is not a claim of physical-device keyboard coverage, production saves or release completion. T20's separate settings-route and full workflow/failure coverage remains controller-owned, as stated in its QA record.

## T13

- Desktop alignment is conditional on the six views whose values correspond one-to-one to subject tracks. Each cell spans the same track count and uses the parent row subgrid; empty values retain their place. Appointment groups and case-wide facts remain outside that alignment rule.
- The status/observation anchor retains the subject. Non-anchor subjects remain available to assistive technology on aligned desktop rows and remain visible in multi-subject mobile cards. The single-subject display removes repetition without removing the sole anchor.
- Status options/permissions, row-opening callbacks and inner-control event propagation are unchanged. The real-component three-subject browser record shows the same 32/43/32px track heights across four columns and correct row action counts.
- Evidence reviewed: T13 record, new component tests, and `/tmp/tips-premium-dashboard-20260915/registration-list/results.json`. The reported 26 focused tests were not rerun.

## T14

- The final production caller in `registration-track-editor.tsx` actually fills the progress slot using the existing progress model. It does not move persistence, subject-change or notification logic into the new view.
- The seven step keys match the shell's mounted section IDs. Step navigation focuses the section heading with `preventScroll`, then scrolls with the measured header margin and reduced-motion preference. It does not unmount or reset a section. The horizontal current-step adjustment affects only the stepper's `scrollLeft`.
- The shell observes its real header height, removes both resize listeners and its observer on unmount, and restores sticky behavior when the compact viewport condition clears. The real caller keeps the existing scrolling Dialog host and section-owned save controls.
- The compact-height change was checked beyond the existing window-resize fixture: a temporary browser probe held the layout at 390×900 while overriding only `visualViewport.height` to 520 and 350. Both set the shell's compact attribute and computed header position to `static`; the Dialog retained its 884px layout height and 2,214px scroll range. This distinguishes the two viewport concepts without claiming that a desktop simulation reproduces an OS keyboard. The observed save controls remain reachable through that scroll range. At 350px visual height, generic automatic scrolling can position a control below the visible area, so physical keyboard behavior remains an explicit evidence limit rather than a verified success.
- Existing reported evidence: 214 focused checks, 5 post-fix checks, and `/tmp/tips-premium-dashboard-20260915/registration-detail/results.json` with actual full editor/host rendering, heading focus, retained textarea, 36/44px save controls and compact window-height checks. No save or customer-message operation was performed by this review.

## T15

- The change correctly follows the final caller: numbered list rows omit the plan session/billing-period collections. Their adapter-produced zeroes therefore become `진도 미조회`, not `계획 없음` or `정상`. The detail source is not incorrectly treated as if it had been merged back into all list rows.
- The pure formatter separately represents accepted zero, accepted 5/10, invalid/absent source, loading, failure, no role and no period. Zero denominators never produce a percentage. Actual next-session metadata appears only when a next-session ID exists.
- Unsupported total session count and the zero-warning summary are removed. Existing sorting, filters, group data, row/detail links, return paths and mutations are unchanged. “수업 설계” remains the same action with secondary emphasis.
- Evidence reviewed: T15 source and QA record, the `.d.ts` interface and three formatter tests, and the reported 55 focused checks. Positive progress and accepted-empty-plan fixtures remain helper-level evidence because the current exact numbered transport does not supply those fields.

## T20

The final `fdb05f66` wrappers change page gutters to 16/20/24px in their actual owners and preserve the corresponding loading/permission/error layouts. The makeup-request dialog's bounded focus patch captures the opener on create/revision/scheduling entry, preserves the existing dirty guard, and falls back to the create button if the original opener is disconnected, hidden, disabled, `body`, or has no rendered client rect. The last two checks are present in the committed patch, beyond the earlier working copy reviewed.

The final T20 QA record and manifests were read. `remaining-verified/manifest.json` has 22 captures across eleven routes with zero unhandled fixture calls/page errors/console errors. Its two failed makeup focus entries are explicitly the pre-fix reproduction. `remaining-focus/manifest.json` supersedes those entries and reports successful focus restoration at both 1440 and 390px. `remaining-shared/manifest.json` adds four clean dashboard/tasks captures. The 134 focused test results are owner-reported and were not rerun.

The record correctly distinguishes actual render routes from redirects and does not claim that these empty-state and representative-control checks establish full workflow/failure coverage or the seven independently owned settings routes. No calendar pagination, role rule, date calculation, operational state transition, API or provider-send change was introduced by T20.

## Prior statistics finding

The independent T18 P2 is resolved in `d1b0009d`. Both visible distribution metrics now use identical formatted counts/units in their accessible names, and the new test imports the real drilldown component. The earlier `foundation-feature-review.md` has been updated to PASS for all four groups. No statistics test was rerun by this reviewer.
