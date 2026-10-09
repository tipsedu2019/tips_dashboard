-- pg-delta: transaction=false
-- Execute only through the pinned CLI; this phase commits independently.
set lock_timeout = '5s';
set statement_timeout = '120s';

do $registration_index_executor$
begin
  if not pg_catalog.pg_try_advisory_lock(20261004, 140440) then
    raise exception 'registration_index_executor_busy' using errcode = '55P03';
  end if;
end;
$registration_index_executor$;

-- Retain this session lock through the core file and ledger inserts. The CLI
-- closes its connection on success or failure; never unlock between phases.
-- Certify initial and interrupted states before any index DDL.
do $registration_index_online_pre$
declare
  v_spec record;
  v_index oid;
begin
  perform pg_catalog.set_config('search_path', '', true);
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ops_registration_subject_tracks'::regclass
      and conname = 'ops_registration_subject_tracks_observation_return_workflow_pai'
  ) then
    raise exception 'registration_index_phase_core_changed' using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('public.ops_registration_observations_scheduled_track_key') is null
    and not exists (
      select 1 from pg_catalog.pg_index
      where indexrelid = pg_catalog.to_regclass('public.ops_registration_observations_open_track_key')
        and indisvalid and indisready and indislive
    ) then
    raise exception 'registration_index_phase_no_valid_fence' using errcode = '55000';
  end if;
  for v_spec in
    select * from (values
      ('ops_registration_observations_open_track_key', 'CREATE UNIQUE INDEX ops_registration_observations_open_track_key ON public.ops_registration_observations USING btree (track_id) WHERE ((decision_kind IS NULL) AND (status = ANY (ARRAY[''scheduled''::text, ''attended_feedback_pending''::text, ''completed''::text, ''no_show''::text])))', false, false, false),
      ('ops_registration_observations_scheduled_track_key', 'CREATE UNIQUE INDEX ops_registration_observations_scheduled_track_key ON public.ops_registration_observations USING btree (track_id) WHERE ((decision_kind IS NULL) AND (status = ''scheduled''::text))', false, true, false)
    ) as expected(index_name, definition, required, require_valid, forbidden)
  loop
    v_index := pg_catalog.to_regclass('public.' || v_spec.index_name);
    if v_index is null then
      if v_spec.required then
        raise exception 'registration_index_phase_fence_missing: %', v_spec.index_name using errcode = '55000';
      end if;
    elsif v_spec.forbidden then
      raise exception 'registration_index_phase_fence_unexpected: %', v_spec.index_name using errcode = '55000';
    elsif not exists (
      select 1 from pg_catalog.pg_index i
      where i.indexrelid = v_index
        and i.indrelid = 'public.ops_registration_observations'::regclass
        and pg_catalog.pg_get_indexdef(i.indexrelid) = v_spec.definition
        and (not v_spec.require_valid or (i.indisvalid and i.indisready and i.indislive))
        and exists (select 1 from pg_catalog.pg_class c where c.oid = i.indexrelid and c.relkind = 'i' and not c.relispartition)
        and not exists (select 1 from pg_catalog.pg_constraint c where c.conindid = i.indexrelid)
        and not exists (select 1 from pg_catalog.pg_depend d where d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = i.indexrelid)
        and not exists (select 1 from pg_catalog.pg_inherits h where h.inhrelid = i.indexrelid or h.inhparent = i.indexrelid)
    ) then
      raise exception 'registration_index_phase_fence_drift_or_invalid: %', v_spec.index_name using errcode = '55000';
    end if;
  end loop;
end;
$registration_index_online_pre$;

create unique index concurrently if not exists ops_registration_observations_scheduled_track_key
  on public.ops_registration_observations(track_id)
  where decision_kind is null and status = 'scheduled';

do $registration_index_built$
declare
  v_spec record;
  v_index oid;
begin
  perform pg_catalog.set_config('search_path', '', true);
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ops_registration_subject_tracks'::regclass
      and conname = 'ops_registration_subject_tracks_observation_return_workflow_pai'
  ) then
    raise exception 'registration_index_phase_core_changed' using errcode = '55000';
  end if;
  for v_spec in
    select * from (values
      ('ops_registration_observations_open_track_key', 'CREATE UNIQUE INDEX ops_registration_observations_open_track_key ON public.ops_registration_observations USING btree (track_id) WHERE ((decision_kind IS NULL) AND (status = ANY (ARRAY[''scheduled''::text, ''attended_feedback_pending''::text, ''completed''::text, ''no_show''::text])))', false, false, false),
      ('ops_registration_observations_scheduled_track_key', 'CREATE UNIQUE INDEX ops_registration_observations_scheduled_track_key ON public.ops_registration_observations USING btree (track_id) WHERE ((decision_kind IS NULL) AND (status = ''scheduled''::text))', true, true, false)
    ) as expected(index_name, definition, required, require_valid, forbidden)
  loop
    v_index := pg_catalog.to_regclass('public.' || v_spec.index_name);
    if v_index is null then
      if v_spec.required then
        raise exception 'registration_index_phase_fence_missing: %', v_spec.index_name using errcode = '55000';
      end if;
    elsif v_spec.forbidden then
      raise exception 'registration_index_phase_fence_unexpected: %', v_spec.index_name using errcode = '55000';
    elsif not exists (
      select 1 from pg_catalog.pg_index i
      where i.indexrelid = v_index
        and i.indrelid = 'public.ops_registration_observations'::regclass
        and pg_catalog.pg_get_indexdef(i.indexrelid) = v_spec.definition
        and (not v_spec.require_valid or (i.indisvalid and i.indisready and i.indislive))
        and exists (select 1 from pg_catalog.pg_class c where c.oid = i.indexrelid and c.relkind = 'i' and not c.relispartition)
        and not exists (select 1 from pg_catalog.pg_constraint c where c.conindid = i.indexrelid)
        and not exists (select 1 from pg_catalog.pg_depend d where d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = i.indexrelid)
        and not exists (select 1 from pg_catalog.pg_inherits h where h.inhrelid = i.indexrelid or h.inhparent = i.indexrelid)
    ) then
      raise exception 'registration_index_phase_fence_drift_or_invalid: %', v_spec.index_name using errcode = '55000';
    end if;
  end loop;
end;
$registration_index_built$;

drop index concurrently if exists public.ops_registration_observations_open_track_key;

do $registration_index_online_post$
declare
  v_spec record;
  v_index oid;
begin
  perform pg_catalog.set_config('search_path', '', true);
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ops_registration_subject_tracks'::regclass
      and conname = 'ops_registration_subject_tracks_observation_return_workflow_pai'
  ) then
    raise exception 'registration_index_phase_core_changed' using errcode = '55000';
  end if;
  for v_spec in
    select * from (values
      ('ops_registration_observations_open_track_key', 'CREATE UNIQUE INDEX ops_registration_observations_open_track_key ON public.ops_registration_observations USING btree (track_id) WHERE ((decision_kind IS NULL) AND (status = ANY (ARRAY[''scheduled''::text, ''attended_feedback_pending''::text, ''completed''::text, ''no_show''::text])))', false, false, true),
      ('ops_registration_observations_scheduled_track_key', 'CREATE UNIQUE INDEX ops_registration_observations_scheduled_track_key ON public.ops_registration_observations USING btree (track_id) WHERE ((decision_kind IS NULL) AND (status = ''scheduled''::text))', true, true, false)
    ) as expected(index_name, definition, required, require_valid, forbidden)
  loop
    v_index := pg_catalog.to_regclass('public.' || v_spec.index_name);
    if v_index is null then
      if v_spec.required then
        raise exception 'registration_index_phase_fence_missing: %', v_spec.index_name using errcode = '55000';
      end if;
    elsif v_spec.forbidden then
      raise exception 'registration_index_phase_fence_unexpected: %', v_spec.index_name using errcode = '55000';
    elsif not exists (
      select 1 from pg_catalog.pg_index i
      where i.indexrelid = v_index
        and i.indrelid = 'public.ops_registration_observations'::regclass
        and pg_catalog.pg_get_indexdef(i.indexrelid) = v_spec.definition
        and (not v_spec.require_valid or (i.indisvalid and i.indisready and i.indislive))
        and exists (select 1 from pg_catalog.pg_class c where c.oid = i.indexrelid and c.relkind = 'i' and not c.relispartition)
        and not exists (select 1 from pg_catalog.pg_constraint c where c.conindid = i.indexrelid)
        and not exists (select 1 from pg_catalog.pg_depend d where d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = i.indexrelid)
        and not exists (select 1 from pg_catalog.pg_inherits h where h.inhrelid = i.indexrelid or h.inhparent = i.indexrelid)
    ) then
      raise exception 'registration_index_phase_fence_drift_or_invalid: %', v_spec.index_name using errcode = '55000';
    end if;
  end loop;
end;
$registration_index_online_post$;

reset lock_timeout;
reset statement_timeout;
