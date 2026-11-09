# #234 date override reader: local release preparation

Status: local productization only. No commit/push/PR, CI run, merge, production SQL,
production data, deployment or operational QA is authorized by this artifact.

## Exact scope

Base main: 5b6c6f9e7f4432b32a4195d285bdac53cd6d8adb (normal Git fetch).
The reader is unchanged from the previously measured source
9a4f1c589d577dec8ed6579fd2c376fa35a01ee2. PR247 changes its binding/context/resolver
dependencies. The existing request/approved/state exclusions cover the new
adoption path; the candidate body is unchanged.

Forward: supabase/migrations/20261109015335_timetable_date_override_native_reader.sql.
Recovery: supabase/rollbacks/20261109015335_timetable_date_override_native_reader.sql.
Only dashboard_private.read_timetable_operating_reference_v1() is replaced.
Expected raw prosrc MD5: bc52c94595c5b2cb294f2c1eebbb6bcc.
Result raw prosrc MD5: 297fe1400b5313adbd978ea859d98fbb.
Candidate SQL-definition SHA256 (without final LF):
ce2956de371dc29378b07a33c3e54251cd8f52d31d92c4204e50818656e37587.
These definition/source hashes are distinct representations; do not compare a
rendered function header or manually transcribed SQL to the raw prosrc MD5.

The ordinary active date-override branch selects each field by key presence:
session first (including explicit null/invalid values), then the date map.
Only four JSON strings with validated times and exact unique IDs from this
call's fresh catalogs can use the existing native path. Otherwise the original
input reaches the original resolver. classroomUnresolved=true on either object
also falls back. All previous identity/date/request/sourceSlot/approved/past
exclusions, weekly/cancellation behavior, raw values, output order, fingerprints
and close projection remain. No business data, index, permission or lock changes.
The migration's SET LOCAL timeouts affect that DDL transaction only; no request
deadline, readback condition or reader function setting is relaxed.

## Evidence and limits

- Prior candidate: 171 reduced-schema equivalence cases, 109 explicit oracles.
  Observed SQLSTATE was 00000 for all those cases; this is not nonzero-error
  coverage. Existing passed inputs and the four performance pairs are reused.
- Prior synthetic workload: PG17.11, 48 classes x 32 date-override sessions,
  48 entries in each catalog. Reader medians 1504.691 -> 336.702ms; 4/4 pairs
  faster, exact complete output hashes equal, resolver calls 1536 -> 0.
  This bypasses input preparation and generic resolver work as well as catalog
  scans; do not attribute the entire difference to the catalog SELECT.
- New migration lifecycle core: 19 checks passed in the existing isolated
  PostgreSQL17 cache. The exact forward/recovery DO blocks were executed.
  Exact 55000 messages, repeat application/recovery refusal, source/anchor/
  candidate/metadata drift, no overwriting of unknown definitions, nondefault
  cost/config preservation and complete final restoration were checked.
- New-main dependency cases: three complete-reader comparisons passed using
  PR247's actual full-context/binding/resolver replacements: verified adoption
  with conflicting date map, missing approval evidence, marker-only active.
  The first case proved both verified context flags, approved 18:00-20:00
  output and the original-date cancellation tombstone. No writer/auth/RLS
  integration was replaced by this reduced-schema evidence.
- Formal pgTAP/full-schema execution and exact final-source full CI remain
  required. Existing pgTAP-download denials are not bypassed. No new download
  is made for this local preparation.
- No proof of operational timeout resolution: real input distribution, reader
  durations, waits/locks and original request correlation remain unknown.

## Authorized application and recovery procedure

1. After independent exact-source review and required full CI, the authorized
   release owner records PR head/base/tested merge SHA/tree and rollback anchors.
   Publication, merge and production application retain their separate scopes.
2. Immediately before an authorized apply, preserve the actual function's
   definition, OID, owner, ACL and all runtime attributes in private recovery
   storage. Check raw prosrc against the baseline MD5. Do not publish raw
   operational definitions or recovery materials in issue comments.
3. Apply only the reviewed forward artifact transaction through the normal
   authorized migration path. Any 55000 drift rejects the entire transaction.
   Stop on a mismatch; do not normalize whitespace, weaken hashes, remove the
   guard, or overwrite a newer definition.
4. Verify exact candidate prosrc and unchanged metadata. Monitor then validates
   the original closing journey, returned result and post-refresh state.
   CI/DDL success alone does not mean the issue is fixed.
5. If recovery is authorized and the installed body still matches the candidate,
   apply the reviewed recovery artifact: it requires candidate MD5 and restores
   the exact previous body while preserving actual metadata. The migration
   ledger requires the release owner's normal reconciliation/forward-recovery
   procedure; executing a recovery file alone does not erase ledger history.
6. If there was an intervening body change, both artifacts refuse it. Diagnose
   that version before any new repair. Function recovery does not undo already
   committed business transactions or authorize closing-status changes.

Primary risks are whole-schema integration gaps, a production definition that
does not match the guarded source, and different operational workload shape.
The fallback and failure conditions remain strict; they are not relaxed to
obtain a successful save.
