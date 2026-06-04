with preset_rules as (
  select *
  from (
    values
      (
        '11111111-2844-4000-9000-000000000001'::uuid,
        '등록 완료 후 첫 인사',
        'registration',
        'registration.completed',
        'all',
        'task.registration.classStartDate',
        5,
        '18:00',
        'teacher',
        '/admin/registration',
        '{studentName} 첫 인사 및 안내 전화',
        'high',
        jsonb_build_array('수업 시작일과 반 안내', '교재/등원 준비 안내', '통화 기록 남기기')
      ),
      (
        '11111111-2844-4000-9000-000000000002'::uuid,
        '전반 완료 후 인수인계',
        'transfer',
        'transfer.completed',
        'all',
        'task.transfer.toClassStartDate',
        2,
        '18:00',
        'teacher',
        '/admin/transfer',
        '{studentName} 전반 인수인계 확인',
        'high',
        jsonb_build_array('전 수업 종료/후 수업 시작 확인', '새 담당 선생님 전달사항 확인', '첫 수업 후 적응 여부 기록')
      ),
      (
        '11111111-2844-4000-9000-000000000003'::uuid,
        '퇴원 완료 후 정산 정리',
        'withdrawal',
        'withdrawal.completed',
        'admin',
        'task.withdrawal.withdrawalDate',
        1,
        '17:00',
        'operator',
        '/admin/withdrawal',
        '{studentName} 퇴원 정산 및 자료 정리 확인',
        'high',
        jsonb_build_array('미납/환불 여부 확인', '미배부 교재 확인', 'MakeEdu/학생 상태 정리 확인')
      ),
      (
        '11111111-2844-4000-9000-000000000004'::uuid,
        '재시험 완료 후 결과 안내',
        'word_retest',
        'word_retest.completed',
        'english',
        'task.wordRetest.testAt',
        0,
        '21:00',
        'teacher',
        '/admin/word-retests',
        '{studentName} 재시험 결과 확인 및 안내',
        'normal',
        jsonb_build_array('점수 입력 확인', '담당 선생님 결과 확인', '필요 시 학부모 안내')
      ),
      (
        '11111111-2844-4000-9000-000000000005'::uuid,
        '수업계획 확정 후 자료 준비',
        'curriculum',
        'curriculum.plan_saved',
        'all',
        'event.classItem.nextSessionDate',
        -1,
        '18:00',
        'teacher',
        '/admin/curriculum',
        '{className} 다음 수업 자료 준비',
        'normal',
        jsonb_build_array('다음 회차 범위 확인', '자료/숙제 준비', '특이사항 공유')
      )
  ) as rule_data (
    id,
    name,
    target,
    trigger_key,
    team_key,
    due_basis,
    offset_days,
    due_time,
    assignee_strategy,
    related_route,
    title,
    priority,
    checklist
  )
)
insert into public.ops_task_automation_rules (
  id,
  name,
  kind,
  target,
  trigger_key,
  enabled,
  recurrence,
  conditions,
  action,
  assignee,
  due,
  notification,
  notification_channel_id
)
select
  preset_rules.id,
  preset_rules.name,
  'trigger',
  preset_rules.target,
  preset_rules.trigger_key,
  true,
  '{}'::jsonb,
  jsonb_build_object(
    'event', preset_rules.trigger_key,
    'duplicatePolicy', 'update_due',
    'required', jsonb_build_array(preset_rules.due_basis),
    'skipStateBoardMirroring', true
  ),
  jsonb_build_object(
    'type', 'create_follow_up_task',
    'title', preset_rules.title,
    'priority', preset_rules.priority,
    'checklist', preset_rules.checklist,
    'relatedRoute', preset_rules.related_route
  ),
  jsonb_build_object(
    'strategy', preset_rules.assignee_strategy
  ),
  jsonb_build_object(
    'basis', preset_rules.due_basis,
    'offsetDays', preset_rules.offset_days,
    'dueTime', preset_rules.due_time
  ),
  jsonb_build_object(
    'enabled', true,
    'teamKey', preset_rules.team_key,
    'secretRef', 'google_chat_webhook:' || preset_rules.team_key
  ),
  channels.id
from preset_rules
left join public.ops_task_notification_channels channels
  on channels.team_key = preset_rules.team_key
on conflict (id) do update
set
  name = excluded.name,
  target = excluded.target,
  trigger_key = excluded.trigger_key,
  conditions = excluded.conditions,
  action = excluded.action,
  assignee = excluded.assignee,
  due = excluded.due,
  notification = excluded.notification,
  notification_channel_id = excluded.notification_channel_id,
  updated_at = now();
