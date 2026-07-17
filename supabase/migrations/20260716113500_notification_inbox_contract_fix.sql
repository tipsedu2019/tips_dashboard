begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.visible_dashboard_notification_rows_v1(
  p_profile_id uuid
)
returns table (
  id uuid,
  recipient_profile_id uuid,
  recipient_team text,
  actor_profile_id uuid,
  notification_type text,
  title text,
  body text,
  href text,
  metadata jsonb,
  legacy_read_at timestamptz,
  receipt_read_at timestamptz,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.id,
    notification.recipient_profile_id,
    notification.recipient_team,
    notification.actor_profile_id,
    notification.type as notification_type,
    notification.title,
    notification.body,
    notification.href,
    notification.metadata,
    notification.read_at as legacy_read_at,
    receipt.read_at as receipt_read_at,
    coalesce(receipt.read_at, notification.read_at) as read_at,
    notification.created_at
  from public.dashboard_notifications notification
  left join public.dashboard_notification_read_receipts receipt
    on receipt.notification_id = notification.id
   and receipt.profile_id = p_profile_id
  where p_profile_id is not null
    and notification.revoked_at is null
    and notification.type <> 'registration_consultation_admin_chat'
    and (
      notification.recipient_profile_id = p_profile_id
      or (
        notification.recipient_profile_id is null
        and notification.recipient_team = '관리팀'
        and exists (
          select 1
          from public.profiles profile
          where profile.id = p_profile_id
            and profile.role in ('admin', 'staff')
        )
      )
    );
$$;

create or replace function public.get_dashboard_notification_inbox_v1(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_items jsonb;
  v_next_created_at timestamptz;
  v_next_id uuid;
  v_unread_count bigint;
begin
  if v_profile_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_limit is null
    or p_limit not between 1 and 100
    or ((p_before_created_at is null) <> (p_before_id is null))
  then
    raise exception 'notification_inbox_cursor_invalid' using errcode = '22023';
  end if;

  with page as (
    select visible.*
    from dashboard_private.visible_dashboard_notification_rows_v1(
      v_profile_id
    ) visible
    where p_before_created_at is null
       or (visible.created_at, visible.id) < (p_before_created_at, p_before_id)
    order by visible.created_at desc, visible.id desc
    limit p_limit
  ), numbered as (
    select
      page.*,
      pg_catalog.row_number() over (
        order by page.created_at desc, page.id desc
      ) as row_number
    from page
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', numbered.id,
          'recipient_profile_id', numbered.recipient_profile_id,
          'recipient_team', numbered.recipient_team,
          'actor_profile_id', numbered.actor_profile_id,
          'type', numbered.notification_type,
          'title', numbered.title,
          'body', numbered.body,
          'href', numbered.href,
          'metadata', numbered.metadata,
          'read_at', numbered.read_at,
          'created_at', numbered.created_at
        ) order by numbered.created_at desc, numbered.id desc
      ),
      '[]'::jsonb
    ),
    (
      pg_catalog.array_agg(
        numbered.created_at order by numbered.row_number desc
      )
    )[1],
    (
      pg_catalog.array_agg(
        numbered.id order by numbered.row_number desc
      )
    )[1]
  into v_items, v_next_created_at, v_next_id
  from numbered;

  select pg_catalog.count(*)
  into v_unread_count
  from dashboard_private.visible_dashboard_notification_rows_v1(
    v_profile_id
  ) visible
  where visible.read_at is null;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'unread_count', v_unread_count::text,
    'next_cursor', case
      when pg_catalog.jsonb_array_length(v_items) < p_limit then null
      else pg_catalog.jsonb_build_object(
        'created_at', v_next_created_at,
        'id', v_next_id
      )
    end
  );
end;
$$;

create or replace function public.get_dashboard_notification_unread_count_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_unread_count bigint;
begin
  if v_profile_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  select pg_catalog.count(*)
  into v_unread_count
  from dashboard_private.visible_dashboard_notification_rows_v1(
    v_profile_id
  ) visible
  where visible.read_at is null;

  return pg_catalog.jsonb_build_object(
    'unread_count', v_unread_count::text
  );
end;
$$;

create or replace function public.mark_dashboard_notification_read_v1(
  p_notification_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := (select auth.uid());
  v_effective_read_at timestamptz;
  v_read_at timestamptz;
  v_newly_read boolean := false;
  v_unread_count bigint;
begin
  if v_profile_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_notification_id is null then
    raise exception 'notification_read_invalid' using errcode = '22023';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = v_profile_id
  for share of profile;
  if not found then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.dashboard_notifications notification
  where notification.id = p_notification_id
  for share of notification;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'notification-read:'
        || p_notification_id::text
        || ':'
        || v_profile_id::text,
      0
    )
  );

  select visible.read_at
  into v_effective_read_at
  from dashboard_private.visible_dashboard_notification_rows_v1(
    v_profile_id
  ) visible
  where visible.id = p_notification_id;
  if not found then
    raise exception 'notification_not_found' using errcode = 'P0002';
  end if;

  v_read_at := v_effective_read_at;
  if v_effective_read_at is null then
    insert into public.dashboard_notification_read_receipts(
      notification_id,
      profile_id,
      read_at
    ) values (
      p_notification_id,
      v_profile_id,
      pg_catalog.clock_timestamp()
    )
    on conflict (notification_id, profile_id) do nothing
    returning read_at into v_read_at;
    v_newly_read := found;

    if v_read_at is null then
      select visible.read_at
      into v_read_at
      from dashboard_private.visible_dashboard_notification_rows_v1(
        v_profile_id
      ) visible
      where visible.id = p_notification_id;
      if not found then
        raise exception 'notification_not_found' using errcode = 'P0002';
      end if;
    end if;
  end if;

  select pg_catalog.count(*)
  into v_unread_count
  from dashboard_private.visible_dashboard_notification_rows_v1(
    v_profile_id
  ) visible
  where visible.read_at is null;

  return pg_catalog.jsonb_build_object(
    'notification_id', p_notification_id,
    'newly_read', v_newly_read,
    'read_at', v_read_at,
    'unread_count', v_unread_count::text
  );
end;
$$;

alter function dashboard_private.visible_dashboard_notification_rows_v1(uuid)
  owner to postgres;
alter function public.get_dashboard_notification_inbox_v1(
  integer,
  timestamptz,
  uuid
) owner to postgres;
alter function public.get_dashboard_notification_unread_count_v1()
  owner to postgres;
alter function public.mark_dashboard_notification_read_v1(uuid)
  owner to postgres;

revoke all on function dashboard_private.visible_dashboard_notification_rows_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_dashboard_notification_inbox_v1(
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.get_dashboard_notification_unread_count_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.mark_dashboard_notification_read_v1(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_dashboard_notification_inbox_v1(
  integer,
  timestamptz,
  uuid
) to authenticated;
grant execute on function public.get_dashboard_notification_unread_count_v1()
  to authenticated;
grant execute on function public.mark_dashboard_notification_read_v1(uuid)
  to authenticated;

commit;
