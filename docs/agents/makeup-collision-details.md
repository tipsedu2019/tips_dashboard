# Makeup approval collision evidence

Issues: #249 and #241. Continues the existing PR #244 on main
`4548057e1d396532638d67e51dd92fb28cd34074`.

The previous warning fix hides a confirmed collision warning while dated
reservation context is unavailable. Approval remains blocked until its existing
context gate is satisfied. This change retains that fix and shows the collision
source, class/request/event title, room and occupied time in the existing request
detail warning. It uses information already returned through the authorized
workspace read and adds no request, database function or write operation.

The detail and badge share the existing completed-request self exclusion and
legacy binding rules. A verified own lesson is excluded; a different lesson of
the same class, stale binding and uncertain occupancy remain blocked. Displaying
an internal row/request identifier or raw API error is unnecessary. Titles are
rendered as React text, including long or HTML-like synthetic titles.

## Verification

- The current main merged normally into the existing PR branch without
  conflicts. The original warning fix and its four regressions were retained.
- The affected approval/performance and legacy UI suites passed 152 tests with
  no failures, cancellations or skips. New assertions cover UTC/Seoul, all three
  collision sources, exact excluded rows, stale proof, uncertain occupancy,
  completed canonical self exclusion, actual workspace detail and preserved
  disabled approval controls. Mocked transports performed no real approval.
- Changed-file ESLint and TypeScript noEmit passed. Current-head full CI is
  tracked separately in the PR.
- The previous PR's browser evidence covers its previous two-file source only.
  No cached Playwright browser was available for this revision. The official
  Chromium download returned HTTP 403 `Domain forbidden`; the installer failed.
  No alternate download route was used. Desktop and 390px browser layout checks
  for the new detail list remain unexecuted. React/JSDOM tests are not a visual
  or authenticated production smoke test.

## Remaining operating evidence

The actual failing request's accepted reservation context, occupancy response
and ownership proof are not available in this session. Existing observations
from ordinary screen text do not establish those response values. This change
does not prove the root cause of #249 or a successful approval. The new detail
can identify which already authorized source blocks the request, but a same
class/time/room match alone does not authorize excluding it.

Keep the existing server approval validation and client readiness gate. After
the required review and checks, use the normal authenticated request detail to
confirm the collision source. Actual request approval or other business changes
require their specifically authorized target. Do not use SQL-editor JWT/role
impersonation to replace the authenticated read.

There is no SQL migration or schema recovery. A release rollback reverts the UI
and regression commits through the normal reviewed application release path;
no request or schedule row is rewritten.
