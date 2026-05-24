create or replace function public.prevent_completed_operation_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.type <> 'general'
    and old.status = 'done'
    and new.status <> 'done'
  then
    raise exception '완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_completed_operation_reopen on public.ops_tasks;
create trigger prevent_completed_operation_reopen
before update of status on public.ops_tasks
for each row execute function public.prevent_completed_operation_reopen();
