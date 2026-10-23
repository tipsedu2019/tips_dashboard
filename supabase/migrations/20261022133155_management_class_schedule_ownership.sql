begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Detail is the authoritative source for the editor's saved row. Without this
-- existing discriminator a normalized class is mistaken for a legacy writer.
-- Add one read-only DTO field; preserve the function's body and ACL otherwise.
do $detail_ownership$
declare
  definition text := pg_get_functiondef('public.get_management_detail_v1(text,uuid)'::regprocedure);
  old_text text := $old$'publicMemo',coalesce(v_raw ->> 'public_memo',''),'updatedAt'$old$;
  new_text text := $new$'publicMemo',coalesce(v_raw ->> 'public_memo',''),'scheduleStorageMode',v_raw ->> 'schedule_storage_mode','updatedAt'$new$;
begin
  if length(definition) - length(replace(definition, old_text, '')) <> length(old_text) then
    raise exception 'management_detail_ownership_target_missing' using errcode = '55000';
  end if;
  execute replace(definition, old_text, new_text);
end;
$detail_ownership$;

commit;
