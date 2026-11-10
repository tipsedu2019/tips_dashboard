# Class closing: reuse an unchanged successful validation

Issue: #234. Base: `4548057e1d396532638d67e51dd92fb28cd34074`.

The close gateway can perform a full timetable read for its baseline, inner
assertion, outer assertion and deferred finalizer. Existing one-use no-op reuse
is deliberately unavailable when legacy makeup rows exist. Recomputing the same
successful validation can exhaust the request budget on a large synthetic
history. This change preserves every assertion, deferred validation, UPDATE,
audit event, lock and failure condition.

## Scope

`20261110071000_timetable_close_validation_proof.sql` changes only the body of
`dashboard_private.validate_timetable_operating_reference_v1()`. It adds two
private tables and two private invoker helpers. Existing functions keep their
OID, owner, ACL, volatility, COST, STRICT, PARALLEL and settings. Original
migrations, timeout limits and client readback conditions are unchanged.

Reuse is eligible only when a class present in the transaction's initial weekly
reference has been closed at that transaction's timestamp. Ordinary saves and
past-correction contexts continue through the original validator.

A successful result is stored only if the following evidence remains identical
before and after validation, and is checked again at each later boundary:

- The exact baseline JSON text, using SHA-256.
- Every class value, ordered by class ID. An equal-valued residual UPDATE may
  reuse the result; changed content and numeric JSON representation may not.
- Visible MVCC tuple identities for normalized slots/sessions, teacher/room
  catalogs, requests, request events, calendars, transfers, profiles and the
  current account. No original source value is substituted by a client value.
- The database snapshot, actor/API role, close/schedule context and selected
  non-secret formatting/planner settings.
- Reviewed function definitions and execution boundaries, relation structure,
  RLS/ACL metadata, owner properties and live planning metadata.

Unknown inputs, inaccessible proof metadata or contract drift use the unchanged
validator body. Cancellation, deadlock and serialization errors propagate.
Proof records are inaccessible to application roles and cascade away with the
existing transaction baseline. They cannot authorize another transaction.

## Validation evidence

Native PostgreSQL 17 checks used an isolated cached container with no network,
ports, mounted data or production payloads. The application schema and triggers
came from the complete ordered migration chain. External auth/cron/storage
services were local stand-ins, so these checks do not replace full Supabase CI.

The prior whole-writer baseline reached its eight-second statement limit. The
inlined proof candidate completed the same bounded synthetic close in 4.294 s,
with two full reader calls. This is a separate-execution diagnostic sample, not
an operating improvement percentage or proof of resolution. Subsequent changes
only strengthened installation/recovery and private-table contract guards;
the validator and proof helper bodies are unchanged.

Native checks covered exact whole returned JSON text, SQLSTATE/message/detail,
NULL/malformed inputs, metadata/content edits, all tracked source relations,
actor and settings changes, definition/owner/ACL drift, cancellation and
serialization propagation. An authenticated-role gateway check retained three
validator calls, two assertions and the deferred finalizer. Separate connections
proved a fresh validation after a visible concurrent commit at READ COMMITTED
and unchanged output at REPEATABLE READ when that commit remains invisible.

The registered full-schema pgTAP file exercises the final migration, guarded
recovery, definition drift, the same domain boundaries and the authenticated
gateway. Full required CI and independent review of the exact tested source
remain release gates. Native diagnostics are not an independent review.

The synthetic timing omitted student/enrollment release load, production
contention and HTTP/browser cancellation. Makeup approval #249 uses a separate
date-scoped reader and has not been diagnosed by this closing experiment.

## Installation and recovery

Before application, confirm the exact reviewed artifact and base, successful
required CI, authorized operating scope and the current function metadata.
The forward guard accepts the prior validator body MD5
`5f577a02f6ee20daf14284c62e4ded05` and the pinned dependency definitions and
execution attributes. It installs body MD5
`4c8050293e2dbb8cb9ff0a7ae93a413e`. Reapplication and drift fail atomically with
SQLSTATE `55000`; do not loosen these checks to force an application.

The matching file under `supabase/rollbacks/` restores the original validator
body and removes only the new helpers/proof tables. It requires the exact
installed function and private-table contracts and preserves existing function
attributes. It does not rewrite any business row. A changed contract requires
investigation rather than an unguarded recovery.

After release, verify installed body/metadata and the originally failing journey
with its specifically authorized business target. Schema application, CI and
synthetic success do not constitute an operating closing or approval PASS.
