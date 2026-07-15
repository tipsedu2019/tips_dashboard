# Registration Canonical Appointments, History, Calendar, and Reminders Design

**Date:** 2026-07-15

**Status:** Approved direction, written-spec review pending

**Depends on:** [Common Notification Control Plane Design](./2026-07-15-common-notification-control-plane-design.md), [Notification Workflow Adapters Design](./2026-07-15-notification-workflow-adapters-design.md)

## Goal

Complete the registration workflow on top of the canonical parent-case, subject-track, and shared-appointment model. The change removes misleading legacy appointment inputs, exposes trustworthy automatic history, gives operators one registration calendar for level tests and visit consultations, and adds durable pre-appointment reminders without weakening the delivery guarantees of existing notification paths.

The implementation must preserve these operating truths:

- One registration case stores common student and inquiry information once.
- English and mathematics move independently through subject tracks.
- A level test or visit consultation may share one real-world appointment across subjects.
- A phone consultation is a per-subject waiting-list activity, not an appointment.
- Canonical database rows and their events are authoritative. Legacy parent fields remain read compatibility only.

## Scope

This design covers:

- Canonical registration create and edit form behavior.
- Subject-specific consultation ownership and shared visit appointments.
- Automatic registration process history.
- A list/calendar view toggle inside the registration workspace.
- Durable scheduled reminders for canonical level-test and visit-consultation appointments.
- Worker deployment, concurrency, delivery state, observability, security, and verification.

This design does not:

- Redesign unrelated withdrawal, transfer, makeup, word-retest, or general-task forms.
- Copy registration appointments into the academic-calendar write model.
- Add drag-and-drop appointment editing.
- Turn phone consultations into scheduled events.
- Send registration reminders to students or guardians.
- Drop legacy registration columns or historical data.

This document extends the canonical subject-track and intake-routing designs dated 2026-07-12 and 2026-07-13. Where their consultation-field layout differs, this document is authoritative for the editable order and for placing phone-queue readiness in a separate read-only block. Their parent/track ownership, atomic intake, and phone-readiness contracts remain in force.

## Canonical Ownership Model

### Parent registration case

`ops_tasks` and `ops_registration_details` remain the parent registration case. They own only common information:

- Student identity and optional linked student record.
- Grade, school, parent phone, and student phone.
- Campus and inquiry timestamp.
- Common request notes and priority.
- Parent open/closed state derived from all subject tracks and admission work.

Parent compatibility columns for subject stage, counselor, class, appointment, and result are non-authoritative after the canonical runtime is ready. They may be read for migration compatibility but must not overwrite canonical child rows.

### Subject tracks

`ops_registration_subject_tracks` is authoritative for each selected subject's:

- Pipeline status.
- Current responsible consultation director.
- Director-assignment source and timestamp.
- Waiting kind and retest decision.
- Stage-entry timestamp.

English and mathematics may therefore have different owners, stages, consultation modes, outcomes, and enrollment progress while sharing one parent case.

The current owner is not the same concept as the actor who performed a mutation. UI labels, history records, notification recipients, and audit queries must keep these identities separate.

### Shared appointments and subject activities

`ops_registration_appointments` is the only source of truth for a scheduled level test or visit consultation. An appointment owns:

- `id`.
- Parent `task_id`.
- `kind`: `level_test` or `visit_consultation`.
- Exact `scheduled_at` timestamp.
- Nonblank `place`.
- `status`: `scheduled`, `completed`, or `canceled`.
- Positive `notification_revision`.
- Creator and database timestamps.

The appointment does not own a combined subject result or one global counselor.

Subject participation is represented by canonical child rows:

- `ops_registration_level_tests` links each participating track to a shared level-test appointment and keeps that subject's attempt and result.
- `ops_registration_consultations` links each participating track to a shared visit appointment and keeps that subject's historical director snapshot, status, and outcome.

One shared visit therefore has one date/time and place, while each participating subject keeps its own current owner, consultation row, result, and track state.

### Phone consultations

A phone consultation always has:

- `mode = 'phone'`.
- No `appointment_id`.
- A per-subject responsible director.
- A server-derived `ready_at` and `ready_source` for queue order.
- A waiting, completed, or canceled lifecycle.

The registration create/edit consultation area renders neither an editable nor a read-only phone date/time control. `ready_at` appears only as secondary metadata in the phone waiting-list workspace or automatic history, and the UI never labels it `예약일시`.

The legacy phone-consultation timestamp column remains readable for historical and migration fallback. Ready-mode create and edit flows never write it, never project it as a live appointment, never place it on the calendar, and never create reminders from it. Historical rows and columns are not dropped.

## Canonical Form Design

### Global ordering rule

This is the product-wide default for every new or directly edited input flow unless a documented domain rule requires a different order:

1. **누가:** responsible person or people.
2. **언제:** appointment date and time.
3. **어디서:** place or room.
4. **무엇을:** participating subjects or work being performed.
5. **어떻게:** method, result, notes, or next action.

When a concept does not apply, the form omits it instead of inventing a field. This implementation reorders only the registration forms directly touched by this work; it does not mass-reorder unrelated existing screens. Future work that creates or edits any workflow form applies the same product-wide order and records any exception in that workflow's domain design.

### Registration create flow

The create dialog stores common inquiry information first and shows one initial plan per selected subject. Downstream fields appear only when required by those plans.

- `문의 유지` adds no appointment fields.
- `바로 전화상담` requires a resolved per-subject director and creates a phone waiting row without an editable time.
- `레벨테스트` enables one shared level-test appointment draft for all subjects choosing that plan.
- `방문상담` enables per-subject directors plus one shared visit appointment draft for all subjects choosing that plan.

The ready-mode client submits the normalized initial-workflow contract to the canonical atomic create RPC. It must not render downstream inputs that the selected runtime cannot persist.

### Consultation input order

The consultation form uses this exact editable order on desktop and mobile:

1. `과목별 상담 책임자`.
2. `방문상담 예약일시`.
3. `방문상담실`.

The owner controls show one labeled value per selected subject. The visit date/time and place are entered once because they belong to the shared appointment. Participating subject badges follow the place as the `무엇을` summary; participation is derived from the selected subject plans on create and remains explicitly editable through the canonical appointment editor later.

The registration create/edit consultation area renders no phone-consultation date or time element, editable or read-only. Server-derived `ready_at` may appear only as secondary metadata in the phone waiting queue or automatic history and is never labeled `예약일시`.

### Level-test scheduling and completion

Level-test scheduling contains only:

- Appointment date/time.
- Place.
- Participating subjects.

`시험지·결과지 URL` is not an appointment-creation field. It appears only in the subject-specific level-test completion action. The completion mutation requires the URL for a completed result and writes it to the corresponding attempt, not to the shared appointment.

### Validation and atomic save

Client validation gives immediate Korean operator guidance, but the database repeats every rule under lock. A canonical create or edit rejects:

- Missing or invalid subject plans.
- A visit subject without a valid responsible director.
- A required appointment without date/time or nonblank place.
- Appointment subject membership that differs from the selected plans.
- A phone consultation carrying an appointment or editable reservation timestamp.
- A visit consultation without an appointment.
- A level-test result URL in a scheduling payload.
- A completed level test without its subject-specific result URL.
- A new scheduled appointment in the past.
- An edit based on a stale appointment revision.

Parent creation or update, subject tracks, appointments, child activities, canonical process history, required immutable `notification_events`, unique `notification_event_fanout_jobs`, and any required director-change `notification_target_reconciliation_jobs` rows commit in one database transaction. Any validation, child-row, process-event, notification-event, fan-out-job, or target-job insert failure rolls back the entire canonical mutation.

Rule fan-out, template rendering, target resolution, delivery creation, and external provider calls occur only after the appointment, notification event, and required queue-job commit. Their failures never roll back a successfully committed authoritative mutation. The UI reports fan-out/reconciliation processing failure separately and retries notification processing without replaying the appointment or track mutation.

## Automatic Registration History

### Event contract

Every authoritative registration mutation writes its event in the same transaction as the data change. The event records:

- Actor profile ID when a user initiated the action.
- Actor kind: `user`, `system`, or `migration`.
- Server timestamp.
- Parent task ID and subject-track ID.
- Subject.
- Stable event type.
- Source and destination states.
- `reason_code` or reason metadata only when that business action already requires a reason; otherwise null.
- Relevant entity IDs and before/after metadata.

Canonical mutations include case creation, subject routing, director assignment, track transitions, appointment creation/update/replacement/cancellation/completion, participation changes, level-test start/completion/absence, consultation completion, waiting decisions, enrollment transitions, and terminal reopening.

Browser timestamps and display labels are never accepted as audit truth. User actions use the authenticated profile; scheduled or automated actions use `actor_kind = 'system'` and a stable system source. Migration fallback uses `actor_kind = 'migration'`.

New canonical registration events use payload version 2 with explicit `actor_kind`. Version 1 history remains readable, but a null actor in version 1 is shown as `알 수 없음`; the UI never infers system versus migration. Automatic history does not add a new `왜` or 사유 field to actions that did not already need one.

### Read-only timeline

The registration detail exposes a read-only timeline built from canonical events. It does not reuse editable assignee or due-date controls.

The existing editable block labeled `담당자 및 일시 이력` is removed. Operators never type, revise, or delete history rows. If the current task assignee or next-processing timestamp remains operationally necessary, those controls move to a separately labeled `현재 업무` edit area near the current action controls. That area represents mutable present state only and is not placed inside, titled as, or visually merged with automatic history.

- Shared appointment operations are grouped once and display all affected subject badges.
- Subject-specific changes remain attributable to their track.
- The default timeline contains business-process milestones only: inquiry, responsibility assignment, level test, consultation, waiting, admission, registration completion, closure, and reopening. Fine-grained appointment edits are grouped under their relevant milestone detail.
- Notification fan-out, delivery attempt, retry, provider reconciliation, and reminder occurrence records never appear in the default registration history; they belong to `최근 전달` or the admin investigation surface.
- The default order is newest first.
- Each collapsed item shows only action time, actor, action label, and affected subject. Source/destination, reason, and entity metadata appear in an optional detail expansion when they exist.
- The current responsible owner is shown separately from the event actor.
- Operators may filter by subject and process stage without changing history.
- Timeline entries expose no edit or delete action.

Mutable-row snapshots may supplement missing migration history, but they must never pretend to be canonical events. A fallback entry is labeled `마이그레이션`; an unavailable actor is shown as `알 수 없음`. The UI does not infer an actor from the current owner and does not invent an exact event time from unrelated `updated_at` values.

## Registration Calendar

### Workspace behavior

The registration workspace provides a `목록 / 캘린더` toggle.

- List mode retains the existing subject-track workflow tabs and operational actions.
- Calendar mode reads canonical appointments in the same authorized registration scope.
- Desktop supports month and week views.
- Mobile uses an agenda ordered by exact appointment time.
- The default status filter shows `scheduled`; explicit status filters can include `completed` and `canceled` for review.

Only `level_test` and `visit_consultation` appointments appear. Phone consultations and legacy parent timestamps never appear.

### Calendar projection

Each canonical appointment produces exactly one calendar item even when two subjects participate. Its stable ID is:

```text
registration-appointment:${appointment.id}
```

The projection includes:

- Appointment ID and parent task ID.
- Exact `scheduled_at` timestamp.
- KST display date and time.
- Appointment kind.
- Place.
- Status.
- Notification revision.
- Participating subject badges derived from canonical children.
- Student display name permitted by the current registration access policy.
- Deep link to the canonical registration appointment.

The default deep link is:

```text
/admin/registration?taskId={taskId}&appointmentId={appointmentId}&view=calendar
```

Selecting a subject badge may add its `trackId`, but the appointment remains the selected shared entity.

The calendar preserves timestamps instead of reducing them to date-only values. It does not create IDs from task, kind, and date, so multiple same-day appointments cannot collide.

### Editing boundary

Calendar cards open the canonical appointment detail/editor. The calendar itself does not support drag-and-drop or resize editing. This prevents a visual gesture from bypassing revision checks, child-participation rules, event creation, and reminder rematerialization.

Registration appointments are never copied into `academic_events`. The academic calendar and registration calendar may share visual components, but each reads its own authoritative source.

### Appointment change and conflict UX

Appointment edits use the same canonical editor whether opened from the list or calendar. Before a reschedule or place/participation change is submitted, the confirmation summarizes the old and new date/time, place, and subjects, together with how many future reminder deliveries and fixed reminder rounds will be recalculated. The confirmation does not imply that a provider message has already been sent.

Cancellation uses an explicit confirmation and shows the appointment plus the future reminders that will be canceled. It does not invent a mandatory cancellation reason; a reason is collected only when the existing business action already requires one.

An optimistic-revision conflict returns HTTP 409 and commits nothing. The editor keeps the operator's local draft and shows `최신 예약 비교`, `다시 적용`, and `계속 편집` actions. The comparison distinguishes server changes from the local draft; `다시 적용` rebases only after the operator reviews the latest appointment. A successful appointment save and reminder rematerialization are separate outcomes: the UI may show `예약 저장됨 · 알림 재계산 중` and later `알림 재계산 완료` or `알림 재계산 실패 · 다시 시도` without replaying the appointment mutation.

## Scheduled Reminder Architecture

### Separation from immediate notifications

An immediate booking/change notification and a pre-appointment reminder are different events.

- The existing visit-consultation notification remains post-commit and preserves its appointment-revision, track, director, dashboard, Google Chat, and failed-target retry semantics.
- The generic registration Google Chat path continues to skip the stage handled by the dedicated visit adapter.
- Phone-queue assignment notifications retain their create, reassign, unread-withdrawal, and cancellation behavior.
- Existing SOLAPI claim/finalize/reconcile/unknown behavior remains authoritative behind its adapter and is not flattened into a generic `sent/failed` log.

Scheduled reminders use the common control plane's four canonical layers: `notification_events`, `notification_rules`, `notification_templates`, and `notification_deliveries`. The registration appointment mutation is the producer boundary before those layers; channel adapters execute the final delivery without changing their meaning.

### Canonical producer boundary

A canonical appointment mutation evaluates the three active scheduled variants in the same transaction as the authoritative change. Creation and eligible schedule/place/participation/replacement changes insert the required future reminder events plus durable fan-out jobs. Cancellation and completion only cancel or mark existing future work and create no new scheduled reminder event. Producer inputs cover:

- Appointment creation.
- Date/time or place change.
- Subject participation change.
- Cancellation.
- Completion.
- Director reassignment as a `registration.director_assigned` source event plus durable target-reconciliation job, not a new reminder event.

The producer uses canonical IDs, persisted appointment `notification_revision`, stable rule IDs, and current rule revisions. It never calls a provider and never accepts browser-supplied title, body, recipient, phone number, or webhook. If a required notification event, fan-out job, or director-change target-reconciliation job cannot be inserted, the canonical mutation rolls back. Once they commit, fan-out/reconciliation execution, delivery creation, rendering, and provider failures do not roll back the appointment or track mutation.

### Layer 1: immutable notification events

`dashboard_private.notification_events` stores one immutable scheduled business occurrence with:

- `workflow_key = registration`.
- `event_key = registration.appointment_reminder_due`. The unqualified form is not stored or accepted by DB, API, RPC, or tests.
- `source_type = registration_appointment`.
- `source_id = appointment.id`.
- `source_revision = appointment.notification_revision`.
- `materialized_rule_id` and `materialized_rule_revision` equal the stable rule ID/revision in its occurrence identity.
- A one-entry `rule_snapshot` containing exactly that materialized rule/template; the scheduled fan-out worker never expands other reminder rules from this event.
- Server actor and occurrence timestamps.
- Payload schema version and allowlisted appointment payload.

The occurrence key is:

```text
registration:registration_appointment:{appointmentId}:source_revision:{notificationRevision}:rule:{ruleId}:rule_revision:{ruleRevision}
```

`scheduled_for` is not an event field or identity component. The registration schedule evaluator calculates it from the canonical appointment and stable rule revision, and fan-out stores it on each delivery. Changing a rule's time, audience/channel state, or active template increments the stable rule's revision, so reconciliation produces a distinct occurrence without splitting the single `registration.appointment_reminder_due` event family.

Payload includes appointment kind, scheduled time, place, task ID, participant track IDs, and subject membership. It excludes phone numbers and secrets. Canonical appointment status and source revision are re-read before dispatch; the event snapshot is audit context, not authority to send stale data.

### Layer 2: stable notification rules

`dashboard_private.notification_rules` stores stable rows. A rule is not an immutable version row and does not contain title or body text. Each registration reminder rule contains the common fields plus:

- Stable `id` used as `rule_id`.
- `workflow_key = registration` and `event_key = registration.appointment_reminder_due`.
- Canonical `channel_key` and `audience_key`.
- `delivery_mode = scheduled`.
- `rule_variant_key`: `previous_day_at`, `same_day_at`, or `offset_before`.
- Validated `schedule_key` and `schedule_config` using `Asia/Seoul`.
- `enabled`.
- `active_template_id` referencing an immutable template version.
- Optimistic `revision`, incremented on every effective rule or active-template change.
- Verified creator/updater and server timestamps.

The common unique key is:

```text
(scope_key, workflow_key, event_key, channel_key, audience_key, rule_variant_key)
```

Non-scheduled common rules use `rule_variant_key = immediate`. The three scheduled variants can therefore coexist for the same audience/channel without inventing separate event semantics.

The approved defaults are:

1. Previous KST calendar day at 14:00: `previous_day_at`.
2. Appointment KST calendar day at 14:00: `same_day_at`.
3. Sixty minutes before the appointment: `offset_before`.

All three variants and all allowed audience/channel cells are seeded with `enabled = false`. They become active only after an admin/staff user explicitly enables and saves them in the common settings UI. This prevents deployment from silently sending three new rounds to existing future appointments.

The exact schedule config is:

```text
anchor_key = appointment_scheduled_at
previous_day_at / same_day_at = { anchor_key, local_time, timezone: "Asia/Seoul" }
offset_before = { anchor_key, lead_minutes, timezone: "Asia/Seoul" }
```

Appointment-kind applicability is a fixed server registry rather than a free-form rule selector:

| kind | allowed audience/channel cells |
| --- | --- |
| `level_test` | `management_team/in_app`, `management_team/google_chat` |
| `visit_consultation` | `track_director/in_app`, `management_team/google_chat` |

A non-applicable kind/cell is not evaluated and does not create `skipped/no_recipient` noise.

A calculated reminder is eligible only when `scheduled_for < appointment.scheduled_at`. A time at or after the appointment creates no event or delivery. The producer appends `reminder_rule_skipped` to `dashboard_private.notification_audit_logs` with reason `not_before_appointment`.

### Layer 3: immutable notification templates

`dashboard_private.notification_templates` is the independent immutable version layer. Each row contains:

- Template ID and owning stable rule ID.
- Monotonic version within the rule.
- Title template and body template.
- Server-generated allowed-variable registry.
- Payload schema version and normalized checksum.
- Creator profile/actor kind and server timestamp under the common user/system seed contract.

Template rows are never updated. If normalized title, body, variables, and schema are unchanged, save creates no new template. If they change, the settings transaction inserts a new template version, changes the stable rule's `active_template_id`, and increments that rule's `revision` exactly once.

Supported registration-reminder variables are student display name, appointment kind, appointment date/time, place, participating subjects, responsible director when applicable, and canonical deep link. Unknown variables, raw HTML, provider mentions, arbitrary external URLs, phone numbers, and secrets fail validation.

### Reminder settings UX and persistence

The common notification settings surface shows exactly three fixed registration reminder variants. Each variant presents the approved audience/channel cells and is independently enabled or disabled. There is no add-rule action, custom fourth variant, cron expression, or free-form schedule expression.

Because every new reminder cell seeds off, the first and every later visit while all cells remain disabled shows `현재 예약 알림이 발송되지 않습니다` above the three visible Korean presets: `예약 전날 14:00`, `예약 당일 14:00`, and `예약 1시간 전`. The empty state links directly to the first applicable switch and never implies that installing the feature activated delivery.

An `admin` or `staff` user may edit:

- The KST wall-clock time for `previous_day_at` and `same_day_at` while preserving each fixed variant.
- The relative lead duration for `offset_before`.
- Enabled audience/channel cells within the common registry.
- Each stable rule's title and body template through a new immutable template version.

Date-based variants always interpret their value in `Asia/Seoul`; the relative variant subtracts its duration from the exact appointment timestamp. Audience and channel are stable rule-key dimensions, so the UI enables or disables predeclared valid cells rather than rewriting a rule into another key.

Each wall-clock rule states that it is omitted when its computed time is not before the appointment; for example, a D-day 14:00 reminder is not sent for an appointment at or before 14:00. The appointment editor shows a compact read-only list of the reminder occurrences actually scheduled from the current draft, excluding passed and not-before-appointment variants.

Settings are never component-local state. The registration scoped dialog and `/admin/settings/notifications` use the same `NotificationControlPanel`, `get_notification_control_plane_v1`, and `save_notification_control_plane_v1` flow. Save requires every changed rule's expected revision and commits registry validation, template insertion when needed, `active_template_id`, rule revision, append-only audit, and one durable `dashboard_private.notification_rule_reconciliation_jobs` row in one transaction. A conflict saves nothing and returns the current rule/template snapshot while retaining the local draft.

Reconciliation processes all future scheduled registration appointments:

1. Cancel superseded future `pending` and `retry_wait` deliveries with reason `rule_revision_changed`.
2. Mark `claimed` but not `sending` deliveries with `cancel_requested_at` and `cancel_reason = rule_revision_changed`; never wait for a worker lease while holding the settings transaction or appointment locks.
3. Re-evaluate the three current rule variants against the appointment-kind applicability registry.
4. Create a new event and fan-out job only when the cell is enabled, applicable, and `now() < scheduled_for < appointment.scheduled_at`; disabled, non-applicable, and already-passed rounds are not backfilled.
5. Preserve `sending`, `sent`, `delivery_unknown`, `failed`, `skipped`, `disabled`, and existing `canceled` history unchanged.

Settings persistence and appointment reconciliation are separate operator outcomes. The UI reports `설정 저장됨` independently from `예약 알림 재계산 중`, `예약 알림 재계산 완료`, or `예약 알림 재계산 실패 · 다시 시도`. Recalculation failure never reverts saved rules/templates. Retry reruns the durable reconciliation job with the same revisions and occurrence keys; it does not save settings again.

### Layer 4: materialized deliveries and adapters

`dashboard_private.notification_deliveries` is the private database outbox. One row represents one target and channel for one immutable event/rule/template snapshot. It contains the common event, rule, rule-revision, template, channel, audience, target, rendered-content, scheduling, lease, provider, error, and audit fields.

Canonical statuses are exactly:

- Execution: `pending`, `claimed`, `sending`, `retry_wait`.
- Success: `sent`.
- Ambiguous: `delivery_unknown`.
- Terminal: `failed`, `skipped`, `disabled`, `canceled`.

`scheduled_for` and `next_attempt_at` are delivery scheduling fields. They are not occurrence identity. The unique delivery dedupe key is the common hash of event ID, stable rule ID, channel, target kind, and target key. The appointment ID, source revision, rule ID, and rule revision remain transitively stable through the immutable event occurrence.

Target keys use canonical resolver output such as `profile:{profileId}` or the `google_chat.management` connection. When one director owns both participating subjects, the resolver creates one per-recipient delivery with both subject badges rather than duplicate messages.

Channel adapters receive only delivery ID and claim token, reload the private event/rule/template/target/connection snapshot, and preserve channel-specific acceptance, `delivery_unknown`, reconciliation, and provider idempotency semantics.

### Approved recipients and channels

Scheduled registration reminders are internal only.

- Level test: `management_team` through `in_app` and `google_chat` using `google_chat.management`.
- Visit consultation: `track_director` through `in_app` for each distinct current participating director, plus `management_team` through `google_chat` using `google_chat.management`. The Korean UI label is `과목별 상담 책임자`.

No student, guardian, SMS, or SOLAPI registration-reminder target is created in this scope.

Visit recipient resolution uses the canonical participating consultation rows and current valid director assignments. A director reassignment does not change appointment time/place or source revision and creates no new reminder event. The track mutation, version-2 `registration.director_assigned` source event, and unique `notification_target_reconciliation_jobs` row commit atomically. Its worker cancels old-recipient future `pending` and `retry_wait` deliveries with `recipient_revoked`, marks pre-send `claimed` deliveries `cancel_requested` with the same reason, and re-fans out the existing future event to the current recipient under the same appointment source revision and current stable rule revision. The resolver stores an immutable target snapshot, so a later profile-name change cannot rewrite historical rendered content. A crash after cancellation resumes the same job and cannot lose or duplicate the new target. Existing delivery history remains auditable.

### Materialization lifecycle

For a newly created appointment, only reminder times strictly later than the commit time are materialized. Already-passed reminder occurrences are not backfilled. The immediate booking notification remains the only immediate message.

If a calculated `scheduled_for` is at or after `appointment.scheduled_at`, the producer creates no event or delivery and writes the deterministic `not_before_appointment` audit described above. This covers cases such as an appointment before the D-day 14:00 rule without creating meaningless work.

On reschedule, participation change, or cancellation:

1. Acquire the shared registration workflow advisory transaction lock before row locks, then lock the appointment and canonical children in stable order.
2. Validate the expected notification revision.
3. Increment the revision exactly once for a date/time, place, participation, replacement, or cancellation mutation. Creation starts at 1; completion and director reassignment do not increment it.
4. Cancel old-revision future `pending` and `retry_wait` deliveries with `source_revision_changed`.
5. Mark old-revision `claimed` but not `sending` deliveries with `cancel_requested_at` and `cancel_reason = source_revision_changed`; do not wait for lease release while holding business locks.
6. Preserve old `sending`, `sent`, `delivery_unknown`, `failed`, `skipped`, `disabled`, and existing `canceled` rows.
7. Insert future reminder events and unique fan-out jobs for the new source revision in the canonical transaction when the appointment remains scheduled.
8. Fan out new deliveries idempotently after commit. `begin_send` atomically rechecks the claim token, cancel request, appointment revision/status, rule revision, and recipient authorization before any provider call.

On appointment completion, all remaining `pending` and `retry_wait` reminders are canceled with `source_status_changed` and pre-send `claimed` reminders receive `cancel_requested_at` with the same reason. No completion mutation creates a new scheduled reminder or increments `notification_revision`. `sending`, `sent`, and `delivery_unknown` history is preserved.

### KST scheduling

All registration reminder policies use the IANA zone `Asia/Seoul`.

- D-1 means the previous KST calendar date, not 24 hours before.
- D-day means the appointment's KST calendar date.
- `-1h` means an exact 60-minute instant offset.
- Database storage uses `timestamptz`; local date/time calculations explicitly use `Asia/Seoul`.
- Browser timezone and server host timezone never affect scheduling.

KST currently has no daylight-saving transition. Tests still run with non-KST browser/server zones and dates that cross DST boundaries elsewhere to prove that the KST result remains unchanged.

## Worker and Delivery Semantics

### Deployment

Supabase Cron runs every minute. The cron job reads a worker credential held in Supabase Vault and calls a private Next.js notification-worker endpoint through `pg_net`.

The private endpoint:

- Is not linked from the UI.
- Requires the Vault-held credential.
- Rejects browser sessions and ordinary authenticated users.
- Uses the service role only for narrow private claim/finalize RPCs.
- Never returns provider secrets or message payloads.

The secret is stored only in Vault and the deployment environment. It is never committed, embedded in cron SQL as plaintext, stored in notification payloads, or written to logs.

### Runtime and feature flags

The reminder producer, dispatcher, and settings UI require:

```text
public.common_notification_control_plane_runtime_version() = 1
```

If the capability is absent or not 1, the canonical control plane fails closed and does not disable an existing sender. The approved flags keep the common names and default to false:

- `notification_control_plane_settings_ui_enabled`: enables the common global page and registration-scoped settings dialog.
- `notification_control_plane_shadow_write_enabled`: evaluates reminder events, rules, templates, and targets but terminates would-be deliveries as `skipped/shadow_mode` without provider calls or new inbox projection.
- `notification_control_plane_dispatch_registration_enabled`: enables registration core and appointment-reminder canonical dispatch after shadow comparison passes.
- `notification_control_plane_registration_phone_adapter_enabled`: separately transfers phone-queue inbox projection ownership from the legacy registration database path.
- `notification_control_plane_registration_visit_adapter_enabled`: separately transfers immediate visit-notification ownership from the legacy route.
- `notification_control_plane_registration_solapi_adapter_enabled`: separately transfers SOLAPI command ownership while preserving its domain state machine.

A dispatch cutover disables the matching legacy sender in the same release before enabling canonical dispatch. No release permits two owners to send the same occurrence. Enabling registration reminder dispatch does not implicitly enable the visit-immediate or SOLAPI adapter flags.

### Claiming and leases

The service-role `claim_notification_deliveries_v1` RPC makes due `retry_wait` rows claimable and selects due `pending` deliveries with:

```sql
FOR UPDATE SKIP LOCKED
```

It claims a bounded batch, assigns a random claim token, sets a lease expiration, and changes each selected row to `claimed` in one transaction. Claiming does not increment `attempt_count`; only beginning a provider request does. Parallel pollers cannot claim the same row.

Immediately before adapter dispatch, the worker revalidates:

- Appointment still exists.
- Appointment status is `scheduled`.
- Appointment notification revision matches the delivery event.
- Reminder time is still before the appointment.
- Stable rule ID and rule revision match the immutable event and delivery snapshot.
- Immutable template ID and payload schema remain renderable.
- Target remains authorized and participating.
- Current server time is still before the appointment.

Revalidation never writes a generic `stale` reason. Missing/non-scheduled appointment becomes `canceled/source_status_changed`; source revision mismatch becomes `canceled/source_revision_changed`; stable rule mismatch becomes `canceled/rule_revision_changed`; unauthorized or no-longer-participating target becomes `canceled/recipient_revoked`. If `now() >= appointment.scheduled_at`, the claimed delivery becomes `failed/retry_window_closed`. If the stored reminder time is not strictly before the matching appointment despite matching revisions, it becomes `failed/schedule_validation_failed`. Unsupported payload/template and render failures use `failed/payload_schema_unsupported` or `failed/render_validation_failed`. Every case ends before adapter contact.

Immediately before the provider call, the worker transitions `claimed` to `sending`, records `last_attempt_started_at`, and increments `attempt_count`. If a `claimed` lease expires before `sending`, the row may return to `pending`. If a `sending` lease expires, the provider may have accepted the request, so the row becomes `delivery_unknown` with reason `worker_lost_after_send_start`; it is not automatically resent.

### Success, definite failure, and `delivery_unknown`

- `sent` requires an explicit adapter/provider acceptance result or the adapter's stronger existing finalize contract.
- A definite rejection proven not to have been accepted may transition to `retry_wait` only before the appointment.
- Registration reminders use three total provider attempts: the initial attempt, then one-minute and five-minute exponential backoff points with the common bounded jitter policy.
- If the next retry would occur at or after the appointment, the row becomes terminal `failed` with `retry_window_closed`.
- Network timeout, connection loss after dispatch begins, worker crash after dispatch begins, ambiguous provider response, and existing adapter ambiguous outcomes become `delivery_unknown`.
- `delivery_unknown` is never automatically resent or claimed by the normal worker.

Adapters that support a provider-enforced idempotency key may reconcile safely using the delivery key. An adapter without that guarantee must preserve ambiguity rather than risk a duplicate.

### Final race boundary

The worker performs canonical revalidation immediately before dispatch, but an appointment may change after that transaction and before the provider accepts the request. The system does not hold a database lock across a network call.

If this narrow race occurs, the delivery remains auditable under its old revision and the appointment mutation emits the existing immediate change or cancellation notification. Observability records the revision race. The system does not hide it, rewrite history, or automatically duplicate-send a correction beyond the approved immediate adapter behavior.

## Concurrency and Rollback

- Appointment create and edit RPCs lock the parent appointment, participating child rows, and affected tracks in stable order.
- Appointment producers and registration rule saves acquire the same workflow advisory transaction lock before domain row locks, so a rule-revision reconciliation snapshot cannot miss a concurrently committed appointment.
- Appointment create/edit commands supply the expected appointment `notification_revision`; director assignment commands instead supply the expected subject-track optimistic version because reassignment does not increment the appointment revision. Either mismatch returns a conflict and no partial write.
- Duplicate submission keys return the original canonical result only when the normalized request fingerprint matches.
- Reminder events use the stable occurrence key and deliveries use the common dedupe hash, so retries and concurrent fan-out cannot create duplicates.
- Competing director reassignments validate the expected track version, lock the track, and atomically enqueue target reconciliation from the committed owner; claimed work is marked `cancel_requested` rather than awaited.
- Concurrent pollers use `SKIP LOCKED` and leases.
- Cancellation or completion racing with a worker is resolved by send-time canonical revalidation and the documented final race boundary.
- Any canonical-data, process-history event, required immutable notification-event, fan-out-job, or target-reconciliation-job insert failure rolls back the relevant registration mutation.
- Fan-out/reconciliation, rendering, target resolution, delivery creation, and provider failures after the atomic commit are post-commit notification failures and cannot roll back the appointment or track mutation.

## Observability and Manual Investigation

Each worker run records a heartbeat and counts for `pending`, `claimed`, `sending`, `retry_wait`, `sent`, `delivery_unknown`, `failed`, `skipped`, `disabled`, and `canceled` deliveries. Logs use delivery/event IDs and sanitized error classes, not student phone numbers, secrets, or full message bodies.

`dashboard_private.notification_audit_logs` exposes deterministic skip counts by reason, including `not_before_appointment`. Schedule-reconciliation jobs expose their rule revisions, status, attempt count, lease, processed appointment count, canceled-delivery count, created-delivery count, skipped-rule counts, last error class, and completion timestamp. Target-reconciliation jobs expose source event, track version, old/current target-set hashes, canceled/created counts, retry state, and last error without profile names or message content.

Operations alerts fire when:

- No worker heartbeat succeeds for three consecutive minutes.
- Any delivery becomes `delivery_unknown`.
- A `pending` or due `retry_wait` delivery is more than five minutes overdue.
- A delivery exhausts its definite-failure retry budget.
- A revision race is observed after dispatch begins.

An admin-only investigation surface supports:

- Filtering by appointment, revision, rule, channel, status, and time.
- Viewing the canonical appointment state beside the immutable event and delivery audit.
- Recording provider evidence.
- Reconciling `delivery_unknown` to `sent` when provider proof exists.
- Reconciling `delivery_unknown` to `failed` when definitive provider evidence supports failure.
- Canceling an obsolete pending delivery.
- Approving `delivery_unknown -> retry_wait` only after confirming non-delivery or accepting duplicate risk and recording an explicit reason.

Manual retry preserves the same business occurrence, event, and delivery row. It appends `manual_retry_approved` to the common audit log and transitions that delivery from `delivery_unknown` to `retry_wait`; it never creates a new business occurrence or replacement delivery. Only an admin may make this disposition.

## Security

- Common notification event, rule, template, delivery, and audit tables live in `dashboard_private` and grant no direct access to `anon` or ordinary `authenticated` roles.
- Canonical registration RLS and role checks continue to protect parent, track, appointment, and activity reads.
- Only approved admin/staff mutations can create or change appointments.
- `admin` and `staff` may read and save reminder rules/templates, view masked delivery summaries, and retry definite failures.
- Only `admin` may create, replace, verify, or disconnect a Google Chat connection and manually disposition `delivery_unknown`.
- Private claim/finalize/reconcile functions validate the service role and use fixed search paths.
- The worker credential is held in Vault and compared server-side without logging it.
- Channel credentials stay inside their adapters.
- Payload snapshots minimize personal data and exclude phone numbers unless an existing adapter's separately approved contract requires them.
- Deep links do not grant access; the destination rechecks registration authorization.

## Error Handling

Operator-facing errors distinguish:

- Invalid or incomplete form input.
- Appointment or subject-track version conflict.
- `common_notification_control_plane_runtime_version() != 1` or canonical runtime maintenance.
- Appointment committed but immediate notification needs retry.
- Appointment committed but reminder fan-out needs retry.
- Appointment committed and reminder delivery later failed or became `delivery_unknown`.

Raw database codes, provider bodies, Vault details, and secrets are never shown to operators. Failure to insert the required immutable reminder event, fan-out job, or target-reconciliation job in the canonical transaction blocks and rolls back the relevant appointment/track save. A post-commit fan-out, reconciliation, delivery-creation, worker, or provider outage is reported as a separate notification failure and does not corrupt or roll back the authoritative mutation.

## Test Strategy

### Form and component contracts

- The ready-mode consultation form contains no editable or read-only phone-consultation date/time element; `ready_at` appears only in the phone queue/history and is never labeled 예약일시.
- Consultation editable DOM order is responsible directors, visit date/time, then visit room.
- Each selected subject can show a different responsible director.
- A shared visit renders one date/time and place with multiple subject badges.
- Phone readiness appears read-only only in the queue/history, never in the create/edit consultation area, and never enters appointment payloads.
- Level-test scheduling omits the result URL; completion requires it.
- Unrelated workflow forms keep their existing layout.

### Database and service tests

- Parent common fields and per-subject authoritative fields cannot overwrite one another.
- Phone rows reject appointments; visit rows require them.
- Shared level tests and visits create one appointment with correct child membership.
- Canonical mutations write actor/time/source/destination/subject events atomically.
- New canonical events use payload version 2 with explicit `actor_kind`; version 1 null actors render `알 수 없음` without inference.
- The manual `담당자 및 일시 이력` editor is absent; required current assignee/due controls live only under `현재 업무`.
- Automatic timeline entries cannot be edited or deleted.
- Actions that do not already require a business reason do not gain a mandatory reason field solely for history.
- An induced canonical process-event, required notification-event, fan-out-job, or target-job insert failure rolls back all canonical rows.
- An induced post-commit fan-out or delivery-creation failure leaves the appointment committed and exposes notification-only retry.
- Revision conflicts and mismatched idempotency-key reuse produce no partial changes.
- Stale subject-track versions reject competing director reassignment without changing the appointment revision or enqueuing a partial target job.
- Appointment completion cancels remaining `pending` and `retry_wait` reminders, marks pre-send `claimed` work `cancel_requested`, and preserves `sending`, `sent`, and `delivery_unknown`.
- Legacy phone timestamps remain readable but are never written or scheduled.
- Ephemeral Supabase/Postgres pgTAP tests impersonate admin, staff, authenticated, anon, and service roles; two-session tests cover advisory-lock and row-lock order; pg_cron/pg_net smoke tests use fixture endpoints and never contact a real provider.

### Calendar tests

- One shared appointment produces one stable calendar item.
- Multiple same-day same-kind appointments have distinct IDs.
- Exact timestamps survive projection and timezone conversion.
- Level tests and visits appear; phone consultations do not.
- Subject badges come from canonical children.
- Deep links restore the shared appointment.
- No registration action inserts or updates `academic_events`.
- Calendar cards expose no drag or resize mutation.

### Reminder scheduling tests

- All three reminder variants and all applicable cells seed disabled and produce no delivery until an admin/staff save explicitly enables them.
- The all-disabled UI shows the no-send warning and three Korean presets; after enabling and saving fixture cells, navigation and reload preserve them and fixture in-app/Google Chat deliveries become due at their exact calculated times without contacting production providers.
- The kind registry evaluates only `level_test` management-team cells and `visit_consultation` track-director/management-team cells; non-applicable cells create no `no_recipient` delivery.
- Every scheduled reminder event key is exactly `registration.appointment_reminder_due`, and its occurrence key round-trips appointment ID, source revision, stable rule ID, and rule revision without `scheduled_for`.
- D-1 14:00, D-day 14:00, and one-hour-before calculations use `Asia/Seoul`.
- KST boundary cases include 00:00, 00:30, 13:59, 14:00, 14:01, and 23:59 appointments.
- Month-end, year-end, leap-day, UTC-host, and DST-changing non-KST host dates produce the same KST schedule.
- Same-day 14:00 is omitted for appointments at or before 14:00.
- Creating an appointment after a reminder time does not backfill it; remaining future rules still materialize.
- A reminder calculated at or after the appointment creates no event or delivery and records `not_before_appointment` in common notification audit.
- Rescheduling cancels old-source-revision `pending` and `retry_wait` rows and creates only future new-source-revision occurrences.
- Cancellation and completion cancel remaining unattempted reminder deliveries while preserving attempted history.
- Director reassignment cancels the old recipient's unattempted rows and creates future rows for the new recipient without changing appointment source revision.
- Director reassignment plus its unique target-reconciliation job commit atomically; a crash after old-target cancellation resumes to exactly one current-target delivery.
- Unique keys prevent duplicate events and deliveries under concurrent materialization.
- Each fixed `rule_variant_key` persists independent enablement, timing, audience, and channel state in a stable rule with optimistic revision.
- Title/body changes create an independent immutable `notification_templates` version and update the rule's `active_template_id` and revision atomically.
- Rule-setting save enqueues a durable schedule-reconciliation job through the common revision-checked RPC.
- Appointment event commit enqueues a unique `notification_event_fanout_jobs` row atomically; worker interruption before or during fan-out resumes without lost or duplicate deliveries.
- Reconciliation cancels only superseded unattempted deliveries, recreates future occurrences with stable rule ID plus new rule revision, and never changes `sending`, `sent`, `delivery_unknown`, or terminal history.
- Reconciliation creates only enabled/applicable rounds with `now < scheduled_for < appointment`; enabling a past preset does not backfill it.
- A reconciliation failure leaves saved settings intact, displays a distinct failure state, and succeeds through idempotent retry.

### Worker and adapter tests

- Parallel claimers cannot claim the same delivery.
- Claim transitions `pending -> claimed`; the worker transitions `claimed -> sending` only immediately before the provider call.
- Leases recover a pre-dispatch `claimed` crash but convert a post-dispatch `sending` crash to `delivery_unknown`.
- Send-time status, source revision, rule revision, or recipient mismatch cancels with its exact closed reason and without adapter contact.
- Send-time revalidation maps status, source revision, rule revision, and recipient failures to their exact closed cancellation reasons; it never stores generic `stale`.
- Cron backlog that reaches a reminder at or after the appointment ends `failed/retry_window_closed` without provider contact.
- Explicit acceptance finalizes `sent`.
- Definite rejection follows the one-minute and five-minute bounded retry policy and stops before the appointment.
- Timeout and ambiguous responses become `delivery_unknown` and never auto-resend.
- Admin manual reconciliation preserves the same occurrence and delivery; approved retry transitions the same row to `retry_wait` with audit.
- All ten canonical delivery statuses and their allowed transitions match the common control-plane contract.
- Runtime probe and the approved settings, shadow, registration, phone, visit, and SOLAPI flags fail closed and prevent dual senders.
- Existing visit immediate-notification dedupe and failed-target retry remain unchanged.
- Existing SOLAPI and phone-assignment adapter state machines remain unchanged.
- The private endpoint rejects missing or invalid worker credentials and ordinary browser authentication.

### Browser QA

Using local or fixture data:

1. Create English and mathematics with different initial subject plans.
2. Confirm direct phone creates a queue item with no picker or calendar event.
3. Confirm a two-subject visit follows owner, date/time, room order and persists one appointment.
4. Confirm level-test result URL appears only during subject completion.
5. Verify list/calendar toggle, month view, week view, and mobile agenda.
6. Open an appointment deep link and confirm the correct shared appointment and subjects.
7. Confirm history separates actor from current owner and labels migration fallback honestly.
8. Reschedule, cancel, and complete appointments and inspect pending reminder changes.
9. Trigger a 409 edit conflict, compare the server appointment with the preserved local draft, and confirm that no partial appointment or reminder mutation occurred.
10. Exercise definite failure and ambiguous timeout adapters without sending production messages.
11. Check desktop and mobile console output for errors and accessibility warnings.

Production verification is read-only unless explicit authorization is given to create a real registration or send a real notification.

## Acceptance Criteria

The design is complete when all of the following are true:

- Ready-mode registration create/edit uses canonical parent, track, appointment, and activity data only.
- No phone date/time element appears in registration create/edit, while historical legacy data remains intact and readable in migration/history context.
- Consultation input order is owner, visit time, then room on desktop and mobile.
- Shared appointments and subject-specific owners/results/states remain distinct.
- Every canonical process mutation creates trustworthy same-transaction history.
- Mutable `현재 업무` controls remain separate from the read-only, non-deletable automatic timeline.
- Registration exposes list/calendar modes backed only by canonical appointments.
- Calendar IDs, timestamps, subjects, statuses, revisions, and deep links are stable and exact.
- Registration never duplicates appointments into `academic_events` and never edits by drag-and-drop.
- After explicit operator enable/save, durable future reminders use the approved KST presets, private outbox, stable occurrence identity, rule/source revision cancellation, and send-time revalidation; deployment alone sends none.
- The three fixed reminder variants persist independent on/off, timing, audience, and channel state in stable rules, while title/body live in independent immutable template versions; no custom variant can be added.
- Polling, `claimed`/`sending` leases, definite `retry_wait`, `delivery_unknown` preservation, same-delivery manual reconciliation, security, and observability satisfy the common control-plane contract.
- Existing immediate visit, SOLAPI, and phone-notification semantics remain available through their adapters without behavioral flattening.
