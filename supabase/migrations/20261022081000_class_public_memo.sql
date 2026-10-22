begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Public authorship is separate from internal notes and lesson/progress notes.
-- The constant empty default does not copy or convert existing class content.
alter table public.classes add column public_memo text not null default '';

-- Adding a key changes to_jsonb(classes). Continue each existing v2 audit chain
-- with an additive schema event; never rewrite its history or reset a hash.
-- No permanent helper, permission, policy, or trigger is added.
do $schema_event$
declare
  current_row jsonb;
  old_hash text;
  new_hash text;
  predecessor public.dashboard_audit_logs%rowtype;
begin
  for current_row in select to_jsonb(c) from public.classes c order by c.id for update loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('classes'),pg_catalog.hashtext(current_row->>'id'));
    select * into predecessor from public.dashboard_audit_logs
      where entity_table='classes' and entity_id=current_row->>'id' and record_format in ('full_v2','diff_v2')
      order by event_sequence desc limit 1;
    if not found then continue; end if;
    old_hash := encode(extensions.digest((current_row-'public_memo')::text,'sha256'),'hex');
    new_hash := encode(extensions.digest(current_row::text,'sha256'),'hex');
    if predecessor.action='DELETE' or predecessor.audit_chain_id is null or predecessor.chain_ordinal is null
      or predecessor.after_hash is distinct from old_hash then
      raise exception 'audit_chain_continuity_invalid' using errcode='55000';
    end if;
    insert into public.dashboard_audit_logs (
      actor_profile_id,actor_email,actor_role,action,entity_table,entity_id,entity_label,class_id,
      request_operation,change_reason,record_format,change_patch,before_hash,after_hash,event_sequence,
      audit_chain_id,chain_ordinal,predecessor_event_id,predecessor_after_hash
    ) values (
      null,'','migration','UPDATE','classes',current_row->>'id',current_row->>'name',(current_row->>'id')::uuid,
      'class_public_memo_schema_v1','홈페이지 공개 메모 필드 추가','diff_v2',
      jsonb_build_object('public_memo',jsonb_build_object('before',null,'beforeExists',false,'after','')),
      old_hash,new_hash,nextval('dashboard_private.dashboard_audit_event_sequence_v2'::regclass),
      predecessor.audit_chain_id,predecessor.chain_ordinal+1,predecessor.id,predecessor.after_hash
    );
  end loop;
end;
$schema_event$;

-- Patch the final ordered definitions, including textbook usage and roster
-- additions. CREATE OR REPLACE retains existing signatures, ownership and ACLs.
do $rpc_fields$
declare
  definition text;
  old_text text;
  new_text text;
begin
  definition := pg_get_functiondef('public.create_class_with_group_memberships_v1(jsonb,uuid[])'::regprocedure);
  old_text := $old$  if p_class - array[$old$;
  new_text := $new$  if p_class ? 'public_memo' and jsonb_typeof(p_class->'public_memo') not in ('string','null') then
    raise exception 'class_public_memo_invalid' using errcode='22023';
  end if;

  if p_class - array[$new$;
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_create_validation_target_missing' using errcode='55000'; end if;
  definition := replace(definition,old_text,new_text);
  old_text := $old$'textbook_ids', 'textbook_usage'$old$;
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_create_keys_target_missing' using errcode='55000'; end if;
  definition := replace(definition,old_text,$new$'textbook_ids', 'textbook_usage', 'public_memo'$new$);
  old_text := E'    textbook_usage\n  )';
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_create_columns_target_missing' using errcode='55000'; end if;
  definition := replace(definition,old_text,E'    textbook_usage,\n    public_memo\n  )');
  old_text := $old$    coalesce(p_class -> 'textbook_usage', '{}'::jsonb)
  )$old$;
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_create_values_target_missing' using errcode='55000'; end if;
  definition := replace(definition,old_text,$new$    coalesce(p_class -> 'textbook_usage', '{}'::jsonb),
    coalesce(p_class ->> 'public_memo', '')
  )$new$);
  execute definition;

  definition := pg_get_functiondef('public.update_class_operational_v1(uuid,jsonb,uuid,jsonb)'::regprocedure);
  old_text := $old$'textbook_usage','schedule_plan'$old$;
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_update_keys_target_missing' using errcode='55000'; end if;
  definition := replace(definition,old_text,$new$'textbook_usage','public_memo','schedule_plan'$new$);
  old_text := $old$ h:=dashboard_private.continuous_class_schedule_hash_v1($old$;
  new_text := $new$ if p_patch ? 'public_memo' then
  if jsonb_typeof(p_patch->'public_memo') not in ('string','null') then raise exception 'class_public_memo_invalid' using errcode='22023';end if;
  p_patch:=jsonb_set(p_patch,'{public_memo}',to_jsonb(coalesce(p_patch->>'public_memo','')));
 end if;
 h:=dashboard_private.continuous_class_schedule_hash_v1($new$;
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_update_validation_target_missing' using errcode='55000'; end if;
  execute replace(definition,old_text,new_text);

  definition := pg_get_functiondef('public.get_management_detail_v1(text,uuid)'::regprocedure);
  old_text := $old$'textbookUsage',coalesce(v_raw -> 'textbook_usage','{}'::jsonb),'updatedAt'$old$;
  new_text := $new$'textbookUsage',coalesce(v_raw -> 'textbook_usage','{}'::jsonb),'publicMemo',coalesce(v_raw ->> 'public_memo',''),'updatedAt'$new$;
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then raise exception 'public_memo_detail_target_missing' using errcode='55000'; end if;
  execute replace(definition,old_text,new_text);
end;
$rpc_fields$;

commit;
