alter table public.students
  add column if not exists recent_issue text not null default '';

comment on column public.students.recent_issue is '수업 상담 중 바로 확인할 학생별 최근 특이사항';
