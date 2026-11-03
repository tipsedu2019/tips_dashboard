begin;
set local lock_timeout = '5s';

-- UTC and +09:00 are equivalent representations of a stored instant. Project
-- explicit-offset timestamps to Seoul only for list display/search/date keys;
-- do not rewrite requests, slot payloads, collision rules, or approval writers.
-- Patch the final definitions so later cancellation-label changes are retained.
do $makeup_seoul_projection$
declare
  target regprocedure;
  definition text;
  anchor text;
  replacement text;
  metadata_before jsonb;
  metadata_after jsonb;
begin
  foreach target in array array[
    'public.makeup_numbered_time_label_v1(text)'::regprocedure,
    'public.makeup_numbered_values_v1(jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select jsonb_build_array(proowner, proacl, prosecdef, provolatile,
      proconfig, prolang, prorettype, proargtypes::text)
      into metadata_before from pg_proc where oid = target;
    definition := pg_get_functiondef(target);
    if target = 'public.makeup_numbered_time_label_v1(text)'::regprocedure then
      anchor := $anchor$select case when coalesce(value,'')='' then '-' when value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then left(value,10)||' '||substring(value from 12 for 5) else value end$anchor$;
      replacement := $replacement$select case
   when instant is not null then to_char(instant at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI')
   when coalesce(value,'')='' then '-'
   when value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then left(value,10)||' '||substring(value from 12 for 5)
   else value end
 from (select public.makeup_numbered_instant_v1(
   -- Match JavaScript milliseconds: PostgreSQL would otherwise round a long
   -- fractional second into a different minute/day at a boundary.
   regexp_replace(value,'(\.[0-9]{3})[0-9]+','\1')
 ) instant) parsed$replacement$;
    else
      anchor := $anchor$dates:=dates||array[substring(coalesce(nullif(s->>'startAt',''),r->>'makeup_start_at') from '^\d{4}-\d{2}-\d{2}'),substring(coalesce(nullif(s->>'endAt',''),r->>'makeup_end_at') from '^\d{4}-\d{2}-\d{2}')];$anchor$;
      replacement := $replacement$dates:=dates||array[substring(a from '^\d{4}-\d{2}-\d{2}'),substring(b from '^\d{4}-\d{2}-\d{2}')];$replacement$;
    end if;
    if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
      raise exception 'makeup_seoul_projection_definition_drift' using errcode = '55000';
    end if;
    execute replace(definition, anchor, replacement);
    select jsonb_build_array(proowner, proacl, prosecdef, provolatile,
      proconfig, prolang, prorettype, proargtypes::text)
      into metadata_after from pg_proc where oid = target;
    if metadata_after is distinct from metadata_before then
      raise exception 'makeup_seoul_projection_metadata_drift' using errcode = '55000';
    end if;
  end loop;
end
$makeup_seoul_projection$;

commit;
