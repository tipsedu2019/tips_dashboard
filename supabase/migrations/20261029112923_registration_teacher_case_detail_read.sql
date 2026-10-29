begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Authorized registration-click display parity only. This adds a teacher-only
-- reader; existing raw-table RLS, management/feedback/provider RPCs and shared
-- menu DTOs are unchanged. No write, receipt, lock or provider path is invoked.
create function dashboard_private.registration_teacher_json_v1(p text)
returns jsonb language plpgsql immutable set search_path='' as $$
begin return p::jsonb;exception when invalid_text_representation then return null;end $$;

create function dashboard_private.registration_teacher_uuid_v1(p text)
returns uuid language plpgsql immutable set search_path='' as $$
begin return p::uuid;exception when invalid_text_representation then return null;end $$;

-- Preserve present keys (including explicit nulls) without synthesizing aliases.
-- These private pure projectors prevent unused nested payload fields from becoming
-- a new read capability while retaining the existing display/correlation facts.
create function dashboard_private.registration_teacher_object_v1(p jsonb,keys text[])
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='array' then
  (select coalesce(jsonb_agg(item order by ord),'[]') from jsonb_array_elements(value) with ordinality x(item,ord) where jsonb_typeof(item) not in('object','array')) else value end),'{}')
 from jsonb_each(case when jsonb_typeof(p)='object' then p else '{}'::jsonb end)
 where key=any(keys) and(jsonb_typeof(value) not in('object','array') or(jsonb_typeof(value)='array' and key in('textbookIds','textbook_ids','activeTrackIds','canceledTrackIds','rowIds','enrollmentIds')))
$$;

create function dashboard_private.registration_teacher_event_payload_v1(p text)
returns text language plpgsql immutable set search_path='' as $$
declare payload jsonb:=dashboard_private.registration_teacher_json_v1(p);result jsonb;metadata jsonb;field text;keys text[];items jsonb;
begin
 -- Only documented canonical versions have a display projection. Plain
 -- legacy text is handled by its existing visible outer event in the caller.
 if jsonb_typeof(payload) is distinct from 'object' or coalesce(payload->>'version','') not in('1','2') then return null;end if;
 result:=dashboard_private.registration_teacher_object_v1(payload,array['version','eventType','event_type','trackId','track_id','subject','source','destination','reason','reason_code','actorId','actor_profile_id','actor_kind','system_source','occurredAt','occurred_at']);
 metadata:=dashboard_private.registration_teacher_object_v1(payload->'metadata',array['action','activeTrackIds','activityId','appointmentId','attemptId','attemptNumber','batchId','canceledTrackIds','changeKind','classId','completedAt','consultationId','consultationStatus','directorProfileId','enrollmentId','enrollmentIds','invoiceSentAt','kind','makeeduRegistered','materialLink','mode','newAppointmentId','notificationRevision','oldAppointmentId','oldNotificationRevision','oldPlace','oldScheduledAt','outcome','paymentConfirmedAt','place','restoredHistoricalEnrollment','resultStatus','retakeDecision','revisionNumber','rowIds','scheduledAt','startedAt','status','waitingKind']);
 for field,keys in select * from(values
  ('rows',array['classId','textbookId','textbookIds','textbook_id','textbook_ids','classStartDate','classStartSession','status']),
  ('subjectTransitions',array['subject','source','destination','reason'])
 ) fields(field,keys) loop
  if jsonb_typeof(payload->'metadata'->field)='array' then
   select coalesce(jsonb_agg(dashboard_private.registration_teacher_object_v1(item,keys) order by ord),'[]') into items
    from jsonb_array_elements(payload->'metadata'->field) with ordinality x(item,ord);
   metadata:=metadata||jsonb_build_object(field,items);
  end if;
 end loop;
 if jsonb_typeof(payload#>'{metadata,enrollmentSnapshot}')='object' then
  metadata:=metadata||jsonb_build_object('enrollmentSnapshot',dashboard_private.registration_teacher_object_v1(payload#>'{metadata,enrollmentSnapshot}',array['classId','textbookId','textbookIds','textbook_id','textbook_ids','classStartDate','classStartSession','status','admissionBatchId']));
 end if;
 if jsonb_typeof(payload#>'{metadata,appointmentChanges}')='array' then
  select coalesce(jsonb_agg(dashboard_private.registration_teacher_object_v1(item,array['eventType','reasonLabel','reason'])||
   jsonb_build_object('metadata',dashboard_private.registration_teacher_object_v1(item->'metadata',array['oldScheduledAt','scheduledAt','oldPlace','place'])) order by ord),'[]') into items
   from jsonb_array_elements(payload#>'{metadata,appointmentChanges}') with ordinality x(item,ord);
  metadata:=metadata||jsonb_build_object('appointmentChanges',items);
 end if;
 return (result||jsonb_build_object('metadata',metadata))::text;
end $$;

create function dashboard_private.registration_teacher_case_v1(p_task_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare parent jsonb;tracks jsonb;appointments jsonb;level_tests jsonb;consultations jsonb;batches jsonb;enrollments jsonb;events jsonb;
 reminders jsonb;active_message jsonb;profiles jsonb;classes jsonb;textbooks jsonb;track_ids uuid[];appointment_ids uuid[];
 scheduled_total integer;enrollment_total integer;current_rows jsonb;history_rows jsonb;
begin
 select dashboard_private.teacher_request_json_pick_v1(to_jsonb(t),array['id','title','type','status','priority','requested_by','requested_by_label','requested_team','assignee_id','assignee_label','assignee_team','secondary_assignee_id','secondary_assignee_label','student_id','student_name','class_id','class_name','textbook_id','textbook_title','campus','subject','start_at','due_at','completed_by','completed_by_label','completed_at','memo','created_at','updated_at'])||jsonb_build_object(
  'ops_registration_details',case when d.task_id is null then '{}'::jsonb else dashboard_private.teacher_request_json_pick_v1(to_jsonb(d),array['task_id','pipeline_status','inquiry_at','school_grade','school_name','parent_phone','student_phone','request_note','admission_notice_sent','common_revision','admission_checklist','level_test_place','level_test_material_link','level_test_result','visit_consultation_place']) end,
  'ops_task_comments',coalesce((select jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(c),array['id','task_id','author_id','body','created_at']) order by c.created_at,c.id) from public.ops_task_comments c where c.task_id=t.id),'[]'),
  'ops_task_attachments',coalesce((select jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(a),array['id','task_id','file_name','file_kind','drive_file_id','drive_link','uploaded_by','uploaded_at']) order by a.uploaded_at,a.id) from public.ops_task_attachments a where a.task_id=t.id),'[]'))
 into parent from public.ops_tasks t left join public.ops_registration_details d on d.task_id=t.id where t.id=p_task_id and t.type='registration';
 if parent is null then raise exception 'registration_teacher_detail_not_found' using errcode='P0002';end if;

 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(summary),array['id','task_id','subject','pipeline_status','director_profile_id','director_assignment_source','director_assignment_rule_key','waiting_kind','level_test_retake_decision','migration_review_required','stage_entered_at','updated_at','workflow_status','workflow_revision','workflow_status_entered_at','waiting_detail_kind','waiting_detail_class_id','waiting_detail_retake_decision','enrollment_detail_rows','phone_ready_at','phone_ready_source','level_test_scheduled_at','level_test_place','visit_scheduled_at','visit_place'])||jsonb_build_object(
  'enrollment_detail_rows',coalesce((select jsonb_agg(dashboard_private.registration_teacher_object_v1(item,array['id','classId','class_id','textbookId','textbook_id','textbookIds','textbook_ids','classStartDate','class_start_date','classStartSessionKey','class_start_session_key','classStartLessonSessionId','class_start_lesson_session_id','classStartSession','class_start_session','classStartSourceObservationId','class_start_source_observation_id','sortOrder','sort_order']) order by ord) from jsonb_array_elements(t.enrollment_detail_rows) with ordinality x(item,ord)),'[]'),
  'director',case when director.id is null then null else jsonb_build_object('id',director.id,'name',coalesce(director.name,'')) end,
  'observation_return_workflow_status',t.observation_return_workflow_status,
  'observation_attempt_count',t.observation_attempt_count,'observation_current_id',o.id,'observation_current_status',o.status,
  'observation_current_appointment_id',o.appointment_id,'observation_nearest_scheduled_at',o.scheduled_at,
  'observation_nearest_place',o.place,'observation_notification_revision',o.notification_revision,
  'observation_revision',o.revision,'observation_feedback_revision',o.feedback_revision) order by t.subject,t.id),'[]')
 into tracks from (select * from public.ops_registration_subject_tracks where task_id=p_task_id and archived_at is null order by subject,id limit 30) t
 join public.ops_registration_subject_track_summaries summary on summary.id=t.id and summary.task_id=p_task_id
 left join public.profiles director on director.id=t.director_profile_id
 left join lateral (select observation.id,observation.status,observation.appointment_id,observation.revision,observation.feedback_revision,
  appointment.scheduled_at,appointment.place,appointment.notification_revision
  from public.ops_registration_observations observation join public.ops_registration_appointments appointment
   on appointment.id=observation.appointment_id and appointment.task_id=p_task_id and appointment.kind='observation_class'
  where observation.task_id=p_task_id and observation.track_id=t.id and observation.decision_kind is null
   and observation.status in('scheduled','attended_feedback_pending','completed','no_show') limit 1) o on true;
 select coalesce(array_agg((value->>'id')::uuid),array[]::uuid[]) into track_ids from jsonb_array_elements(tracks);

 select count(*)::integer into scheduled_total from public.ops_registration_appointments where task_id=p_task_id and kind<>'observation_class' and status='scheduled';
 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(a),array['id','task_id','kind','scheduled_at','place','status','notification_revision','created_at','updated_at']) order by a.scheduled_at,a.id),'[]') into current_rows
 from(select * from public.ops_registration_appointments where task_id=p_task_id and kind<>'observation_class' and status='scheduled' order by scheduled_at,id limit 30) a;
 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(a),array['id','task_id','kind','scheduled_at','place','status','notification_revision','created_at','updated_at']) order by a.updated_at desc,a.id desc),'[]') into history_rows
 from(select * from public.ops_registration_appointments where task_id=p_task_id and kind<>'observation_class' and status in('completed','canceled') order by updated_at desc,id desc limit 30) a;
 appointments:=current_rows||history_rows;
 select coalesce(array_agg((value->>'id')::uuid),array[]::uuid[]) into appointment_ids from jsonb_array_elements(appointments);

 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(q),array['id','track_id','appointment_id','attempt_number','status','started_at','completed_at','material_link']) order by t.subject,t.id,q.phase,q.attempt_number desc,q.id desc),'[]') into level_tests
 from public.ops_registration_subject_tracks t cross join lateral (
  (select l.*,0 phase from public.ops_registration_level_tests l where l.track_id=t.id and l.status in('scheduled','in_progress') order by l.attempt_number desc,l.id desc limit 1)
  union all
  (select l.*,1 phase from public.ops_registration_level_tests l where l.track_id=t.id and l.status in('completed','absent','canceled') order by l.attempt_number desc,l.id desc limit 30)
 ) q where t.id=any(track_ids) and t.task_id=p_task_id;
 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(q),array['id','track_id','appointment_id','mode','status','director_profile_id','ready_at','ready_source','completed_at','outcome','note','created_at','updated_at']) order by t.subject,t.id,q.phase,q.sort_at desc,q.id desc),'[]') into consultations
 from public.ops_registration_subject_tracks t cross join lateral (
  (select c.*,0 phase,c.created_at sort_at from public.ops_registration_consultations c where c.track_id=t.id and c.status in('waiting','scheduled') order by c.created_at desc,c.id desc limit 1)
  union all
  (select c.*,1 phase,c.updated_at sort_at from public.ops_registration_consultations c where c.track_id=t.id and c.status in('completed','canceled') order by c.updated_at desc,c.id desc limit 30)
 ) q where t.id=any(track_ids) and t.task_id=p_task_id;
 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(q),array['id','task_id','revision_number','status','invoice_sent_at','payment_confirmed_at','created_at','updated_at']) order by q.phase,q.revision_number desc,q.id desc),'[]') into batches from(
  (select b.*,0 phase from public.ops_registration_admission_batches b where task_id=p_task_id and status in('draft','invoiced','paid') order by revision_number desc,id desc limit 1)
  union all
  (select b.*,1 phase from public.ops_registration_admission_batches b where task_id=p_task_id and status in('completed','canceled') order by revision_number desc,id desc limit 30)
 ) q;
 select count(*)::integer into enrollment_total from public.ops_registration_enrollments where track_id=any(track_ids) and(status in('planned','waitlisted') or(status='enrolled' and roster_active));
 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(q),array['id','track_id','student_id','admission_batch_id','class_id','textbook_id','textbook_ids','class_start_date','class_start_session_key','class_start_lesson_session_id','class_start_session','class_start_source_observation_id','status','makeedu_registered','roster_active','roster_released_at','roster_release_reason','roster_release_source_task_id','roster_release_kind','sort_order','created_at','updated_at']) order by q.phase,q.sort_at desc,q.id desc),'[]') into enrollments from(
  (select e.*,0 phase,e.created_at sort_at from public.ops_registration_enrollments e where track_id=any(track_ids) and(status in('planned','waitlisted') or(status='enrolled' and roster_active)) order by created_at desc,id desc limit 30)
  union all
  (select e.*,1 phase,e.updated_at sort_at from public.ops_registration_enrollments e where track_id=any(track_ids) and(status='canceled' or(status='enrolled' and not roster_active)) order by updated_at desc,id desc limit 30)
 ) q;

 -- Preserve the established shared-event filter. The case-created snapshot
 -- contains extra student data unused by the UI: retain only its audit fields.
 select coalesce(jsonb_agg(dashboard_private.teacher_request_json_pick_v1(to_jsonb(e),array['id','task_id','actor_id','event_type','field_name','before_value','after_value','created_at'])||
  case when e.event_type='registration_case_created' then jsonb_build_object('before_value',null,'after_value',
   dashboard_private.teacher_request_json_pick_v1(dashboard_private.registration_teacher_json_v1(e.after_value),array['version','actorId','occurredAt'])::text)
  when e.event_type='legacy_registration_imported' then jsonb_build_object(
   'before_value',dashboard_private.registration_teacher_object_v1(dashboard_private.registration_teacher_json_v1(e.before_value),array['studentId','classId','textbookId','pipelineStatus'])::text,
   'after_value',(dashboard_private.registration_teacher_object_v1(dashboard_private.registration_teacher_json_v1(e.after_value),array['version'])||jsonb_build_object(
    'timestamps',dashboard_private.registration_teacher_object_v1(dashboard_private.registration_teacher_json_v1(e.after_value)->'timestamps',array['levelTestAt','levelTestCompletedAt','phoneConsultationAt','visitConsultationAt','consultationAt','classStartDate','classStartSession']),
    'legacyBooleans',dashboard_private.registration_teacher_object_v1(dashboard_private.registration_teacher_json_v1(e.after_value)->'legacyBooleans',array['admissionNoticeSent','makeeduRegistered','makeeduInvoiceSent','paymentChecked'])))::text)
  when e.event_type='registration_track_event' then jsonb_build_object('before_value',null,'after_value',dashboard_private.registration_teacher_event_payload_v1(e.after_value))
  else '{}'::jsonb end order by e.created_at,e.id),'[]') into events
 from public.ops_task_events e where e.task_id=p_task_id and public.registration_task_event_shared_visible(e)
  -- Match the actual history model's milestone/alias/fine-event inventory.
  -- Raw audit-only events (including registration_fact_saved) are not displayed.
  and (e.event_type='legacy_registration_imported' or(case when e.event_type='registration_track_event' then
   case dashboard_private.registration_teacher_json_v1(e.after_value)->>'version'
    when '1' then dashboard_private.registration_teacher_json_v1(e.after_value)->>'eventType'
    when '2' then dashboard_private.registration_teacher_json_v1(e.after_value)->>'event_type' end
   else e.event_type end)=any(array[
    'case_created','inquiry_routed','director_default_resolved','director_manual_override','level_test_scheduled','level_test_started','level_test_completed',
    'consultation_waiting','visit_consultation_scheduled','consultation_completed','waiting_started','enrollment_decided','admission_completed','registration_completed','track_closed','track_reopened',
    'registration_case_created','initial_inquiry_selected','director_default_cleared','director_assignment_required','director_phone_queue_repaired','level_test_retake_scheduled','level_test_absent','level_test_canceled','level_test_track_closed','visit_scheduled','waiting_transitioned','enrollment_decision_routed','admission_batch_started','admission_batch_completed','enrollment_rows_saved','registration_enrollment_makeedu_updated','registration_enrollment_canceled','registration_enrollment_roster_released','admission_batch_canceled','migration_review_resolved',
    'appointment_updated','appointment_replaced','appointment_subject_deselected','appointment_canceled']))
  -- The existing UI hides these internal notification/provider events entirely.
  and lower(e.event_type) !~ '(^|[._-])(notification|fanout|delivery|retry|provider)($|[._-])'
  and (e.event_type<>'registration_track_event' or lower(coalesce(dashboard_private.registration_teacher_json_v1(e.after_value)->>'event_type',dashboard_private.registration_teacher_json_v1(e.after_value)->>'eventType','')) !~ '(^|[._-])(notification|fanout|delivery|retry|provider)($|[._-])');
 select dashboard_private.teacher_request_json_pick_v1(to_jsonb(m),array['id','status','claim_active','template_key','updated_at']) into active_message
 from public.ops_registration_messages m where m.task_id=p_task_id and m.template_key='admission_application' and m.claim_active limit 1;

 -- Copy only the existing persisted reminder display calculation. Do not call
 -- ensure/preview/claim/worker functions or expose message/provider payloads.
 select coalesce(jsonb_agg(jsonb_build_object('appointment_id',a.id,
  'state',case when m.status='accepted' then 'sent' when m.status='unknown' then 'unknown' when m.status='failed_hold' then 'failed_hold'
   when m.status='pending' or j.status in('claimed','dispatching') then 'processing' when a.status<>'scheduled' then 'canceled'
   when a.created_at >= (date_trunc('day',a.scheduled_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') then 'not_applicable_same_day_created'
   when a.schedule_confirmed_at >= (date_trunc('day',a.scheduled_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') then 'not_applicable_same_day_changed' else 'scheduled' end,
  'scheduled_for',case when m.status in('accepted','unknown','failed_hold') then null else coalesce(j.due_at,(date_trunc('day',a.scheduled_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')+interval '10 hours') end,
  'sent_at',case when m.status='accepted' then m.resolved_at else null end,
  'updated_at',greatest(a.updated_at,coalesce(j.updated_at,'-infinity'::timestamptz),coalesce(m.updated_at,'-infinity'::timestamptz))) order by a.scheduled_at,a.id),'[]') into reminders
 from public.ops_registration_appointments a
 left join lateral(select j.status,j.due_at,j.updated_at from dashboard_private.registration_customer_reminder_jobs j
  where j.appointment_id=a.id and j.message_kind='appointment_reminder' and j.source_revision=a.notification_revision order by j.updated_at desc,j.job_id desc limit 1) j on true
 left join lateral(select m.status,m.resolved_at,m.updated_at from public.ops_registration_customer_messages m
  where m.task_id=p_task_id and m.appointment_id=a.id and m.message_kind='appointment_reminder' order by m.updated_at desc,m.id desc limit 1) m on true
 where a.id=any(appointment_ids) and a.task_id=p_task_id and a.kind in('level_test','visit_consultation');

 -- Only labels referenced by the selected display rows are returned. No
 -- profile/account directory or class/textbook selector catalog is exposed.
 with refs as(
  select parent->>k id from unnest(array['requested_by','assignee_id','secondary_assignee_id','completed_by']) k
  union select value->>'author_id' from jsonb_array_elements(parent->'ops_task_comments')
  union select value->>'uploaded_by' from jsonb_array_elements(parent->'ops_task_attachments')
  union select value->>'director_profile_id' from jsonb_array_elements(tracks)
  union select value->>'director_profile_id' from jsonb_array_elements(consultations)
  union select value->>'actor_id' from jsonb_array_elements(events)
  union select coalesce(dashboard_private.registration_teacher_json_v1(value->>'after_value')->>'actor_profile_id',dashboard_private.registration_teacher_json_v1(value->>'after_value')->>'actorId') from jsonb_array_elements(events)
 ) select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.name,'')) order by p.id),'[]') into profiles
 from public.profiles p where p.id in(select dashboard_private.registration_teacher_uuid_v1(id) from refs);
 with refs as(
  select parent->>'class_id' id
  union select dashboard_private.registration_teacher_json_v1(value->>'before_value')->>'classId' from jsonb_array_elements(events) where value->>'event_type'='legacy_registration_imported'
  union select value->>'class_id' from jsonb_array_elements(enrollments)
  union select value->>'waiting_detail_class_id' from jsonb_array_elements(tracks)
  union select coalesce(e->>'classId',e->>'class_id') from jsonb_array_elements(tracks) t
   cross join lateral jsonb_array_elements(case when jsonb_typeof(t->'enrollment_detail_rows')='array' then t->'enrollment_detail_rows' else '[]'::jsonb end) e
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',coalesce(c.name,'')) order by c.id),'[]') into classes
 from public.classes c where c.id in(select dashboard_private.registration_teacher_uuid_v1(id) from refs);
 with refs as(
  select parent->>'textbook_id' id
  union select dashboard_private.registration_teacher_json_v1(value->>'before_value')->>'textbookId' from jsonb_array_elements(events) where value->>'event_type'='legacy_registration_imported'
  union select value->>'textbook_id' from jsonb_array_elements(enrollments)
  union select b#>>'{}' from jsonb_array_elements(enrollments) e cross join lateral jsonb_array_elements(case when jsonb_typeof(e->'textbook_ids')='array' then e->'textbook_ids' else '[]'::jsonb end) b
  union select coalesce(e->>'textbookId',e->>'textbook_id') from jsonb_array_elements(tracks) t
   cross join lateral jsonb_array_elements(case when jsonb_typeof(t->'enrollment_detail_rows')='array' then t->'enrollment_detail_rows' else '[]'::jsonb end) e
  union select b#>>'{}' from jsonb_array_elements(tracks) t
   cross join lateral jsonb_array_elements(case when jsonb_typeof(t->'enrollment_detail_rows')='array' then t->'enrollment_detail_rows' else '[]'::jsonb end) e
   cross join lateral jsonb_array_elements(case when jsonb_typeof(coalesce(e->'textbookIds',e->'textbook_ids'))='array' then coalesce(e->'textbookIds',e->'textbook_ids') else '[]'::jsonb end) b
 ) select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'title',coalesce(b.title,'')) order by b.id),'[]') into textbooks
 from public.textbooks b where b.id in(select dashboard_private.registration_teacher_uuid_v1(id) from refs);
 return jsonb_build_object('parent',parent,'tracks',tracks,'appointments',appointments,'levelTests',level_tests,'consultations',consultations,
  'admissionBatches',batches,'enrollments',enrollments,'events',events,'activeAdmissionMessage',active_message,'reminderSummaries',reminders,
  'scheduledAppointmentTotal',scheduled_total,'currentEnrollmentTotal',enrollment_total,'profiles',profiles,'classes',classes,'textbooks',textbooks);
end $$;

create function dashboard_private.registration_teacher_attempt_v1(
 o public.ops_registration_observations,a public.ops_registration_appointments)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('observationId',o.id,'taskId',o.task_id,'trackId',o.track_id,'appointmentId',o.appointment_id,
  'appointmentStatus',a.status,'className',o.class_name_snapshot,'subject',o.subject,'sessionDate',o.session_date,
  'startsAt',o.starts_at,'endsAt',o.ends_at,'teacherName',o.teacher_name_snapshot,'classroomName',o.classroom_name_snapshot,
  'campus',o.campus,'textbooks',coalesce((select jsonb_agg(jsonb_build_object('title',item->>'title') order by ord)
   from jsonb_array_elements(o.textbook_snapshot) with ordinality t(item,ord)),'[]'),
  'progress',o.progress_snapshot,'status',o.status,'attendance',o.attendance,'suitabilityResult',o.suitability_result,
  'decisionKind',o.decision_kind,'createdAt',o.created_at,'updatedAt',o.updated_at)
$$;

create function dashboard_private.get_registration_teacher_detail_v1_impl(
 p_task_id uuid,p_section text default 'case',p_track_id uuid default null,p_observation_id uuid default null,
 p_page integer default 1,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare data jsonb;track public.ops_registration_subject_tracks%rowtype;current_observation jsonb;attempts jsonb;latest_decision jsonb;history jsonb;total integer;
begin
 -- Current database role/account is authoritative; no user-editable JWT role,
 -- caller-supplied actor, role impersonation or broader shared predicate.
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role='teacher'
  and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())) then
  raise exception 'registration_teacher_detail_forbidden' using errcode='42501';end if;
 if p_task_id is null or p_section is null or p_section not in('case','observation_detail','observation_attempt','feedback','customer_history')
  or p_page is null or p_limit is null
  or(p_section='customer_history' and(p_page not between 1 and 100000 or p_limit not in(10,15,20) or p_track_id is not null or p_observation_id is not null))
  or(p_section<>'customer_history' and(p_page<>1 or p_limit<>10))
  or(p_section='case' and(p_track_id is not null or p_observation_id is not null))
  or(p_section='observation_detail' and(p_track_id is null or p_observation_id is not null))
  or(p_section in('observation_attempt','feedback') and(p_track_id is null or p_observation_id is null)) then
  raise exception 'registration_teacher_detail_invalid' using errcode='22023';end if;
 if not exists(select 1 from public.ops_tasks where id=p_task_id and type='registration') then
  raise exception 'registration_teacher_detail_not_found' using errcode='P0002';end if;
 if p_track_id is not null then
  select * into track from public.ops_registration_subject_tracks where id=p_track_id and task_id=p_task_id and archived_at is null;
  if not found then raise exception 'registration_teacher_detail_forbidden' using errcode='42501';end if;
 end if;
 if p_observation_id is not null and not exists(select 1 from public.ops_registration_observations
  where id=p_observation_id and task_id=p_task_id and track_id=p_track_id) then
  raise exception 'registration_teacher_detail_forbidden' using errcode='42501';end if;
 if p_section='case' then data:=dashboard_private.registration_teacher_case_v1(p_task_id);
 elsif p_section='observation_detail' then
  select dashboard_private.registration_teacher_attempt_v1(o,a) into current_observation
  from public.ops_registration_observations o join public.ops_registration_appointments a on a.id=o.appointment_id and a.task_id=p_task_id and a.kind='observation_class'
  where o.task_id=p_task_id and o.track_id=p_track_id and o.decision_kind is null and o.status in('scheduled','attended_feedback_pending','completed','no_show') limit 1;
  select coalesce(jsonb_agg(dashboard_private.registration_teacher_attempt_v1(o,a) order by o.created_at desc,o.id desc),'[]') into attempts
  from(select * from public.ops_registration_observations where task_id=p_task_id and track_id=p_track_id order by created_at desc,id desc limit 20) o
  join public.ops_registration_appointments a on a.id=o.appointment_id and a.task_id=p_task_id and a.kind='observation_class';
  select jsonb_build_object('observationId',id,'decisionKind',decision_kind) into latest_decision
  from public.ops_registration_observations where task_id=p_task_id and track_id=p_track_id and decision_kind is not null order by created_at desc,id desc limit 1;
  data:=jsonb_build_object('track',jsonb_build_object('taskId',track.task_id,'trackId',track.id,'subject',track.subject),
   'currentObservation',current_observation,'attempts',attempts,'latestDecisionObservation',latest_decision);
 elsif p_section='observation_attempt' then
  select jsonb_build_object('taskId',p_task_id,'trackId',p_track_id,'observation',dashboard_private.registration_teacher_attempt_v1(o,a)) into data
  from public.ops_registration_observations o join public.ops_registration_appointments a on a.id=o.appointment_id and a.task_id=p_task_id and a.kind='observation_class'
  where o.id=p_observation_id and o.task_id=p_task_id and o.track_id=p_track_id;
 elsif p_section='feedback' then
  -- Preserve the existing saved feedback tuple/relationship validity checks.
  -- No assigned-teacher/director mutation capability is granted by this read.
  select jsonb_build_object('observationId',o.id,'taskId',o.task_id,'trackId',o.track_id,'status',o.status,
   'className',o.class_name_snapshot,'teacherName',o.teacher_name_snapshot,'attendance',o.attendance,'decisionKind',o.decision_kind,
   'suitabilityResult',o.suitability_result,'feedbackReason',o.feedback_reason,
   'proxySubmitted',case when o.feedback_submitted_by is null then false else o.feedback_submitted_by<>o.teacher_profile_id end,
   'feedbackSubmittedByName',submitter.name,'feedbackSubmittedAt',o.feedback_submitted_at) into data
  from public.ops_registration_observations o
  join public.ops_registration_appointments a on a.id=o.appointment_id and a.task_id=p_task_id and a.kind='observation_class'
  join public.ops_registration_details d on d.task_id=p_task_id
  join public.classes c on c.id=o.class_id and c.subject=o.subject
  join public.teacher_catalogs teacher on teacher.id=o.teacher_catalog_id
  join public.profiles assigned on assigned.id=o.teacher_profile_id and teacher.profile_id=assigned.id
  left join public.class_lesson_sessions lesson on lesson.id=o.class_lesson_session_id and lesson.class_id=o.class_id
  left join public.profiles submitter on submitter.id=o.feedback_submitted_by
  left join auth.users account on account.id=submitter.id and account.deleted_at is null and(account.banned_until is null or account.banned_until<=now())
  where o.id=p_observation_id and o.task_id=p_task_id and o.track_id=p_track_id
   and((o.session_authority='normalized' and nullif(btrim(lesson.session_key),'') is not null)
    or(o.session_authority='legacy' and lesson.id is null and nullif(btrim(o.legacy_session_key),'') is not null))
   and((o.feedback_submitted_by is null and o.feedback_submitted_at is null)
    or(o.feedback_submitted_by is not null and o.feedback_submitted_at is not null and account.id is not null and nullif(btrim(submitter.name),'') is not null));
 else
  -- Same persisted masked history as the management service-role reader.
  -- Provider-status checks are actions, so both capabilities are always false.
  select count(*)::integer into total from public.ops_registration_customer_messages where task_id=p_task_id;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('messageId',m.id,'messageKind',m.message_kind,'currentStatus',m.status,
   'confirmedByName',case when m.delivery_origin='scheduled' then '자동 발송' else coalesce(nullif(btrim(p.name),''),'담당자') end,
   'confirmedAt',m.confirmed_at,'updatedAt',m.updated_at,'recipientLast4',case when m.recipient_last4~'^[0-9]{4}$' then m.recipient_last4 else null end,
   'canCheck',false,'canCheckDelivery',false)) order by m.created_at desc,m.id desc),'[]') into history
  from(select id,message_kind,status,delivery_origin,confirmed_by,confirmed_at,updated_at,recipient_last4,created_at
   from public.ops_registration_customer_messages where task_id=p_task_id order by created_at desc,id desc limit p_limit offset((p_page-1)*p_limit)) m
  left join public.profiles p on p.id=m.confirmed_by;
  data:=jsonb_build_object('ok',true,'page',p_page,'pageSize',p_limit,'totalCount',total,'history',history);
 end if;
 if data is null then raise exception 'registration_teacher_detail_not_found' using errcode='P0002';end if;
 return jsonb_build_object('contractVersion',1,'taskId',p_task_id,'section',p_section,'data',data);
end $$;

create function public.get_registration_teacher_detail_v1(
 p_task_id uuid,p_section text default 'case',p_track_id uuid default null,p_observation_id uuid default null,
 p_page integer default 1,p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path='' as $$
 select dashboard_private.get_registration_teacher_detail_v1_impl(p_task_id,p_section,p_track_id,p_observation_id,p_page,p_limit)
$$;

alter function dashboard_private.registration_teacher_object_v1(jsonb,text[]) owner to postgres;
alter function dashboard_private.registration_teacher_event_payload_v1(text) owner to postgres;
alter function dashboard_private.registration_teacher_json_v1(text) owner to postgres;
alter function dashboard_private.registration_teacher_uuid_v1(text) owner to postgres;
alter function dashboard_private.registration_teacher_case_v1(uuid) owner to postgres;
alter function dashboard_private.registration_teacher_attempt_v1(public.ops_registration_observations,public.ops_registration_appointments) owner to postgres;
alter function dashboard_private.get_registration_teacher_detail_v1_impl(uuid,text,uuid,uuid,integer,integer) owner to postgres;
alter function public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer) owner to postgres;
revoke all on function dashboard_private.registration_teacher_object_v1(jsonb,text[]) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.registration_teacher_event_payload_v1(text) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.registration_teacher_json_v1(text) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.registration_teacher_uuid_v1(text) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.registration_teacher_case_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.registration_teacher_attempt_v1(public.ops_registration_observations,public.ops_registration_appointments) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.get_registration_teacher_detail_v1_impl(uuid,text,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
-- The invoker wrapper needs this one implementation grant. Direct invocation
-- has the identical current-actor, closed-argument and association guards.
grant execute on function dashboard_private.get_registration_teacher_detail_v1_impl(uuid,text,uuid,uuid,integer,integer) to authenticated;
grant execute on function public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer) to authenticated;
commit;
