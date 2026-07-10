# Registration 50-Bug Sweep

**Goal:** Make registration a reliable single-application workflow from inquiry through enrollment, with 10 verified sets of 5 distinct defects.

## Set 1 - Stage Model

- [x] R01 `문의만` was missing from the consultation-result actions.
- [x] R02 `미등록` incorrectly highlighted consultation as the current input step.
- [x] R03 `문의만` incorrectly highlighted consultation as the current input step.
- [x] R04 canceled registration records still exposed the normal edit path.
- [x] R05 `다음 개강 알림` was incorrectly modeled as a class waitlist.

## Set 2 - Inquiry Input

- [x] R06 an inquiry could be created without a student name.
- [x] R07 an inquiry could be created without a subject.
- [x] R08 an inquiry accepted an invalid parent mobile number.
- [x] R09 a new inquiry did not default its inquiry timestamp.
- [x] R10 grade choices omitted lower elementary grades and contained stale year-prefixed values.

## Set 3 - Level Test And Consultation

- [x] R11 a level-test reservation could advance without a location.
- [x] R12 level-test completion had no actual completion timestamp.
- [x] R13 level-test completion had no required result.
- [x] R14 a visit consultation could be reserved without a room.
- [x] R15 consultation completion silently generated a timestamp instead of requiring the real completion time.

## Set 4 - Waitlist Synchronization

- [x] R16 class-wait decisions are explicitly limited to `현재반 대기` and `신규반 대기`.
- [x] R17 `다음 개강 알림` no longer requires a class.
- [x] R18 `다음 개강 알림` no longer creates a student-management record early.
- [x] R19 an enrolled student can no longer be demoted into the same class waitlist.
- [x] R20 a failed waitlist-class change restores the previous waitlist relation.

## Set 5 - Admission Messaging

- [x] R21 MakeEdu manual sending now has an explicit completion action that advances to `5-1`.
- [x] R22 SOLAPI status loading no longer hides registration-detail query errors.
- [x] R23 SOLAPI status loading no longer hides message-history query errors.
- [x] R24 an indeterminate provider request is recorded as `unknown`, not left pending forever.
- [x] R25 admission messages can no longer be sent after registration is closed.

## Set 6 - Payment And Completion Checks

- [x] R26 admission-form completion is disabled before an enrollment decision.
- [x] R27 payment confirmation is disabled until the payment stage and admission-form completion.
- [x] R28 MakeEdu registration is disabled until payment is confirmed.
- [x] R29 invoice sending is disabled until MakeEdu registration is complete.
- [x] R30 textbook billing is disabled until payment, class, and textbook data are ready.

## Set 7 - Table And Filters

- [x] R31 changing the filtered column clears the previous column's search text.
- [x] R32 the column-filter input can collapse while a filter remains active.
- [x] R33 all active registration filters can be detected and reset together.
- [x] R34 reversed custom date ranges are normalized.
- [x] R35 pipeline, dates, and checklist values use typed sort keys instead of display strings.

## Set 8 - Detail And Recovery

- [x] R36 inquiry details no longer show final-enrollment blockers.
- [x] R37 detail fields now follow level test before consultation.
- [x] R38 the selected textbook is visible in registration detail.
- [x] R39 the level-test Drive URL is a safe clickable link.
- [x] R40 `미등록` and `문의만` records have an explicit consultation-stage reopen action.

## Set 9 - Mobile And Accessibility

- [x] R41 text fields no longer dispatch duplicate updates through both `change` and `input`.
- [x] R42 the long one-page form keeps its action bar sticky.
- [x] R43 checklist labels wrap instead of truncating critical text.
- [x] R44 blocker actions focus the exact missing control.
- [x] R45 mobile cards hide future workflow sections until they become relevant.

## Set 10 - Error And Regression Protection

- [x] R46 unknown open pipeline values remain visible in the inquiry view.
- [x] R47 unknown closed pipeline values remain visible in the closed view.
- [x] R48 failed non-final updates roll task, detail, and waitlist state back.
- [x] R49 stale message-status responses are aborted when the selected task changes.
- [x] R50 a provider-accepted message is not reported as failed when only local refresh fails.

## Verification

- `node --test tests/registration-workflow.test.mjs`: 50/50 regression cases.
- `node --test tests/ops-task-model.test.mjs tests/ops-task-workspace.test.mjs tests/registration-workflow.test.mjs`: shared workflow regression suite.
- `pnpm lint`: ESLint.
- `pnpm build`: Next.js production build and TypeScript validation.
