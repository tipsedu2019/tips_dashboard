# Weekly-array reuse in the timetable reader (#234)

The shared timetable reader executes a SQL query over the same weekly JSON
defaults for each ordinary or cancelled legacy lesson. This forward migration
materializes those two ordered arrays once per class, after the existing default
checks, and uses PL/pgSQL `FOREACH` for the three repeated loops. Complete reader
and conflict validation still execute. Class/date order, duplicates, fingerprints,
fallbacks, authentication, locks, audit, and result confirmation are unchanged.

## Exact artifacts and recovery

- Base: `302ef1df83eb7626fd73b9726b5552d2e2d8f4cc`.
- Forward: `20261110140429_timetable_reader_weekly_arrays.sql`, SHA256
  `615db840b31c7653182893d159374b4d91a550940472a1fe1c152fd3c6c1ecac`.
- Recovery: the same filename in `supabase/rollbacks`, SHA256
  `deceb9f9f78c5bd4d9eef337860ea0e573d56add8e98d30a94141a1cf420f0a5`.
- Reader body MD5: `297fe1400b5313adbd978ea859d98fbb` to
  `bbad57545ec4346d979cfe0b0b9056f3`.

The transaction checks the exact original body and owner-only function boundary,
preserves the OID and every nonbody `pg_proc` field, and updates only this reader's
existing dependency fingerprint in `timetable_validation_reuse_contracts`.
Missing/stale fingerprints, altered table access, reapplication, and definition
drift abort with `55000`; they are not repaired implicitly. No new runtime table,
index, permission, lock, timeout, or proof acceptance condition is introduced.

Recovery checks the exact installed body and fingerprint, reverses the five
replacement anchors and restores this dependency fingerprint atomically. It
does not reverse business operations performed after deployment. Stop on drift;
do not remove guards or reconstruct SQL in an editor. Capture the relevant
function metadata and dependency row privately before application and verify
them afterward. Original migrations remain byte-identical.

## Evidence and limits

Isolated PostgreSQL 17.11, fixed cached official image, network disabled, two CPUs
and 768 MiB memory. Data are invented. External platform services are stand-ins.
Statement timeout remains eight seconds.

- Fifteen native differential cases preserve complete returned JSON text or
  exact SQLSTATE/message, including malformed inputs, skipped branches and
  cancellation. The prior diagnostic results are reused.
- In one backend, a twelve-class ABBA reader comparison took 489.067/411.379 ms
  before and 395.138/375.110 ms after (mean reduction 14.46%). Full outputs match.
- Separate cold whole-writer candidate runs succeeded in 3982.805 ms and
  3534.118 ms; the latter includes 104 normalized sessions. Each retains two
  full reader calls and three validator calls. A preceding eight-second baseline
  timed out. These separate executions are not a controlled improvement ratio.
- The new registered test has 30 native assertions, including exact migration
  and recovery artifacts, drift failures, metadata/dependency roundtrip, full
  output equivalence and nonzero errors. Official pgTAP is still a separate gate.
- The two earlier migration lifecycle tests temporarily restore their exact
  historical input with this guarded recovery, then reinstall this exact forward
  artifact. Their subsequent functional tests run the final reader. The historical
  artifact literals and assertions remain intact.

The full schema inventory grows from 114 to 115 files and the canonical migration
inventory from 198 to 199. Independent review, all required CI checks, deployment
readback and the original authenticated user journey remain separate gates.
Synthetic results do not establish the production timeout's sole cause or prove
that closing or makeup latency is resolved.
