# Existing past lesson state correction

An existing legacy lesson can retain its time and resource IDs while a skipped
state needs correction. Ordinary schedule saving still rejects a new historical
reservation when another class has unresolved historical occupancy. The separate
administrator action reviews those unknown blockers and corrects only one saved
regular lesson's state. Known resource collisions continue to block it.

The saved row must own its start/end times and teacher/classroom catalog IDs.
Current weekly defaults, names and date-map values cannot fill missing historical
proof. The server preserves row IDs, all other rows, billing/content fields and
resource values. Forced, linked makeup, ambiguous, non-legacy, future and workflow
owned lessons are refused. A reason and current version are required.

The browser's **과거 상태 정정** dialog uses the shared dialog, alert and form
components. Unknown occupancy requires a separate checked acknowledgment before
explicit save. An uncertain save has no automatic write retry; a manual retry of
the identical reviewed command reuses its request key. Errors focus the local
alert and preserve the reason. Standard Tab, Shift+Tab and Escape remain available.

## Agent contract

`POST /api/v2/classes/{classId}/lesson-state-corrections/preview` accepts a strict
8192-byte JSON body with `expectedVersion`, `lessonId`, `date`, `expectedState`,
`nextState` and `reason`. States are `scheduled`, `cancelled` or source-only
`skipped`; the target is scheduled/cancelled. This does not change the ordinary
`pastChanges:false` capability or the existing `/changes/preview` restrictions.

The first `{data,error:null}` response has `reviewOnly:true`,
`reviewRequired:true`, `previewToken:null`, `blockerReviewHash`,
`unknownOccupancyCount`, `warnings` and `before`. Warning entries contain only
`{code:"unknown_occupancy",count}`; no other class or student details are exposed.
Even zero blockers require a second request. Repeat the exact command with both
`blockerReviewHash` and `acknowledgeUnknownOccupancy:true`. The acknowledged result
has `reviewOnly:false`, `reviewRequired:false`, a UUID token, `expiresAt`, `before`,
`after` and `notifications:{state:"not_requested"}`. Preview tokens expire after
the existing ten-minute interval.

Use existing `POST /api/v2/operations` with `{previewToken}` and a persisted UUID
`Idempotency-Key`. Recover an uncertain result with `GET /api/v2/operations/{key}`.
Compare `data.class.verificationHash` from applied receipt and readback to the
acknowledged `data.after.verificationHash`. No fresh key resolves uncertainty.
Existing admin creator checks, exact class grant and `class-details:read` plus
`lesson-plan:write` scopes remain required; this change creates no credential.

`agent_review_stale` maps to 409; `agent_unknown_occupancy_ack_required` to 422.
Partial/false acknowledgment is 400/`invalid_request`. Existing typed envelopes
remain stable. Unknown 503 failures add only a server request ID, fixed phase,
optional validated SQLSTATE and matching `X-Request-Id`; raw messages, requests,
headers, tokens and stacks are not logged. Malformed producer success fails closed.

## Verification

- Final synthetic JavaScript/DOM/API regression: **116/116** passed.
- Full TypeScript check and webpack production build passed. Full ESLint: zero
  errors and seven existing warnings outside this change.
- A fresh isolated PostgreSQL baseline passed **1,937** assertions; three related
  SQL files passed **165** assertions, including 104 correction assertions. Fixtures
  exercise 60 saved rows, 23 unknown blockers, no sends, scope/auth revocation,
  known collisions, stale review, same-key replay and the deferred commit guard.
- The exact rollback passed eight checks: old dispatcher/apply/guard restoration,
  new RPC/context removal and private durable attestation/history preservation.
- Actual frozen Next query route with synthetic transport: **10/10** browser
  cases passed at 390px and 1440px. They cover warning/zero-warning explicit save,
  collision and stale focus, no automatic retry, same-key manual retry, Escape
  focus restoration, Tab/Shift+Tab and no horizontal overflow. Other 59 rows and
  the existing Oct6 exception remain unchanged. All Supabase/API traffic is
  intercepted; no production or provider write is claimed by browser results.

Migration SHA-256: `8456b73483c15448e5a017234578cca5e6797a192641e94197b522a84d52f9dc`.
Rollback SHA-256: `11f6a2c2f60cd9cf4fe5247a961af363d7bbf90a32dadef508ee1673d58aebdb`.
Rollback restores the prior functions and retains corrected lessons and audits.
Operating schema/deployment evidence and the sole authorized writer's actual
receipt/readback are recorded separately; offline tests do not establish them.
