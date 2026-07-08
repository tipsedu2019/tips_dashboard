alter table public.makeup_requests
  drop constraint if exists makeup_requests_status_check;

alter table public.makeup_requests
  add constraint makeup_requests_status_check
  check (status in ('approval_pending', 'revision_requested', 'rejected', 'manager_pending', 'makeup_pending', 'refund_pending', 'completed', 'canceled'));
