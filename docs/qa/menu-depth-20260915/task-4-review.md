# Task 4 independent SPEC + QUALITY review

Verdict: **APPROVE WITH LIMITS**. No actionable introduced bug found in commit `a20a58caa79a60d5b702cf2dcbff5ded65e2fb0c` (the two settings/CMS files only).

Reviewed 2026-09-15. `settings-review.diff` was not present at `/tmp/tips-menu-review-20260915/settings-review.diff`; the exact commit diff from `git show a20a58ca` was reviewed instead. Calendar changes in the shared checkout were excluded. No product edits, tests reruns, browser reruns, builds, server restarts, data writes, provider actions, or deployment were performed by this reviewer.

## Grounding and scope

Read root `AGENTS.md`, `DESIGN.md`, `.agents/skills/tips-quality/SKILL.md`, the plan's global constraints, `task-4-audit.md`, and `task-4-report.md`. Reviewed actual route callers, installed dialog/input composition, settings column helper, content draft contract, shared draft/history guard, and existing settings guard tests. Consulted installed `vercel:shadcn` mechanics and the [pinned official interface guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md), applying the repository's more specific behavior contracts.

## Spec and code review

- `school-master-workspace.tsx:309-316`: add creates one row using the current category, clears the query, resets name sorting, prepends the row, and marks the catalog dirty. Existing load/save guards and whole-catalog ordering/validation remain intact. `createEmptySchool` at lines 104-112 supplies the selected category, so the category filter does not hide the added row.
- `school-master-workspace.tsx:145-154`: focus is requested only for the newly created row; the visible input is selected from the desktop/mobile twins. The ref clears after success, so subsequent typing does not repeatedly steal focus. The sole current caller mounts one school workspace.
- `school-master-workspace.tsx:466`: query reset restores focus to the existing search input before the reset button disappears.
- `public-content-workspace.tsx:281-285,388-409`: every new/opened editor receives its own serialized initial draft. Draft data consists of strings plus scalar sort/publication state; current updates are immutable. Reverting to the original draft becomes clean, and a reopened entry receives a fresh baseline. Temporary signed preview URLs do not create a false content change; successful upload changes the persisted media reference and therefore becomes dirty.
- `public-content-workspace.tsx:443-457,611-617,1264-1272`: review retains `editing`; Escape/outside/close/cancel use the shared dirty guard, while returning from review clears only review state. Existing upload/save close locks remain. The confirmation uses the existing nested dialog and focus restoration mechanism.
- `public-content-workspace.tsx:469-495`: successful apply clears both review and editor directly, so it does not prompt for a now-saved draft. Failed apply retains both. Existing request IDs, expected versions, normalization, API/auth headers, media contracts, and public rendering boundaries are unchanged.
- The real CMS page still checks admin access and token before mounting the workspace. The new guard is mounted once per workspace and delegates browser/history/app navigation to the existing hook. No custom hotkeys, ornamental features, shared primitive changes, or backend changes were added.

## Evidence inspected

Read `/tmp/tips-menu-review-20260915/settings-after.mjs`, its synthetic transport setup, and `settings-after/manifest.json`. The supplied manifest records both 1440px and 390px passing, with no runtime errors or unhandled requests. Independently viewed all four supplied screenshots: `school-add-1440.png`, `school-add-390.png`, `cms-dirty-1440.png`, and `cms-dirty-390.png`.

The harness directly asserts filtered school add reveals and focuses a blank row, clears search, permits save after valid input, resets to originals, and restores search focus. CMS assertions cover review-content edit, Escape, keep-edit text/focus preservation, discard, original opener focus, clean reopening, and immediate clean Escape. The screenshots show the visible first school input and readable nested confirmation with focus on continue editing at both widths. This is reviewed supplied current-run evidence, not a new reviewer execution.

## Limits

- Category-filter add, zero-result add, and prior name sorting are supported by source flow, but the after harness directly exercises only a matching nonempty query under the all-category/default-sort state.
- Teacher/result dirty dismissal, reverting a field to baseline, review-stage Escape, outside-click/close-icon dismissal, upload completion/failure, apply success/failure, browser history/unload, and app navigation are source-reviewed here; the supplied after harness does not exercise those branches. Existing settings navigation tests cover the shared guard in other settings owners, not the new CMS owner.
- CMS currently uses `key={session.access_token}` (`src/app/admin/public-content/page.tsx:20`). An auth-token replacement or role/loading boundary can remount/unmount the editor outside this local close guard. This predates this commit and is not an introduced finding; approval does not claim draft persistence across token refresh or authentication changes.
- Import/bootstrap/bulk-status review has no `editing` draft and therefore retains its preexisting immediate close semantics. Protection added here is for the teacher/review/result editor and its subsequent review, not a new import-draft feature.
- No real successful save, DB/readback, provider/send, production deployment, performance improvement, or complete all-menu workflow validation is established by this review.
