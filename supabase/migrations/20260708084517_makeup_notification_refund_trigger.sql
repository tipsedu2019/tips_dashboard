alter table public.makeup_notification_settings
  drop constraint if exists makeup_notification_settings_trigger_kind_check;

alter table public.makeup_notification_settings
  add constraint makeup_notification_settings_trigger_kind_check
  check (trigger_kind in ('submitted', 'approved', 'returned', 'rejected', 'completed', 'canceled', 'refund_requested'));

insert into public.makeup_notification_settings (trigger_kind, channel, enabled, title_template, body_template)
select trigger_kind, channel, true, '휴보강 환불 신청이 올라왔습니다', '{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강'
from unnest(array['refund_requested']::text[]) trigger_kind
cross join unnest(array[
  'dashboard_personal',
  'dashboard_management',
  'google_chat_executive',
  'google_chat_admin',
  'google_chat_math',
  'google_chat_english'
]::text[]) channel
on conflict (trigger_kind, channel) do nothing;

update public.makeup_notification_settings
set
  title_template = '휴보강 환불 신청이 올라왔습니다',
  body_template = '{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강'
where trigger_kind = 'refund_requested'
  and (coalesce(title_template, '') = '' or coalesce(body_template, '') = '');

notify pgrst, 'reload schema';
