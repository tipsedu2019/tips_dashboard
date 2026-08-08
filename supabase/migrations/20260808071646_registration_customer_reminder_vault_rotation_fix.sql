begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.configure_registration_customer_reminder_worker_secret_v1(
  p_secret text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url constant text :=
    'https://tipsdashboard.vercel.app/api/solapi/registration/reminders/worker';
  v_url_id uuid;
  v_secret_id uuid;
  v_url_count integer;
  v_secret_count integer;
begin
  if (select auth.role()) <> 'service_role'
    or p_secret is null
    or pg_catalog.octet_length(p_secret) < 32
    or pg_catalog.octet_length(p_secret) > 256
    or p_secret ~ '[[:space:]]' then
    raise exception 'registration_customer_reminder_worker_secret_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-reminder-worker-secret-v1', 0)
  );

  select secret.id
  into v_url_id
  from vault.secrets secret
  where secret.name = 'registration_customer_reminder_worker_url'
  order by secret.id
  limit 1;

  select pg_catalog.count(*)::integer
  into v_url_count
  from vault.secrets secret
  where secret.name = 'registration_customer_reminder_worker_url';

  select secret.id
  into v_secret_id
  from vault.secrets secret
  where secret.name = 'registration_customer_reminder_worker_bearer_secret'
  order by secret.id
  limit 1;

  select pg_catalog.count(*)::integer
  into v_secret_count
  from vault.secrets secret
  where secret.name = 'registration_customer_reminder_worker_bearer_secret';

  if v_url_count > 1 or v_secret_count > 1 then
    raise exception 'registration_customer_reminder_worker_vault_ambiguous'
      using errcode = '55000';
  end if;

  if v_url_id is null then
    perform vault.create_secret(
      v_url,
      'registration_customer_reminder_worker_url',
      'TIPS registration reminder worker URL'
    );
  else
    perform vault.update_secret(
      secret_id => v_url_id,
      new_secret => v_url,
      new_name => 'registration_customer_reminder_worker_url',
      new_description => 'TIPS registration reminder worker URL'
    );
  end if;

  if v_secret_id is null then
    perform vault.create_secret(
      p_secret,
      'registration_customer_reminder_worker_bearer_secret',
      'TIPS registration reminder worker bearer secret'
    );
  else
    perform vault.update_secret(
      secret_id => v_secret_id,
      new_secret => p_secret,
      new_name => 'registration_customer_reminder_worker_bearer_secret',
      new_description => 'TIPS registration reminder worker bearer secret'
    );
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

alter function public.configure_registration_customer_reminder_worker_secret_v1(text)
  owner to postgres;
revoke all on function public.configure_registration_customer_reminder_worker_secret_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.configure_registration_customer_reminder_worker_secret_v1(text)
  to service_role;

commit;
