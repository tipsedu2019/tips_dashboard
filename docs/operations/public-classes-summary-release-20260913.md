# Public classes summary API release

This patch exposes `GET /api/public-classes/summary` for the separately owned public frontend. It starts from `origin/main` at `b7afcf3466997880382f6d8ce3ea2fc0800e8b2d` and adds only the summary route, responder, and focused tests. The existing full API, selected-class detail API, cache, payload normalizer, and public catalog loader are unchanged.

## Response and data boundary

- Return `source`, `generatedAt`, `availability`, and `classes`.
- Each class contains only `id`, `name`, `className`, `subject`, `grade`, `teacher`, `room`, `classroom`, `schedule`, `status`, `fee`, `tuition`, `capacity`, `enrolledCount`, and `waitlistCount`.
- Reuse the existing server-only summary query on `classes` and its tagged 600-second Next Data Cache. Roster arrays become aggregate counts before publication. Do not load full schedules, textbooks, or progress for this endpoint.
- Preserve confirmed empty results as HTTP 200. Reject malformed records and duplicate IDs atomically. Sanitize legacy snapshot fields through the existing public allowlist.
- Fresh live summaries use `public, max-age=0, s-maxage=600`. Bounded snapshots retain their original generation time and use `no-store`; failures return HTTP 503 with a generic error and `no-store`. Future or older-than-24-hour snapshots cannot appear current.
- No DB migrations, grants, RLS, privileged function, schema, or provider-send changes are required by this API patch. CMS/recruiting changes, if combined by the release owner, have separate migration and authorization requirements.

## Verification

Focused checks on the isolated candidate passed:

- 45 tests across summary API, private-field stripping, summary projection, full/detail compatibility, bounded failures, and cache invalidation.
- 7 additional tests against Next's real detail-cache implementation and existing mutation/invalidation contracts (52 focused checks total).
- ESLint for the three new code/test files.
- TypeScript compilation of the new route and its imports with the repository's strict, bundler-resolution settings.
- `git diff --check`.

Read-only verification at `2026-09-12T17:48:09Z` (2026-09-13 KST):

| Surface | Observation |
| --- | --- |
| Candidate responder, existing production summary query | 200, live, 67 classes, 23,087 bytes; only the 15 allowed class fields |
| Production full API | 200, 67 classes, 3,347,680 bytes |
| Production selected-class detail | 200, live; returned class matches the selected public class |
| Production summary URL before release | 404 `public_class_not_found`; request currently falls through to the dynamic class-id route |

Evidence during preparation: `/tmp/tips-public-renewal-backend-readonly.json`. This is source/responder verification against production reads, not proof that the new route has been deployed.

## Cutover order

1. The release owner reviews this API patch and runs the final combined dashboard production build/checks.
2. Deploy the dashboard backend first. Confirm the deployed SHA and `GET https://tipsdashboard.vercel.app/api/public-classes/summary` returns a fresh HTTP 200 with the allowlisted shape. Also recheck the full endpoint and a selected-class detail URL.
3. Only then deploy the public frontend and its same-origin API routing. Confirm `/api/public-classes/summary`, `/classes` filtering, selected detail, and timetable export through the public origin.
4. Keep the full and selected-detail endpoints available for rollback and compatibility. This patch does not modify the old dashboard classes screen.

No remote push, production deployment, database mutation, or message send was performed while preparing this API patch.
