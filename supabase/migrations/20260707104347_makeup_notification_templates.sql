alter table public.makeup_notification_settings
  add column if not exists title_template text not null default '',
  add column if not exists body_template text not null default '';

update public.makeup_notification_settings
set title_template = case trigger_kind
  when 'submitted' then '휴보강 신청서가 올라왔습니다'
  when 'approved' then '휴보강 신청서가 결재 승인되어 자동 처리되었습니다'
  when 'returned' then '휴보강 신청서 보완 요청이 도착했습니다'
  when 'rejected' then '휴보강 신청서가 반려되었습니다'
  when 'completed' then '휴보강 신청서가 결재 승인되어 자동 처리되었습니다'
  when 'canceled' then '휴보강 승인이 취소되었습니다'
  else '{프로세스}'
end
where coalesce(title_template, '') = '';

update public.makeup_notification_settings
set body_template = '{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강'
where coalesce(body_template, '') = '';

notify pgrst, 'reload schema';
