# Makeup: distinguish snapshot content from pair ownership

Issue #249. The existing adoption predicate treats a matching lesson ID anywhere
in another nonterminal request's whole-class snapshots as a competing claim.
A previously completed, unrelated request can therefore block a new valid pair
because its unchanged ordinary original lesson was also in that full snapshot.

`20261110095800_makeup_legacy_snapshot_ownership.sql` changes only the body of
`dashboard_private.makeup_legacy_pair_competing_v1(public.makeup_requests,jsonb)`.
It preserves its SQL language, STABLE/invoker attributes, OID, owner, ACL, settings
and all callers. Existing migrations are unchanged. No index or privilege is
added, and no business record is rewritten.

The exception is deliberately narrow: the other request is a completed legacy
cancellation/makeup request with an approval actor, time and audit event; its
single makeup slot is consistent and outside both target dates; both snapshots
have exactly one byte-identical, ordinary active original lesson at the target
date and no target makeup identity/alias. Claimed rows, cross-links, changed date
maps, missing or malformed snapshots, duplicate identities and all unresolved
histories retain the previous conflict. Same cancellation ownership always
blocks. The current exact-pair, occupancy, authority, stale-input, locked writer,
audit and idempotency checks remain in place.

The forward accepts body MD5 `c892cccbbc7f755e0a2ea3876c5408d8` and installs
`d2864a81d9287b8956ba701b827b64a5`. Reapplication/definition or boundary drift
raises `55000` atomically. The matching guarded recovery restores the exact prior
body only when the installed body and function boundary match. Recovery does not
reverse any separately approved business transition.

PostgreSQL 17.11 synthetic checks reproduced the original false positive and
verified the narrow candidate. Four lifecycle checks cover unchanged metadata,
reapplication refusal, guarded recovery and attribute drift. The new 36-case
delta in the existing registered adoption suite was executed with native
assertion adapters, including authenticated context, actual approval, exact plan
delta and completed status, plus UTC/Seoul and genuine/ambiguous ownership.
Adapters are not official pgTAP: the full Supabase schema job and exact-source
independent review remain required. The first delta execution found a fixture
operator-precedence error; it was corrected without changing product SQL.

The earlier UI details and warning correction remain separate from this server
root-cause fix. Browser/authenticated production verification and actual business
success have not been claimed. No operating payload belongs in these fixtures.
