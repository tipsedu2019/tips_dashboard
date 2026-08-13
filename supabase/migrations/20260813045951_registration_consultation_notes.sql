alter table public.ops_registration_consultations
  add column note text;

revoke execute on function public.save_registration_consultation_details_v1(uuid, text, text, text)
  from public, anon, authenticated;
drop function public.save_registration_consultation_details_v1(uuid, text, text, text);

revoke execute on function dashboard_private.save_registration_consultation_details_impl(uuid, text, text, text)
  from public, anon, authenticated;
drop function dashboard_private.save_registration_consultation_details_impl(uuid, text, text, text);

create function dashboard_private.save_registration_consultation_details_impl(
  p_consultation_id uuid,
  p_status text,
  p_outcome text,
  p_note text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_consultation public.ops_registration_consultations%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_request_key), '') is null
    or p_status not in ('waiting', 'scheduled', 'completed', 'canceled')
    or (
      p_status = 'completed'
      and p_outcome not in ('enrollment', 'waiting', 'not_registered')
    )
    or (p_status <> 'completed' and p_outcome is not null)
    or (p_status <> 'completed' and v_note is not null)
  then
    raise exception 'registration_consultation_details_invalid' using errcode = '22023';
  end if;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  where consultation.id = p_consultation_id
  for update of consultation, track;
  if not found then
    raise exception 'registration_consultation_not_found' using errcode = 'P0002';
  end if;

  select track.*
  into strict v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_consultation.track_id;

  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    v_track.id,
    'complete_consultation'
  );

  update public.ops_registration_consultations
  set
    status = p_status,
    outcome = p_outcome,
    note = v_note,
    completed_at = case
      when p_status = 'completed' then coalesce(completed_at, pg_catalog.now())
      else null
    end,
    updated_at = pg_catalog.now()
  where id = p_consultation_id
  returning * into v_consultation;

  perform dashboard_private.write_registration_track_event(
    v_track.task_id,
    v_track.id,
    'registration_consultation_details_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'consultationId', p_consultation_id,
      'status', p_status,
      'outcome', p_outcome
    )
  );

  return pg_catalog.jsonb_build_object(
    'consultationId', v_consultation.id,
    'trackId', v_track.id,
    'status', v_consultation.status,
    'outcome', v_consultation.outcome,
    'note', v_consultation.note
  );
end;
$$;

revoke execute on function dashboard_private.save_registration_consultation_details_impl(uuid, text, text, text, text)
  from public, anon, authenticated;

create function public.save_registration_consultation_details_v1(
  p_consultation_id uuid,
  p_status text,
  p_outcome text,
  p_note text,
  p_request_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select dashboard_private.save_registration_consultation_details_impl($1, $2, $3, $4, $5);
$$;

alter function public.save_registration_consultation_details_v1(uuid, text, text, text, text)
  owner to postgres;

revoke execute on function public.save_registration_consultation_details_v1(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.save_registration_consultation_details_v1(uuid, text, text, text, text)
  to authenticated;
