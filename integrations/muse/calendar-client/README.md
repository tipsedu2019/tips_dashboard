# tips-calendar-api-candidate

DRAFT candidate client for the calendar v2 contract + `health.classAccess`
grant display. Offline contract review only — never pointed at production.

**Separate from the pinned class client** (`~/workspace/skills/tips-admin-api/`),
which remains frozen and untouched.

## Layout

- `bin/tips-cal` — the candidate CLI (Python 3, stdlib only)
- `bin/dynamic_credentials.py` — surrogate helper, copied unchanged from the
  pinned skill (no secrets; Sentinel swaps surrogates on approved egress)
- `tests/test_cal_mock.py` — 38 offline mock tests, no network
  (`python3 tests/test_cal_mock.py`)

## Commands

- `health` — shows apiVersion/credentialId/scopes plus `classAccess`:
  `all` (explicit grant, current + future classes), `selected` (UUID list),
  `legacy_all_read` (read-only grant; writes not authorized)
- `calendar-schools [--search] [--page]`
- `calendar-school-get --school-id --school-year`
- `calendar-changes-preview --school-id --school-year --expected-version
  --reason --events-json|--events-file`
- `calendar-operations-commit --preview-token [--idempotency-key]
  [--source-reference]`
- `calendar-operations-get --request-key`
- `calendar-operations-list [--page]`

## Contract behaviors mirrored from the pinned client

- Exit codes 0/2/3/4/5 with the same meaning.
- Client-side validation before any request (exit 2): max 100 events, exact
  type enum, Korean grade enum (`all` standalone), school-year window
  (Mar 1 – next Mar 1, end-inclusive dates), `checkedAt` within 30 days and
  not future, https source URLs, required `schoolIdentityEvidence`.
- Scope gates: `calendar:read` / `calendar:write` (names assumed — confirm).
- Preview leaves no journal entry on 409/422; TTL ~10 min displayed.
- Commit validates receipt: `operationId == key`, `kind == "calendar"`,
  `calendar.schoolId` and `verificationHash` match the preview expectation.
- Journal: separate `calendar-operations.jsonl` per canonical-origin /
  v2 / credentialId partition; fsync, 0600, corrupt-line = exit 4.
- Replay: same previewToken → GET existing key first, 0 new POSTs.
- Same key + different body → refuse before send (exit 2).
- 5xx / transport / unknown → exit 4, same-key GET recovery, no new preview.

## Draft assumptions (flagged as contract blockers to Codex)

See the handoff message: scope names, `legacy_all_read` write semantics,
`schoolIdentityEvidence` format, `conflictResolution` validation, `examTerm`
format, boundary-spanning events, `scienceAreaKey` validation, `all` grade
combos, `checkedAt` skew tolerance, calendar stale/idempotency-reuse codes,
exact `type` enum strings, deletion design.

## Contract answers applied (2026-09-30, incl. independent review round)

- Scopes are `calendar:read` / `calendar:write`.
- `legacy_all_read` never grants class writes; calendar permissions are
  independent of `classAccess` mode.
- `schoolIdentityEvidence`: required, trimmed free text, max 500 chars
  (no NEIS/address field exists).
- `conflictResolution`: trimmed non-empty text, max 500, retained in
  provenance; permits older `publishedOn`/`checkedAt` or a lower-ranked
  official source, but NEVER bypasses versions, authorization, identity
  matching, or validation.
- `examTerm` enum: `1학기 중간` / `1학기 기말` / `2학기 중간` / `2학기 기말`;
  not part of duplicate identity.
- Ranges crossing March 1 are rejected; any split must be faithful to the
  cited source.
- `scienceAreaKey` is REQUIRED for `과학시험일` and ONLY allowed there;
  every grade must be 고1/고2/고3 (`all` is not allowed for 과학시험일).
  The key value itself is server-validated against
  `workspace.scienceAreas`.
- `all` cannot be combined with other grades.
- `checkedAt`: 5 minutes of future clock skew tolerated, must be within
  30 days (client mirrors this tolerance).
- Source URL accepts http or https; embedded credentials rejected.
- `agent_stale` and `agent_idempotency_key_reused` are exact.
- Type strings exact, no guessing.
- Successful responses are exactly HTTP 200 (201 is indeterminate, exit 4).
- 422 `agent_calendar_metadata_invalid` protects malformed existing
  TIPS_META rows — surfaced as exit 3; the client never overwrites them.
- The endpoint upserts the specified events and never deletes omitted ones;
  explicit cancellation/deletion is future work — report conflicts rather
  than inferring deletion.
- Receipts now validate `data.calendar.school.id` **and** `schoolYear` against
  the preview expectation. The preview response is bound before anything is
  journaled: `before.school.id` and `after.school.id` must equal the
  requested school, `before.schoolYear` and `after.schoolYear` must equal
  the requested year, and `before.version` must equal `--expected-version`.
  `calendar-school-get` verifies the returned workspace's `school.id` and
  `schoolYear` against the requested ones.
- Workspace shape is strict: `school` needs non-empty id/name;
  `school.category` may be **null** (server schema permits it — the client
  reports unknown identity as-is and never invents it); `version` and
  `verificationHash` are 64 lowercase hex chars; `timezone` is `Asia/Seoul`;
  `scienceAreas` is a list; a null/non-dict workspace is exit 4, never an
  internal error.
- Provenance convention: `source: null` on a current row means an ordinary
  UI edit happened after the last API write — no provenance is verified
  for the current row; the old receipt still documents its own operation.
  No extra history endpoint is needed for this.
- Operation-list items carry `kind: "calendar"` (server-side); the list
  parser already requires it.
- v1 `/health` confirmed to return `classAccess` and a UUID `credentialId`,
  so it is the health source for this candidate (v2 `/health` requires
  `class-details:read`; same origin, journal partition unchanged).
- `calendar-school-get` prints the FULL workspace (events, scienceAreas,
  provenance included); preview prints full before/after/diff, not counts.
- `error:null` is required for SUCCESS. Durable FAILED receipts arrive as
  HTTP 200 with `data.state=failed` and `error=data.error`; the client
  validates operationId/kind first, then reports exit 3 on a recognized
  error.code/sqlstate. A POST failed receipt comes as 409/422 (or 503
  `agent_write_failed`); the durable state is established later via GET on
  the same key. A 5xx with a plausible data object is NEVER success.
- Receipt GET/list require `calendar:write`, like the server.
- Reject codes include the confirmed client/server set: `invalid_request`,
  `agent_invalid`, `agent_invalid_range`, `agent_invalid_catalog`,
  `agent_not_found`, `agent_forbidden`, `agent_no_change`,
  `agent_approval_workflow_required`, `agent_preview_expired`,
  `agent_preview_consumed`, `agent_idempotency_key_reused`,
  `agent_rate_limited`, `agent_write_failed`, plus the calendar-specific
  codes. Recognized 4xx → exit 3; 5xx (even with a recognized code) →
  exit 4, and 429 stops without retry loops.
- `schoolYear` must be 2000..2200; `expectedVersion` must be 64 hex chars;
  `credentialId` must be a UUID before it is used in a journal path.
- Health is read from `/api/v1/health` at the same origin: v2 `/health`
  currently requires `class-details:read`, while v1 accepts any valid
  calendar-only credential. Same canonical origin, so the journal partition
  is unchanged. (A combined class+calendar production grant includes
  `class-details:read` anyway.)
