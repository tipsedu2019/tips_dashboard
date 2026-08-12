# Registration Observation Workflow Delivery Roadmap

> **For agentic workers:** 이 문서는 실행 순서와 공통 계약을 고정하는 상위 로드맵이다. 직접 구현하지 말고 아래 다섯 실행 계획을 순서대로 진행한다. 각 실행 계획은 superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans를 사용한다.

**Goal:** 등록 신청 직전의 과목별 청강 예약, 교사 피드백, 원장 결정, 프로필 기반 Google Chat 담당자 멘션, Google Chat 운영 알림, SOLAPI 고객 안내를 독립적으로 검증·배포·활성화한다.

**Architecture:** 예약·피드백 같은 핵심 도메인 저장과 외부 전송을 분리한다. 핵심 mutation은 canonical 사실과 revision을 검증한 뒤 공통 domain outbox까지만 원자 저장하고, Google Chat과 SOLAPI는 각자 별도 materializer·queue·worker·activation을 소유한다. 스키마 준비 여부와 사용자 노출 runtime을 분리해 활성화 전에도 안전하게 readiness를 확인한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Postgres/PostgREST/RLS, Google Chat webhook, SOLAPI AlimTalk, Node test runner, pgTAP, ESLint, Vercel

## Product Authority

- 승인된 제품 계약: `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`
- 승인된 공용 멘션 계약: `docs/superpowers/specs/2026-08-10-dashboard-google-chat-profile-mentions-design.md`
- 이 로드맵은 구현 경계를 나눌 뿐 제품 계약을 변경하지 않는다.
- 계약 변경이 필요하면 구현을 중단하고 설계 문서를 먼저 수정·승인받는다.

## Executable Plans

| Order | Plan | Independently testable outcome |
|---:|---|---|
| 1 | `docs/superpowers/plans/2026-08-09-registration-observation-core.md` | default-OFF schema/readiness, 예약 원장·RPC·목록/상세 UI, 공통 outbox |
| 2 | `docs/superpowers/plans/2026-08-09-registration-observation-feedback-enrollment.md` | 교사 피드백·원장 결정·등록 첫 수업일·달력 |
| 3 | `docs/superpowers/plans/2026-08-10-dashboard-google-chat-profile-mentions.md` | 프로필 identity·규칙별 토글·공용 resolver/snapshot·provider text, adopted rule 0/provider 0 |
| 4 | `docs/superpowers/plans/2026-08-09-registration-observation-google-chat.md` | 과목방 교사·관리팀방 원장 멘션, immediate/due worker와 종류별 default-OFF 활성화 |
| 5 | `docs/superpowers/plans/2026-08-09-registration-observation-solapi.md` | 고객 예약 안내·3시간 리마인드, 템플릿 verification/live 활성화 |

뒤 계획은 앞 계획이 정의한 public/private interface만 소비한다. 앞 계획의 migration이나 RPC를 다시 정의해 부수효과를 붙이는 방식은 금지한다.

## Global Safety Constraints

- 청강은 과목 track 단위이며 `등록 신청` 직전의 선택 경로다. 상담 완료에서 직접 등록하는 기존 경로는 유지한다.
- `ops_registration_appointments`는 예약, `ops_registration_observations`는 반·회차·참석·평가·결정 사실을 소유한다.
- appointment `notification_revision`, observation `revision`, observation `feedback_revision`, track `workflow_revision`의 책임을 합치지 않는다.
- browser가 보낸 학생·과목·반·선생님·강의실·campus·회차·전화번호 문구를 신뢰하지 않는다. DB가 canonical 관계를 다시 resolve한다.
- 모든 mutation은 request key와 해당 expected revisions를 검증하며 같은 `(actor_id, request_key)`와 같은 fingerprint 재호출에는 저장된 response를 반환한다.
- 행 잠금 순서는 `track → observation → appointment → provider-independent due/outbox rows → mutation request`다. request-key advisory lock은 이 순서 전에 한 번만 잡는다.
- 외부 provider를 DB transaction 안에서 호출하지 않는다. Google Chat/SOLAPI 실패는 예약·피드백·결정을 rollback하지 않는다.
- 미등록·대기·재청강은 enrollment/admission/payment 데이터를 생성·수정·삭제하지 않는다.
- 담당 교사에게 전체 registration task 또는 sibling track SELECT 권한을 추가하지 않는다.
- 첫 화면 summary에는 track에 transactionally maintained된 `observation_attempt_count`와 partial-unique open row에서 최대 1건만 읽는 nearest appointment scalar만 포함하고 feedback·교재·진도·schedule_plan/history count aggregate를 넣지 않는다.
- 상세 read는 12초 AbortSignal, `.retry(false)`, generation-aware in-flight/settled cache를 사용한다.
- 기존 migration은 수정하지 않고 forward-only migration만 추가한다.
- 각 DB task는 clean local migration apply와 focused pgTAP을 해당 task 안에서 통과해야 GREEN이다.
- 모든 신규 migration은 저장소가 고정한 Supabase CLI `/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go` `2.103.0`의 `migration new`와 아래 표의 exact slug로 먼저 생성한다. 실행 전 reviewed frozen target 부재를 확인하고 생성된 동일 slug 파일이 정확히 한 개인지 검증한다. 생성 파일은 untracked이므로 exact generated path에 `git add -- "$generated"`를 먼저 실행한 뒤에만 각 task block의 literal frozen path로 `git mv --`한다. move 직후와 SQL 작성 뒤 target을 다시 stage하고, `git diff --cached --name-only --diff-filter=ACMR`에서 같은 slug가 frozen target 정확히 한 개, `--diff-filter=D`에서 staged source/orphan이 0개인지 검증한다. target 충돌, CLI version drift, 생성 파일 0개/2개 이상, staged orphan, empty target, `git diff --cached --check` 실패면 그 task를 중단한다. 직접 `touch`, redirection, `apply_patch`로 migration 파일을 처음 만드는 것은 금지한다.
- `SECURITY DEFINER` mutation/read surface는 `SET search_path = ''`, schema-qualified relation/function, 함수 내부 explicit actor·role/access 검증을 갖는다. pure private ID/hash/trigger helper는 모든 API role에서 exact EXECUTE를 revoke하고 actor-guarded definer caller/trigger chain에서만 도달하는 경우에만 직접 actor 인자를 생략할 수 있으며 그 call graph를 pgTAP으로 고정한다. 필요하지 않은 `authenticated`, `service_role`도 revoke하고 실제 호출 역할에만 최소 grant한다. public enrollment wrapper처럼 기존 definer 경계를 유지하는 함수도 같은 ACL을 pgTAP으로 고정한다.
- 새 runtime, Google Chat rule, SOLAPI message kind는 모두 default OFF다. code push나 migration만으로 provider가 활성화되면 안 된다.
- 공용 Google Chat 멘션 foundation은 기존 workflow 설정을 채택하거나 활성화하지 않는다. action-required 기본 ON/informational 기본 OFF는 각 workflow 채택 migration이 별도 mention-setting row를 seed할 때만 적용한다.
- Directory 조회는 선생님 설정의 명시적 동기화에서만 허용한다. worker/provider hot path는 DB에 미리 검증된 identity snapshot만 사용하고 Directory 호출 0을 유지한다.
- 테스트/DB 적용/Git push/Vercel READY/Google Chat receipt/SOLAPI approval·receipt는 서로 다른 증거로 보고한다.

## Cross-Plan Database Contract

### Readiness and runtime are separate

```sql
public.registration_observation_schema_readiness_v1() returns jsonb
-- authenticated admin/staff only
-- {"schemaReady": true, "missingObjects": [], "runtimeVersion": 0}

public.registration_observation_runtime_version() returns integer
-- authenticated; 0=UI/mutations disabled, 1=enabled
-- PGRST202/42883 schema-cache miss is mapped to 0 by the TypeScript client, not by SQL

public.activate_registration_observation_runtime_v1(
  p_expected_current_version integer,
  p_request_key text
) returns jsonb
-- rechecks schema readiness in the same transaction before changing 0 -> 1
```

Rollout order is therefore fixed:

```text
all inert/default-OFF migrations and matching code deployed while runtime 0
→ explicit campus prerequisites completed
→ schema readiness true
→ runtime-0/provider-zero smoke
→ atomic activation RPC
→ public runtime probe 1
→ UI/RPC smoke
```

### Provider-independent domain outbox

The core plan owns one stable outbox. Later plans must not `CREATE OR REPLACE` booking/feedback RPCs to attach provider logic.

```sql
dashboard_private.registration_observation_domain_events(
  event_id uuid primary key,
  observation_id uuid not null,
  appointment_id uuid not null,
  notification_revision integer not null,
  event_kind text not null,
  booking_fact_hash text not null,
  source_revision jsonb not null,
  occurred_at timestamptz not null,
  unique(observation_id, notification_revision, event_kind)
)
```

`source_revision` exact shape:

```ts
type RegistrationObservationSourceRevision =
  | { authority: "normalized"; sessionId: string; revision: number }
  | { authority: "legacy"; sessionKey: string; contentHash: string }
```

`appointment_id` is a required integrity fact but not part of the unique key because the approved identity is exactly `observation_id + notification_revision + event_kind` and observation↔appointment is 1:1.

Legacy canonicalization is frozen across every resolver/materializer: source array is `schedule_plan.sessions`, falling back to `session_list` only when the former is not an array; stable key priority is nonblank `sessionKey → session_key → id`; state priority is `scheduleState → schedule_state → state`, lowercase `normal` maps to `active`, and only `active|makeup` remains selectable. The legacy `contentHash` uses the existing `continuous_class_schedule_content_hash_v1(jsonb)` over an envelope containing only the selected canonical session and only its referenced textbook catalog entries. Unselected session changes must not change that hash.

Closed `event_kind` list:

```text
observation_scheduled
observation_rescheduled
observation_canceled
observation_attendance_recorded
observation_no_show
observation_feedback_submitted
```

- core booking mutation inserts scheduled/rescheduled/canceled.
- feedback mutation inserts attendance_recorded/no_show/feedback_submitted.
- Google Chat and SOLAPI plans consume these rows with their own materialization checkpoints and unique identities.
- every worker re-reads runtime, source status, appointment notification revision, source revision and booking fact hash at claim and immediately before provider dispatch.
- normalized revision 또는 legacy selected-session content hash만 변했을 때는 exact source identity 한 건을 최대 한 번 bounded refresh해 현재 booking fact hash를 다시 계산한다. booking hash가 같으면 content-only drift로 허용하며 preparation payload만 같은 선택 회차의 최신 교재·진도로 갱신한다. source revision/hash 불일치 자체는 `source_dirty`가 아니다. class/subject/authority/ID/key/state/date/time/teacher/room/campus가 변해 booking hash가 달라진 경우에만 core drift가 `source_dirty`를 반환하고 provider attempt는 0이다.

### Local DB runner

Plan 1 creates one reusable runner:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs \
  --execute --approved-local-db \
  --focus schema
```

`--focus` accepts exactly one of `schema | booking | workspace | core-review | feedback-access | feedback-submit | feedback | enrollment | chat-mentions | google-chat | solapi-contract | solapi-queue | solapi`. The runner must create a clean isolated database, apply repository migrations in order only through the selected focus ceiling, run the requested pgTAP files, report the exact failed assertion, and tear down the temporary database on success or failure. `feedback-submit` runs access + submit pgTAP, while `feedback` runs access + submit + decision pgTAP from separate files. `chat-mentions` ends at `20260809104500`, seeds no adopted workflow row and has provider/outbox stage `core`. A DB task cannot defer this check to the final rollout plan.

Single-session mutation pgTAP may set runtime `1` only inside its rollback transaction. A `dblink`/multi-session concurrency test must not rely on that uncommitted value: the isolated runner creates uniquely named fixture rows and sets runtime `1` through a separate superuser connection, commits them before opening worker connections, then disconnects workers, restores runtime `0`, deletes only those exact fixture IDs in reverse FK order, commits cleanup, and verifies runtime `0` from a fresh connection. Enrollment activation concurrency starts from committed runtime `0`, performs the real admin RPC in worker connections, and restores `1→0` with the exact Gate B-R rehearsed SQL body before deleting only exact fixture IDs; an outer transaction rollback is never claimed to undo a remote commit. No test helper, bypass GUC, deactivation RPC, direct-write grant, or fixture row is installed by a production migration.

Reviewed frozen migration identities are closed across the five normal plans. A worker must use the slug in the right column with the pinned CLI, stage the exact generated path, then move it to the exact target in the left column; it must not select a fresh timestamp instead. The sole exception is Gate B-R: no artifact exists in the healthy tree, and an incident-generated timestamp is accepted only through its separate failure declaration, staged-orphan gate, two reviews, and two approvals.

| Frozen target | `migration new` slug |
|---|---|
| `20260809100000_registration_observation_core_schema.sql` | `registration_observation_core_schema` |
| `20260809101000_registration_observation_reads.sql` | `registration_observation_reads` |
| `20260809102000_registration_observation_booking.sql` | `registration_observation_booking` |
| `20260809102500_registration_observation_feedback_access.sql` | `registration_observation_feedback_access` |
| `20260809103000_registration_observation_feedback_mutations.sql` | `registration_observation_feedback_mutations` |
| `20260809103500_registration_observation_feedback_decisions.sql` | `registration_observation_feedback_decisions` |
| `20260809104000_registration_observation_enrollment_source.sql` | `registration_observation_enrollment_source` |
| `20260809104500_dashboard_google_chat_profile_mentions.sql` | `dashboard_google_chat_profile_mentions` |
| `20260809105000_registration_observation_google_chat.sql` | `registration_observation_google_chat` |
| `20260809106000_registration_observation_solapi_contract.sql` | `registration_observation_solapi_contract` |
| `20260809106100_registration_observation_solapi_queue.sql` | `registration_observation_solapi_queue` |
| `20260809106200_registration_observation_solapi_dispatch.sql` | `registration_observation_solapi_dispatch` |

## Cross-Plan Type Contract

```ts
export type RegistrationObservationDomainEventKind =
  | "observation_scheduled"
  | "observation_rescheduled"
  | "observation_canceled"
  | "observation_attendance_recorded"
  | "observation_no_show"
  | "observation_feedback_submitted"

export type RegistrationObservationRuntimeState = Readonly<{
  runtimeVersion: 0 | 1
  available: boolean
}>

export type RegistrationObservationSchemaReadiness = Readonly<{
  schemaReady: boolean
  missingObjects: readonly string[]
  runtimeVersion: 0 | 1
}>
```

All RPC response normalizers use exact-key validation. Unknown enums, malformed UUIDs, negative revisions and invalid timestamps fail closed before UI state changes.

## Delivery Sequence and Approval Gates

### Gate A: Plans 1–5 default-OFF artifacts implemented

- clean DB apply through `20260809106200` and all observation schema/booking/feedback/enrollment/profile-mention/Google Chat/SOLAPI pgTAP pass
- focused Node tests, ESLint, tsc, `next build --webpack`, `git diff --check` pass
- independent spec and code-quality review pass per task
- runtime, every Google Chat observation rule and every SOLAPI observation message kind remain OFF; provider attempts are zero

### Gate B: Core production release

1. Rebase the reviewed feature branch on current `origin/main` in the isolated worktree, keep it free of unrelated changes, finish every Plan 1–5 commit/review, and record `release_sha="$(git rev-parse HEAD)"`. Push that exact commit to its `origin/codex/...` feature ref; do not update `main` yet.
2. Freeze a trusted read-only pre-dispatch receipt and classify it as exactly one of these two states; every other or partially installed state is `drifted` and blocks dispatch.
   - First installation, exact token `not_installed`: `dashboard_private.registration_observation_runtime_settings`, `dashboard_private.registration_observation_domain_events`, `dashboard_private.google_chat_profile_identities`, `dashboard_private.registration_observation_chat_jobs`, and `dashboard_private.registration_observation_solapi_event_consumptions` are all absent; observation provider attempts are zero; and the complete local-only pending set is exactly `20260809100000`, `20260809101000`, `20260809102000`, `20260809102200`, `20260809102400`, `20260809102450`, `20260809102500`, `20260809103000`, `20260809103500`, `20260809104000`, `20260809104500`, `20260809105000`, `20260809106000`, `20260809106100`, `20260809106200`, `20260812002019`, `20260812003000` in that order, with unreviewed pending count `0`. The five added versions are reviewed prerequisites or follow-up fixes, not unreviewed extras. Do not require a runtime probe before its relation/function exists. The feature-ref workflow must transition this state to exact token `installed_inert`: all seventeen reviewed versions are installed, runtime is `0`, exactly seven adopted Google Chat mention-setting rows have the approved six ON/one informational OFF values, all eight Google Chat observation destination rules and both SOLAPI observation kinds are OFF, and observation outbox/consumer/job/template-receipt/provider-attempt counts remain zero.
   - Subsequent rollout, exact token `installed_runtime0`: the observation schema and runtime probe already exist, `public.registration_observation_runtime_version()=0`, all observation provider families are OFF, observation outbox/provider attempts are zero, and the complete pending set equals that rollout's frozen reviewed ordered set with unreviewed pending count `0`. The feature-ref workflow must preserve `installed_runtime0` and produce no outbox/provider delta until the later activation step.
   In either branch, dispatch the existing GitHub Actions workflow `.github/workflows/supabase-db-push.yml` / `Push Supabase Migrations` with the exact feature ref before any application-code update to `main`. The workflow's event/head branch/checkout `headSha` must match the dispatch and `release_sha`; its layout test/verifier and `Push migrations` job must succeed. Freeze the full linked ledger immediately afterward and compare it with the pre-dispatch receipt: it may add only the exact frozen reviewed pending set, may remove no version, and may contain no unreviewed version. For this first installation that delta is the exact seventeen-version set above, including profile mention foundation `20260809104500` before Google Chat `20260809105000` and all five reviewed prerequisite/follow-up fixes; its dependency gate must pass before observation mutations can create an event. Operator shell must not run `supabase link`, `migration repair`, or any `db push --linked`.
3. Only after the feature-ref DB run has `conclusion=success`, exact `headSha=release_sha`, and frozen ledger evidence, fast-forward `main` to that identical `release_sha`—no merge commit, rebuild commit, or cherry-pick SHA. Wait for the `push: main` `Push Supabase Migrations` run before accepting application deployment evidence. That second DB run must have exact `headSha=release_sha`, report pending migration count 0 / remote database already up to date, and leave a second read-only ledger byte-for-byte equal to the feature-ref receipt. A non-no-op or unequal-ledger main-trigger run blocks Vercel acceptance and activation.
4. Verify Vercel Production `READY`, aliases and runtime logs for the identical `release_sha`; a Production receipt for another SHA is invalid.
5. In the deployed classroom management UI, explicitly select `본관 | 별관` for every in-use classroom left null; do not infer from names.
6. Verify `registration_observation_schema_readiness_v1().schemaReady = true` and `missingObjects=[]`.
7. Run admin/staff/teacher read smoke, runtime-0 mutation rejection, calendar observation runtime-0 payload/deep-link rejection, Google Chat/SOLAPI default-OFF source smoke, and prove provider attempts remain zero.
8. Call atomic activation RPC and verify runtime probe 1.
9. Run admin/staff/teacher mutation and browser list/detail/calendar/mobile smoke with provider attempts still zero.

The release evidence records the exact pre-dispatch state token and trusted receipt, its required post-dispatch state token and receipt, feature ref, `release_sha`, dispatch run ID/URL, `headSha`, conclusion, ordered applied ledger, main-trigger run ID/URL, pending-zero line, and equal post-ledger. Only `not_installed -> installed_inert` or `installed_runtime0 -> installed_runtime0` is accepted. The operator-side dispatch may use:

```bash
release_branch="$(git branch --show-current)"
release_sha="$(git rev-parse HEAD)"
test -n "$release_branch"
test "$release_branch" != "main"
git push origin "$release_sha:refs/heads/$release_branch"
test "$(git ls-remote origin "refs/heads/$release_branch" | cut -f1)" = "$release_sha"
db_dispatched_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run supabase-db-push.yml --ref "$release_branch"
db_run_id="$(gh run list --workflow supabase-db-push.yml --branch "$release_branch" --event workflow_dispatch --commit "$release_sha" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$db_run_id"
gh run watch "$db_run_id" --exit-status
test "$(gh run view "$db_run_id" --json event --jq .event)" = "workflow_dispatch"
test "$(gh run view "$db_run_id" --json headBranch --jq .headBranch)" = "$release_branch"
test "$(gh run view "$db_run_id" --json headSha --jq .headSha)" = "$release_sha"
test "$(gh run view "$db_run_id" --json conclusion --jq .conclusion)" = "success"
gh run view "$db_run_id" --json databaseId,event,headBranch,headSha,createdAt,updatedAt,conclusion,jobs
TIPS_OBSERVATION_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("$TIPS_OBSERVATION_CLI" --version)" = "2.103.0"
ledger_after_dispatch="$(mktemp)"
"$TIPS_OBSERVATION_CLI" migration list --linked > "$ledger_after_dispatch"
git merge-base --is-ancestor origin/main "$release_sha"
git push origin "$release_sha:refs/heads/main"
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$release_sha"
main_db_run_id="$(gh run list --workflow supabase-db-push.yml --branch main --event push --commit "$release_sha" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$main_db_run_id"
gh run watch "$main_db_run_id" --exit-status
test "$(gh run view "$main_db_run_id" --json headSha --jq .headSha)" = "$release_sha"
test "$(gh run view "$main_db_run_id" --json conclusion --jq .conclusion)" = "success"
main_db_log="$(mktemp)"
gh run view "$main_db_run_id" --log > "$main_db_log"
rg -n 'Remote database is up to date|No migrations to apply' "$main_db_log"
ledger_after_main="$(mktemp)"
"$TIPS_OBSERVATION_CLI" migration list --linked > "$ledger_after_main"
cmp -s "$ledger_after_dispatch" "$ledger_after_main"
```

The workflow itself is the only linked writer. Require the selected dispatch run's `createdAt >= db_dispatched_at`. The two local `migration list --linked` calls are read-only receipts; the shell never runs `supabase link`, `migration repair`, or any `supabase db push --linked`. Preserve the dispatch and main run logs, both ledger files/hashes, their `cmp` result, and the pending-zero line before Vercel acceptance.

If a check fails before activation, keep runtime 0. Gate B step 8 may not start until the failure-only rollback rehearsal below is GREEN and its approval/evidence template is ready. If a check fails after activation, use only Gate B-R; do not issue an ad-hoc table UPDATE, add an unreviewed deactivation RPC, edit an applied migration, or delete saved rows.

### Gate B-R: failure-only forward runtime deactivation task

This is an incident task, not a normal Gate A artifact and not one of the frozen migrations above. No rollback migration file exists or ships while runtime activation is healthy. It may be generated only after a post-activation failure is declared. The incident record must first contain the production project ref, deployed code SHA, current migration head, public runtime probe `1`, provider family states/attempt counts, the exact open-observation report below, and explicit user approval to prepare the artifact. At declaration, freeze further activation calls, observation releases and unrelated migration deploys for that project; do not mutate provider settings as a substitute for runtime deactivation. A second explicit approval is required after independent spec/quality review and before production apply.

The preflight is read-only. It records runtime and open rows without student name, phone, feedback reason, or enrollment detail:

```sql
select activation_version, updated_at, updated_by
from dashboard_private.registration_observation_runtime_settings
where singleton = true;

select id, task_id, track_id, appointment_id, status, decision_kind,
       revision, feedback_revision, created_at
from public.ops_registration_observations
where decision_kind is null
  and status in ('scheduled','attended_feedback_pending','completed','no_show')
order by created_at, id;
```

Record counts and SHA-256/row-JSON hashes for `ops_registration_observations`, `ops_registration_subject_tracks`, `ops_registration_enrollments`, and `ops_registration_admission_batches` before/after without placing row contents in the report. There is no registration payment table in this workflow; the reviewed SQL must reference only the runtime singleton, and source review/pgTAP must prove zero INSERT/UPDATE/DELETE against observation, track, appointment, enrollment, admission, payment/import, outbox, due, or provider tables.

After the first approval, create the incident migration from a clean checkout with the pinned CLI. The generated timestamp becomes the reviewed incident version; changing it afterward is forbidden.

```bash
TIPS_OBSERVATION_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("$TIPS_OBSERVATION_CLI" --version)" = "2.103.0"
"$TIPS_OBSERVATION_CLI" migration new deactivate_registration_observation_runtime
rollback_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_deactivate_registration_observation_runtime\.sql$')"
test "$(printf '%s\n' "$rollback_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
rollback_version="$(basename "$rollback_generated" | cut -d_ -f1)"
rollback_target="supabase/migrations/${rollback_version}_registration_observation_runtime_deactivate.sql"
test ! -e "$rollback_target"
git add -- "$rollback_generated"
git mv -- "$rollback_generated" "$rollback_target"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg "^supabase/migrations/${rollback_version}_(deactivate_registration_observation_runtime|registration_observation_runtime_deactivate)\.sql$")" = "$rollback_target"
test -z "$(git diff --cached --name-only --diff-filter=D | rg '(registration_observation_runtime.*deactivate|deactivate_registration_observation_runtime)')"
```

Write exactly this replay-safe SQL body with `apply_patch`, then `git add -- "$rollback_target"`, repeat the staged exact-one/D-zero gate, run `test -s "$rollback_target"`, `git diff --cached --check`, and record `shasum -a 256 "$rollback_target"` in both reviews and the apply approval:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table dashboard_private.registration_observation_runtime_settings
  in row exclusive mode;

do $registration_observation_runtime_deactivate_v1$
declare
  v_current integer;
begin
  select activation_version
  into v_current
  from dashboard_private.registration_observation_runtime_settings
  where singleton = true
  for update;

  if not found or v_current not in (0, 1) then
    raise exception 'registration_observation_runtime_state_invalid'
      using errcode = '55000';
  end if;

  if v_current = 1 then
    update dashboard_private.registration_observation_runtime_settings
    set activation_version = 0,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = null
    where singleton = true
      and activation_version = 1;
  end if;
end;
$registration_observation_runtime_deactivate_v1$;

commit;
```

Before commit, run two isolated database paths. The normal clean-reset path applies every migration through the generated incident version from runtime default `0` and proves the body is a replay-safe no-op. The failure path applies only through `20260809106200`, creates unique fixtures, commits runtime `1`, captures the four table hashes/open-row report, then applies only `$rollback_target`. `supabase/tests/registration_observation_enrollment_test.sql` must execute the same marked SQL body inside a rollback transaction and pgTAP-assert `1 → 0`, a second `0 → 0` replay, unchanged row counts/hashes/revisions, preserved open observations, no new mutation/domain/provider rows, and `updated_by IS NULL`. The isolated runner's `--focus enrollment` rehearses this SQL before Gate B without creating a migration artifact; the incident path additionally proves the generated file's normalized SQL body hash equals the rehearsed block. Both paths end with a fresh-connection runtime `0` assertion. No linked/remote test is allowed.

After RED (missing generated migration/body-hash contract) and GREEN (both isolated paths plus pgTAP 0 failures), review the staged diff, exact target/hash, clean-apply log, focus/ceiling log, and open-row/data-preservation report; commit with `fix: deactivate registration observation runtime`. Rebase onto current `origin/main`, record `rollback_sha`, and push that exact commit to the incident feature ref without moving `main`. Trusted read-only ledger evidence must prove the sole pending version is `rollback_version`; then obtain the second production approval. Apply only through the existing GitHub workflow at that exact ref:

```bash
rollback_branch="$(git branch --show-current)"
rollback_sha="$(git rev-parse HEAD)"
test -n "$rollback_branch"
test "$rollback_branch" != "main"
git push origin "$rollback_sha:refs/heads/$rollback_branch"
test "$(git ls-remote origin "refs/heads/$rollback_branch" | cut -f1)" = "$rollback_sha"
TIPS_OBSERVATION_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("$TIPS_OBSERVATION_CLI" --version)" = "2.103.0"
rollback_ledger_before="$(mktemp)"
"$TIPS_OBSERVATION_CLI" migration list --linked > "$rollback_ledger_before"
gh workflow run supabase-db-push.yml --ref "$rollback_branch"
rollback_run_id="$(gh run list --workflow supabase-db-push.yml --branch "$rollback_branch" --event workflow_dispatch --commit "$rollback_sha" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$rollback_run_id"
gh run watch "$rollback_run_id" --exit-status
test "$(gh run view "$rollback_run_id" --json headSha --jq .headSha)" = "$rollback_sha"
test "$(gh run view "$rollback_run_id" --json conclusion --jq .conclusion)" = "success"
rollback_ledger_after_dispatch="$(mktemp)"
"$TIPS_OBSERVATION_CLI" migration list --linked > "$rollback_ledger_after_dispatch"
git merge-base --is-ancestor origin/main "$rollback_sha"
git push origin "$rollback_sha:refs/heads/main"
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$rollback_sha"
rollback_main_run_id="$(gh run list --workflow supabase-db-push.yml --branch main --event push --commit "$rollback_sha" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$rollback_main_run_id"
gh run watch "$rollback_main_run_id" --exit-status
test "$(gh run view "$rollback_main_run_id" --json headSha --jq .headSha)" = "$rollback_sha"
test "$(gh run view "$rollback_main_run_id" --json conclusion --jq .conclusion)" = "success"
rollback_main_log="$(mktemp)"
gh run view "$rollback_main_run_id" --log > "$rollback_main_log"
rg -n 'Remote database is up to date|No migrations to apply' "$rollback_main_log"
rollback_ledger_after_main="$(mktemp)"
"$TIPS_OBSERVATION_CLI" migration list --linked > "$rollback_ledger_after_main"
cmp -s "$rollback_ledger_after_dispatch" "$rollback_ledger_after_main"
```

The dispatch log and before/after ledger diff must show exactly the named incident version applied once and no other change. The automatic main run must be pending 0 / database already up to date, and `cmp` must prove its ledger equals the feature-ref receipt. Any pre-dispatch ledger mismatch blocks the run. These `migration list --linked` calls are read-only; operators never run `supabase link`, `db push --linked`, `migration repair`, or `db reset --linked` directly. Post-apply, verify runtime `0` from a fresh connection and browser probe, new non-replay observation mutations rejected, provider attempts unchanged, all four hashes/counts preserved, and re-run the open-observation report. Existing open observations remain stored and must be individually listed for an explicit product-approved wind-down/resume decision; this task neither cancels them nor changes attendance, feedback, decision, enrollment, admission, payment, outbox, due, or provider data.

### Gate C: Google Chat profile identity and observation release

- use the Plan 3 foundation and Plan 4 observation code/migrations already deployed at Gate B; do not apply a new Google migration after runtime activation
- provision the three Directory credentials in Vercel Production only through the approved secret workflow, redeploy the identical release SHA, and require the new Production deployment `READY`; Preview/local remain absent
- verify actual teacher/director profile identities in teacher settings before any mention-enabled rule; identity readiness is not provider-send proof
- prove provider-zero, destination routing, URL allowlist and privacy in isolated DB and browser
- enable one event family at a time: scheduled → rescheduled → canceled → 3h preparation → feedback due → feedback submitted → director reassigned
- verify exactly one expected channel receipt for each family before enabling the next
- rollback only observation rule families; existing registration/level-test/consultation notifications stay enabled

### Gate D: SOLAPI release

- use the Plan 5 code/migrations already deployed default-OFF at Gate B
- create provider templates and wait for approval without blocking domain/Google Chat operation
- add new template IDs to Vercel Preview/Production environment, redeploy exact code SHA and verify `READY`
- for each kind independently: `off → verification → one approved-number accepted receipt → live`
- set observation reminder lead to 3 hours and ON only after cron/Vault/worker heartbeat and live-test receipt are verified
- apply `activated_at` cutoff so pre-activation sources cannot send retrospectively
- rollback observation kinds first; global reminder OFF is reserved for a shared worker emergency

## Evidence and Git Ordering

Each implementation task commits code only after its own GREEN and review. Production evidence is added after real verification.

```text
feature code commit(s)
→ push reviewed exact SHA to origin feature ref
→ workflow_dispatch Push Supabase Migrations at that ref
→ exact headSha + ordered ledger success
→ fast-forward the identical SHA to main
→ main-trigger DB workflow pending 0 / equal-ledger no-op
→ Vercel Production READY for the identical SHA
→ operational verification
→ evidence report commit
→ push docs-only report commit
→ Production READY for final report SHA
```

The report records both SHAs and states that the second deployment is docs-only. It must not describe a provider as live until an accepted provider receipt and recipient confirmation exist.

## Master Completion Gate

- [ ] Plan 1 completion gate passes.
- [ ] Plan 2 completion gate passes.
- [ ] Plan 3 shared profile-mention completion gate passes with adopted-rule count 0 and provider 0.
- [ ] Plan 4 completion gate passes, including actual subject-room teacher and management-room director mention receipts.
- [ ] Plan 5 code/DB completion gate passes independently of provider approval.
- [ ] SOLAPI booking and reminder each pass verification receipt, recipient receipt and live activation.
- [ ] Gate B 전에 enrollment-focus pgTAP으로 exact `1 → 0` SQL body와 data/open-observation 보존을 rehearsal했으며, healthy release tree에는 rollback migration artifact가 없다. 실제 실패 때만 Gate B-R exact CLI/staged orphan/hash/two-review/two-approval gate로 named forward-only migration을 생성·적용한다. Google Chat rules와 SOLAPI kinds는 데이터를 삭제하지 않고 독립 비활성화할 수 있다.
- [ ] No duplicate provider attempts exist for the same observation + notification revision + message/event kind.
- [ ] No unregistered observation creates or mutates payment, admission or unrelated enrollment rows.
- [ ] Feature-ref DB workflow and main-trigger no-op workflow both report the identical reviewed head SHA; first ledger contains only reviewed versions, second pending count is 0 and ledger is equal. No operator direct linked push occurred.
- [ ] `main` push, Supabase migrations, Vercel Production, Google Chat and SOLAPI evidence are reported separately.
