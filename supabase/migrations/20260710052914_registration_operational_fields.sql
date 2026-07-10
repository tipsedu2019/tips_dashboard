alter table public.ops_registration_details
  add column if not exists textbook_preparation text
    check (
      textbook_preparation is null
      or textbook_preparation in (
        '전부 학원에서 준비',
        '개인적으로 준비',
        '일부만 학원에서 준비(메모 확인 필수)'
      )
    ),
  add column if not exists visit_consultation_place text
    check (
      visit_consultation_place is null
      or visit_consultation_place in ('본관', '별관')
    ),
  add column if not exists timetable_roster_updated boolean not null default false;

create index if not exists ops_registration_details_visit_consultation_at_idx
  on public.ops_registration_details(visit_consultation_at);

create index if not exists ops_registration_details_class_start_date_idx
  on public.ops_registration_details(class_start_date);
