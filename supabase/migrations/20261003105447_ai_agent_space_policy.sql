begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- User policy is separate from runtime slot activation and bot grants.
-- The existing generic immutable receipt store can safely scope this writer by
-- authenticated principal + operation + target, without a request mutation.
create table dashboard_private.ai_agent_space_policy_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),
 before_space_keys text[] not null,
 after_space_keys text[] not null,
 before_revision bigint not null check(before_revision>=0),
 after_revision bigint not null check(after_revision=before_revision+1),
 created_at timestamptz not null default clock_timestamp()
);
create index ai_agent_space_policy_events_user on dashboard_private.ai_agent_space_policy_events(user_id,after_revision);
create index ai_agent_space_policy_events_actor on dashboard_private.ai_agent_space_policy_events(actor_id);
alter table dashboard_private.ai_agent_space_policy_events enable row level security;
revoke all on dashboard_private.ai_agent_space_policy_events from public,anon,authenticated,service_role;
create trigger ai_agent_space_policy_events_immutable before update or delete on dashboard_private.ai_agent_space_policy_events for each row execute function dashboard_private.ai_agent_immutable_v1();

create function public.ai_agent_space_policy_api_v1(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); target uuid; key uuid; ai_role text; target_role text;
 actor_active boolean:=false; target_active boolean:=false; target_found boolean:=false;
 row_profile record; row_auth record;
 perm dashboard_private.chat_user_space_permissions;
 receipt dashboard_private.ai_agent_request_receipts;
 keys text[]; expected bigint; previous bigint; fingerprint text; result jsonb; items jsonb;
begin
 if p_action='catalog' then
  actor:=dashboard_private.ai_agent_require_user_v1();
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array[]::text[]);
  select p.role into ai_role from public.profiles p where p.id=actor;
  select jsonb_agg(jsonb_build_object(
   'key',s.space_key,
   'label',(array['경영팀','관리팀','조교팀','영어팀','전체공지','수학팀','과학팀'])[right(s.space_key,1)::integer],
   'configured',s.configured,
   'selectable',s.configured and (ai_role='admin' or s.space_key=any(coalesce(p.space_keys,array[]::text[]))),
   'reason',case when not s.configured then 'space_not_configured' when ai_role<>'admin' and not s.space_key=any(coalesce(p.space_keys,array[]::text[])) then 'space_not_allowed' end,
   'revision',s.revision::text) order by s.space_key) into items
  from dashboard_private.chat_space_configuration s left join dashboard_private.chat_user_space_permissions p on p.user_id=actor;
  return jsonb_build_object('items',coalesce(items,'[]'::jsonb));
 elsif p_action='get' then
  actor:=dashboard_private.ai_agent_require_admin_v1();
  perform dashboard_private.ai_agent_assert_input_v1(p_input,array['userId']);
  target:=dashboard_private.ai_agent_required_uuid_v1(p_input,'userId');
  select * into perm from dashboard_private.chat_user_space_permissions where user_id=target;
  return jsonb_build_object('userId',target,'spaceKeys',coalesce(perm.space_keys,array[]::text[]),'revision',coalesce(perm.revision,0)::text,'updatedAt',perm.updated_at);
 elsif p_action is distinct from 'set' then
  raise exception using errcode='22023',message='ai_agent_invalid';
 end if;

 -- Early authorization is fail-closed; decisive authority is checked again
 -- from current tuples after all profile/auth waits, before any replay/effect.
 perform dashboard_private.ai_agent_require_admin_v1();
 perform dashboard_private.ai_agent_assert_input_v1(p_input,array['userId','revision','spaceKeys','idempotencyKey']);
 target:=dashboard_private.ai_agent_required_uuid_v1(p_input,'userId');
 key:=dashboard_private.ai_agent_required_uuid_v1(p_input,'idempotencyKey');
 if not p_input ? 'revision' then raise exception using errcode='22023',message='ai_agent_precondition_required';end if;
 if jsonb_typeof(p_input->'revision') is distinct from 'string' or p_input->>'revision' !~ '^(0|[1-9][0-9]{0,18})$' then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 begin expected:=(p_input->>'revision')::bigint;
 exception when numeric_value_out_of_range then raise exception using errcode='22023',message='ai_agent_invalid';end;
 if jsonb_typeof(p_input->'spaceKeys') is distinct from 'array' or jsonb_array_length(p_input->'spaceKeys')>7 then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 if exists(select 1 from jsonb_array_elements(p_input->'spaceKeys')x where jsonb_typeof(x) is distinct from 'string' or x#>>'{}' not in('space_1','space_2','space_3','space_4','space_5','space_6','space_7'))
 or (select count(*)<>count(distinct x) from jsonb_array_elements(p_input->'spaceKeys')x) then raise exception using errcode='22023',message='ai_agent_invalid';end if;
 select coalesce(array_agg(x order by x),array[]::text[]) into keys from jsonb_array_elements_text(p_input->'spaceKeys')x;

 -- This policy-only target lock covers the absent-row CAS case too. No
 -- existing Chat/user writer takes this namespace or any policy-writer lock.
 -- Shared profile/auth locks match Chat's profile -> auth -> permission order;
 -- sorted UUIDs avoid a two-admin cross-target cycle. This writer never locks
 -- credentials, requests, claims or outbox rows.
 perform pg_advisory_xact_lock(hashtextextended('ai_agent_space_policy:'||target::text,0));
 for row_profile in select p.id,p.role from public.profiles p where p.id in(actor,target) order by p.id for share loop
  if row_profile.id=actor then ai_role:=row_profile.role;end if;
  if row_profile.id=target then target_role:=row_profile.role;target_found:=true;end if;
 end loop;
 for row_auth in select u.id,u.deleted_at,u.banned_until from auth.users u where u.id in(actor,target) order by u.id for share loop
  if row_auth.id=actor then actor_active:=row_auth.deleted_at is null and (row_auth.banned_until is null or row_auth.banned_until<=clock_timestamp());end if;
  if row_auth.id=target then target_active:=row_auth.deleted_at is null and (row_auth.banned_until is null or row_auth.banned_until<=clock_timestamp());end if;
 end loop;
 if ai_role is distinct from 'admin' or not actor_active then raise exception using errcode='42501',message='ai_agent_forbidden';end if;
 if not target_found then raise exception using errcode='P0002',message='ai_agent_not_found';end if;
 select * into perm from dashboard_private.chat_user_space_permissions where user_id=target for update;
 -- Admin catalog authority is independent of employee permission rows. An
 -- existing inactive/downgraded/admin row can only be explicitly cleared.
 if (target_role is null or target_role not in('staff','teacher','assistant') or not target_active)
 and (cardinality(keys)>0 or perm.user_id is null) then raise exception using errcode='42501',message='ai_agent_space_forbidden';end if;
 fingerprint:=encode(sha256(convert_to((p_input-'idempotencyKey')::text,'UTF8')),'hex');
 select * into receipt from dashboard_private.ai_agent_request_receipts where principal_kind='user' and principal_id=actor and operation='space_policy_set' and resource_id=target and idempotency_key=key;
 if found then
  if receipt.payload_hash<>fingerprint then raise exception using errcode='23514',message='ai_agent_idempotency_conflict';end if;
  return receipt.result;
 end if;
 previous:=coalesce(perm.revision,0);
 if expected<>previous then raise exception using errcode='55000',message='ai_agent_stale_version';end if;
 if previous=9223372036854775807 then raise exception using errcode='55000',message='ai_agent_conflict';end if;
 insert into dashboard_private.ai_agent_space_policy_events(user_id,actor_id,before_space_keys,after_space_keys,before_revision,after_revision)
 values(target,actor,coalesce(perm.space_keys,array[]::text[]),keys,previous,previous+1);
 insert into dashboard_private.chat_user_space_permissions(user_id,space_keys,revision,configured_by,updated_at) values(target,keys,previous+1,actor,clock_timestamp())
 on conflict(user_id) do update set space_keys=excluded.space_keys,revision=excluded.revision,configured_by=excluded.configured_by,updated_at=excluded.updated_at returning * into perm;
 result:=jsonb_build_object('userId',target,'spaceKeys',perm.space_keys,'revision',perm.revision::text,'updatedAt',perm.updated_at);
 insert into dashboard_private.ai_agent_request_receipts(principal_kind,principal_id,operation,resource_id,idempotency_key,payload_hash,result) values('user',actor,'space_policy_set',target,key,fingerprint,result);
 return result;
end$$;
revoke all on function public.ai_agent_space_policy_api_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ai_agent_space_policy_api_v1(text,jsonb) to authenticated;
commit;
