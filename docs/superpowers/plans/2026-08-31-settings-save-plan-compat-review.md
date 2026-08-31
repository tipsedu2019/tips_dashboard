# Settings save plan compatibility preflight

Date: 2026-08-31. Scope: read-only challenge of three requested contracts. No implementation, database connection, SQL execution, network/browser use, commits, deployment, or sends. The only executable check was an in-memory Node/Intl comparison; it is not SQL parity evidence. No relevant memory result was used.

## Verdict

The journal + invoker atomic-save design remains viable. Two precise decisions are required before its SQL implementation can be approved: the school comparator, and teacher lock acquisition/closure under existing FK writes. The plan already recognizes sort parity and lock testing, but its present wording is insufficient to implement those contracts unambiguously. Same-team moves are correctly specified. Actor-owned receipts are acceptable retry state for successful calls through this API, not an unforgeable exactly-once execution attestation.

## 1. School sorting: actual comparator incompatibility, already acknowledged but not resolved

Current source `src/features/management/school-master-workspace.tsx:335–341` sorts the **current raw draft names** with `localeCompare("ko-KR", { numeric: true })`, multiplying only the comparison by direction. It has no ID/string fallback. Name whitespace normalization happens at Save, `:268–275`, using `:87–88`.

The final collation definition `supabase/migrations/20260813194812_dashboard_statistics_sources.sql:5–8` is ICU `ko-u-kn-true`, **deterministic=true**; its guard explicitly rejects a nondeterministic replacement (`:30–35`). No subsequent migration replaces this collation. Deterministic byte tie-breaking therefore cannot stand in for JavaScript comparator equality. Adding the journal ordinal after this collation does not repair equality lost inside the collation comparison.

An in-memory check using the current bundled Node 24.19.0 / ICU 78.3 confirmed the existing comparator returns zero for each of:

- `학교 02` / `학교 2`;
- precomposed `é` / `e` + combining acute;
- precomposed `가` / decomposed Hangul `가`.

Both ascending and descending JS sorts preserve the pair's incoming order. The same check returns nonzero for `학교  2` / `학교 2`, so trimming/collapsing the patch before a later name-sort also changes current behavior. Runtime resolved options were sort usage, variant sensitivity, punctuation significant, numeric=true, caseFirst=false. These results are a reference fixture, not proof of every browser/SQL ICU version's parity.

Smallest plan correction:

1. Keep the existing global collation unchanged, since other readers and its guard require its deterministic contract. Choose a **settings-local comparator/equality mechanism** and require exact local SQL parity fixtures before accepting it; a separately scoped nondeterministic ICU collation is one candidate, not an already-verified solution.
2. Define equal-name ties as the array ordinal **immediately before that name-sort operation**, ascending in both directions. Do not reuse the original database ordinal after a prior move. Example: `[A:"학교 02", B:"학교 2"] -> move A down -> name-sort` must remain `[B,A]` in either direction.
3. Clarify that the global “stable sorts end with id” rule applies to persisted page ordering. It must not introduce an ID tie-break into this user action. After the action, unique sequential server ranks make page order deterministic.
4. Preserve raw name patches during chronological replay; normalize at the existing final-save boundary. Require raw-whitespace rename/sort fixtures, not only normalized names.

Affected plan text: `docs/superpowers/plans/2026-08-31-numbered-pagination-settings-workflows.md:20,100–101`; existing warning is `2026-08-31-settings-save-contract-audit.md:55`. This is a known unresolved implementation gate, not a newly discovered shipped regression.

### Same-team moves: compatible as written

`teacher-master-workspace.tsx:543–546` selects the team from the full draft array. `:690–712` locates the neighboring same-team ID, then `:307–318` removes the source and inserts at the target's **original global index**. Thus `[A(English),B(Math),C(English)]`, moving A down, becomes `[B,C,A]`, not `[C,B,A]` or `[B,A,C]`. The audit's `:53` explicitly says splice, and `:603–621` confirms insertion after the chosen team's last global row. Team changes alone preserve positions. The plan already covers this; only use literal expected arrays in its promised tests. No redesign is warranted.

## 2. Teacher locks: signup order alone does not cover the final FK write graph

Final-chain source facts:

- Final signup function is `public.handle_new_dashboard_user()` in `20260722093000_science_team_and_classroom.sql`: profile update/insert at `:55–110`, teacher insert/update at `:145–183`, then profile backlink update at `:186–191`. Profile-first indeed matches this path.
- `20260429162000_teacher_account_link_audit.sql:14–16` defines `profiles.teacher_catalog_id -> teacher_catalogs.id ON DELETE SET NULL`; `:46–48` defines the reciprocal `teacher_catalogs.profile_id -> profiles.id ON DELETE SET NULL`. No later migration drops/redefines these FKs.
- The backlink index is nonunique (`:29–30`), whereas teacher `profile_id` has a nonnull unique index (`:61–63`). The schema does **not** guarantee reciprocal one-to-one link consistency.
- The legacy direct delete remains `management-service.js:1567–1569`. Its teacher table write invokes the profile SET NULL action inside the same database statement/transaction. The legacy upsert and explicit profile sync (`:1554–1564`) are separate awaited API calls, so they must not be inaccurately described as one reverse-order transaction; the FK delete is sufficient evidence.
- Final teacher writes allow admin/staff/teacher (`20260318120000_teacher_classroom_catalogs.sql:80–86`). Final profile SELECT/UPDATE differ (`20260808172743_rls_policy_initplan_consolidation.sql:90–131`): identity-readable other profiles need not be updatable, and other profiles may be invisible.
- Final audit trigger is `dashboard_private.log_dashboard_audit_event_v2`, installed on teachers/profiles in `20260814115116_dashboard_audit_diff_format.sql:225–230`. It obtains an entity-keyed advisory lock at `:158`, not a global audit lock, and keeps constrained writer authority. No reason was found to change that writer.

Concrete lock cycle permitted by the current plan (`settings-workflows.md:131`):

1. Save A locks profile P and has not acquired teacher collection SHARE ROW EXCLUSIVE yet.
2. Legacy DELETE B obtains teacher ROW EXCLUSIVE and deletes teacher T; the FK action must update P's `teacher_catalog_id` and waits for A's profile lock.
3. A waits for B's teacher ROW EXCLUSIVE to release before getting SHARE ROW EXCLUSIVE.

This is a real source-derived wait cycle, **not a reproduced SQL deadlock**. A bounded timeout can abort it safely, but does not make “matching signup order” a globally consistent lock-order argument. If the selected profile row lock is `FOR UPDATE`, a teacher insert/relink can similarly hold its teacher table lock while waiting for the FK's profile key-share lock. `FOR NO KEY UPDATE` avoids that particular key-share conflict but does not resolve the DELETE/SET NULL cycle.

Smallest plan correction:

- Specify the exact profile row-lock mode and collection-acquisition conflict policy. Do not wait indefinitely for the teacher collection while holding profile locks. One bounded, non-expansive candidate is teacher collection acquisition with NOWAIT after profile prelocks, aborting the entire request on contention, retaining its UUID/draft, and recording no receipt. Whether NOWAIT or another fail-fast strategy is selected, prove it in the existing two-connection local harness rather than claiming deadlock prevention from order text.
- Define the lock set separately for explicit linked-profile synchronization and implicit FK deletion side effects. Include old/new visible links and **visible incoming backlink rows** for deleted teachers, even when `teacher.profile_id` does not point back at them. Revalidate the observable set after collection acquisition, without acquiring newly discovered row locks in a reversed order. Missing hidden incoming rows cannot be “discovered” by an invoker query: preserve the FK action and a bounded abort policy for its contention, not an elevated read/hash or bypass.
- Extend the already-planned concurrency fixture to cover this exact save-versus-direct-delete interleaving, direct insert/relink when relevant to the selected row-lock mode, signup, reverse-only backlink fixtures, and concurrent profile mutation. Assert actual resulting SQLSTATE/rollback/receipt absence; keep genuine lock/deadlock codes separate from `55000/settings_revision_conflict`. No SQLSTATE was observed in this preflight.

Parent follow-up candidate: `FOR NO KEY UPDATE NOWAIT` for deterministic profile prelocks followed by teacher `SHARE ROW EXCLUSIVE NOWAIT`, preserving native `55P03` as retryable busy, with the original draft/UUID and no receipt. This is a sound narrow correction for the **prelock phase**: it avoids the key-share conflict of FOR UPDATE and refuses to add the second wait edge in the demonstrated delete cycle. After the collection lock, changed observable link/lock sets must abort rather than trigger extra locks in a new order. Keep transaction-local lock_timeout active for the whole call as well: implicit hidden/reverse-only FK cleanup can still acquire unprelocked rows during DML. Therefore claim bounded, atomic abort on contention, not that all legacy trigger paths become globally deadlock-free. None of these candidate SQLSTATE behaviors was executed here.

One authorization fixture must accompany that candidate: a profile SELECT-visible only through email/login identity matching, but not UPDATE-authorized under `profiles_update_v2`. Row-locking SELECTs need their actual RLS behavior verified in the local final-chain tests; do not infer update/lock eligibility from a successful version read. Distinguish a missing/inaccessible synchronization target from a readable already-matching profile, and decide the conservative failure behavior explicitly if the required lock cannot be acquired under existing rights. Do not grant profile UPDATE merely to make the prelock succeed.

### Revision / hidden-profile boundary

The plan's visible-profile tuple + fixed unreadable sentinel (`settings-workflows.md:47`) is correct for avoiding a hidden-field hash oracle. “Fingerprint” is not an authorization capability; the fingerprint of a small visible tuple is not a secret. Keep identical treatment of inaccessible and absent requested profile targets, and never use a definer to resolve a hidden profile's no-op status. A readable profile still requires actual UPDATE authorization; an unreadable explicit sync candidate may conservatively fail as already planned.

The necessary clarification is that implicit FK cleanup is not equivalent to explicit profile-role synchronization. A hidden reverse-only backlink must not be hashed, returned in changedIds, or require expanded SELECT/UPDATE privileges merely to preserve a previously authorized teacher delete. Hidden-only changes must not alter the fixed sentinel. Visible-to-hidden visibility changes may alter the revision because the caller's observable scope changed. No extra hidden profile read is justified.

## 3. Actor-owned receipts: compatible retry mechanism, limited trust contract

`settings-workflows.md:108,129–134` and audit `:83–91` already specify the important mechanics: actor/request uniqueness, canonical entire semantic payload, transaction advisory serialization, receipt lookup before stale-version checks, receipt in the same transaction, no write replay, no expiry, no own UPDATE/DELETE, and explicit prohibition on treating receipts as audit/security evidence. There is no current settings receipt implementation to verify.

That is sufficient for at-most-one committed application and exact stored-result replay of an immutable request **submitted through this RPC**, after an initial successful commit. Failed transactions leave no receipt; a replay need not prove that the current collection still has the returned historical revision. Existing audit triggers remain the independent audit mechanism.

The precise limit is that an invoker caller necessarily has receipt INSERT privilege. Own-actor RLS prevents cross-actor claims; it does not prove that an own-actor row was created by this RPC or that its claimed result ever happened. A caller with an applicable SQL execution path can preinsert its own matching fake receipt and suppress its own later Save. The non-exposed schema removes the direct PostgREST table endpoint, not the SQL role privilege. This is not demonstrated remote exploitability and not authority escalation; the plan already intentionally declines receipt provenance. Do not introduce a definer solely to turn retry state into an attestation.

Smallest plan clarification/tests:

- State the guarantee as “no duplicate committed effects for identical requests through the API, with original-result replay for its committed receipts”; do not claim exactly-once execution provenance for arbitrary actor-authored rows.
- Replay must remain a no-DML return after current caller/catalog authorization. A receipt must never authorize a write, bypass present role checks, or imply current-state freshness. Validate the narrow stored response shape before returning it; reload the authorized numbered page as already planned.
- Negative tests should prove another actor cannot insert/read the actor's receipt, own receipts cannot be updated/deleted, preinserted own retry state cannot grant writes or produce independent audit evidence, and concurrent same-request calls perform one commit. Preserve full transaction rollback if receipt insertion fails; never turn a uniqueness conflict into success after committing unreceipted DML.
- “No v1 expiry” includes no inadvertent cascading receipt deletion; choose actor-reference deletion semantics consistently with the stated retention/retry horizon.

These are trust-boundary wording and proof requirements, not a blocker requiring a privileged writer or an authorization redesign.

## Handoff

Only this report was written. Production source and parent/other-agent edits were not touched. The next useful action is to resolve the two explicit SQL contracts in the plan, then obtain local final-chain pgTAP/concurrency/Intl parity evidence. This report does not mark settings implementation, SQL verification, or the app-wide rollout complete.
