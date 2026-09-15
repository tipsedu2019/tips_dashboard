# Premium dashboard: reproducible local baseline

2026-09-15. This is a bounded T01 browser baseline, not a completed A–G matrix or production verification.

## Fixed input and build

- Worktree: `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/internal-dashboard-only-20260915`.
- Rendered source: cleanup commit `5e423390f4a27180d0771d2a48baf0873f5ca14f`; pre-existing production `.next`, build ID `s9bqGPW5qsk60JpFG0wof`. No build was run by this task. Later checkout commits do not identify the code rendered by this server.
- Real Next pages, AuthProvider and feature components. Browser network interception provides synthetic Supabase/API DTOs; no copied operational HTML or replacement product routes.
- Fixed time `2026-09-15T05:30:00.000Z`, `Asia/Seoul`, Korean locale, light theme, reduced motion, fresh browser context, expanded desktop sidebar.
- Viewports: 1440×900 and 390×844. Exact Chromium version, route, role, build, fixture, API requests, response-ready outcome, errors and document overflow are in the manifest.
- Canonical output: `/tmp/tips-premium-dashboard-20260915/before/complete/manifest.json` and its 12 `A-*.png` images. The parent `/before` directory contains earlier contract probes and is **not** the accepted success baseline.

## Run

The application must be built with the dummy public Supabase URL/key below. For this baseline use the existing `.next`; do not rebuild it to reproduce the old screen after source edits. To compare a later implementation, build its own output with the same dummy public values and record its actual source SHA.

```sh
export PATH="/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
NEXT_PUBLIC_SUPABASE_URL=https://tips-internal-fixture.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only-anon-key \
node node_modules/next/dist/bin/next start -p 3215
```

In another terminal, from the worktree:

```sh
export PATH="/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
PREMIUM_SOURCE_SHA=5e423390f4a27180d0771d2a48baf0873f5ca14f \
PREMIUM_OUT=/tmp/tips-premium-dashboard-20260915/before/complete \
node scripts/qa/premium-dashboard-browser.mjs
```

`PREMIUM_BASE_URL` defaults to `http://127.0.0.1:3215` and rejects non-loopback hosts. `PREMIUM_ROUTES` accepts comma-separated page names; `PREMIUM_FIXTURES` defaults to `A`. `PLAYWRIGHT_PACKAGE` can point to another installed Playwright `package.json`; no dependency installation or package changes are required. `PREMIUM_SOURCE_SHA` is the SHA used to build the server, not necessarily current HEAD. If omitted, the manifest leaves rendered source unknown and separately records current checkout SHA.

The script exits nonzero for unknown API contracts, missing ready content, runtime/console errors, or document overflow. Visible images must finish decoding. API and Supabase requests are fulfilled locally or rejected; all other external browser requests are aborted and WebSockets closed. The harness never forwards API calls to the application server. Read RPC POST requests are logged as reads, not treated as database mutations. This is a browser interception boundary, not an OS-level server egress sandbox.

## Verified baseline

| Page | Fixture A data | PC/mobile outcome |
| --- | --- | --- |
| `/admin/dashboard` | Three schedule types, distinct subjects, times and places | Passed; original schedule counts and links render |
| `/admin/students` | 10 students, synthetic contacts, some null contacts | Passed; nonempty rows and pagination render |
| `/admin/registration` | Successful empty inquiry list; runtime/capability readers answered | Passed; empty state and nine stage tabs render |
| `/admin/textbooks` | One English textbook, price 12,000, stock 0 | Passed; successful inventory row and five work tabs render |
| `/admin/class-schedule` | Successful empty numbered page and catalogs | Passed; empty state renders |
| `/admin/statistics` | Overview: 10 students, 15 enrollments, three classes | Passed; accepted snapshot renders |

All 12 have zero unhandled API requests, runtime errors, console errors and document horizontal overflow. Desktop dashboard and mobile textbook screenshots were visually inspected, including the loaded TIPS logo and the nonempty inventory row. The other ten captures passed automated render checks; this is not a full visual/accessibility review.

Navigation/resource timing is recorded for diagnostic comparison only. Cold/warm five-run medians, LCP/INP/CLS, backend latency and human task times were not measured. No database, provider, real login, save, recipient send, deployment or production behavior is proven.

## Fixture coverage and follow-up

- **A executed** as above. Student detail, sort/filter/selection and the five textbook workflows are still separate interaction checks.
- **B data defined, not executed**: student18/school30/textbook100 characters; long daily-event title. Actual 60-character class-management row and detail fixture remain to be added.
- **C data defined, not executed**: zero students, schedule and inventory. Verify the old/new page-specific empty selectors before expanding the matrix.
- **D data defined, not executed**: 20 students; request search filters rows. Add a browser search→zero→clear→restore assertion.
- **E partial only**: daily schedule has three different types/subjects/places. This does **not** satisfy the registration three-track status/teacher/time correspondence fixture. Add real numbered-list parent and track supplement DTOs before claiming E.
- **F partial only**: responses can delay 2.5 seconds. Loading screenshot, prior-success→500 retention and B→A response reversal have not been implemented or executed.
- **G partial only**: anonymous local session mode and login return-path assertion exist. The mode was not executed here; authenticated forbidden role and mid-session expiry remain unimplemented.

The manifest records state as `rendered`, `failed` or `unhandled-contract`; a screenshot alone does not promote an unsupported state to a pass. The art direction and target measurements remain master-plan §§5–9. No separately approved target image, student-detail composition or new design approval is claimed by this harness.
