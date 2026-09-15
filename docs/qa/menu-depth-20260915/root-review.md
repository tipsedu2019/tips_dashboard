# Root menu change review

Reviewed 2026-09-15. Scope: `root-review.diff` (fdcccd41 and d783292b), plan Global Constraints / Tasks 1 and 5, AGENTS.md, DESIGN.md, repository tips-quality guidance and real callers. Product source was not edited; no build, restart, real write, or deployment was performed.

## Verdict

- SPEC: approved after focused re-review of 672a02ac; the nested-drilldown retention gap is resolved.
- QUALITY: approved with the material limits below. No outstanding actionable findings in this scope.

## Resolved finding

### Resolved P2 — Preserve loaded child rosters when collapsing their class group

`src/features/dashboard/statistics-drilldown.tsx:101–103`

The new `opened ? … : null` branch removes every rendered row when its parent group collapses. The real caller in `src/features/dashboard/statistics-workspace.tsx:145` renders a nested `StatisticsDrilldown` for each class roster, so this destroys that child's accepted data, cursor and expanded state. Opening a class group, opening its student roster, collapsing and reopening the group now hides the already accepted roster; reopening the child requests the same roster again. This misses the same-query reuse / retain-data-on-collapse requirement in the actual class workflow.

Independently reproduced with the real TSX component mounted in jsdom, synthetic auth/fetch, and the same nested `renderRow` composition as the real caller. Before outer collapse: requests `class-group`, `class-roster`. After reopening the outer group: child `aria-expanded=false`, accepted student absent. After reopening the child: requests `class-group`, `class-roster`, `class-roster`. No network request escaped the synthetic fetch. This is mounted DOM evidence, not a newly run browser suite.

Resolved by 672a02ac. The existing hidden panel now retains the rendered descendant tree, preserving child component state through outer collapse. Query/viewer keys and unmount abort logic are unchanged, so actual scope changes still discard obsolete state and requests. The dependent mounted test now uses the real nested composition, verifies the same connected child trigger remains expanded with accepted student data after outer collapse/reopen, and verifies that toggling both parent and child does not increase the seven accumulated requests. It also explicitly checks that collapsed descendants sit under a hidden ancestor. This is a meaningful regression test for the reported failure; no further implementation change is needed for this finding.

Focused re-review inspected only commit 672a02ac and its dependent test, plus `/tmp/tips-menu-review-20260915/nested-school-tests.log`: 13/13 pass (9 statistics and 4 school checks), no runtime diagnostic. The school changes themselves are outside this review. No full suite or browser suite was rerun during the re-review; the nested regression is mounted DOM evidence.

## Checks and evidence

- Dashboard count kinds `level_test`, `visit_consultation`, and `observation` match the existing registration route consumer (`ops-task-workspace.tsx:8521–8529`). No replacement API or business calculation was added. Supplied dashboard browser results pass at 1440 and 390; inspected the actual 390 screenshot.
- Statistics query and viewer identity are keyed before content mount; obsolete requests are aborted on unmount and checked before accepting payloads. Pagination retains the accepted cursor after failure, deduplicates IDs, and retries the failed page. Persistent trigger/focus and flat same-query reopening are covered by the supplied mounted test. The test does not change drilldown user/role/token; viewer isolation is source-reviewed, not independently runtime-proven by that test.
- WorkspaceTabs changes only list `scrollLeft`; no focus call or new page scrolling occurs in the new effect. Real caller uses controlled/manual tabs and one stable panel. Supplied clean `tabs-tests.log`: 3/3 pass, including selected deep-link reveal with focus and draft mount preservation.
- Management required-field lookup matches real form definitions: student name, class name, science-only subject area, textbook title. Validation runs after permissions and before `beginSaving` / service writes. Whitespace is trimmed for presence checks. New detail/create openings reset validation state. The conditional science-field visibility matches validation. Authentication, service payload construction, draft guards and mutation reconciliation are unchanged.
- Supplied student browser script asserts whitespace blocks writes, sets inline `aria-invalid`, focuses the name, clears the field error after repair, and retains edited data following a mocked save failure and continue-editing. Class script asserts whitespace rejection/focus and continued draft preservation. Both supplied results pass at 1440 and 390; inspected 390 validation screenshots. Create-form, textbook-title and science-area branches are source-reviewed only in this review.
- `root-tests.log`: 15 passing tests, with an initial jsdom attachEvent diagnostic. The later `tabs-tests.log` is clean after input-focus shims and supersedes that tab-runtime diagnostic. Existing suites were not repeated. Independent `git diff --check` passed.

## Material limits

This review does not certify a full menu audit, every class/textbook relation flow, successful real save/readback, production auth transitions, database behavior, external providers, or deployment. Browser artifacts and writes recorded by their scripts are synthetic. No claim of general performance improvement beyond avoided same-query calls is made.

The repository's pinned [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) were consulted for focus and inline-form-error mechanics; repository business and UI contracts remain the decision criteria.
