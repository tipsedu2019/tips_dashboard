# Registration Subject Tracks and Multi-Enrollment Design

**Date:** 2026-07-12

## Goal

Keep one registration case for a student while allowing English and mathematics to move through the registration workflow independently. A subject that reaches enrollment may contain more than one class, with its own textbook choice and class-start schedule for each class.

The design must reflect the academy's actual operating rules:

- English and mathematics level tests normally share one appointment when both are required.
- A visit consultation may cover both subjects in one appointment when the responsible directors can attend.
- One subject may be handled in a visit consultation while the other remains in the phone-consultation queue.
- Phone consultations are not scheduled appointments. Directors work through a waiting list, record the completion time, and decide the next step for that subject.
- One subject may finish while another remains in progress. The parent case stays open until every subject track is terminal and no admission batch remains open.

## Current Limitation

The current application stores multiple inquiry subjects only as a serialized `ops_tasks.subject` value. The workflow, level-test fields, consultation owner, consultation fields, class, textbook, class-start schedule, and pipeline status are all single values on the parent task or its one-to-one `ops_registration_details` row.

This allows `영어, 수학` to be displayed and filtered, but it cannot represent any of the following without overwriting data:

- English in consultation while mathematics is in a level test.
- A shared level-test appointment with separate subject results.
- A shared visit consultation with subject-specific outcomes.
- A visit consultation for one subject and a phone consultation for the other.
- More than one class for a registered subject.

Adding only a `수업 추가` button to the current form would create UI state that the service and database cannot persist safely.

## Considered Approaches

### Separate task per subject

Creating an `ops_task` for every subject would reuse much of the existing pipeline code. It would also duplicate student, contact, inquiry, admission, payment, and message history. Operators could mistake the duplicated tasks for separate inquiries, and the model would still need another child table for multiple classes. This approach is rejected.

### JSONB subject flows and class lists

Storing subject flows and enrollments as JSONB would minimize the first schema change. It would weaken foreign keys to classes and textbooks, make stage counts and filtering more expensive, complicate concurrent edits, and make roster synchronization difficult to validate transactionally. This approach is rejected.

### Parent case, subject tracks, shared appointments, and enrollment rows

One parent case owns common inquiry and admission data. Subject tracks own independent workflow state. Shared appointment rows represent one real-world time slot, while subject-specific activity rows preserve separate results. Enrollment rows represent every selected class. This approach is approved.

## Domain Model

### Parent registration case

`ops_tasks` and `ops_registration_details` remain the parent record.

The parent owns:

- Student identity and linked student record.
- Grade, school, parent phone, student phone, and inquiry date/time.
- Common request notes.
- Admission-application delivery.
- Admission-batch summary and history.
- Parent open/closed status and derived final outcome.

The parent does not own the authoritative subject stage, director, class, textbook, or class-start schedule after the new model is enabled.

Existing parent columns remain temporarily as compatibility projections:

- `ops_tasks.subject` is derived from active subject tracks.
- `ops_tasks.class_id` and `textbook_id` are non-authoritative legacy representatives.
- `ops_tasks.secondary_assignee_id` and `ops_registration_details.counselor` are non-authoritative legacy representatives; the track director is authoritative.
- `ops_registration_details.pipeline_status` is a non-authoritative summary projection.
- `ops_registration_details.makeedu_registered` is derived from active enrollment rows.
- `ops_registration_details.makeedu_invoice_sent` and `payment_checked` are derived from the current batch or, when none is open, the most recent completed batch.
- `ops_registration_details.common_revision` versions only common-information edits. Saves compare the loaded revision under lock, increment once, and return a conflict instead of overwriting another operator's newer contact/school/grade/inquiry data.

Compatibility columns are not dropped in this change.

### Subject tracks

Add `public.ops_registration_subject_tracks` with:

- `id uuid primary key`.
- `task_id uuid not null references ops_tasks(id) on delete cascade`.
- `subject text not null`, limited initially to `영어` and `수학`.
- `pipeline_status text not null` using stable machine values.
- `director_profile_id uuid references profiles(id) on delete restrict`.
- `director_assignment_source text null`, limited to default, manual, or migration.
- `director_assignment_rule_key text null` and `director_assigned_at timestamptz null` with an explicit all-null/unassigned branch and valid provenance checks. Assigned director profile deletion is restricted so historical ownership cannot be silently detached.
- `waiting_kind text null`, limited to `current_class`, `current_term_opening`, or `next_term_opening`.
- `level_test_retake_decision text null`, limited to `required` or `not_required`.
- `level_test_retake_decided_at timestamptz null`.
- `migration_review_required boolean not null default false`.
- `stage_entered_at timestamptz not null` for queue ordering and elapsed-time reporting.
- `created_at` and `updated_at`.
- A unique constraint on `(task_id, subject)`.

The stable `pipeline_status` values are:

- `inquiry`.
- `migration_review`.
- `level_test_scheduled`.
- `level_test_in_progress`.
- `consultation_waiting`.
- `visit_consultation_scheduled`.
- `waiting`.
- `enrollment_decided`.
- `enrollment_processing`.
- `registered`.
- `not_registered`.
- `inquiry_closed`.

The six top-level tabs are derived from these values rather than stored separately. Completing a level test moves the track directly to `consultation_waiting`. Completing a consultation requires its outcome in the same operation and moves the track directly to `waiting`, `enrollment_decided`, or `not_registered`; there is no persisted ambiguous “consultation completed but undecided” track state.

`level_test_retake_decision` is deliberately three-state: null means not reviewed, `required` means a new level test must be booked, and `not_required` permits enrollment. Recording `required` alone leaves the track in waiting; only saving a real appointment moves it to level-test scheduling, so tab counts never claim that an unscheduled test is booked. Entering a waiting state clears both the decision and its timestamp so an older decision cannot be reused silently.

### Shared appointments

Add `public.ops_registration_appointments` with:

- `id uuid primary key`.
- `task_id uuid not null references ops_tasks(id) on delete cascade`.
- `kind text not null`, limited to `level_test` or `visit_consultation`.
- `scheduled_at timestamptz not null`.
- `place text not null`, nonblank for every level-test or visit appointment.
- `status text not null`, limited to scheduled, completed, or canceled.
- `notification_revision integer not null`, starting at 1 and incremented once for each authoritative schedule/participation/cancellation change.
- `created_by uuid references profiles(id) on delete set null`.
- `created_at` and `updated_at`.

An appointment is the shared real-world time and place. It does not contain a combined subject result.

An appointment may be edited in place only while every attached subject activity is still scheduled. Once any attached activity is in progress or terminal, its time and place become immutable history. Rescheduling the remaining subjects cancels their scheduled activities and creates a replacement appointment; completed or absent activities never move to the replacement.

### Level-test attempts

Add `public.ops_registration_level_tests` with:

- `id uuid primary key`.
- `track_id uuid not null references ops_registration_subject_tracks(id) on delete cascade`.
- `appointment_id uuid not null references ops_registration_appointments(id) on delete restrict`.
- `attempt_number integer not null`.
- `status text not null`, limited to scheduled, in-progress, completed, absent, or canceled.
- `started_at timestamptz null`.
- `completed_at timestamptz null`.
- `material_link text null` for the subject's test paper and result URL.
- `created_at` and `updated_at`.
- Unique constraints on `(track_id, attempt_number)` and `(appointment_id, track_id)`.

English and mathematics tests on the same day point to the same appointment. Each attempt keeps its own result link. A later retest creates a new appointment or joins another shared appointment and increments `attempt_number`, preserving prior history.

### Consultations

Add `public.ops_registration_consultations` with:

- `id uuid primary key`.
- `track_id uuid not null references ops_registration_subject_tracks(id) on delete cascade`.
- `appointment_id uuid null references ops_registration_appointments(id) on delete restrict`.
- `mode text not null`, limited to `phone` or `visit`.
- `status text not null`, limited to waiting, scheduled, completed, or canceled.
- `director_profile_id uuid not null references profiles(id) on delete restrict`.
- `completed_at timestamptz null`.
- `outcome text null`, limited to enrollment, waiting, or not-registered.
- `created_at` and `updated_at`.
- A check constraint requiring phone consultations to have no appointment and visit consultations to have an appointment.

The consultation director is a historical snapshot of the responsible track director at the time the consultation is created. A later administrative reassignment does not rewrite completed consultation history.

A phone consultation has no appointment and begins in `waiting`. The director completes it directly from the consultation queue; the server stamps `completed_at` and requires an outcome in the same operation.

A visit consultation points to a visit appointment. Two consultations may point to the same appointment when both subjects are handled together. If only one subject is visited, only that subject's consultation points to the appointment and the other subject retains a phone consultation in `waiting`.

Consultation outcomes remain subject-specific even when the appointment is shared.

### Admission batches

Add `public.ops_registration_admission_batches` with:

- `id uuid primary key`.
- `task_id uuid not null references ops_tasks(id) on delete cascade`.
- `revision_number integer not null`.
- `status text not null`, limited to draft, invoiced, paid, completed, or canceled.
- `invoice_sent_at timestamptz null`.
- `payment_confirmed_at timestamptz null`.
- `created_at` and `updated_at`.
- A unique constraint on `(task_id, revision_number)`.
- A partial unique index allowing only one non-terminal batch per task.

An admission batch groups the new enrollment rows being processed and billed together. The admission application remains a case-level one-time step. MakeEdu confirmation remains enrollment-specific. Invoice and payment confirmation belong to the batch so a subject or class added later cannot reuse an older payment confirmation.

If English is admitted first while mathematics remains waiting, English may complete in batch 1. When mathematics is admitted later, its enrollment rows enter batch 2 with a new invoice and payment confirmation. Completed batches remain visible as history.

### Enrollment rows

Add `public.ops_registration_enrollments` with:

- `id uuid primary key`.
- `track_id uuid not null references ops_registration_subject_tracks(id) on delete cascade`.
- `student_id uuid null references students(id) on delete restrict`; unbatched planned drafts must be null, while waitlisted, batched, and enrolled rows freeze the resolved student.
- `admission_batch_id uuid null references ops_registration_admission_batches(id) on delete restrict`.
- `class_id uuid not null references classes(id) on delete restrict`.
- `textbook_id uuid null references textbooks(id) on delete restrict`.
- `class_start_date date null`.
- `class_start_session_key text null`, the canonical `${date}:${positive session number}` identity.
- `class_start_session text null`.
- `status text not null`, limited to planned, waitlisted, enrolled, or canceled.
- `makeedu_registered boolean not null default false`.
- `roster_active boolean not null default false`, true while this row owns the live student/class roster relationship or an open-batch claim.
- `roster_released_at timestamptz null` and `roster_release_reason text null`, allowing withdrawal/transfer to release current roster ownership without rewriting immutable paid admission history.
- `roster_release_source_task_id uuid null references ops_tasks(id) on delete restrict` and `roster_release_kind text null`, limited to withdrawal or transfer, so every external release is attributable to its source operation.
- `sort_order integer not null default 0`.
- `created_at` and `updated_at`.
- A partial unique index on `(track_id, class_id)` for rows that are planned or roster-active. A released enrolled history row does not block a later enrollment in the same class.
- A partial unique index on `(student_id, class_id)` where `roster_active`, preventing two registration cases or batches from claiming the same real relationship while allowing later withdrawal/transfer release.
- A partial unique index allowing only one active `waitlisted` row per track.

The row lifecycle is exact: an unbatched planned draft has null student/batch, inactive roster, and no release metadata; a batched planned row has student/batch and an active claim; a waitlisted row has student, no batch, and an active claim; a current enrolled row has student/batch and an active claim; an externally released enrolled history row stays enrolled but becomes inactive with complete release timestamp/reason/source/kind; and a canceled row is inactive with no external-release metadata. Immediate database checks reject every mixed shape.

Every enrollment must use a class whose normalized subject matches the parent track. Draft and current-class waitlist rows may omit the start schedule. Moving a row into admission processing requires both schedule fields, and the chosen date and session must still exist as a selectable session on that class at completion time. Current-term-opening and next-term-opening waits remain track-level waits until a concrete class exists; current-class waiting uses a `waitlisted` enrollment row.

The textbook defaults from the class's first valid linked textbook. An operator may clear it to represent a student who already owns the book. A null textbook never blocks enrollment.

Canceling a row preserves it as history. Adding the same class later creates a new current row because the uniqueness rule excludes canceled and externally released history. Completed batch/core enrollment fields remain immutable; only an audited registration cancellation may change enrolled status to canceled, and withdrawal/transfer may release live ownership without rewriting the paid outcome.

## Workflow Semantics

### Status and tab mapping

Every active subject track contributes exactly one item to exactly one top-level tab:

| Track status | Top-level tab |
| --- | --- |
| `inquiry`, `migration_review` | 문의 |
| `level_test_scheduled`, `level_test_in_progress` | 레벨테스트 |
| `consultation_waiting`, `visit_consultation_scheduled` | 상담 |
| `waiting` | 대기 |
| `enrollment_decided`, `enrollment_processing` | 등록 |
| `registered`, `not_registered`, `inquiry_closed` | 완료 |

Tab badges count tracks, not parent cases. A terminal track remains in 완료 even while another track from the same parent remains active elsewhere.

### Allowed transitions

| From | Allowed destination and condition |
| --- | --- |
| `inquiry` | Level-test scheduling, consultation waiting, waiting, or inquiry-only closure after the management decision. |
| `migration_review` | The operator attributes the legacy fields, then chooses the corresponding non-terminal or terminal state; no generic next action is available before attribution. |
| `level_test_scheduled` | In progress when the test starts; inquiry when all scheduled attempts are canceled and management resets the direction. |
| `level_test_in_progress` | Consultation waiting after a completed result; a new level-test schedule after absence or a required retest. |
| `consultation_waiting` | Visit scheduled, enrollment decided, waiting, or not registered. Enrollment/waiting/not-registered destinations require atomic phone-consultation completion and outcome. |
| `visit_consultation_scheduled` | Enrollment decided, waiting, or not registered after that subject's visit completion; consultation waiting after visit cancellation. |
| `waiting` | Level-test scheduling after a required retest decision; enrollment decided after an explicit not-required decision; not registered after an explicit closure. |
| `enrollment_decided` | Enrollment processing after class, schedule, admission-application, and batch validation; waiting or not registered before processing begins. |
| `enrollment_processing` | Registered after MakeEdu, invoice, payment, and atomic roster completion; reversal to waiting or not registered requires canceling the open batch and preserving its history. |
| `not_registered`, `inquiry_closed` | Reopening requires a reason and an explicit destination of inquiry or consultation waiting; the parent status is recomputed. |
| `registered` | Generic reopening is blocked. Adding a class or canceling an enrollment uses its dedicated operation, preserves completed history, and recomputes the parent status. |

Every transition records the actor, source, destination, subject, timestamp, and reason when required.

### Inquiry

Creating a registration case creates one subject track for each selected subject. Common inquiry data is stored once. The create contract does not accept a browser-selected student ID; the first waitlist/admission materialization resolves or creates the student under a deterministic normalized identity lock. Removing a subject that already has activities or enrollments is blocked; the operator must explicitly close that track instead.

Editing an existing case uses one narrow revision-checked transaction for common fields and a separate history-aware subject-sync action. The common mutation updates only student/contact/school/grade/campus/inquiry-time/request-note/priority fields; it cannot carry stage, director, class, appointment, result, or checklist values. If edited identity no longer matches a saved student link, the link may be cleared only before roster or admission history exists. Any admission-application row with `claim_active = true`—pending, accepted, unknown, or failed-hold—freezes identity, as does a waitlist, non-planned enrollment, or admission batch. A definitively failed or explicitly released row with `claim_active = false` releases only the message boundary when no other history exists.

The management team chooses the next direction independently for each track:

- Level test.
- Direct consultation based on submitted grades.
- Waiting.
- Inquiry-only closure.

### Level test

The reservation form asks for the appointment date/time and place, then lets the operator select one or both eligible subjects.

An eligible subject cannot already have an active same-kind activity on another appointment. A still-scheduled activity remains selectable while editing its own appointment; a started or terminal activity is immutable and is not presented as a free candidate. The server repeats this rule while holding row locks.

Selecting both subjects creates one appointment and two subject-specific level-test rows. Every completed subject attempt requires its own result URL before that track can move to consultation waiting.

Each attempt finishes independently as completed, absent, or canceled. A completed attempt requires its own result URL. Absent and canceled attempts do not require a URL and do not advance the track; the operator may schedule another attempt or close the inquiry. The shared appointment becomes completed only when all attached attempts are terminal.

While every child is still scheduled, editing a shared test may add or remove a subject. Removing a subject cancels only its scheduled child and returns that track to inquiry when no other active attempt remains; the system never leaves `level_test_scheduled` without a reservation. Once any child starts or finishes, remaining work moves through a new replacement appointment rather than rewriting immutable activity IDs.

### Consultation

Direct-consultation and completed-level-test tracks enter `consultation_waiting`.

Phone consultations do not ask for a reservation time. The consultation tab is the responsible director's queue, ordered oldest first by `stage_entered_at`. The row action is `전화상담 완료 및 결과 결정`. Completion stamps the server time and atomically chooses enrollment, waiting, or not-registered.

A visit consultation creates an appointment and selects one or both eligible subject tracks. Each track retains its own responsible director. When both subjects share the appointment, each track still receives an independent completion and outcome. Scheduling a visit atomically cancels that track's active phone-waiting activity before inserting the visit child; a subject not included remains in the phone queue. Deselecting or canceling a visit returns only the affected track to consultation waiting and recreates one phone queue item when its director remains valid; otherwise it shows assignment required.

### Waiting

Waiting status belongs to a subject track. The operator selects current-class, current-term-opening, or next-term-opening waiting.

Current-class waiting requires one concrete class and one `waitlisted` enrollment row. Entering and leaving this wait uses an atomic roster operation that updates all four null-safe, deduplicated projections: student `class_ids`/`waitlist_class_ids` and class `student_ids`/`waitlist_ids`. Enrollment, waiting, and removal each write one `student_class_enrollment_history` row only when the real mode changes. Registration removal does not change the student's `재원` status; the withdrawal workflow owns `퇴원`. The other two waiting kinds do not create an enrollment row until a class is known. Leaving current-class waiting for a retest removes the active waitlist projection while preserving the historical row.

Those four live roster columns are JSONB arrays. One locked database helper validates array shape and UUID-string elements, normalizes both sides, and owns every roster transition across registration, task, and management screens. Ready-mode clients cannot write whole roster arrays directly; existing roster controls use the shared RPC, and ordinary student/class edits omit roster fields. This prevents a stale non-registration browser write from overwriting a concurrently committed registration relationship.

Withdrawal and transfer completion use dedicated atomic database operations rather than a client remove/add/rollback sequence. Whole-student withdrawal removes every current enrolled and waitlist relationship, releases each claimed enrolled row with source metadata, cancels waitlisted claims and closes their waiting tracks, then marks the student withdrawn and completes the task in the same transaction. It rejects any open registration batch first. Transfer removes one source relationship, conditionally releases its registration claim, adds the destination relationship, keeps the student active, and completes the task atomically. Both also work for legacy/management roster pairs with no registration claim. Direct terminal task/checklist writes, type-reclassification bypasses, and malformed task/detail pairings are blocked. A withdrawn student cannot acquire a new registration claim without a separate explicit reactivation workflow, closing withdrawal-versus-batch/wait races.

Before a waiting track moves to enrollment, the operator records the level-test retake decision. `required` keeps the track in waiting until the operator saves a new level-test appointment; that save moves it to level-test scheduling without deleting prior attempts. `not_required` permits the enrollment decision. A missing decision blocks the transition.

### Enrollment

Every track with an enrollment outcome shows a subject card containing its enrollment rows and a `수업 추가` button.

Each row contains:

- Class.
- Textbook or `선택 안 함 · 이미 보유`.
- Class-start date and session from that class's schedule.
- MakeEdu registration status.
- Remove action while the row is still planned.

Class options are restricted to the track subject. Choosing a class loads only that class's schedule and linked textbooks. Adding another row does not reset existing rows.

An enrolled row cannot be deleted directly. Reversal requires an explicit cancellation path that removes the roster projection and records history.

The enrollment transition is exact:

1. `enrollment_decided` means the consultation or waiting decision selected registration, but class rows may still be drafts.
2. Moving to `enrollment_processing` requires at least one non-canceled enrollment row, a valid start schedule on every included row, the case-level admission application, and an open admission batch containing those rows.
3. During `enrollment_processing`, operators confirm MakeEdu on every row, then send the batch invoice and confirm payment.
4. Finalizing the paid batch runs the roster transaction. It marks the included enrollment rows enrolled, marks every participating track registered, and completes the batch together.

Roster projections are not changed at `enrollment_decided` or while a batch remains unpaid. This preserves the current rule that the dashboard roster changes only when registration completion succeeds.

Adding a class to an already registered track is an explicit add-class operation. It reopens that track to `enrollment_processing`, reopens the parent task, and creates a new admission batch for only the new enrollment rows. Previously completed financial/core row fields remain immutable history; only explicit audited registration cancellation or external live-roster release may change status/ownership metadata.

Canceling an add-class batch cancels only that batch's planned rows. If any older historical enrolled row survives—even one whose live roster was later released by withdrawal/transfer—the subject is restored to its prior registered admission outcome. A truly first-admission subject receives its own waiting/not-registered resolution. While any open batch contains a row for a track, row-level cancellation for that track is blocked; the batch must be completed or canceled first.

### Admission application message

The one-time admission application uses a database claim separate from provider delivery status. `ops_registration_messages.claim_active` is true for pending, accepted, unknown, and an operator-confirmed failed-hold; those states freeze recipient identity and block every second send key. A definitive provider rejection or an explicit delayed retry release makes the failed row inactive. A partial unique index permits only one active case/template claim.

Only the transaction whose pending-row insert actually succeeds receives `shouldSend: true`. Replays and concurrent actors receive the authoritative active row with no send authority. Provider results are written only through a service-role finalizer: accepted remains active and triggers the one-time admission mark; unknown remains active; definitive provider failure releases the claim. A human may reconcile unknown to accepted or failed-hold, and may upgrade an unreleased failed-hold to accepted when later provider evidence arrives. Failed-hold remains blocking until a separately audited `재발송 허용` action after the safety delay; the next send then requires a brand-new message key.

Every send includes the message request key in SOLAPI custom fields. If the send response is lost, a server-only `발송 상태 확인` action waits 15 minutes, queries the provider by saved IDs or recipient/time window, filters the exact custom request key, and passes the result through the finalizer. No exact match becomes unknown, not automatic failure. Browser reconciliation never decides a still-pending request. During schema maintenance the server route returns 503 before claim, lookup, send, finalization, or mark, so partial deployment cannot emit an external message.

Authenticated readers receive only workflow-safe message columns—ID, task/template/request key, status, claim state, and timestamps—under the existing parent-scoped RLS policy. Recipient fragments, provider IDs/status text, and raw errors remain server-only; UI history shows normalized audited outcomes rather than raw provider payloads.

### Completion

A subject track may become `registered`, `not_registered`, or `inquiry_closed` independently. The parent task remains open while any track is non-terminal or any admission batch is non-terminal.

When all tracks are terminal, the parent result is derived as:

- `전과목 등록` when every track is registered.
- `부분 등록` when at least one track is registered and at least one is not registered or inquiry-only.
- `전과목 미등록` when no track is registered.

The admission checklist appears when at least one track enters enrollment. The admission application is shared once by the case, while the remaining items apply to the current admission batch:

1. 입학신청서 발송.
2. 현재 batch의 모든 enrollment row에 대한 MakeEdu 수업·교재 등록.
3. 현재 batch 청구서 발송.
4. 현재 batch 수납 완료 확인.
5. 현재 batch 등록 완료.

The MakeEdu step is derived from the batch enrollment rows. It is not a second editable parent boolean. A later batch receives fresh invoice and payment steps instead of inheriting a prior batch's checks.

The parent `ops_tasks.status` projection is deterministic:

- `requested` while every track remains in inquiry.
- `in_progress` while any track or admission batch is non-terminal.
- `done` after all tracks and admission batches are terminal and at least one track is registered.
- `canceled` after all tracks are terminal and none is registered.

Legacy compatibility projections are also deterministic:

- `ops_registration_details.pipeline_status` represents the earliest non-terminal track in workflow order. After closure it represents registered completion when any track registered, otherwise inquiry-only or not-registered closure as appropriate.
- `ops_tasks.class_id` and `textbook_id` represent the first compatibility enrollment by subject order, `sort_order`, then enrollment UUID for older consumers. An unbatched planned add-class draft on an already registered track is excluded until its new admission batch starts, so merely saving a later class draft does not change a closed case's legacy projection.
- Parent director fields represent the first active track by subject order only for older consumers.
- `ops_registration_details.makeedu_registered` is true only when at least one compatibility enrollment exists and every row in that set has been confirmed in MakeEdu. The same closed-track unbatched add-class drafts are excluded until batch start, preserving the completed parent projection while the draft is still editable.
- `ops_registration_details.makeedu_invoice_sent` and `payment_checked` reflect the most recent non-canceled admission batch so a completed parent remains compatible with older readers.

## User Interface

### List and tabs

The top tabs count subject work items, not distinct students. A student whose English track is in consultation and mathematics track is in a level test appears in both tabs.

The list adapter flattens parent cases into track rows containing the common student summary plus the subject, current stage, responsible director, and next action. Rows from the same parent keep a shared case indicator so they are not mistaken for unrelated duplicate inquiries.

Opening a row uses both `taskId` and `trackId`, then opens the unified case detail with the selected subject in focus.

### Unified detail and edit dialog

The dialog header shows the common student information once. Under it, subject controls show labels such as `영어 · 상담 대기` and `수학 · 레벨테스트 예약`.

Selecting a subject shows only that track's stage fields and actions. Shared appointments show all participating subject badges. Editing a shared appointment updates the shared time/place once and preserves each subject's independent result.

The admission panel appears once below the subject content when at least one track has reached enrollment, a batch exists, or admission-message state/history still needs attention. It is case-scoped and stays mounted when the operator selects a different subject or routes the last eligible track away. It shows all explicitly selectable unbatched rows, the one-time admission-application state, the current mixed-subject batch checklist, and collapsed history. Eligibility comes from an `enrollment_decided` subject or a registered subject with an unbatched planned add-class row, not from the parent's earliest compatibility stage. Pending, accepted-but-unsynced, unknown, and failed-hold states never expose a second send action; failed-hold exposes evidence-based acceptance or delayed `재발송 허용` only to management. Every current-batch enrollment row displays its subject and class.

### Consultation queue

The consultation tab distinguishes:

- `전화상담 대기` with no reservation date.
- `방문상담 예약` with an appointment date/time and place.

Phone rows expose `전화상담 완료 및 결과 결정`. Visit rows expose subject-specific completion actions after the appointment. All action labels include the subject, such as `[영어] 전화상담 완료`.

Visible controls follow the same matrix as the database. A responsible director is an existing visible teacher-catalog principal whose linked dashboard profile has role `admin`; there is no separate non-admin director role. Admin/staff see stage-appropriate management actions, but consultation completion is a responsibility-bound action: only the currently assigned admin director may complete that track's active consultation, and both the live track owner and the consultation's historical director snapshot must match the caller. Staff and other admin directors cannot complete that consultation. Assistants, task participants, and ordinary teachers retain case/history read access where existing parent RLS permits it but see no mutation buttons.

### Multiple classes

The enrollment section groups rows under each subject. `수업 추가` appends an empty row for that subject. A row can be removed only before enrollment is committed.

On mobile, each enrollment is a vertical card. On desktop, rows use a compact repeated grid. Neither layout introduces page-level horizontal scrolling.

## Assignment and Notifications

Academic-director defaults are resolved per subject track using the existing year-aware assignment rule. A combined English and mathematics inquiry is no longer ambiguous because each track receives its own default director. The track stores whether the assignment came from a default, manual override, or migration plus a canonical rule key. Grade/inquiry-year changes re-resolve only nonterminal default assignments. If the changed inputs are unsupported, or an authoritative completed option snapshot proves the resolved profile unavailable, the stale default is atomically cleared and the case shows `담당자 지정 필요`; transient/partial option loading never clears it. Manual, migrated, and terminal-track assignments remain stable as historical ownership and are never auto-cleared.

Visit consultation notifications are deduplicated by appointment revision, subject track, and recipient. Creation starts revision 1; real time/place/participation edits and cancellation increment it once, while idempotent retries preserve it. A shared appointment may notify multiple responsible directors, while the management-team Google Chat message is summarized as one appointment containing both subjects. Cancellation and replacement notify the old appointment revision after commit, and a replacement separately notifies its new appointment, so stale live-reservation notices are not left behind.

Phone consultation waiting does not send a false reservation notification. Queue assignment may create an internal dashboard notification for the responsible director. Consultation completion and outcome changes remain independently recorded per track.

Notification delivery occurs after the authoritative database transition. A failed notification displays a retryable warning but never rolls back the saved workflow state.

## Transaction and Security Design

Initial case creation and subject-track creation must succeed or fail together.

Creating or editing a shared appointment and its subject-specific activities must also succeed or fail together. Phone-consultation completion stamps the completion time, stores the outcome, advances the track, and records the event in one transaction.

Every appointment mutation validates that the appointment and all attached tracks belong to the same parent task. Level-test rows may reference only level-test appointments. Visit consultations may reference only visit-consultation appointments.

Enrollment completion uses a registration-specific Postgres RPC executed as one transaction. It must:

1. Validate the authenticated operator's access to the parent task.
2. Lock the task, student, subject track, enrollment rows, affected classes, and non-null textbooks in one fixed order.
3. Revalidate the locked student against the case identity snapshot.
4. Confirm that each class still exists and its subject matches its track.
5. Confirm that every class-start schedule remains selectable.
6. Reject duplicate active classes and textbooks that were deleted or unlinked from the class.
7. Update all four student/class roster projections symmetrically.
8. Record one student-class history entry per real mode transition.
9. Mark the enrollment rows and track complete.
10. Recompute the parent compatibility projections and status.
11. Return the committed rows.

The RPC accepts an idempotency key so repeated clicks cannot enroll the same student twice. If any row fails validation, the entire transaction rolls back.

The six new business tables in `public` are read-only to authenticated browser clients and inherit visibility from the existing parent-task `SELECT` policy. Admin/staff/assistant and existing task participants retain current visibility. Responsible directors already belong to the admin audience, so assignment does not create a second RLS role or grant a non-admin extra case access. Admin/staff perform management transitions; `complete_consultation` is the sole responsibility-bound action and succeeds only for the currently assigned admin director whose consultation snapshot still matches. Staff, other admin directors, assistants, participants, and ordinary teachers cannot complete that consultation, and non-management roles cannot invoke other workflow mutations.

Browser code cannot issue direct `INSERT`, `UPDATE`, or `DELETE` calls that bypass workflow guards. Direct authenticated creation of a registration parent or detail is disabled, so every new case is created atomically with its subject tracks by `create_registration_case`. A `BEFORE UPDATE OF type` trigger also makes the registration type boundary immutable: a general task cannot be relabeled as a childless registration, and a legacy or child-backed registration cannot be relabeled as another task type to escape the guards. For a child-backed registration, old browser policies block direct parent-task/detail updates and deletes; fixed-owner RPCs are the only write path. Canonical event types used by the parsed registration audit history cannot be inserted directly by a case viewer. Existing legacy registrations without child tracks keep their old fallback updates except for type reclassification until migration is completed, but the browser cannot create new legacy-shaped registrations after the schema is active.

Each authenticated workflow RPC is a thin `SECURITY INVOKER` wrapper around one schema-qualified `SECURITY DEFINER` implementation in unexposed `dashboard_private`; it validates `auth.uid()`, the action matrix, identity, target state, and invariants, and exposes no generic writer. The one deliberate exception is the three-argument admission-message finalizer: its public/private functions are revoked from authenticated users, granted only to `service_role`, have no actor receipt, and perform a locked provider-result compare-and-set. No browser service exports it.

The same locked database gateway owns all four JSONB roster projections and student status transitions across registration, task, and management screens. Ready-mode authenticated clients can create only empty roster arrays and cannot directly update arrays, flip `재원/퇴원`, or forge/delete/truncate enrollment history. Admin/staff roster commands use expected-mode conflict checks; assistants cannot mutate global rosters. Physical student/class deletion is limited to never-used, already-unlinked records, preserving historical audit rows. Migration readiness is blocked until an operator-reviewed repair resolves every pre-existing global asymmetry.

Idempotency receipts are an implementation-only table in the existing unexposed `dashboard_private` schema, keyed by authenticated actor and request key. Receipt-backed mutations use it, but the one-shot message claim deliberately derives send authority only from its successful row insert, and the service-role provider finalizer uses a locked compare-and-set with no actor receipt. The table is not exposed or granted to browser code.

Student materialization takes a deterministic normalized name + required parent-phone advisory lock before its second lookup/create, so two cases cannot concurrently create the same new student. More than one exact identity match remains an explicit management-cleanup error; the registration flow never prefers active over withdrawn or merges records silently. Consultation completion rechecks both current track ownership and the consultation's director snapshot after row locks, preventing a former director from winning a reassignment race. Every new live phone/visit consultation also verifies that the current owner is a visible teacher-catalog principal with an admin profile; default assignments must still match the current year/subject/grade SQL rule.

## Loading and Caching

The list query reads only parent summary fields plus subject-track summary fields. It does not load appointments, attempts, consultations, class schedules, textbooks, or rosters.

Registration option data is a separate four-read parallel summary load for profiles, eligible class summaries, visible teachers, and active textbooks. It does not read the students table, class schedules, fees, or roster arrays. The removed existing-student picker therefore cannot keep a full student-roster payload on the critical path.

The new adapter is enabled only by a readiness-version function created after both migrations, parent normalization, guards, and RPCs. No child tables means legacy mode. Child tables without the readiness function means maintenance/read-only mode; new registration creation and all edits/actions stay blocked until migration completion.

Opening a case loads its tracks and recent activity rows. Selecting an enrollment class loads only that class's schedule and linked textbook IDs. Cache keys include viewer ID, task ID, track ID, and class ID as appropriate. Same-key concurrent loads share one in-flight promise.

Tab counts are computed from track summaries. Parent cases are not duplicated in storage, only flattened for the working list.

## Migration and Compatibility

The schema migration is additive. It creates the new tables, constraints, indexes, triggers, grants, and RLS policies without dropping legacy columns. During an announced maintenance window it pauses registration and roster-writing jobs/endpoints, then takes write-conflicting locks in the fixed order registration parent, registration detail, students, classes. Resolved student rows are locked before class rows and both roster projections are revalidated before any waitlisted/registered enrollment is imported. An old application or roster write therefore cannot slip between the evidence scan and the new guards; lock timeout aborts the whole migration rather than accepting a mixed snapshot.

Backfill rules are deterministic:

- Before backfill, null/blank, unknown, and mixed recognized/unknown legacy subject values require an explicit reviewed `(task, subject)` mapping. They are never filtered away or inferred from counselor/class metadata. The migration aborts if any registration parent lacks exactly one or two resolved subjects, and readiness is installed only after every registration parent has the exact corresponding track set.
- A single-subject case creates one track. Existing level-test, consultation, class, textbook, and class-start data are assigned to that track.
- A multi-subject case still at inquiry creates one clean track per subject.
- A progressed multi-subject case creates one `migration_review` track per subject with `migration_review_required = true`. It creates no subject activities, enrollments, or duplicated parent counselor assignment from ambiguous fields. Automatic director defaults skip review tracks. The detail dialog displays the parent legacy fields once, requires an explicit manual director per subject before choosing a phone/visit consultation target, and lets the operator attribute each value and state. The migration never copies ambiguous results to both tracks.
- A reviewed `level_test_scheduled` target requires an attributed legacy level-test time and nonblank place. Incomplete legacy reservation data remains read-only common history; the operator resolves that track to inquiry and creates a fresh appointment through the normal reservation flow, never a partial child appointment.
- An existing single class becomes one enrollment row only when its subject can be matched to exactly one track.
- Existing phone-consultation timestamps are preserved as imported legacy history; they are not treated as required future reservation times.
- Readiness requires every pre-existing `퇴원` student to have no own-side or reverse-side enrolled/waitlist projection and no roster-active registration claim. Any violation requires an operator-reviewed repair or abort; the migration never blesses withdrawn students with live classes.

During rollout, reads prefer the new child rows and fall back to the legacy parent fields only when no child rows exist. `migration_review` tracks deliberately combine the new track list with the one parent legacy-review panel; ordinary workflow actions remain disabled until attribution is saved. Writes update the new authoritative rows and the minimum compatibility projections required by older code. Legacy field removal is a later, separately authorized migration after production verification.

The existing completed-operation guards remain in force. Their migration is updated to validate the authoritative child rows, one-time admission application, and admission batches whenever a write attempts to set a final parent status. The application uses registration transition functions for finalization, and generic task updates cannot bypass the same invariants or reopen a completed case.

No remote migration or deployment is part of this design approval.

## Error Handling

- Missing or mismatched subject/class data blocks only the affected track's transition and focuses the corresponding field.
- A shared level-test appointment cannot become terminal until every attached attempt is terminal. Completed attempts require a subject-specific result URL; absent or canceled attempts do not.
- A phone consultation cannot complete without an outcome.
- A visit consultation may complete one participating subject while another remains pending.
- A partially started shared appointment cannot be edited in place; remaining scheduled activities must be moved through the replacement-appointment action.
- Appointment edit, replacement, and cancellation compare the form's expected notification revision under lock. A stale operator receives a reload conflict and cannot overwrite a newer time, place, or subject-participation change.
- A waiting track cannot move to enrollment until its three-state retake decision is recorded.
- A draft or waitlisted enrollment may omit a start schedule, but admission processing cannot begin until every included row has a valid schedule.
- Removing a subject with history is blocked and replaced by an explicit subject closure action.
- A roster transaction failure leaves all enrollment rows and roster projections unchanged.
- Adding later enrollments creates a new admission batch and cannot inherit an older invoice or payment confirmation.
- Canceling a mixed add-class/first-admission batch restores tracks with surviving enrolled rows and routes only first-admission tracks.
- Any batch cancellation or last-enrollment cancellation that routes a track to waiting/not-registered also cancels all remaining unbatched planned rows for that track, so no active class draft survives on a waiting or terminal subject.
- Row cancellation is denied while the track participates in an open batch, including a race with batch start.
- Notification failures are surfaced after save with an explicit retry action.
- Legacy rows requiring subject attribution show a persistent `과목 분리 확인 필요` badge and cannot complete enrollment until reviewed.

## Verification

### Pure workflow tests

- Independent English and mathematics transitions within one case.
- Shared level-test appointment with separate results.
- Level-test retake history preservation.
- Shared visit consultation with separate directors and outcomes.
- Visit consultation for one subject and phone waiting for the other.
- Phone completion server timestamp and required result.
- Oldest-first phone queue ordering from `stage_entered_at`.
- Exact track-status to top-tab mapping and one-count-per-track behavior.
- Three-state retake decision and reset on waiting entry.
- Partial registration and parent completion derivation.
- Multiple enrollment rows per subject.
- Admission-batch revision behavior when another subject or class registers later.
- One-time admission application, per-row MakeEdu, and per-batch invoice/payment dependencies.

### Service and database tests

- RLS and parent-access inheritance for every new table.
- Parent-policy read inheritance plus assigned-admin-director consultation completion, with sibling-admin, staff, and ordinary-teacher completion denial.
- UI permission parity for assigned admin director, other admin director, staff, assistant, and task participant.
- Child-backed parent/detail direct-write denial and canonical-event forgery denial.
- Direct registration parent/detail creation denial with atomic RPC creation success.
- Common-info atomic update, safe pre-roster stale-link clearing, and identity-change rejection after waitlist/registration history.
- Deterministic migration backfill for single-subject, inquiry-only multi-subject, and ambiguous progressed multi-subject cases.
- `migration_review` action blocking and explicit legacy-field attribution.
- Subject/class and schedule validation.
- Nullable waitlist schedule with processing-time schedule enforcement.
- Transaction rollback when any enrollment row fails.
- Idempotent repeated completion.
- Student roster, class roster, and history consistency across multiple classes.
- All four roster arrays, no-op history suppression, and unchanged student `재원` status after registration cancellation.
- Roster-active student/class claim collision, external release metadata, released-history re-enrollment, and withdrawn-with-no-live-claim readiness.
- Whole-student withdrawal across enrolled and waitlisted subjects, claimed/unclaimed transfer, direct terminal/type/status bypass denial, and injected rollback.
- Same-identity concurrent student materialization and director-reassignment/completion races.
- Notification deduplication for shared appointments.
- Message one-shot claim, service-role-only finalizer, pending provider lookup, failed-hold/late acceptance, delayed retry release, and cross-task key reuse.
- Shared-appointment subject deselection and visit scheduling that cancels only selected phone queues.
- Narrow list projection, four-way parallel registration option summaries without students, and selected-class-only detail hydration.

### Browser verification

- Desktop and mobile tab counts based on tracks.
- The same student visible in different tabs for different subjects.
- Subject-focused detail deep links.
- One shared level-test appointment for two subjects.
- Combined and split visit/phone consultation scenarios.
- Phone-consultation queue without reservation inputs.
- Adding, defaulting, clearing, and removing multiple class rows.
- Common checklist behavior for full and partial registration.
- A second admission batch after an earlier subject has already completed.
- Loading timing, console health, and absence of horizontal overflow.

## Delivery Boundaries

- Implement schema and application compatibility before removing legacy fields.
- Keep MakeEdu as a manual operational confirmation; API automation is not added here.
- Do not add payment-provider automation.
- Do not send real external Google Chat or customer messages during tests.
- Do not apply remote migrations, deploy, or mutate production data without separate authorization.
