# Dashboard Google Chat Profile Mentions — Shared Foundation Evidence

## Completion boundary

- Plan task: `Task 7: Prove the Shared Foundation Is Provider-Zero and Ready for Observation`
- Evidence base HEAD: `7d1932b36feb42f28884fb11819224aa673a3eb2`
- Branch: `codex/google-chat-profile-mentions`
- Date: 2026-08-11 KST
- Scope: tests and this report only; production TypeScript and the frozen `104500` migration are unchanged.

This report proves the shared profile-mention foundation locally. It does not prove or perform a Git push, Production Supabase migration, Vercel deployment, Directory credential installation, mention-rule activation, webhook provider attempt, actual Google Chat room delivery, or recipient receipt.

## Added evidence

1. `tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs` assembles the production identity route, mention-setting route, and Google Chat provider with injected Supabase RPC, Directory, and fetch boundaries.
2. GET readiness and missing-credential POST paths keep Directory calls at `0` and webhook fetch calls at `0`.
3. One explicit identity sync calls Directory exactly `1` time and keeps webhook fetch calls at `0`.
4. Mention-setting, resolver, first snapshot, and frozen retry transitions add no Directory or webhook call. Retry returns the first immutable snapshot after identity and setting drift in the fixture.
5. An unadopted workflow returns an exact empty settings list and never enters the save transition.
6. The worker import graph contains no management Directory or profile-identity dependency.
7. pgTAP snapshots all pre-existing notification rule `enabled`, `revision`, and `active_template_id` facts, then proves identity, setting, resolver, and snapshot behavior does not change them.

## RED and mutation sensitivity

The production seams already existed after Tasks 1–6, so the completed provider-zero test first passed `3/3` without a production change. To prove the new negative assertion can catch the intended regression, a temporary GET-path Directory lookup was inserted into the production identity route:

- mutated run: `2/3` passed, `1/3` failed;
- exact failure: expected `directoryCalls: 0`, observed `directoryCalls: 1`;
- the mutation was immediately removed;
- restored focused run: `3/3` passed;
- production route diff after restoration: empty.

No test-only expectation was weakened to obtain GREEN.

## Fresh verification receipts

### Node matrix

Command:

```text
node --experimental-strip-types --test \
  tests/dashboard-google-chat-profile-identities.test.mjs \
  tests/teacher-google-chat-profile-identities.test.mjs \
  tests/notification-mention-settings.test.mjs \
  tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/teacher-account-linking.test.mjs
```

Result: `191/191` passed, `0` failed, `0` skipped, exit `0`.

### Isolated local database

Command:

```text
node --experimental-strip-types \
  scripts/run-registration-observation-local-db-qa.mjs \
  --execute --approved-local-db --focus chat-mentions
```

Result:

```json
{
  "mode": "executed-local-db",
  "focus": "chat-mentions",
  "runtimeVersion": 0,
  "providerCalls": 0,
  "cleanup": "passed",
  "report": {
    "status": 0,
    "primaryError": null,
    "cleanupErrors": [],
    "startAttempted": true,
    "setupStarted": true,
    "providerCalls": 0
  }
}
```

The focused pgTAP plan is `70`; the runner completed with status `0`. The database lifecycle used dynamic loopback resources and completed cleanup. No remote Supabase project was accessed.

### Static and build gates

- Supabase migration layout verifier: exit `0` (`Supabase migration layout verified.`)
- Targeted ESLint: exit `0`, no warnings or errors
- Full `tsc --noEmit --pretty false`: exit `0`, no diagnostics
- Next.js 16.1.1 Webpack production build: exit `0`, compiled in `3.6s`, static generation `80/80`
- `git diff --check`: exit `0`

## Frozen artifact hashes

```text
dd91bf230d575e8a4bfcc8bae276549c6c79c6e8ed0ffda3decf991d38c0408e  supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql
d5f433f76c46e8255eb30a0b90270f81d28e8634c6abcd0158925ad0aa1fbc88  src/features/notifications/server/providers/google-chat-provider.ts
d910f327bca9cf71ff688a7563a22472b52fd8dc06a3757a4be02738be1061f3  tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs
```

The frozen migration and production provider hashes remain exact.

## Supabase/security review

- No new schema or migration was created in Task 7.
- The existing `104500` migration remains frozen and keeps private-table RLS, direct privilege revocation, exact function grants, owner, active-actor checks, and empty search paths under its existing pgTAP coverage.
- The 2026 Data API default-grant change was reviewed; Task 7 changes no Data API exposure and retains the migration's explicit privilege model.

## Observation handoff

The shared foundation is locally ready for the observation consumer plan. The next consumer migration is `20260809105000` (`105000`). Only that consumer may seed the seven reviewed observation mention settings and connect canonical observation assignee facts to final prepare. This Task 7 evidence seeds no workflow row and activates no runtime or provider.
