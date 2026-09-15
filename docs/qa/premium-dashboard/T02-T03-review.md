# T02/T03 independent review

- Reviewed: `T02-T03-review.diff`, current affected source through `c41e5468`, T02/T03 task cards, master S01, `DESIGN.md`, and recorded T02/T03 QA evidence.
- Decision: **Approve source/spec review. No actionable correctness or code-quality findings. Browser verification remains pending.**

## Evidence

- `use-dashboard-daily-brief.ts:26-35,90-96`: accepted data is keyed by user ID, role, and Seoul calendar date; auth-loading, signout, mismatched session/user, and lost access hide it in the render that changes the boundary. Read the actual auth provider: renewed credentials preserve the same user's resolved profile while identity changes reset it. Token changes trigger a new request without unnecessarily changing the accepted-data key.
- `use-dashboard-daily-brief.ts:56-88`: effect cleanup prevents superseded requests from committing; same-key refresh and failure preserve accepted data and `generatedAt`; changed-key results cannot render. Returned dates and current Seoul date are checked before success is accepted.
- `daily-brief-date.ts` and hook lines 41-54: one timer is scheduled for the next Seoul midnight, with focus/visibility recovery and cleanup. No periodic polling or automatic failure retry was added.
- Actual unchanged `daily-brief-service.ts` still calls only `get_dashboard_daily_brief_v1`, uses an 8-second abort timeout, disables transport retry, and runs the existing normalizer. No auth-provider, SQL, RLS/ACL, send, or mutation contract changes are in this diff.
- Ordered migration search found the sole function definition in `20260813192115_dashboard_daily_brief.sql`: today's scheduled appointments, chronological first five, including already elapsed times; all source titles include their appointment type. The component preserves supplied hrefs and source title/subject/place content. It does not expose `openTasks` or add type-count deep links.
- `dashboard-daily-brief.tsx:42-129`: S01's heading/date/generated timestamp, three unit-bearing counts, three-row initial skeleton, unread/error versus zero distinction, refresh preservation, empty-state wording, maximum-five description, full text wrapping, 48/64px time columns, and 64px minimum rows are implemented. Both whole-schedule links use the existing `/admin/registration?view=calendar` contract; low-priority registration/academic/statistics links remain.

## Validation boundary

- Reviewed existing behavior tests and QA records: recorded 17/17 focused tests, targeted ESLint, TypeScript, and diff-whitespace checks passed. Tests were not rerun, as requested; these are recorded results rather than a new test execution.
- The hook test exercises a focus-triggered KST rollover and pure midnight calculation; it does not directly fire the scheduled timeout callback. The timer and listener lifecycle were reviewed in source.
- This review made no source edits and performed no build, server restart, browser interaction, production data check, or deployment.
- Controller's desktop 1440px and mobile 390px checks for loading/error/empty/five-row/long-content layout, first-screen visibility, and keyboard/focus behavior are still required before marking T03 fully verified.
