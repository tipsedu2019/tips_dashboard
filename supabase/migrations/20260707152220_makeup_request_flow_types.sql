alter table public.makeup_requests
  add column if not exists request_kind text not null default 'cancel_makeup';

alter table public.makeup_requests
  drop constraint if exists makeup_requests_request_kind_check;

alter table public.makeup_requests
  add constraint makeup_requests_request_kind_check
  check (request_kind in ('cancel_makeup', 'cancel_only', 'makeup_only'));

alter table public.makeup_requests
  drop constraint if exists makeup_requests_status_check;

alter table public.makeup_requests
  add constraint makeup_requests_status_check
  check (status in ('approval_pending', 'revision_requested', 'rejected', 'manager_pending', 'makeup_pending', 'completed', 'canceled'));

alter table public.makeup_requests
  alter column cancel_date drop not null,
  alter column makeup_start_at drop not null,
  alter column makeup_end_at drop not null,
  alter column makeup_classroom drop not null;

alter table public.makeup_requests
  drop constraint if exists makeup_requests_time_check;

alter table public.makeup_requests
  add constraint makeup_requests_time_check
  check (
    makeup_start_at is null
    or makeup_end_at is null
    or makeup_end_at > makeup_start_at
  );

create index if not exists makeup_requests_kind_idx
  on public.makeup_requests(request_kind);

delete from public.academic_events event
where event.note like '%[[TIPS_MAKEUP]]%'
  and (substring(event.note from '\[\[TIPS_MAKEUP\]\]\s*(\{.*\})')::jsonb ->> 'kind') = 'makeup'
  and not exists (
    select 1
    from public.makeup_requests request
    where request.id::text = (substring(event.note from '\[\[TIPS_MAKEUP\]\]\s*(\{.*\})')::jsonb ->> 'requestId')
  );
