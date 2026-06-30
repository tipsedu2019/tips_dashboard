alter table public.classes
  add column if not exists class_type text not null default '정규';

comment on column public.classes.class_type is '수업 운영 DB에서 사용하는 공식 수업 유형';
