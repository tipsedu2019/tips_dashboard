begin;

create or replace function public.prevent_registration_compatibility_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_projection jsonb;
begin
  if tg_relid = 'public.ops_tasks'::regclass then
    v_task_id := new.id;
  elsif tg_relid = 'public.ops_registration_details'::regclass then
    v_task_id := new.task_id;
  else
    raise exception 'registration_compatibility_trigger_table_invalid' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
  ) then
    return new;
  end if;

  v_projection := dashboard_private.derive_registration_parent_projection(v_task_id);
  if tg_relid = 'public.ops_tasks'::regclass then
    if new.subject is distinct from v_projection ->> 'subject'
      or new.class_id is distinct from nullif(v_projection ->> 'classId', '')::uuid
      or new.textbook_id is distinct from nullif(v_projection ->> 'textbookId', '')::uuid
      or new.secondary_assignee_id is distinct from nullif(v_projection ->> 'secondaryAssigneeId', '')::uuid
    then
      raise exception 'registration_compatibility_override_denied' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.pipeline_status is distinct from v_projection ->> 'pipelineStatus'
    or new.counselor is distinct from nullif(v_projection ->> 'counselor', '')
    or new.makeedu_registered is distinct from coalesce((v_projection ->> 'makeeduRegistered')::boolean, false)
    or new.makeedu_invoice_sent is distinct from coalesce((v_projection ->> 'makeeduInvoiceSent')::boolean, false)
    or new.payment_checked is distinct from coalesce((v_projection ->> 'paymentChecked')::boolean, false)
    or new.level_test_at is distinct from old.level_test_at
    or new.level_test_place is distinct from old.level_test_place
    or new.level_test_material_link is distinct from old.level_test_material_link
    or new.level_test_completed_at is distinct from old.level_test_completed_at
    or new.level_test_result is distinct from old.level_test_result
    or new.phone_consultation_at is distinct from old.phone_consultation_at
    or new.visit_consultation_at is distinct from old.visit_consultation_at
    or new.visit_consultation_place is distinct from old.visit_consultation_place
    or new.consultation_at is distinct from old.consultation_at
    or new.class_start_date is distinct from old.class_start_date
    or new.class_start_session is distinct from old.class_start_session
    or new.textbook_ready is distinct from old.textbook_ready
    or new.textbook_preparation is distinct from old.textbook_preparation
    or new.textbook_billing_issued is distinct from old.textbook_billing_issued
    or new.timetable_roster_updated is distinct from old.timetable_roster_updated
  then
    raise exception 'registration_compatibility_override_denied' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter function public.prevent_registration_compatibility_override() owner to postgres;
revoke execute on function public.prevent_registration_compatibility_override()
  from public, anon, authenticated;

commit;
