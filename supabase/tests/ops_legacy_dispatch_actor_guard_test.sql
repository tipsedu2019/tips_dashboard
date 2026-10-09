begin;
select no_plan();
set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- Independent of completion fixtures: use real request RPCs and final plans.
-- All data, rules, and templates below are synthetic and rolled back. No provider.
insert into auth.users(id,email)
select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'actor-guard-'||n||'@example.invalid' from generate_series(1,6) n;
insert into public.profiles(id,role)
select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case n when 1 then 'admin' when 3 then 'staff' else 'teacher' end
from generate_series(1,6) n on conflict(id) do update set role=excluded.role;
insert into public.classes(id,name,subject,status,student_ids,waitlist_ids)
values('73000000-0000-4000-8000-000000000032','합성 권한 수업','영어','진행중',
 '["73000000-0000-4000-8000-000000000031"]','[]');
insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids)
values('73000000-0000-4000-8000-000000000031','합성 권한 학생','재원','00000000000',
 '["73000000-0000-4000-8000-000000000032"]','[]');

do $rules$
<<rules>>
declare kind text; rule_id uuid; template_id uuid; next_version bigint; n integer:=80;
begin
 foreach kind in array array['transfer','withdrawal'] loop
  n:=n+1;
  template_id:=('73000000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid;
  select id into rule_id from dashboard_private.notification_rules
   where event_key=kind||'.submitted' and channel_key='google_chat'
    and audience_key='management_team' and rule_variant_key='immediate';
  if rule_id is null then
   rule_id:=('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
   insert into dashboard_private.notification_rules(id,workflow_key,event_key,channel_key,audience_key,
    rule_variant_key,delivery_mode,enabled,active_template_id,created_actor_kind,updated_actor_kind)
   values(rule_id,kind,kind||'.submitted','google_chat','management_team','immediate','immediate',true,
    template_id,'system','system');
  else
   update dashboard_private.notification_rules set enabled=true,active_template_id=template_id where id=rule_id;
  end if;
  select coalesce(max(version),0)+1 into next_version from dashboard_private.notification_templates where notification_templates.rule_id=rules.rule_id;
  insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,
   allowed_variables,payload_schema_version,checksum,created_actor_kind)
  values(template_id,rule_id,next_version,'합성 권한 제목','합성 권한 본문','[]',1,repeat('c',64),'system');
  insert into dashboard_private.notification_settings_ui_registry(rule_id,workflow_key,workflow_label,workflow_sort,
   event_key,event_label,group_label,trigger_description,event_sort,audience_key,audience_label,
   channel_key,channel_label,cell_sort,initial_enabled)
  values(rule_id,kind,kind,4,kind||'.submitted','신청',kind,'신청 시',1,'management_team','관리팀','google_chat','Google Chat',1,true)
  on conflict do nothing;
 end loop;
end;
$rules$;

create temp table actor_guard_cases(kind text,label text,actor_id uuid,task_id uuid,source_id uuid,allowed boolean);
grant select on actor_guard_cases to authenticated,anon,service_role;
select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
do $fixtures$
<<fixtures>>
declare kind text; c record; payload jsonb; result jsonb; task_id uuid; source_id uuid;
 owner_id uuid:='73000000-0000-4000-8000-000000000005';
 allowed_teacher uuid:='73000000-0000-4000-8000-000000000004';
 actor_id uuid;
begin
 foreach kind in array array['transfer','withdrawal'] loop
  for c in select * from (values
   ('source_actor',4,true),('requester',4,true),('assignee',4,true),('secondary',4,true),
   ('admin',1,true),('staff',3,true),('unrelated_null',2,false),('unrelated_one_null',2,false),
   ('unrelated_nonnull',2,false),('missing_profile',999,false),('null_actor',null,false)
  ) cases(label,actor_no,allowed) loop
   actor_id:=case when c.actor_no is null then null
    else ('73000000-0000-4000-8000-'||lpad(c.actor_no::text,12,'0'))::uuid end;
   payload:=jsonb_build_object('task',jsonb_build_object('type',kind,'title','합성 권한 '||kind||' '||c.label,
    'status','requested','student_name','합성 권한 학생','student_id','73000000-0000-4000-8000-000000000031',
    'class_id','73000000-0000-4000-8000-000000000032','class_name','합성 권한 수업','subject','영어'),
    kind,case when kind='transfer' then jsonb_build_object('from_class_name','합성 원반','to_class_name','합성 목적반')
    else jsonb_build_object('teacher_name','합성 선생님','withdrawal_date','2026-10-09','withdrawal_session','4회차') end);
   result:=public.create_ops_task_v2(payload,gen_random_uuid());
   task_id:=(result->'task'->>'id')::uuid;
   select id into strict source_id from public.ops_task_events e where e.task_id=fixtures.task_id and event_type=kind||'.submitted';
   -- Fixture owner isolates each existing allow relationship; no policy is changed.
   update public.ops_tasks set requested_by=case when c.label='requester' then allowed_teacher else owner_id end,
    assignee_id=case when c.label='assignee' then allowed_teacher when c.label in('unrelated_one_null','unrelated_nonnull') then owner_id else null end,
    secondary_assignee_id=case when c.label='secondary' then allowed_teacher when c.label='unrelated_nonnull' then owner_id else null end
   where id=task_id;
   update public.ops_task_events set actor_id=case when c.label='source_actor' then allowed_teacher else owner_id end where id=source_id;
   insert into actor_guard_cases values(kind,c.label,actor_id,task_id,source_id,c.allowed);
  end loop;
 end loop;
end;
$fixtures$;

select ok(has_function_privilege('service_role','public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)','execute'),
 'service role can call the public wrapper');
select ok(not has_function_privilege(role_name,'public.get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)','execute'),
 role_name||' cannot call the internal helper') from unnest(array['anon','authenticated','service_role']) role_name;
select ok(not has_function_privilege(role_name,'public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)','execute'),
 role_name||' cannot directly call the public wrapper') from unnest(array['anon','authenticated']) role_name;

set local role service_role;
select is(jsonb_array_length(public.get_ops_task_legacy_dispatch_plan_v1(source_id,actor_id)->'items'),1,
 kind||' '||label||' preserves an existing allowed relationship and nonempty plan')
from actor_guard_cases where allowed order by kind,label;
select throws_ok(format('select public.get_ops_task_legacy_dispatch_plan_v1(%L::uuid,%L::uuid)',source_id,actor_id),
 '42501','ops_task_legacy_dispatch_forbidden',kind||' '||label||' is denied')
from actor_guard_cases where not allowed and label<>'null_actor' order by kind,label;
select throws_ok(format('select public.get_ops_task_legacy_dispatch_plan_v1(%L::uuid,null)',source_id),
 '22023','ops_task_legacy_dispatch_invalid',kind||' null actor keeps input validation')
from actor_guard_cases where label='null_actor' order by kind;
select throws_ok($$select public.get_ops_task_legacy_dispatch_before_subject_completion_v1(null,null)$$,
 '42501',null,'service role cannot bypass the wrapper');
reset role;

select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.ops_task_events where task_id in(select task_id from actor_guard_cases)),0::bigint,
 'unrelated teacher cannot list these event IDs through RLS');
select is(public.authorize_registration_legacy_dispatch_v1(source_id),false,
 kind||' nonregistration preflight returns false and does not reject the source')
from actor_guard_cases where label='unrelated_null' order by kind;
select throws_ok($$select public.get_ops_task_legacy_dispatch_plan_v1(null,null)$$,
 '42501',null,'authenticated direct plan call is rejected before evaluating parameters');
select throws_ok($$select count(*) from dashboard_private.notification_events$$,
 '42501',null,'authenticated cannot read canonical plan data directly');
reset role;
set local role anon;
select throws_ok($$select public.get_ops_task_legacy_dispatch_plan_v1(null,null)$$,
 '42501',null,'anonymous direct plan call is rejected');
reset role;
select is((select count(*) from dashboard_private.notification_deliveries),0::bigint,'plans create no deliveries');
select is((select count(*) from net.http_request_queue),0::bigint,'plans enqueue no external requests');
select is((select count(*) from cron.job_run_details),0::bigint,'no scheduler has run');
select * from finish();
rollback;
