begin;

create or replace function public.assign_registration_track_director(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
    p_track_id,
    p_director_profile_id,
    p_assignment_source,
    p_rule_key,
    p_expected_common_revision,
    p_request_key
  );
exception
  when serialization_failure then
    if sqlerrm = 'registration_director_default_stale' then
      raise exception 'registration_director_default_stale' using errcode = 'P0001';
    else
      raise;
    end if;
end;
$$;

revoke execute on function public.assign_registration_track_director(
  uuid, uuid, text, text, integer, text
) from public, anon;
grant execute on function public.assign_registration_track_director(
  uuid, uuid, text, text, integer, text
) to authenticated;

commit;