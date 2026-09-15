# Foundation and feature review

Reviewed 2026-09-15 against the supplied `foundation-feature-review.diff` (`5e423390..48cfd77d`) and current scoped source. Registration T13/T14 and schedule T15/T20 are excluded. Source was not edited; no build, restart, or repeated test suite was run.

## Verdicts

| Group | SPEC | QUALITY |
| --- | --- | --- |
| Foundation T04/T05/T06/T08 | PASS | PASS — no actionable regression found |
| Management T10/T11/T12 | PASS | PASS — no actionable regression found |
| Textbooks T09/T16 | PASS | PASS — no actionable regression found |
| Statistics T17/T18/T19 | PASS | PASS after `d1b0009d` — P2 resolved |

These are source-review verdicts, supported by the existing validation records. They are not release, production-data, real-save, or complete cross-platform acceptance claims.

## Resolved finding

### [P2] Include the displayed metric in distribution buttons' accessible names

Location: [statistics-drilldown.tsx:80](../../../src/features/dashboard/statistics-drilldown.tsx#L80). Call sites: [statistics-workspace.tsx:126](../../../src/features/dashboard/statistics-workspace.tsx#L126) and [statistics-workspace.tsx:145](../../../src/features/dashboard/statistics-workspace.tsx#L145).

The new `trigger` branch assigns `aria-label={label}` to the button containing `DistributionBar`. The supplied labels contain only the school/grade/group name and the roster action, while the numeric student/class count and its unit now live inside the button. That explicit accessible name overrides the descendant label/count text: a visible row such as `가학교 · 42명` is announced as `가학교 학생 명단 보기`, without `42명`. Before this change, the count was standalone text beside the roster action. This prevents a screen-reader user from comparing the new student and class distributions before opening their rosters.

Keep the visible count/unit in the button's accessible name or a linked description, or leave the metric as readable text outside the action. Apply the same fix to student-distribution and class-group triggers. Add one focused accessible-name assertion for each trigger kind; the existing tests verify label/query wiring but do not assert that the metric remains exposed. This is a source-confirmed regression; no assistive-technology session was claimed.

Resolution verified: `d1b0009d` adds the same formatted student/class count and unit used by the visible bars to both accessible labels. The added interaction test renders the real `StatisticsDrilldown` and checks zero students, comma-formatted 1,200 students, and 12 classes. The owner reports 10 focused checks passed; they were not rerun in this review. No open actionable finding remains in these four groups.

## Review evidence by group

### Foundation

- Central 36/42/44px control roles, 44/48/12px table roles, shell dimensions and motion values match the cards. The bounded destructive Button correction consumes the new foreground pair without changing its action behavior.
- Shared table markup, callback paths, pagination and settings semantics remain intact. Selection still uses checkboxes as well as background treatment; pinned offsets use the effective selection width.
- Shell changes preserve navigation content, role filtering, preferred sidebar side/mode and focus restoration ownership. Route-conditioned global shell CSS was removed without replacing sheet-specific composition.
- Pretendard manifest, local stylesheet pointer, weight range and license provenance were inspected. Local WOFF2 URLs, `font-display: swap`, unicode subsets, existing system fallbacks and no full-Korean preload are present.
- Existing evidence: T04–T08 QA records; reported focused 53/35 checks; shell `results.json` (12 combinations), gallery `results.json` (4 combinations, actual primary/destructive contrast), and the T07 font-probe record. Windows and physical-device checks remain explicitly unverified.

### Management

- Initial student widths are defaults; saved visibility/order/sizing remain in the existing preference owner and restore path. The smaller student minimum avoids inflating 44/64px defaults on rehydration. Class defaults put the title first without replacing saved order.
- Phone formatting is display-only: exact 11-digit `010` inputs receive hyphens; null/undefined/empty receive the missing marker; exceptions retain their original representation.
- Time separator formatting leaves parsing/storage unchanged. Per-slot teacher/location metadata still comes through the existing line formatter; list metadata is omitted only when it exactly matches the shared values. Detail headers now retain the separate lines.
- Student/class sheets retain their existing state, confirmations, draft guards, roster navigation and section order. Changed CSS and JSX alter typography/wrapping/alignment rather than service behavior.
- Existing evidence: T10/T11/T12 records with 52/97/128 reported focused checks and `/tmp/tips-premium-dashboard-20260915/management/results.json` showing both 1440/390 runs passed. Controller-owned detail/final QA remains a separate acceptance gate.

### Textbooks

- Mobile classification uses a fresh copy of applied state on each opening. Escape/cancel do not call `onApply`; applying sends all four values through the existing draft guard and query owner. Subject/category and school/grade reset relationships are preserved; grade choices follow the local school draft.
- Distinct control IDs avoid collisions with the still-mounted desktop controls. Search, inactive-material filtering and the existing reset function retain their prior ownership. The trigger remains mounted while read feedback changes.
- Inventory zero locations now remain visible with neutral zero totals. Purchase remainder uses the displayed lines' ordered/received values and excludes returned/cancelled rows. Student/teacher scope quantities remain separate. Sales labels follow the actual line state; stock-count labels distinguish accepted ledger quantity from unsaved input.
- Existing eligibility, busy-state, return, retry and mutation paths are unchanged. No new stock calculation or service write was introduced.
- Existing evidence: T09/T16 records, 173 reported checks, T09 390/768/1440 flow, and T16 five-tab by two-width browser captures. Actual operational mutations and exports are not proven by these fixtures.

### Statistics

- Refresh errors retain only the accepted keyed snapshot. Query/account/role changes still use the existing cache-key guard; request cleanup still aborts stale responses. Initial failures and same-query refresh failures remain distinct.
- The route parser removes invalid/duplicate/unknown and tab-inapplicable fields; user tab changes push, filters replace, and native history remains connected to Next search params. Only the selected tab mounts.
- Distribution sorting copies server rows and retains exact roster keys. Shared maxima, zero handling, school top-eight/all controls and corrected people/registrations/classes/textbook/progress units match the cards. No invented trend or stock quantity is added.
- Existing evidence: T17–T19 records, 73 reported checks, and two-width actual-app fixture flows covering deep links, refresh failure, subject changes, drilldown query identity, back/forward and reload. The P2 above is not covered by those query and visual assertions.

## Protected boundaries

The scoped diff contains no API route, service, migration, RLS/ACL, lock, idempotency, or provider-send implementation changes. Existing draft/mutation owners remain responsible for actions. The source review used repository `DESIGN.md`, the task cards, `tips-quality`, and the pinned [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) only as supporting accessibility guidance.
