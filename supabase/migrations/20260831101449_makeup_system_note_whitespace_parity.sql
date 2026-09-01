begin;
set local lock_timeout='5s';
-- Compare with exactly ECMAScript whitespace and ASCII digits. Translation is
-- predicate-only: the returned source note and all other display keys stay raw.
create or replace function public.makeup_numbered_values_v1(r jsonb, latest jsonb, labels jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare slots jsonb:=public.makeup_numbered_slots_v1(r); s jsonb; slot_times text[]:='{}'; rooms text[]:='{}'; dates text[]:='{}'; a text; b text; note text; cancel_note text; result jsonb; k text;
begin
 if jsonb_array_length(slots)=0 then slots:=jsonb_build_array(jsonb_build_object('startAt',r->>'makeup_start_at','endAt',r->>'makeup_end_at','classroom',r->>'makeup_classroom')); end if;
 dates:=array[substring(r->>'cancel_date' from '^\d{4}-\d{2}-\d{2}')];
 for s in select value from jsonb_array_elements(slots) loop
  a:=public.makeup_numbered_time_label_v1(coalesce(nullif(s->>'startAt',''),r->>'makeup_start_at'));
  b:=public.makeup_numbered_time_label_v1(coalesce(nullif(s->>'endAt',''),r->>'makeup_end_at'));
  if a<>'-' or b<>'-' then slot_times:=array_append(slot_times,case when b='-' then a else a||' - '||b end); end if;
  if coalesce(nullif(s->>'classroom',''),r->>'makeup_classroom','')<>'' then rooms:=array_append(rooms,coalesce(nullif(s->>'classroom',''),r->>'makeup_classroom')); end if;
  dates:=dates||array[substring(coalesce(nullif(s->>'startAt',''),r->>'makeup_start_at') from '^\d{4}-\d{2}-\d{2}'),substring(coalesce(nullif(s->>'endAt',''),r->>'makeup_end_at') from '^\d{4}-\d{2}-\d{2}')];
 end loop;
 cancel_note:=public.makeup_numbered_trim_v1(latest#>>'{canceled,note}');
 note:=coalesce(nullif(public.makeup_numbered_trim_v1(latest#>>'{approved,note}'),''),public.makeup_numbered_trim_v1(r->>'final_note'));
 if note='' or translate(note,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',repeat(' ',25)) ~ '^보강 +[0-9]{4}-[0-9]{2}-[0-9]{2} +[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}' or (cancel_note<>'' and note=cancel_note) then note:='-'; end if;
 result:=labels||jsonb_build_object('status',case r->>'status' when 'approval_pending' then '결재자 승인 대기' when 'revision_requested' then '보완 요청' when 'rejected' then '반려' when 'manager_pending' then '이전 관리팀 전달' when 'makeup_pending' then '보강대기' when 'refund_pending' then '환불대기' when 'completed' then '완료' when 'canceled' then '승인 취소' else r->>'status' end,
  'className',public.makeup_numbered_trim_v1(r->>'class_name'),'subject',public.makeup_numbered_trim_v1(r->>'subject'),'reason',public.makeup_numbered_trim_v1(r->>'reason'),'cancelDate',coalesce(r->>'cancel_date',''),
  'makeupAt',coalesce(nullif(array_to_string(slot_times,' / '),''),'-'),'makeupRoom',coalesce(nullif(array_to_string(rooms,' / '),''),'-'),
  'submittedAt',public.makeup_numbered_time_label_v1(coalesce(nullif(r->>'created_at',''),latest#>>'{submitted,createdAt}')),
  'revisionRequestedAt',public.makeup_numbered_time_label_v1(latest#>>'{revision_requested,createdAt}'),
  'approvedAt',public.makeup_numbered_time_label_v1(coalesce(nullif(r->>'approved_at',''),latest#>>'{approved,createdAt}')),
  'rejectedAt',public.makeup_numbered_time_label_v1(latest#>>'{rejected,createdAt}'),
  'canceledAt',public.makeup_numbered_time_label_v1(coalesce(nullif(r->>'canceled_at',''),latest#>>'{canceled,createdAt}')),
  'returnedReason',public.makeup_numbered_trim_v1(r->>'returned_reason'),'rejectedReason',public.makeup_numbered_trim_v1(r->>'rejected_reason'),'finalNote',note,'canceledNote',cancel_note);
 for k in select jsonb_object_keys(result) loop if result->>k='' then result:=result||jsonb_build_object(k,'-'); end if; end loop;
 return result||jsonb_build_object('dates',to_jsonb(array_remove(dates,null)));
end $$;
commit;
