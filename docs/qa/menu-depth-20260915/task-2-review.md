# Task 2 independent SPEC + QUALITY review

Verdict: APPROVED for the scoped product changes in `cd39dcc13f1ff77305765fe56ed0068b0e480ba0` and `bc02ece62a0fb1c718bb167389eba36e9d08c158`. No actionable defect introduced by these diffs was found. This is not approval of complete operational workflow coverage; Task 2 remains DONE_WITH_CONCERNS as reported.

## Scope and grounding

Reviewed only `src/features/tasks/ops-task-workspace.tsx` in the two named commits. The current file has no diff from `bc02ece6`. Ignored other agents' school/CMS/calendar changes. Read AGENTS.md, DESIGN.md, the plan Global Constraints and Task 2, task-2-report.md, domain guidance, the local tips-quality skill, installed vercel:shadcn component guidance, local Dialog/Input primitives, and focused tests. Applied the relevant keyboard/focus checks from the pinned [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) subject to the repository contracts.

## Code and lifetime trace

- Lines 9515–9584: toolbar/empty-state create callers reach `openCreate`; capture occurs after permission guards but before `await ensureTaskOptions()` and before mounting any form inputs. An option-load failure leaves the dialog unopened. A later entry overwrites the retained reference. Registration create uses its existing separate application host, so the normal-form handler is not credited for registration-host focus.
- Lines 9622–9708: `openEdit` and `openWordRetestRetryForm` capture synchronously before option work/state changes. Word editor/expected-date/retry adapters at 9816–9838 and 12226–12246 delegate into these functions. The expected-date focus effect occurs later, preserving the original capture.
- Lines 10820–10892 and 13342–13372: clean close, dirty confirmation, keep editing, discard, and route continuation retain their existing state machine. Opening/canceling the nested confirmation does not replace the normal form opener. Discard clears the confirmation-return reference before closing both scopes.
- Lines 12911–12920: the normal form consumes and clears its opener on close. It only overrides the installed Dialog/Radix default when pathname matches and the element remains connected, enabled, outside hidden/inert ancestors, and has layout rectangles. Existing primitives call the caller callback first and respect preventDefault. Actor/path/workspace keys at line 7787 scope this ref to its workspace session.
- Lines 12542–12575: the shared search clear handler updates the query and focuses the actual input ref synchronously. Input forwards native props/ref to the DOM input. Lines 9412–9414 keep todo search mounted regardless of result count/query; the query reset therefore cannot remove the just-focused input while the numbered page is empty/loading. Registration remains governed by list/calendar mode; transfer/withdrawal search visibility is unchanged.
- No service calls, authorization gates, public APIs, financial calculations, database definitions, saves, or provider actions changed in the diffs.

## Evidence reviewed

- `ops/completion.json` and `ops/forms-after/manifest.json`: eight clean create/Escape cases across transfer, withdrawal, word retests, and todo at 1440×900 and 390×844 have closed=true, focusRestored=true, no unknown API contracts and no page errors.
- `ops/task-search-final/manifest.json`: both widths have searchClearLoadingFocus=true and searchClearFocus=true, no unknown API contracts/page errors, and allZeroOverflow=true. Inspected `/tmp/tips-ops-task-search-final.mjs`: it delays the reset numbered response by 1500 ms, checks focus after 100 ms, then checks again after restoration. This is direct evidence of focus surviving the empty-page reload.
- Visually inspected `ops/forms-after/tasks-390-dialog.png` and `ops/task-search-final/tasks-390-clear-loading.png`; the actual form input and search field show their focus ring, and the mobile screenshots have no page-width overflow. Tall form content uses the existing internal scrolling layout.
- `/tmp/tips-menu-review-20260915/ops/focused-tests-final.txt` records 225 pass, 0 fail, 0 skipped. Did not rerun already-passed tests, build, restart a server, mutate real data, or deploy. The dialog test exercises the shared primitive and its guards; it is not a mounted test of every newly added OpsTaskWorkspace handler.

## Explicit limits

- The eight clean create cases do not prove persisted detail→edit, word-retest retry/expected-date editing, save failure, workflow transitions, approval, billing acceptance, customer sends, or authorization enforcement. The report's per-menu untested branches remain outstanding. Mobile word bulk selection is explicitly unverified after a harness lookup failure.
- Detail→edit closes/unmounts the detail dialog (line 9632), so a captured detail action can become disconnected and be skipped by the safe-return guard. This diff does not establish return to the original list row for that flow. Likewise, legacy registration edit can be entered after an asynchronous detail selection. These are existing unverified pathways, not a newly introduced regression in these two commits.
- Browser manifests label development server 3216, have sourceSha=null, and record captureCheckoutSha values from the evolving checkout (`fd1f52ae` for forms-after, `d783292b` for delayed search). They are current-run HMR behavior evidence, not immutable proof that a specific production build or commit was executed. Commit diff review and current-file equality are separate evidence.
- No matched performance benchmark, production data validation, persistence, provider/recipient outcome, deployment, or full-menu workflow completion is claimed.
