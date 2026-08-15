begin;

do $$
begin
  if exists (
    select 1
    from dashboard_private.registration_customer_solapi_activation activation
    where activation.mode <> 'off'
  ) then
    raise exception 'registration_customer_solapi_activation_evidence_requires_off'
      using errcode = '55000';
  end if;
end;
$$;

create table dashboard_private.registration_customer_solapi_activation_evidence (
  id uuid primary key default gen_random_uuid(),
  message_kind text not null check (message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder',
    'waiting_notice',
    'admission_application',
    'observation_booking',
    'observation_reminder'
  )),
  template_id text not null check (nullif(pg_catalog.btrim(template_id), '') is not null),
  pf_id text not null check (nullif(pg_catalog.btrim(pf_id), '') is not null),
  template_checksum text not null check (template_checksum ~ '^[a-f0-9]{64}$'),
  rendered_variables_checksum text not null check (rendered_variables_checksum ~ '^[a-f0-9]{64}$'),
  rendered_body_checksum text not null check (rendered_body_checksum ~ '^[a-f0-9]{64}$'),
  rendered_buttons_checksum text not null check (rendered_buttons_checksum ~ '^[a-f0-9]{64}$'),
  provider_payload_checksum text not null check (provider_payload_checksum ~ '^[a-f0-9]{64}$'),
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  provider_message_id text not null check (nullif(pg_catalog.btrim(provider_message_id), '') is not null),
  provider_status_code text not null check (nullif(pg_catalog.btrim(provider_status_code), '') is not null),
  verified_at timestamptz not null,
  verified_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index registration_customer_solapi_activation_evidence_kind_verified_idx
  on dashboard_private.registration_customer_solapi_activation_evidence(
    message_kind,
    verified_at desc
  );

alter table public.ops_registration_customer_messages
  add column provider_payload_checksum text,
  add constraint ops_registration_customer_messages_provider_payload_checksum_check
    check (
      provider_payload_checksum is null
      or provider_payload_checksum ~ '^[a-f0-9]{64}$'
    );

alter table dashboard_private.registration_customer_solapi_activation
  drop constraint registration_customer_solapi_activation_shape_check,
  add column activation_evidence_id uuid,
  add constraint registration_customer_solapi_activation_evidence_fkey
    foreign key (activation_evidence_id)
    references dashboard_private.registration_customer_solapi_activation_evidence(id)
    on delete restrict;

do $$
declare
  v_constraint_name text;
begin
  select constraint_row.conname
  into v_constraint_name
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_attribute attribute_row
    on attribute_row.attrelid = constraint_row.conrelid
   and attribute_row.attnum = any(constraint_row.conkey)
  where constraint_row.conrelid =
      'dashboard_private.registration_customer_solapi_activation'::pg_catalog.regclass
    and constraint_row.contype = 'f'
    and attribute_row.attname = 'verification_task_id';

  if v_constraint_name is not null then
    execute pg_catalog.format(
      'alter table dashboard_private.registration_customer_solapi_activation drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$$;

alter table dashboard_private.registration_customer_solapi_activation
  drop column live_test_message_id,
  drop column live_test_confirmed_at,
  add constraint registration_customer_solapi_activation_shape_check check (
    (
      mode = 'off'
      and verification_task_id is null
      and verification_recipient_hash is null
    )
    or (
      mode = 'verification'
      and verification_task_id is not null
      and verification_recipient_hash is not null
      and activation_evidence_id is null
      and updated_by is not null
    )
    or (
      mode = 'live'
      and verification_task_id is null
      and verification_recipient_hash is null
      and activation_evidence_id is not null
      and updated_by is not null
    )
  );

alter table dashboard_private.registration_customer_solapi_activation_evidence
  owner to postgres;
alter table dashboard_private.registration_customer_solapi_activation_evidence
  enable row level security;
revoke all on table dashboard_private.registration_customer_solapi_activation_evidence
  from public, anon, authenticated, service_role;

commit;
