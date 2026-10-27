begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Dedicated request-owner boundary. Existing management RPCs and table grants
-- remain closed to teachers. No role/JWT GUC is changed by this migration.
create table dashboard_private.teacher_request_origins_v1 (
  domain text not null check(domain in('transfer','withdrawal','makeup','textbook')),
  request_id uuid not null,
  requester_id uuid not null,
  processing_seen boolean not null default false,
  withdrawn_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(domain,request_id)
);
create table dashboard_private.teacher_request_history_v1 (
  id uuid primary key default gen_random_uuid(),
  domain text not null check(domain in('transfer','withdrawal','makeup','textbook')),
  request_id uuid not null,
  actor_id uuid not null,
  action text not null check(action in('create','update','withdraw','change_request','cancel_request','confirmed','rejected','noted')),
  note text not null default '',
  input_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index teacher_request_history_request_v1 on dashboard_private.teacher_request_history_v1(domain,request_id,created_at,id);
create table dashboard_private.teacher_request_changes_v1 (
  id uuid primary key default gen_random_uuid(),
  domain text not null check(domain in('transfer','withdrawal','makeup','textbook')),
  request_id uuid not null,
  requester_id uuid not null,
  kind text not null check(kind in('change_request','cancel_request')),
  note text not null check(length(btrim(note)) between 1 and 4000),
  status text not null default 'pending' check(status in('pending','confirmed','rejected')),
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check((status='pending' and resolved_by is null and resolved_at is null and resolution_note is null)
    or(status<>'pending' and resolved_by is not null and resolved_at is not null and length(btrim(resolution_note)) between 1 and 4000))
);
create unique index teacher_request_changes_pending_v1 on dashboard_private.teacher_request_changes_v1(domain,request_id) where status='pending';
create index teacher_request_changes_queue_v1 on dashboard_private.teacher_request_changes_v1(domain,status,created_at,id);
create table dashboard_private.teacher_request_receipts_v1 (
  request_key uuid primary key,
  actor_id uuid not null,
  domain text not null,
  request_id uuid not null,
  action text not null,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
-- Only this private table can authorize nested existing domain triggers. A
-- caller-controlled setting, role name, or displayed teacher name is not proof.
create table dashboard_private.teacher_request_context_v1 (
  transaction_id bigint not null,
  backend_pid bigint not null,
  actor_id uuid not null,
  domain text not null check(domain in('transfer','withdrawal','makeup','textbook')),
  request_id uuid not null,
  action text not null check(action in('create','update','withdraw')),
  primary key(transaction_id,backend_pid,domain,request_id)
);

alter table dashboard_private.teacher_request_origins_v1 enable row level security;
alter table dashboard_private.teacher_request_history_v1 enable row level security;
alter table dashboard_private.teacher_request_changes_v1 enable row level security;
alter table dashboard_private.teacher_request_receipts_v1 enable row level security;
alter table dashboard_private.teacher_request_context_v1 enable row level security;
revoke all on table dashboard_private.teacher_request_origins_v1,dashboard_private.teacher_request_history_v1,
 dashboard_private.teacher_request_changes_v1,dashboard_private.teacher_request_receipts_v1,
 dashboard_private.teacher_request_context_v1 from public,anon,authenticated,service_role;

create function dashboard_private.teacher_request_actor_v1(p_teacher_only boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); r text;
begin
  select role into r from public.profiles where id=a for share;
  if a is null or r is null or (p_teacher_only and r<>'teacher')
    or (not p_teacher_only and r not in('admin','staff','viewer')) then
    raise exception 'teacher_request_forbidden' using errcode='42501';
  end if;
  perform 1 from auth.users where id=a and deleted_at is null
    and (banned_until is null or banned_until<=clock_timestamp()) for share;
  if not found then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
  return a;
end $$;

create function dashboard_private.teacher_request_context_matches_v1(p_domain text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from dashboard_private.teacher_request_context_v1 c
  join public.profiles p on p.id=c.actor_id and p.role='teacher'
  join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  where c.transaction_id=txid_current() and c.backend_pid=pg_backend_pid()
    and c.actor_id=auth.uid() and c.domain=p_domain and c.request_id=p_id)
$$;

create function dashboard_private.teacher_request_append_only_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'teacher_request_history_append_only' using errcode='42501';end $$;
create trigger teacher_request_history_append_only_v1 before update or delete on dashboard_private.teacher_request_history_v1
for each row execute function dashboard_private.teacher_request_append_only_v1();
create trigger teacher_request_receipt_append_only_v1 before update or delete on dashboard_private.teacher_request_receipts_v1
for each row execute function dashboard_private.teacher_request_append_only_v1();

create function dashboard_private.teacher_request_json_pick_v1(p jsonb,keys text[])
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(k,p->k),'{}') from unnest(keys) k
$$;

create function dashboard_private.teacher_request_note_v1(p jsonb)
returns text language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or p-array['note']<>'{}'
    or jsonb_typeof(p->'note') is distinct from 'string' or length(btrim(p->>'note')) not between 1 and 4000 then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 return btrim(p->>'note');
end $$;

-- No arbitrary task-type, assignee, approval, checklist, or stock fields.
create function dashboard_private.teacher_request_input_fields_v1(p_domain text)
returns text[] language sql immutable set search_path='' as $$
 select case p_domain
 when 'makeup' then array['request_kind','class_id','reason','cancel_date','original_lesson_session_id','makeup_slots']
 when 'textbook' then array['title','textbookId','classId','locationId','studentQuantity','teacherQuantity','memo']
 else null end
$$;

-- Existing rows are not backfilled as effect-free. Only a newly observed
-- request origin plus a monotonic processing flag can prove this condition.
create function dashboard_private.teacher_request_mark_processing_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare d text; i uuid; row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 before_data jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;has_effect boolean:=false;v jsonb;
begin
 if tg_table_name='ops_tasks' then d:=row_data->>'type';i:=(row_data->>'id')::uuid;
 elsif tg_table_name in('ops_transfer_details','ops_withdrawal_details') then
  d:=case when tg_table_name='ops_transfer_details' then 'transfer' else 'withdrawal' end;i:=(row_data->>'task_id')::uuid;
 elsif tg_table_name='makeup_requests' then d:='makeup';i:=(row_data->>'id')::uuid;
 elsif tg_table_name='makeup_request_events' then d:='makeup';i:=(row_data->>'request_id')::uuid;
 elsif tg_table_name='textbook_purchase_orders' then d:='textbook';i:=(row_data->>'id')::uuid;
 elsif tg_table_name='textbook_purchase_order_lines' then d:='textbook';i:=(row_data->>'purchase_order_id')::uuid;
 elsif tg_table_name='textbook_stock_moves' then
  d:='textbook';select purchase_order_id into i from public.textbook_purchase_order_lines where id=(row_data->>'purchase_order_line_id')::uuid;
 end if;
 if d not in('transfer','withdrawal','makeup','textbook') or i is null then return null;end if;
 for v in select value from jsonb_array_elements(jsonb_build_array(before_data,row_data)) loop
  if tg_table_name='ops_tasks' then has_effect:=has_effect or v->>'status'='done' or v->>'completed_at' is not null;
  elsif tg_table_name in('ops_transfer_details','ops_withdrawal_details') then
   has_effect:=has_effect or coalesce((v->>'timetable_roster_updated')::boolean,false)
    or coalesce((v->>'makeedu_transfer_done')::boolean,false) or coalesce((v->>'makeedu_withdrawal_done')::boolean,false)
    or coalesce((v->>'fee_processed')::boolean,false) or coalesce((v->>'textbook_fee_processed')::boolean,false);
  elsif tg_table_name='makeup_requests' then
   has_effect:=has_effect or coalesce(v->>'status' in('makeup_pending','refund_pending','completed'),false)
    or v->>'approved_at' is not null or v->>'makeup_effect_revision' is not null
    or v->>'cancel_academic_event_id' is not null or v->>'makeup_academic_event_id' is not null
    or coalesce(nullif(v->'makeup_lesson_session_ids','null'),'[]')<>'[]'
    or coalesce(nullif(v->'makeup_academic_event_ids','null'),'[]')<>'[]';
  elsif tg_table_name='makeup_request_events' then
   has_effect:=has_effect or coalesce(v->>'event_type' in('approved','refund_requested','refund_completed','approval_canceled','completed_canceled','completed'),false);
  elsif tg_table_name='textbook_purchase_orders' then
   has_effect:=has_effect or coalesce(v->>'status' in('ordered','partially_received','received','returned'),false)
    or v->>'ordered_at' is not null or v->>'received_at' is not null;
  elsif tg_table_name='textbook_purchase_order_lines' then
   has_effect:=has_effect or coalesce((v->>'ordered_quantity')::numeric,0)<>0 or coalesce((v->>'received_quantity')::numeric,0)<>0
    or coalesce((v->>'teacher_ordered_quantity')::numeric,0)<>0 or coalesce((v->>'teacher_received_quantity')::numeric,0)<>0;
  elsif tg_table_name='textbook_stock_moves' then has_effect:=true;
  end if;
 end loop;
 if coalesce(has_effect,false) and not dashboard_private.teacher_request_context_matches_v1(d,i) then
  update dashboard_private.teacher_request_origins_v1 set processing_seen=true where domain=d and request_id=i and not processing_seen;
 end if;
 return null;
end $$;

create trigger teacher_request_processing_ops_v1 after update or delete on public.ops_tasks for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_transfer_v1 after insert or update or delete on public.ops_transfer_details for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_withdrawal_v1 after insert or update or delete on public.ops_withdrawal_details for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_makeup_v1 after update or delete on public.makeup_requests for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_makeup_event_v1 after insert on public.makeup_request_events for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_textbook_v1 after update or delete on public.textbook_purchase_orders for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_textbook_line_v1 after insert or update or delete on public.textbook_purchase_order_lines for each row execute function dashboard_private.teacher_request_mark_processing_v1();
create trigger teacher_request_processing_stock_v1 after insert or update or delete on public.textbook_stock_moves for each row execute function dashboard_private.teacher_request_mark_processing_v1();

-- This is the sole change to an existing guard. General API calls still have
-- no marker; only the bounded owner RPC can admit its exact nested audit write.
create or replace function dashboard_private.assert_ops_task_actor_v2(p_task public.ops_tasks default null::public.ops_tasks,p_requested_by uuid default null::uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text:=public.current_dashboard_role();
begin
 if v_actor is null or not exists(select 1 from public.profiles where id=v_actor) then
  raise exception 'ops_task_access_denied' using errcode='42501';end if;
 if v_role='teacher' and p_task.id is not null and p_task.type in('transfer','withdrawal')
  and p_task.requested_by=v_actor and dashboard_private.teacher_request_context_matches_v1(p_task.type,p_task.id) then return v_actor;end if;
 if p_task.id is not null and ((v_role='assistant' and p_task.type is distinct from 'word_retest')
  or(v_role='teacher' and p_task.type in('registration','transfer','withdrawal','textbook'))) then
  raise exception 'ops_task_access_denied' using errcode='42501';end if;
 if p_task.id is not null and coalesce(v_role,'') not in('admin','staff','assistant')
  and v_actor is distinct from p_task.requested_by and v_actor is distinct from p_task.assignee_id
  and v_actor is distinct from p_task.secondary_assignee_id and not dashboard_private.is_ops_word_retest_teacher(p_task.id) then
  raise exception 'ops_task_access_denied' using errcode='42501';end if;
 if p_task.id is null and p_requested_by is not null and p_requested_by<>v_actor and coalesce(v_role,'') not in('admin','staff','assistant') then
  raise exception 'ops_task_access_denied' using errcode='42501';end if;
 return v_actor;
end $$;

create function dashboard_private.teacher_request_lock_v1(d text,i uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if d in('transfer','withdrawal') then
  perform 1 from public.ops_tasks where id=i and type=d for update;
  if d='transfer' then perform 1 from public.ops_transfer_details where task_id=i for update;
  else perform 1 from public.ops_withdrawal_details where task_id=i for update;end if;
 elsif d='makeup' then perform 1 from public.makeup_requests where id=i for update;
 elsif d='textbook' then
  -- FOR UPDATE also conflicts with a new child's FK KEY SHARE lock. A weaker
  -- NO KEY UPDATE lock would allow the whole-line-set CAS to race an INSERT.
  perform 1 from public.textbook_purchase_orders where id=i for update;
  perform 1 from public.textbook_purchase_order_lines where purchase_order_id=i order by id for update;
 else raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
end $$;

create function dashboard_private.teacher_request_state_v1(d text,i uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;detail jsonb:='{}';effects jsonb:='{}';origin jsonb;owner_id uuid;state text;
 history jsonb;changes jsonb;input jsonb;title text;observed boolean:=false;terminal boolean;rev text;actions jsonb;reason text;labels jsonb;representable boolean:=true;
begin
 if d in('transfer','withdrawal') then
  select to_jsonb(t) into r from public.ops_tasks t where id=i and type=d;
  if d='transfer' then select to_jsonb(t) into detail from public.ops_transfer_details t where task_id=i;
  else select to_jsonb(t) into detail from public.ops_withdrawal_details t where task_id=i;end if;
  owner_id:=(r->>'requested_by')::uuid;title:=r->>'title';state:=r->>'status';
  observed:=state='done' or r->>'completed_at' is not null
    or coalesce((detail->>'timetable_roster_updated')::boolean,false)
    or coalesce((detail->>'makeedu_transfer_done')::boolean,false)
    or coalesce((detail->>'makeedu_withdrawal_done')::boolean,false)
    or coalesce((detail->>'fee_processed')::boolean,false)
    or coalesce((detail->>'textbook_fee_processed')::boolean,false);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') into effects
   from public.ops_task_events e where e.task_id=i;
 elsif d='makeup' then
  select to_jsonb(t) into r from public.makeup_requests t where id=i;
  owner_id:=(r->>'requester_id')::uuid;title:=r->>'class_name';state:=r->>'status';
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') into effects from public.makeup_request_events e where request_id=i;
  observed:=state in('makeup_pending','refund_pending','completed') or r->>'approved_at' is not null
    or r->>'makeup_effect_revision' is not null or r->>'cancel_academic_event_id' is not null
    or r->>'makeup_academic_event_id' is not null or coalesce(r->'makeup_academic_event_ids','[]')<>'[]'
    or coalesce(r->'makeup_lesson_session_ids','[]')<>'[]'
    or (r->'schedule_plan_before' is not null and r->'schedule_plan_before'<>'null')
    or exists(select 1 from public.makeup_request_events where request_id=i and event_type in('approved','refund_requested','refund_completed','approval_canceled','completed_canceled','completed'));
 elsif d='textbook' then
  select to_jsonb(t) into r from public.textbook_purchase_orders t where id=i;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into detail from public.textbook_purchase_order_lines t where purchase_order_id=i;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into effects from public.textbook_stock_moves s
   where purchase_order_line_id in(select id from public.textbook_purchase_order_lines where purchase_order_id=i);
  owner_id:=(r->>'created_by')::uuid;state:=r->>'status';
  title:=coalesce(detail#>>'{0,requested_textbook_title}','교재요청');
  observed:=state is distinct from 'requested' or r->>'ordered_at' is not null or r->>'received_at' is not null
    or effects<>'[]' or exists(select 1 from public.textbook_purchase_order_lines where purchase_order_id=i
      and(ordered_quantity<>0 or received_quantity<>0 or teacher_ordered_quantity<>0 or teacher_received_quantity<>0 or unit_cost<>0));
 else raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if r is null then raise exception 'teacher_request_not_found' using errcode='P0002';end if;
 select to_jsonb(o) into origin from dashboard_private.teacher_request_origins_v1 o where domain=d and request_id=i;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'actorId',h.actor_id,'note',h.note,'createdAt',h.created_at) order by h.created_at,h.id),'[]')
 into history from dashboard_private.teacher_request_history_v1 h where domain=d and request_id=i;
 select h.input_snapshot into input from dashboard_private.teacher_request_history_v1 h
 where domain=d and request_id=i and action in('create','update') and actor_id=owner_id order by created_at desc,id desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'note',c.note,'status',c.status,'createdAt',c.created_at,
  'resolvedAt',c.resolved_at,'resolutionNote',c.resolution_note,'revision',md5(to_jsonb(c)::text)) order by c.created_at,c.id),'[]')
 into changes from dashboard_private.teacher_request_changes_v1 c where domain=d and request_id=i;
 terminal:=state in('canceled','cancelled','rejected') or origin->>'withdrawn_at' is not null;
 observed:=coalesce(observed,false) or coalesce((origin->>'processing_seen')::boolean,false);
 -- A current revision must never be paired with an old editable snapshot.
 -- Preserve snapshots in append-only history; before effects, project only the
 -- current request fields so manager corrections cannot be silently overwritten.
 if origin is not null and input is not null and not observed then
  if d='transfer' then
   input:=dashboard_private.teacher_request_json_pick_v1(coalesce(detail,'{}'),array['from_class_id','to_class_id','transfer_reason','from_class_end_date','from_class_end_session','to_class_start_date','to_class_start_session','from_undistributed_textbooks','to_undistributed_textbooks'])
    ||jsonb_build_object('student_id',r->'student_id','memo',coalesce(r->>'memo',''));
   input:=input||jsonb_build_object('transfer_reason',coalesce(input->>'transfer_reason',''),'from_class_end_session',coalesce(input->>'from_class_end_session',''),
    'to_class_start_session',coalesce(input->>'to_class_start_session',''),'from_undistributed_textbooks',coalesce(input->>'from_undistributed_textbooks',''),'to_undistributed_textbooks',coalesce(input->>'to_undistributed_textbooks',''));
  elsif d='withdrawal' then
   input:=dashboard_private.teacher_request_json_pick_v1(coalesce(detail,'{}'),array['withdrawal_date','withdrawal_session','customer_reason','teacher_opinion','undistributed_textbooks'])
    ||jsonb_build_object('student_id',r->'student_id','class_id',r->'class_id','memo',coalesce(r->>'memo',''));
   input:=input||jsonb_build_object('withdrawal_session',coalesce(input->>'withdrawal_session',''),'customer_reason',coalesce(input->>'customer_reason',''),
    'teacher_opinion',coalesce(input->>'teacher_opinion',''),'undistributed_textbooks',coalesce(input->>'undistributed_textbooks',''));
  elsif d='makeup' then
   input:=dashboard_private.teacher_request_json_pick_v1(r,dashboard_private.teacher_request_input_fields_v1('makeup'));
  elsif d='textbook' then
   representable:=jsonb_array_length(detail)>0 and not exists(select 1 from public.textbook_purchase_order_lines where purchase_order_id=i group by copy_scope having count(*)>1)
    and (select count(distinct jsonb_build_array(textbook_id,requested_textbook_title,class_id,location_id,memo)) from public.textbook_purchase_order_lines where purchase_order_id=i)=1;
   if representable then input:=jsonb_build_object('title',coalesce(detail#>>'{0,requested_textbook_title}',''),'textbookId',detail#>'{0,textbook_id}',
    'classId',detail#>'{0,class_id}','locationId',detail#>'{0,location_id}','memo',coalesce(detail#>>'{0,memo}',''),
    'studentQuantity',coalesce((select sum(requested_quantity) from public.textbook_purchase_order_lines where purchase_order_id=i and copy_scope='student'),0),
    'teacherQuantity',coalesce((select sum(requested_quantity) from public.textbook_purchase_order_lines where purchase_order_id=i and copy_scope='teacher'),0));end if;
  end if;
  -- Existing foreign keys use ON DELETE SET NULL. Never advertise a direct
  -- edit from a partial current record or pair its revision with an older
  -- editable snapshot. The append-only original remains in private history.
  if d='transfer' then
   representable:=detail is not null and r->>'student_id' is not null and r->>'class_id' is not null
    and input->>'from_class_id' is not null and input->>'to_class_id' is not null;
  elsif d='withdrawal' then
   representable:=detail is not null and input->>'student_id' is not null and input->>'class_id' is not null;
  elsif d='makeup' then representable:=input->>'class_id' is not null;
  end if;
  if not representable then input:=null;end if;
 end if;
 if terminal then actions:='[]';reason:='종결된 신청입니다.';
 elsif origin is null or (origin->>'requester_id')::uuid is distinct from owner_id or input is null then
  actions:='["change_request","cancel_request"]';reason:='처리 이력 확인 필요';
 elsif observed then actions:='["change_request","cancel_request"]';reason:='처리 이후에는 변경·취소 요청을 남겨 주세요.';
 elsif not representable then actions:='["change_request","cancel_request"]';reason:='신청 항목 확인 필요';
 elsif (d in('transfer','withdrawal') and state not in('requested','confirmed','in_progress','review_requested','on_hold')) then
  actions:='["change_request","cancel_request"]';reason:='신청 상태 확인 필요';
 else actions:='["update","withdraw"]';reason:=null;end if;
 if exists(select 1 from dashboard_private.teacher_request_changes_v1 where domain=d and request_id=i and status='pending') then
  actions:='[]';reason:='처리 중인 변경·취소 요청이 있습니다.';end if;
 rev:=md5(jsonb_build_object('parent',r,'detail',detail,'effects',effects,'origin',origin,'history',history,'changes',changes)::text);
 labels:=jsonb_strip_nulls(jsonb_build_object(
  'student',(select name from public.students where id=nullif(input->>'student_id','')::uuid),
  'class',(select name from public.classes where id=nullif(coalesce(input->>'class_id',input->>'classId'),'')::uuid),
  'fromClass',(select name from public.classes where id=nullif(input->>'from_class_id','')::uuid),
  'toClass',(select name from public.classes where id=nullif(input->>'to_class_id','')::uuid),
  'textbook',(select coalesce(nullif(b.title,''),b.name) from public.textbooks b where b.id=nullif(input->>'textbookId','')::uuid),
  'location',(select name from public.textbook_inventory_locations where id=nullif(input->>'locationId','')::uuid)));
 return jsonb_build_object('id',i,'domain',d,'title',coalesce(title,''),'status',state,'requesterId',owner_id,
  'createdAt',r->'created_at','updatedAt',r->'updated_at','revision',rev,'allowedActions',actions,'blockedReason',reason,
  'effectState',case when observed then 'observed' when origin is null or input is null then 'unknown' else 'none' end,
  'input',input,'referenceLabels',labels,
  'approver',case when d='makeup' then jsonb_build_object('profileId',r->'approver_profile_id','label',(select name from public.teacher_catalogs where id=(r->>'approver_teacher_catalog_id')::uuid)) else null end,
  'history',history,'changes',changes);
end $$;

create function public.get_teacher_own_request_v1(p_domain text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a uuid:=dashboard_private.teacher_request_actor_v1();r jsonb;
begin
 r:=dashboard_private.teacher_request_state_v1(p_domain,p_id);
 if (r->>'requesterId')::uuid is distinct from a then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
 return r;
end $$;

create function public.get_teacher_own_requests_v1(p_domain text,p_page integer default 1,p_page_size integer default 10)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a uuid:=dashboard_private.teacher_request_actor_v1();total bigint;rows jsonb;
begin
 if p_domain is null or p_domain not in('transfer','withdrawal','makeup','textbook') or p_page is null or p_page<1 or p_page>100000
  or p_page_size is null or p_page_size not in(10,15,20) then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 -- The owner filter, count, page and STABLE state projection must share one
 -- statement snapshot. Re-reading selected IDs in a later statement can expose
 -- a new owner's summary after a concurrent management reassignment.
 with source as materialized(
  select id,created_at from public.ops_tasks where p_domain in('transfer','withdrawal') and type=p_domain and requested_by=a
  union all select id,created_at from public.makeup_requests where p_domain='makeup' and requester_id=a
  union all select id,created_at from public.textbook_purchase_orders where p_domain='textbook' and created_by=a
 ),page as(select id,created_at from source order by created_at desc,id desc limit p_page_size offset((p_page-1)*p_page_size))
 select(select count(*) from source),
  (select coalesce(jsonb_agg(dashboard_private.teacher_request_state_v1(p_domain,id)-array['input','history','changes']
   order by created_at desc,id desc),'[]') from page) into total,rows;
 return jsonb_build_object('rows',rows,'totalCount',total,'page',p_page,'pageSize',p_page_size);
end $$;

create function public.get_teacher_request_references_v1(p_domain text,p_class_id uuid default null,p_month text default null)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a uuid:=dashboard_private.teacher_request_actor_v1();month_start date;class_row public.classes%rowtype;director jsonb;
 students jsonb:='[]';
begin
 if p_domain is null or p_domain not in('transfer','withdrawal','makeup','textbook') then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 -- Existing paged class/textbook pickers remain the entry point. Before a
 -- class is selected, return no global class, student or approver payload.
 if p_class_id is null or p_domain='textbook' then
  return jsonb_build_object('classes','[]'::jsonb,'students','[]'::jsonb,'rooms','[]'::jsonb,'sessions','[]'::jsonb,'approver',null);
 end if;
 select * into class_row from public.classes where id=p_class_id;
 if not found then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if p_domain='makeup' then
  if p_month is not null and p_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then
   raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  month_start:=(coalesce(p_month,to_char(now() at time zone 'Asia/Seoul','YYYY-MM'))||'-01')::date;
  director:=dashboard_private.resolve_registration_default_director(class_row.subject,class_row.grade,now());
 elsif p_domain in('transfer','withdrawal') then
  -- Match management_student_enrollments_v1's five canonical sources and
  -- enrolled-before-waitlisted precedence. Scan the roster projections once,
  -- not the per-student helper for every student; enrollment uses class_id.
  -- Student projections are arrays in that contract. Object keys or scalar
  -- strings must never become a new relationship through the ? operator.
  with candidates as (
   select enrollment.student_id,
    case when enrollment.status='enrolled' and enrollment.roster_active then 0 else 1 end priority
   from public.ops_registration_enrollments enrollment
   where enrollment.class_id=p_class_id and enrollment.student_id is not null
    and ((enrollment.status='enrolled' and enrollment.roster_active) or enrollment.status in('waitlist','waitlisted'))
   union all
   select student.id,
    case when (jsonb_typeof(student.class_ids)='array' and coalesce(student.class_ids,'[]'::jsonb) ? p_class_id::text)
      or coalesce(class_row.student_ids,'[]'::jsonb) ? student.id::text then 0 else 1 end
   from public.students student
   where (jsonb_typeof(student.class_ids)='array' and coalesce(student.class_ids,'[]'::jsonb) ? p_class_id::text)
    or (jsonb_typeof(student.waitlist_class_ids)='array' and coalesce(student.waitlist_class_ids,'[]'::jsonb) ? p_class_id::text)
    or coalesce(class_row.student_ids,'[]'::jsonb) ? student.id::text
    or coalesce(class_row.waitlist_ids,'[]'::jsonb) ? student.id::text
  ), canonical as (
   select student_id,min(priority) priority from candidates group by student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',student.id,'name',student.name,
    'status',case when canonical.priority=0 then 'enrolled' else 'waitlisted' end) order by student.name,student.id),'[]')
   into students from canonical join public.students student on student.id=canonical.student_id;
 end if;
 return jsonb_build_object(
  'classes',jsonb_build_array(jsonb_build_object('id',class_row.id,'name',class_row.name,'scheduleStorageMode',class_row.schedule_storage_mode)),
  'students',students,
  'rooms',case when p_domain='makeup' then coalesce((select jsonb_agg(jsonb_build_object('name',name) order by sort_order,name) from public.classroom_catalogs where is_visible),'[]') else '[]'::jsonb end,
  'sessions',case when p_domain='makeup' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',session_date,'startTime',start_time,'endTime',end_time,'revision',revision) order by session_date,start_time,id)
   from public.class_lesson_sessions where class_id=p_class_id and session_date>=month_start and session_date<(month_start+interval '1 month')::date and schedule_state in('active','makeup')),'[]') else '[]'::jsonb end,
  'approver',case when p_domain='makeup' then jsonb_build_object('status',director->'status','label',director->'directorName') else null end);
end $$;

create function dashboard_private.teacher_request_makeup_input_v1(p_input jsonb,p_existing_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.classes%rowtype;t public.teacher_catalogs%rowtype;ap public.teacher_catalogs%rowtype;
 old_request public.makeup_requests%rowtype;director jsonb;v jsonb;slot jsonb;mode text;session_id uuid;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or not(p_input ?& dashboard_private.teacher_request_input_fields_v1('makeup'))
  or p_input-dashboard_private.teacher_request_input_fields_v1('makeup')<>'{}'
  or jsonb_typeof(p_input->'request_kind') is distinct from 'string'
  or jsonb_typeof(p_input->'class_id') is distinct from 'string'
  or jsonb_typeof(p_input->'reason') is distinct from 'string'
  or length(btrim(p_input->>'reason')) not between 1 and 4000
  or jsonb_typeof(p_input->'makeup_slots') is distinct from 'array'
  or jsonb_array_length(p_input->'makeup_slots')>30
  or jsonb_typeof(p_input->'cancel_date') not in('string','null')
  or jsonb_typeof(p_input->'original_lesson_session_id') not in('string','null') then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 select * into c from public.classes where id=(p_input->>'class_id')::uuid for share;
 if not found then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if p_existing_id is not null then
  select * into old_request from public.makeup_requests where id=p_existing_id;
  if c.id is distinct from old_request.class_id then raise exception 'teacher_request_reference_change_forbidden' using errcode='22023';end if;
 end if;
 -- Resolve unique active catalog links, never a client-supplied profile/role.
 if (select count(*) from public.teacher_catalogs tc join public.profiles p on p.id=tc.profile_id
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where tc.is_visible and btrim(tc.name)=btrim(c.teacher))<>1 then
  raise exception 'teacher_request_teacher_unavailable' using errcode='22023';end if;
 select tc.* into t from public.teacher_catalogs tc join public.profiles p on p.id=tc.profile_id
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where tc.is_visible and btrim(tc.name)=btrim(c.teacher);
 director:=dashboard_private.resolve_registration_default_director(c.subject,c.grade,coalesce(old_request.created_at,now()));
 if director->>'status' is distinct from 'resolved' then raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 if p_existing_id is not null and old_request.approver_profile_id::text is distinct from director->>'profileId' then
  raise exception 'teacher_request_approver_changed' using errcode='23514';end if;
 if (select count(*) from public.teacher_catalogs where is_visible and profile_id::text=director->>'profileId')<>1 then
  raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 select * into ap from public.teacher_catalogs where is_visible and profile_id::text=director->>'profileId';
 if p_existing_id is not null and old_request.approver_teacher_catalog_id is distinct from ap.id then
  raise exception 'teacher_request_approver_changed' using errcode='23514';end if;
 for slot in select value from jsonb_array_elements(p_input->'makeup_slots') loop
  if jsonb_typeof(slot) is distinct from 'object' or not(slot ?& array['startAt','endAt','classroom'])
    or slot-array['startAt','endAt','classroom']<>'{}' or exists(select 1 from jsonb_each(slot) where jsonb_typeof(value)<>'string')
    or not exists(select 1 from public.classroom_catalogs where is_visible and name=slot->>'classroom')
    or (slot->>'endAt')::timestamptz<=(slot->>'startAt')::timestamptz then
    raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 end loop;
 session_id:=nullif(p_input->>'original_lesson_session_id','')::uuid;
 if c.schedule_storage_mode='normalized' and p_input->>'request_kind'<>'makeup_only' then
  if session_id is null or not exists(select 1 from public.class_lesson_sessions where id=session_id and class_id=c.id
    and session_date=(p_input->>'cancel_date')::date and schedule_state in('active','makeup')) then
   raise exception 'makeup_lesson_session_invalid' using errcode='22023';end if;
 elsif session_id is not null then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 v:=jsonb_build_object('request_kind',p_input->'request_kind','class_id',c.id,'class_name',c.name,'subject',c.subject,
  'approval_group',case when btrim(c.subject)='영어' then 'english' when btrim(c.subject)='수학' and coalesce(nullif(btrim(c.grade),''),nullif(btrim(c.name),''),'')~*'(고|high)' then 'math_high'
   when btrim(c.subject)='수학' and coalesce(nullif(btrim(c.grade),''),nullif(btrim(c.name),''),'')~*'(초|elementary|중|middle)' then 'math_middle' else 'unknown' end,
  'requester_id',auth.uid(),'teacher_catalog_id',t.id,'teacher_profile_id',t.profile_id,'approver_teacher_catalog_id',ap.id,'approver_profile_id',ap.profile_id,
  'reason',btrim(p_input->>'reason'),'cancel_date',p_input->'cancel_date','original_lesson_session_id',session_id,
  'makeup_slots',p_input->'makeup_slots','makeup_start_at',p_input#>'{makeup_slots,0,startAt}',
  'makeup_end_at',p_input#>'{makeup_slots,0,endAt}','makeup_classroom',p_input#>'{makeup_slots,0,classroom}');
 if not coalesce(dashboard_private.notification_makeup_input_valid_v1(v,coalesce(old_request.created_at,now())),false) then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'teacher_request_input_invalid' using errcode='22023';
end $$;

create function dashboard_private.teacher_request_textbook_validate_v1(p_input jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or not(p_input ?& dashboard_private.teacher_request_input_fields_v1('textbook'))
  or p_input-dashboard_private.teacher_request_input_fields_v1('textbook')<>'{}'
  or jsonb_typeof(p_input->'title') is distinct from 'string' or nullif(btrim(p_input->>'title'),'') is null
  or jsonb_typeof(p_input->'memo') is distinct from 'string'
  or exists(select 1 from unnest(array['textbookId','classId','locationId']) k where jsonb_typeof(p_input->k) not in('string','null'))
  or exists(select 1 from unnest(array['studentQuantity','teacherQuantity']) k where jsonb_typeof(p_input->k) is distinct from 'number'
    or (p_input->>k)!~'^(0|[1-9][0-9]*)$' or (p_input->>k)::numeric>2147483647)
  or (p_input->>'studentQuantity')::bigint+(p_input->>'teacherQuantity')::bigint<=0 then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if (p_input->>'textbookId' is not null and not exists(select 1 from public.textbooks where id=(p_input->>'textbookId')::uuid))
  or(p_input->>'classId' is not null and not exists(select 1 from public.classes where id=(p_input->>'classId')::uuid))
  or(p_input->>'locationId' is not null and not exists(select 1 from public.textbook_inventory_locations where id=(p_input->>'locationId')::uuid)) then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'teacher_request_input_invalid' using errcode='22023';
end $$;

create function dashboard_private.teacher_request_ops_input_v1(d text,p jsonb,p_existing_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare keys text[];ids text[];dates text[];k text;s public.students%rowtype;c public.classes%rowtype;dest public.classes%rowtype;
 old_task public.ops_tasks%rowtype;old_detail public.ops_transfer_details%rowtype;task_input jsonb;detail jsonb;
begin
 if d='transfer' then
  keys:=array['student_id','memo','from_class_id','to_class_id','transfer_reason','from_class_end_date','from_class_end_session','to_class_start_date','to_class_start_session','from_undistributed_textbooks','to_undistributed_textbooks'];
  ids:=array['student_id','from_class_id','to_class_id'];dates:=array['from_class_end_date','to_class_start_date'];
 elsif d='withdrawal' then
  keys:=array['student_id','memo','class_id','withdrawal_date','withdrawal_session','customer_reason','teacher_opinion','undistributed_textbooks'];
  ids:=array['student_id','class_id'];dates:=array['withdrawal_date'];
 else raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& keys) or p-keys<>'{}' then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 foreach k in array keys loop
  if k=any(dates) then
   if jsonb_typeof(p->k) not in('string','null') then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
   if p->>k is not null then perform (p->>k)::date;end if;
  else
   if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>4000 then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  end if;
 end loop;
 select * into s from public.students where id=(p->>'student_id')::uuid for share;
 if not found then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 select * into c from public.classes where id=(p->>case when d='transfer' then 'from_class_id' else 'class_id' end)::uuid for share;
 if not found then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 -- Creation uses the same canonical enrolled/waitlisted relationship as
 -- the selector. Past own records keep their immutable identity and original
 -- fields even if the current roster changes; only new creates use this gate.
 if p_existing_id is null and not exists(
  select 1 from dashboard_private.management_student_enrollments_v1(s.id) enrollment where enrollment.class_id=c.id
 ) then raise exception 'teacher_request_student_class_unrelated' using errcode='22023';end if;
 if p_existing_id is not null then
  select * into old_task from public.ops_tasks where id=p_existing_id and type=d;
  if s.id is distinct from old_task.student_id or c.id is distinct from old_task.class_id then
   raise exception 'teacher_request_reference_change_forbidden' using errcode='22023';end if;
 end if;
 task_input:=jsonb_build_object('title',case when d='transfer' then '전반 신청 · ' else '퇴원 신청 · ' end||s.name,
  'type',d,'student_id',s.id,'student_name',s.name,'class_id',c.id,'class_name',c.name,'subject',c.subject,'memo',p->'memo');
 if d='transfer' then
  select * into dest from public.classes where id=(p->>'to_class_id')::uuid for share;
  if not found or dest.id=c.id then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  detail:=(dashboard_private.teacher_request_json_pick_v1(p,keys)-array['student_id','memo'])||jsonb_build_object(
   'from_teacher_name',c.teacher,'to_teacher_name',dest.teacher,'from_class_name',c.name,'to_class_name',dest.name);
 else
  detail:=(dashboard_private.teacher_request_json_pick_v1(p,keys)-array['student_id','memo','class_id'])||jsonb_build_object('school_grade',s.grade,'teacher_name',c.teacher);
 end if;
 return jsonb_build_object('task',task_input,d,detail);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'teacher_request_input_invalid' using errcode='22023';
end $$;

create function public.mutate_teacher_own_request_v1(p_domain text,p_id uuid,p_action text,p_input jsonb,p_expected_revision text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
declare a uuid:=dashboard_private.teacher_request_actor_v1();i uuid:=p_id;r jsonb;v jsonb;result jsonb;fingerprint text;
 receipt dashboard_private.teacher_request_receipts_v1%rowtype;task_row public.ops_tasks%rowtype;makeup_row public.makeup_requests%rowtype;
 note text:='';change_id uuid;old_request_setting text:=current_setting('app.ops_transition_request_id',true);
begin
 if p_domain is null or p_domain not in('transfer','withdrawal','makeup','textbook') or p_action is null
  or p_action not in('create','update','withdraw','change_request','cancel_request') or p_request_id is null or p_input is null
  or (p_action='create' and(p_id is not null or p_expected_revision is not null))
  or(p_action<>'create' and(p_id is null or p_expected_revision is null)) then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 -- Keep the existing timetable-before-request lock order for makeup. Nothing
 -- below applies or reverses a lesson, roster, payment, or stock effect.
 if p_domain='makeup' then perform dashboard_private.lock_timetable_operating_resources_v1();end if;
 perform pg_advisory_xact_lock(hashtextextended('teacher-own-request:'||p_request_id::text,0));
 if p_action<>'create' then
  perform dashboard_private.teacher_request_lock_v1(p_domain,p_id);
  r:=dashboard_private.teacher_request_state_v1(p_domain,p_id);
  if (r->>'requesterId')::uuid is distinct from a then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
 end if;
 fingerprint:=md5(jsonb_build_object('actor',a,'domain',p_domain,'id',p_id,'action',p_action,'input',p_input,'revision',p_expected_revision)::text);
 select * into receipt from dashboard_private.teacher_request_receipts_v1 where request_key=p_request_id;
 if found then
  if receipt.actor_id is distinct from a then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
  if p_action='create' then
   perform dashboard_private.teacher_request_lock_v1(receipt.domain,receipt.request_id);
   r:=dashboard_private.teacher_request_state_v1(receipt.domain,receipt.request_id);
   if (r->>'requesterId')::uuid is distinct from a then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
  end if;
  if receipt.fingerprint<>fingerprint then raise exception 'idempotency_key_reused' using errcode='22023';end if;
  -- Preserve the first effect but return current capabilities, not a stale form.
  return r;
 end if;
 -- Serialize the legacy textbook receipt check with its existing producer.
 -- Otherwise an uncommitted legacy submission can pass this check, then be
 -- replayed inside submit_teacher_textbook_request_v1 as a falsely safe origin.
 if p_domain='textbook' and p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended('notification-request:'||p_request_id::text,0));
 end if;
 -- Do not reinterpret an old domain receipt as a newly proven safe origin.
 if exists(select 1 from dashboard_private.notification_request_ledger where request_id=p_request_id) then
  raise exception 'idempotency_key_reused' using errcode='22023';end if;
 if p_action<>'create' then
  if r->>'revision' is distinct from p_expected_revision then raise exception 'teacher_request_stale' using errcode='23514';end if;
  if not(r->'allowedActions' ? p_action) then raise exception 'teacher_request_state_conflict' using errcode='23514';end if;
 end if;
 if p_action in('withdraw','change_request','cancel_request') then note:=dashboard_private.teacher_request_note_v1(p_input);end if;
 if p_action in('change_request','cancel_request') then
  insert into dashboard_private.teacher_request_changes_v1(domain,request_id,requester_id,kind,note)
  values(p_domain,i,a,p_action,note) returning id into change_id;
 elsif p_action='create' then
  if p_domain in('transfer','withdrawal') then
   v:=dashboard_private.teacher_request_ops_input_v1(p_domain,p_input);
   task_row:=dashboard_private.insert_ops_task_from_json_v2(v,a);i:=task_row.id;
   insert into dashboard_private.teacher_request_context_v1 values(txid_current(),pg_backend_pid(),a,p_domain,i,p_action);
   perform set_config('app.ops_transition_request_id',p_request_id::text,true);
   perform dashboard_private.upsert_ops_task_detail_v2(i,p_domain,v->p_domain);
   perform set_config('app.ops_transition_request_id',coalesce(old_request_setting,''),true);
  elsif p_domain='makeup' then
   v:=dashboard_private.teacher_request_makeup_input_v1(p_input);
   result:=dashboard_private.create_makeup_request_v2_unguarded(v,p_request_id);i:=(result#>>'{request,id}')::uuid;
   -- The outer ledger binds the entire input, including the selected normalized
   -- session. A replay returns above and never re-enters the legacy wrapper.
  else
   perform dashboard_private.teacher_request_textbook_validate_v1(p_input);
   result:=public.submit_teacher_textbook_request_v1(p_request_id,p_input);i:=(result->>'orderId')::uuid;
  end if;
  insert into dashboard_private.teacher_request_origins_v1(domain,request_id,requester_id) values(p_domain,i,a);
 elsif p_action in('update','withdraw') then
  insert into dashboard_private.teacher_request_context_v1 values(txid_current(),pg_backend_pid(),a,p_domain,i,p_action);
  if p_domain in('transfer','withdrawal') then
   select * into task_row from public.ops_tasks where id=i;
   if p_action='update' then v:=dashboard_private.teacher_request_ops_input_v1(p_domain,p_input,i);
   else v:='{"task":{"status":"canceled"}}';end if;
   perform dashboard_private.update_ops_task_v2_impl(i,v,task_row.updated_at,p_request_id);
  elsif p_domain='makeup' then
   select * into makeup_row from public.makeup_requests where id=i;
   if p_action='update' then
    v:=dashboard_private.teacher_request_makeup_input_v1(p_input,i);
    update public.makeup_requests set status='approval_pending',request_kind=v->>'request_kind',reason=v->>'reason',
     cancel_date=(v->>'cancel_date')::date,original_lesson_session_id=(v->>'original_lesson_session_id')::uuid,
     original_lesson_session_revision=(select revision from public.class_lesson_sessions where id=(v->>'original_lesson_session_id')::uuid),
     makeup_slots=v->'makeup_slots',makeup_start_at=(v->>'makeup_start_at')::timestamptz,
     makeup_end_at=(v->>'makeup_end_at')::timestamptz,makeup_classroom=v->>'makeup_classroom'
    where id=i;
    if makeup_row.status='revision_requested' then
     perform dashboard_private.record_makeup_notification_source_v2(i,'resubmitted',makeup_row.status,'approval_pending',null,p_request_id,a);
    else insert into public.makeup_request_events(request_id,actor_id,event_type,note,mutation_request_id)
     values(i,a,'request_updated',null,p_request_id);end if;
   else
    update public.makeup_requests set status='canceled',canceled_by=a,canceled_at=clock_timestamp() where id=i;
    insert into public.makeup_request_events(request_id,actor_id,event_type,note,mutation_request_id)
    values(i,a,'withdrawn',note,p_request_id);
   end if;
  else
   if p_action='update' then perform dashboard_private.teacher_request_textbook_update_v1(i,p_input);
   else update public.textbook_purchase_orders set status='cancelled',updated_at=clock_timestamp() where id=i;end if;
  end if;
  if p_action='withdraw' then update dashboard_private.teacher_request_origins_v1 set withdrawn_at=clock_timestamp() where domain=p_domain and request_id=i;end if;
 end if;
 delete from dashboard_private.teacher_request_context_v1 where transaction_id=txid_current() and backend_pid=pg_backend_pid()
  and actor_id=a and domain=p_domain and request_id=i;
 insert into dashboard_private.teacher_request_history_v1(domain,request_id,actor_id,action,note,input_snapshot)
 values(p_domain,i,a,p_action,note,p_input);
 result:=dashboard_private.teacher_request_state_v1(p_domain,i);
 insert into dashboard_private.teacher_request_receipts_v1(request_key,actor_id,domain,request_id,action,fingerprint,response)
 values(p_request_id,a,p_domain,i,p_action,fingerprint,result);
 return result;
end $$;

create function dashboard_private.teacher_request_textbook_update_v1(i uuid,p_input jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare scope text;q integer;line_id uuid;
begin
 perform dashboard_private.teacher_request_textbook_validate_v1(p_input);
 if exists(select 1 from public.textbook_purchase_order_lines where purchase_order_id=i group by copy_scope having count(*)>1)
  or exists(select 1 from public.textbook_purchase_order_lines where purchase_order_id=i and copy_scope not in('student','teacher')) then
  raise exception 'teacher_request_state_conflict' using errcode='23514';end if;
 foreach scope in array array['student','teacher'] loop
  q:=(p_input->>case when scope='student' then 'studentQuantity' else 'teacherQuantity' end)::integer;
  select id into line_id from public.textbook_purchase_order_lines where purchase_order_id=i and copy_scope=scope;
  if line_id is not null then
   update public.textbook_purchase_order_lines set textbook_id=(p_input->>'textbookId')::uuid,
    requested_textbook_title=btrim(p_input->>'title'),class_id=(p_input->>'classId')::uuid,
    location_id=(p_input->>'locationId')::uuid,requested_quantity=q,memo=p_input->>'memo' where id=line_id and purchase_order_id=i;
  elsif q>0 then
   insert into public.textbook_purchase_order_lines(purchase_order_id,textbook_id,requested_textbook_title,class_id,location_id,requested_quantity,ordered_quantity,received_quantity,memo,copy_scope)
   values(i,(p_input->>'textbookId')::uuid,btrim(p_input->>'title'),(p_input->>'classId')::uuid,(p_input->>'locationId')::uuid,q,0,0,p_input->>'memo',scope);
  end if;
 end loop;
 update public.textbook_purchase_orders set updated_at=clock_timestamp() where id=i;
end $$;

create function dashboard_private.teacher_request_manager_can_access_v1(d text,i uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.deleted_at is null
  and(u.banned_until is null or u.banned_until<=now()) where p.id=auth.uid() and(p.role in('admin','staff')
   or(d='makeup' and p.role='viewer' and exists(select 1 from public.makeup_requests m where m.id=i and m.approver_profile_id=p.id))))
$$;

create function public.get_teacher_request_changes_v1(p_domain text,p_page integer default 1,p_page_size integer default 10)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid:=dashboard_private.teacher_request_actor_v1(false);rows jsonb;total bigint;
begin
 if p_domain is null or p_domain not in('transfer','withdrawal','makeup','textbook') or p_page is null or p_page<1 or p_page>100000
  or p_page_size is null or p_page_size not in(10,15,20) then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 with source as materialized(select c.* from dashboard_private.teacher_request_changes_v1 c
  where domain=p_domain and dashboard_private.teacher_request_manager_can_access_v1(domain,request_id)),
 page as(select * from source order by(status='pending') desc,created_at desc,id desc limit p_page_size offset((p_page-1)*p_page_size))
 select(select count(*) from source),(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'domain',c.domain,'requestId',c.request_id,'requesterId',c.requester_id,
  'kind',c.kind,'note',c.note,'status',c.status,'createdAt',c.created_at,'resolvedAt',c.resolved_at,'resolutionNote',c.resolution_note,
  'revision',md5(to_jsonb(c)::text),
  'title',coalesce(case when c.domain in('transfer','withdrawal') then(select title from public.ops_tasks where id=c.request_id and type=c.domain)
   when c.domain='makeup' then(select class_name from public.makeup_requests where id=c.request_id)
   else(select requested_textbook_title from public.textbook_purchase_order_lines where purchase_order_id=c.request_id order by id limit 1) end,'원본 없음'),
  'requestStatus',case when c.domain in('transfer','withdrawal') then(select status from public.ops_tasks where id=c.request_id and type=c.domain)
   when c.domain='makeup' then(select status from public.makeup_requests where id=c.request_id)
   else(select status from public.textbook_purchase_orders where id=c.request_id) end,
  'anchorId',case when c.domain='textbook' then(select id from public.textbook_purchase_order_lines where purchase_order_id=c.request_id order by id limit 1) else c.request_id end)
  order by(c.status='pending') desc,c.created_at desc,c.id desc),'[]') from page c) into total,rows;
 return jsonb_build_object('rows',rows,'totalCount',total,'page',p_page,'pageSize',p_page_size);
end $$;

create function public.resolve_teacher_request_change_v1(p_change_id uuid,p_resolution text,p_note text,p_expected_revision text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='30s' as $$
declare a uuid:=dashboard_private.teacher_request_actor_v1(false);c dashboard_private.teacher_request_changes_v1%rowtype;
 receipt dashboard_private.teacher_request_receipts_v1%rowtype;f text;result jsonb;original jsonb;
begin
 if p_change_id is null or p_request_id is null or p_resolution is null or p_resolution not in('confirmed','rejected')
  or p_note is null or length(btrim(p_note)) not between 1 and 4000 or p_expected_revision is null then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 select * into c from dashboard_private.teacher_request_changes_v1 where id=p_change_id;
 if not found or not dashboard_private.teacher_request_manager_can_access_v1(c.domain,c.request_id) then
  raise exception 'teacher_request_forbidden' using errcode='42501';end if;
 if c.domain='makeup' then perform dashboard_private.lock_timetable_operating_resources_v1();end if;
 perform pg_advisory_xact_lock(hashtextextended('teacher-own-request:'||p_request_id::text,0));
 perform dashboard_private.teacher_request_lock_v1(c.domain,c.request_id);
 select * into c from dashboard_private.teacher_request_changes_v1 where id=p_change_id for update;
 original:=dashboard_private.teacher_request_state_v1(c.domain,c.request_id);
 if not dashboard_private.teacher_request_manager_can_access_v1(c.domain,c.request_id)
   or (original->>'requesterId')::uuid is distinct from c.requester_id then
  raise exception 'teacher_request_forbidden' using errcode='42501';end if;
 f:=md5(jsonb_build_object('actor',a,'change',p_change_id,'resolution',p_resolution,'note',p_note,'expected',p_expected_revision)::text);
 select * into receipt from dashboard_private.teacher_request_receipts_v1 where request_key=p_request_id;
 if found then
  if receipt.actor_id is distinct from a then raise exception 'teacher_request_forbidden' using errcode='42501';end if;
  if receipt.fingerprint<>f or receipt.action<>'resolve' then raise exception 'idempotency_key_reused' using errcode='22023';end if;
  return receipt.response;
 end if;
 if md5(to_jsonb(c)::text) is distinct from p_expected_revision then raise exception 'teacher_request_stale' using errcode='23514';end if;
 if c.status<>'pending' then raise exception 'teacher_request_state_conflict' using errcode='23514';end if;
 -- Recording a manager's result never performs, approves, or reverses the
 -- underlying enrollment, stock, refund, or lesson-schedule operation.
 update dashboard_private.teacher_request_changes_v1 set status=p_resolution,resolution_note=btrim(p_note),resolved_by=a,resolved_at=clock_timestamp() where id=p_change_id returning * into c;
 insert into dashboard_private.teacher_request_history_v1(domain,request_id,actor_id,action,note,input_snapshot)
 values(c.domain,c.request_id,a,p_resolution,btrim(p_note),jsonb_build_object('changeId',c.id));
 result:=jsonb_build_object('id',c.id,'domain',c.domain,'requestId',c.request_id,'kind',c.kind,'note',c.note,'status',c.status,
  'createdAt',c.created_at,'resolvedAt',c.resolved_at,'resolutionNote',c.resolution_note,'revision',md5(to_jsonb(c)::text));
 insert into dashboard_private.teacher_request_receipts_v1(request_key,actor_id,domain,request_id,action,fingerprint,response)
 values(p_request_id,a,c.domain,c.request_id,'resolve',f,result);
 return result;
end $$;

-- Public RPCs are invokers. The private implementation performs every active
-- role, ownership, field, state, CAS and replay check; granting its exact EXECUTE
-- does not grant access to the private tables or other internal functions.
alter function public.get_teacher_own_request_v1(text,uuid) set schema dashboard_private;
alter function dashboard_private.get_teacher_own_request_v1(text,uuid) rename to get_teacher_own_request_v1_impl;
create function public.get_teacher_own_request_v1(p_domain text,p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select dashboard_private.get_teacher_own_request_v1_impl(p_domain,p_id) $$;
alter function public.get_teacher_own_requests_v1(text,integer,integer) set schema dashboard_private;
alter function dashboard_private.get_teacher_own_requests_v1(text,integer,integer) rename to get_teacher_own_requests_v1_impl;
create function public.get_teacher_own_requests_v1(p_domain text,p_page integer default 1,p_page_size integer default 10) returns jsonb language sql security invoker set search_path='' as $$
 select dashboard_private.get_teacher_own_requests_v1_impl(p_domain,p_page,p_page_size) $$;
alter function public.get_teacher_request_references_v1(text,uuid,text) set schema dashboard_private;
alter function dashboard_private.get_teacher_request_references_v1(text,uuid,text) rename to get_teacher_request_references_v1_impl;
create function public.get_teacher_request_references_v1(p_domain text,p_class_id uuid default null,p_month text default null) returns jsonb language sql security invoker set search_path='' as $$
 select dashboard_private.get_teacher_request_references_v1_impl(p_domain,p_class_id,p_month) $$;
alter function public.mutate_teacher_own_request_v1(text,uuid,text,jsonb,text,uuid) set schema dashboard_private;
alter function dashboard_private.mutate_teacher_own_request_v1(text,uuid,text,jsonb,text,uuid) rename to mutate_teacher_own_request_v1_impl;
create function public.mutate_teacher_own_request_v1(p_domain text,p_id uuid,p_action text,p_input jsonb,p_expected_revision text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select dashboard_private.mutate_teacher_own_request_v1_impl(p_domain,p_id,p_action,p_input,p_expected_revision,p_request_id) $$;
alter function public.get_teacher_request_changes_v1(text,integer,integer) set schema dashboard_private;
alter function dashboard_private.get_teacher_request_changes_v1(text,integer,integer) rename to get_teacher_request_changes_v1_impl;
create function public.get_teacher_request_changes_v1(p_domain text,p_page integer default 1,p_page_size integer default 10) returns jsonb language sql security invoker set search_path='' as $$
 select dashboard_private.get_teacher_request_changes_v1_impl(p_domain,p_page,p_page_size) $$;
alter function public.resolve_teacher_request_change_v1(uuid,text,text,text,uuid) set schema dashboard_private;
alter function dashboard_private.resolve_teacher_request_change_v1(uuid,text,text,text,uuid) rename to resolve_teacher_request_change_v1_impl;
create function public.resolve_teacher_request_change_v1(p_change_id uuid,p_resolution text,p_note text,p_expected_revision text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select dashboard_private.resolve_teacher_request_change_v1_impl(p_change_id,p_resolution,p_note,p_expected_revision,p_request_id) $$;

do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='dashboard_private' and(p.proname like 'teacher_request_%_v1' or p.proname in(
  'get_teacher_own_request_v1_impl','get_teacher_own_requests_v1_impl','get_teacher_request_references_v1_impl',
  'mutate_teacher_own_request_v1_impl','get_teacher_request_changes_v1_impl','resolve_teacher_request_change_v1_impl')) loop
  execute format('alter function %s owner to postgres',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='public' and p.proname in('get_teacher_own_request_v1','get_teacher_own_requests_v1','get_teacher_request_references_v1',
  'mutate_teacher_own_request_v1','get_teacher_request_changes_v1','resolve_teacher_request_change_v1'))
 or(n.nspname='dashboard_private' and p.proname in('get_teacher_own_request_v1_impl','get_teacher_own_requests_v1_impl','get_teacher_request_references_v1_impl',
  'mutate_teacher_own_request_v1_impl','get_teacher_request_changes_v1_impl','resolve_teacher_request_change_v1_impl')) loop
  execute format('alter function %s owner to postgres',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to authenticated',fn);
 end loop;
end $$;

-- Match the existing closed-view UI's neutral cancellation label and include
-- owner withdrawal events in its search/sort keys. Membership, approval,
-- notification producers and the full row DTO remain unchanged.
do $teacher_withdrawn_search$
declare target regprocedure; definition text; anchor text; replacement text;
 owner_before oid; acl_before aclitem[];
begin
 for target in select unnest(array[
  'public.makeup_numbered_values_v1(jsonb,jsonb,jsonb)'::regprocedure,
  'public.list_makeup_numbered_page_v1(jsonb,integer,integer)'::regprocedure,
  'dashboard_private.list_makeup_numbered_page_v1_common_impl_v1(jsonb,integer,integer)'::regprocedure]) loop
  select proowner,proacl into owner_before,acl_before from pg_proc where oid=target;
  definition:=pg_get_functiondef(target);
  if target='public.makeup_numbered_values_v1(jsonb,jsonb,jsonb)'::regprocedure then
   anchor:=$anchor$when 'canceled' then '승인 취소'$anchor$;
   replacement:=$patch$when 'canceled' then '취소·철회'$patch$;
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'teacher_withdrawn_status_definition_drift' using errcode='55000';end if;
   definition:=replace(definition,anchor,replacement);
  else
   anchor:=$anchor$in('approval_canceled','completed_canceled')$anchor$;
   replacement:=$patch$in('approval_canceled','completed_canceled','withdrawn')$patch$;
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'teacher_withdrawn_event_kind_definition_drift' using errcode='55000';end if;
   definition:=replace(definition,anchor,replacement);
   anchor:=$anchor$in('approval_canceled','completed_canceled','submitted','resubmitted','revision_requested','approved','rejected')$anchor$;
   replacement:=$patch$in('approval_canceled','completed_canceled','withdrawn','submitted','resubmitted','revision_requested','approved','rejected')$patch$;
   if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'teacher_withdrawn_event_filter_definition_drift' using errcode='55000';end if;
   definition:=replace(definition,anchor,replacement);
  end if;
  execute definition;
  if exists(select 1 from pg_proc where oid=target and(proowner is distinct from owner_before or proacl is distinct from acl_before)) then
   raise exception 'teacher_withdrawn_search_acl_drift' using errcode='55000';end if;
 end loop;
end $teacher_withdrawn_search$;

notify pgrst,'reload schema';
commit;
