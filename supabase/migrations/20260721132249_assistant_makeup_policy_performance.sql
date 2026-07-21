begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
    or not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'makeup_requests'
        and policy.policyname = 'makeup_requests_assistant_hard_deny'
    )
    or not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'makeup_request_events'
        and policy.policyname = 'makeup_request_events_assistant_hard_deny'
    )
    or not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'makeup_notification_settings'
        and policy.policyname = 'makeup_notification_settings_assistant_hard_deny'
    )
    or not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'makeup_notification_deliveries'
        and policy.policyname = 'makeup_notification_deliveries_assistant_hard_deny'
    )
    or not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'dashboard_notifications'
        and policy.policyname = 'dashboard_notifications_assistant_makeup_hard_deny'
    )
  then
    raise exception 'assistant_makeup_policy_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$$;

alter policy makeup_requests_assistant_hard_deny
  on public.makeup_requests
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

alter policy makeup_request_events_assistant_hard_deny
  on public.makeup_request_events
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

alter policy makeup_notification_settings_assistant_hard_deny
  on public.makeup_notification_settings
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

alter policy makeup_notification_deliveries_assistant_hard_deny
  on public.makeup_notification_deliveries
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

alter policy dashboard_notifications_assistant_makeup_hard_deny
  on public.dashboard_notifications
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
      and coalesce(
        type = 'makeup_request'
        or metadata ->> 'workflow_key' = 'makeup_requests'
        or href like '/admin/makeup-requests%',
        false
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
      and coalesce(
        type = 'makeup_request'
        or metadata ->> 'workflow_key' = 'makeup_requests'
        or href like '/admin/makeup-requests%',
        false
      )
    )
  );

commit;
