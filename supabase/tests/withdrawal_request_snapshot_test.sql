-- Synthetic history compatibility cases; no production data or provider calls.
begin;
select no_plan();
set local statement_timeout = '30s';
set local lock_timeout = '5s';
insert into auth.users(id,email) values
  ('a0800000-0000-4000-8000-000000000001','withdrawal-snapshot@example.invalid');
insert into public.profiles(id,role,name) values
  ('a0800000-0000-4000-8000-000000000001','admin','합성 관리자')
  on conflict(id) do update set role=excluded.role,name=excluded.name;
select set_config('request.jwt.claims','{"sub":"a0800000-0000-4000-8000-000000000001","role":"authenticated"}',true),
  set_config('request.jwt.claim.sub','a0800000-0000-4000-8000-000000000001',true),
  set_config('request.jwt.claim.role','authenticated',true);
create temp table snapshot_cases(
  label text primary key, task_id uuid, student_id uuid, class_id uuid,
  request_id uuid, last_date date, response jsonb
);
create function pg_temp.snapshot_case(p_label text,p_initial_date date,p_initial_round text,p_future boolean default false,p_removed boolean default false)
returns void language plpgsql as $$
declare t uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  d date:=(clock_timestamp() at time zone 'Asia/Seoul')::date + case when p_future then 10 else -10 end;
begin
  insert into public.classes(id,name,status,subject,student_ids,waitlist_ids)
    values(c,'합성 수업 '||p_label,'진행중','영어',case when p_removed then '[]'::jsonb else jsonb_build_array(s) end,'[]');
  insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids)
    values(s,'합성 학생 '||p_label,'재원','00000000000',case when p_removed then '[]'::jsonb else jsonb_build_array(c) end,'[]');
  insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject,student_name,class_name)
    values(t,'withdrawal','requested','합성 완료 '||p_label,s,c,
      'a0800000-0000-4000-8000-000000000001','영어','합성 학생 '||p_label,'합성 수업 '||p_label);
  -- A real detail INSERT produces the original, possibly incomplete snapshot.
  insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
    values(t,p_initial_date,p_initial_round,true,false,false);
  update public.ops_withdrawal_details set withdrawal_date=d,withdrawal_session='확정 3회차' where task_id=t;
  insert into snapshot_cases values(p_label,t,s,c,gen_random_uuid(),d,null);
end; $$;
select pg_temp.snapshot_case('missing',null,null);
select pg_temp.snapshot_case('empty',null,null);
select pg_temp.snapshot_case('missing_removed',null,null,false,true);
select pg_temp.snapshot_case('empty_removed',null,null,false,true);
select pg_temp.snapshot_case('partial_round',null,'원래 1회차');
select pg_temp.snapshot_case('partial','2026-06-01',null);
select pg_temp.snapshot_case('complete','2026-06-01','원래 1회차');
select pg_temp.snapshot_case('future',null,null,true);
select pg_temp.snapshot_case('no_applied_round',null,null);
-- Seed a pre-producer historical request without disabling any runtime guards.
delete from public.ops_task_events where task_id in(select task_id from snapshot_cases where label in('missing','missing_removed'))
  and event_type='withdrawal.submitted';
update public.ops_withdrawal_details set withdrawal_session=null
  where task_id=(select task_id from snapshot_cases where label='no_applied_round');
create temp table snapshot_history_before as
  select id,to_jsonb(e) as original from public.ops_task_events e
  where task_id in(select task_id from snapshot_cases);
create temp table snapshot_notifications_before as
  select id,to_jsonb(e) as original from dashboard_private.notification_events e;
select public.manage_withdrawal_roster_release_scheduler_v1('install');

-- Completion regression: call the actual public endpoint with an app role.
grant select,update on snapshot_cases to authenticated;
set local role authenticated;
update snapshot_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id)
  where label<>'no_applied_round';
reset role;
select is(t.status,'done',c.label||' completes through real v3')
  from snapshot_cases c join public.ops_tasks t on t.id=c.task_id where c.response is not null;
select ok(not d.fee_processed and not d.textbook_fee_processed,c.label||' preserves unpaid flags')
  from snapshot_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id;
select is(e.payload->>'requested_withdrawal_snapshot_status',
  case when c.label in('missing','missing_removed') then 'missing' when c.label='complete' then 'complete' else 'incomplete' end,
  c.label||' records honest historical snapshot availability')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed';
select ok(not(e.payload?'requested_withdrawal_date') and not(e.payload?'requested_withdrawal_round'),
  c.label||' does not fabricate original request values')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed' and c.label in('missing','empty','future','missing_removed','empty_removed');
select is(e.payload->>'requested_withdrawal_date','2026-06-01',c.label||' retains original date')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed' and c.label in('partial','complete');
select ok(not(e.payload?'requested_withdrawal_round'),'partial history does not acquire an invented round')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed' and c.label='partial';
select is(e.payload->>'requested_withdrawal_round','원래 1회차','complete history retains original round')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed' and c.label in('complete','partial_round');
select ok(not(e.payload?'requested_withdrawal_date'),'round-only history does not acquire an invented date')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed' and c.label='partial_round';
select ok(c.response->>'rosterAlreadyRemoved'='true'
  and not(s.class_ids?c.class_id::text) and not(cl.student_ids?c.student_id::text),
  c.label||' already removed roster remains removed') from snapshot_cases c
  join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id
  where c.label in('missing_removed','empty_removed');
select is((select count(*) from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),
  0::bigint,c.label||' does not fabricate roster history') from snapshot_cases c
  where c.label in('missing_removed','empty_removed');
select ok(e.payload->>'applied_withdrawal_date'=c.last_date::text
  and e.payload->>'applied_withdrawal_round'='확정 3회차',c.label||' notification uses validated applied schedule')
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id where e.event_type='withdrawal.completed';
select ok(not(s.class_ids?c.class_id::text) and not(cl.student_ids?c.student_id::text),c.label||' past roster is removed')
  from snapshot_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id
  where c.label in('missing','empty','partial','complete');
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,'incomplete history preserves future roster')
  from snapshot_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where c.label='future';
select ok(dashboard_private.withdrawal_roster_includes_date_v1(student_id,class_id,last_date)
  and not dashboard_private.withdrawal_roster_includes_date_v1(student_id,class_id,last_date+1),
  'historical snapshot does not change D inclusive / D+1 excluded boundary') from snapshot_cases where label='future';
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,label||' exact retry replays receipt')
  from snapshot_cases where response is not null;
select is((select count(*) from public.ops_task_events e where e.task_id=c.task_id and e.event_type='withdrawal.completed'),
  1::bigint,c.label||' completion source remains unique') from snapshot_cases c where response is not null;
select is((select count(*) from dashboard_private.notification_events e where e.payload->>'task_id'=c.task_id::text and e.event_key='withdrawal.completed'),
  1::bigint,c.label||' canonical completion notification remains unique') from snapshot_cases c where response is not null;
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),
  '23514','ops_withdrawal_applied_snapshot_required','applied round is still mandatory with exact SQLSTATE')
  from snapshot_cases where label='no_applied_round';
select ok(t.status='requested' and s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,
  'rejected applied snapshot rolls back task and both roster arrays') from snapshot_cases c
  join public.ops_tasks t on t.id=c.task_id join public.students s on s.id=c.student_id
  join public.classes cl on cl.id=c.class_id where c.label='no_applied_round';
select ok(not exists(select 1 from snapshot_history_before b left join public.ops_task_events e using(id)
  where to_jsonb(e) is distinct from b.original),'all historical task events remain byte-for-byte unchanged');
select ok(not exists(select 1 from snapshot_notifications_before b left join dashboard_private.notification_events e using(id)
  where to_jsonb(e) is distinct from b.original),'all historical canonical snapshots remain byte-for-byte unchanged');
select is((select count(*) from dashboard_private.notification_deliveries),0::bigint,'synthetic test does not fan out or send');
-- Export real producer output for the no-send presentation consumer verification.
select 'SNAPSHOT_PAYLOAD '||jsonb_build_object('case',c.label,'payload',e.payload)::text
  from snapshot_cases c join public.ops_task_events e on e.task_id=c.task_id
  where e.event_type='withdrawal.completed' order by c.label;
select * from finish();
rollback;
