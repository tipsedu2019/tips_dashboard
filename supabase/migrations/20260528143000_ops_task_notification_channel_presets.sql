insert into public.ops_task_notification_channels (
  name,
  team_key,
  description,
  webhook_secret_ref,
  is_active
) values
  ('[팁스] 조교팀', 'assistants', 'Google Chat [팁스] 조교팀', 'google_chat_webhook:assistants', true),
  ('[팁스] 영어팀', 'english', 'Google Chat [팁스] 영어팀', 'google_chat_webhook:english', true),
  ('[팁스] 수학팀', 'math', 'Google Chat [팁스] 수학팀', 'google_chat_webhook:math', true),
  ('[팁스] 관리팀', 'admin', 'Google Chat [팁스] 관리팀', 'google_chat_webhook:admin', true),
  ('[팁스] 전체 공지', 'all', 'Google Chat [팁스] 전체 공지', 'google_chat_webhook:all', true)
on conflict (team_key) do update
set
  name = excluded.name,
  description = coalesce(nullif(public.ops_task_notification_channels.description, ''), excluded.description),
  webhook_secret_ref = coalesce(nullif(public.ops_task_notification_channels.webhook_secret_ref, ''), excluded.webhook_secret_ref),
  updated_at = now();
