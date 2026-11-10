-- #234: share each raw-text dated input between the two EXCEPT ALL branches.
-- Only the dated-diff SELECT changes. Reader/workset preparation, the equality
-- fast case, weekday diff, affected-date enumeration and conflict checks remain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $dated_diff_projection$
declare
  target oid := to_regprocedure('dashboard_private.validate_timetable_operating_reference_v1()');
  original_body text;
  candidate_body text;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  anchor text := $anchor$   select coalesce(array_agg(distinct dt) filter(where dt is not null),'{}'::date[])
   into changed_dated_dates
   from ((select v::text collate "C" raw_dated,dt from unnest(old_workset)
          except all select v::text collate "C",dt from unnest(new_workset))
         union all
         (select v::text collate "C" raw_dated,dt from unnest(new_workset)
          except all select v::text collate "C",dt from unnest(old_workset))) changed_dated;$anchor$;
  replacement text := $replacement$   with old_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(old_workset)
   ), new_raw_dated as materialized (
    select v::text collate "C" raw_dated,dt from unnest(new_workset)
   )
   select coalesce(array_agg(distinct dt) filter(where dt is not null),'{}'::date[])
   into changed_dated_dates
   from ((select raw_dated,dt from old_raw_dated
          except all select raw_dated,dt from new_raw_dated)
         union all
         (select raw_dated,dt from new_raw_dated
          except all select raw_dated,dt from old_raw_dated)) changed_dated;$replacement$;
begin
  select p.prosrc, to_jsonb(p) - 'prosrc'
    into original_body, metadata_before
    from pg_catalog.pg_proc p where p.oid = target;
  if metadata_before is null
    or md5(original_body) is distinct from 'f43f5adf0c9ed1ed6b195de6940bb639'
    or length(original_body) - length(replace(original_body, anchor, '')) <> length(anchor) then
    raise exception 'timetable_dated_diff_projection_definition_drift' using errcode = '55000';
  end if;
  candidate_body := replace(original_body, anchor, replacement);
  if md5(candidate_body) is distinct from '5f577a02f6ee20daf14284c62e4ded05' then
    raise exception 'timetable_dated_diff_projection_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'timetable_dated_diff_projection_definition_drift' using errcode = '55000';
  end if;
  execute replace(definition, anchor, replacement);
  select p.prosrc, to_jsonb(p) - 'prosrc'
    into candidate_body, metadata_after
    from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from '5f577a02f6ee20daf14284c62e4ded05'
    or metadata_after is distinct from metadata_before then
    raise exception 'timetable_dated_diff_projection_metadata_drift' using errcode = '55000';
  end if;
end
$dated_diff_projection$;

commit;
