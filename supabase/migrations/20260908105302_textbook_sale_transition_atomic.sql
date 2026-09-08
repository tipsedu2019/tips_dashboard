set lock_timeout = '5s';
set statement_timeout = '30s';

-- Refuse pre-existing duplicates; never discard or rewrite stock history.
-- This small table had 124 rows and no duplicate groups at the read-only preflight.
-- The bounded transactional build also protects legacy clients during rollout.
-- squawk-ignore require-concurrent-index-creation
create unique index if not exists textbook_stock_moves_sale_transition_key
  on public.textbook_stock_moves (sale_line_id, move_type)
  where sale_line_id is not null and move_type in ('sale_issue', 'return_in');

create or replace function public.transition_textbook_sale_line_v1(
  p_sale_line_id uuid,
  p_target_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_actor uuid := auth.uid();
  v_line public.textbook_sale_lines%rowtype;
  v_issue public.textbook_stock_moves%rowtype;
  v_return public.textbook_stock_moves%rowtype;
begin
  if v_actor is null or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff') then
    raise exception using errcode = '42501', message = 'textbook_sale_forbidden';
  end if;
  if p_target_status is null or p_target_status not in ('issued', 'returned') then
    raise exception using errcode = '22023', message = 'textbook_sale_target_invalid';
  end if;

  -- Serialize this lifecycle while remaining compatible with child FK key-share locks.
  select * into v_line from public.textbook_sale_lines
  where id = p_sale_line_id for no key update;
  if not found then
    raise exception using errcode = 'P0002', message = 'textbook_sale_not_found';
  end if;
  select * into v_issue from public.textbook_stock_moves
  where sale_line_id = v_line.id and move_type = 'sale_issue' for update;
  select * into v_return from public.textbook_stock_moves
  where sale_line_id = v_line.id and move_type = 'return_in' for update;

  if p_target_status = 'issued' then
    if v_line.status not in ('charged', 'paid', 'excluded', 'issued') or v_return.id is not null then
      raise exception using errcode = '23514', message = 'textbook_sale_state_conflict';
    end if;
    if v_line.quantity <= 0 then
      raise exception using errcode = '23514', message = 'textbook_sale_quantity_invalid';
    end if;
    if v_issue.id is not null then
      if row(v_issue.textbook_id, v_issue.location_id, v_issue.copy_scope, v_issue.quantity, v_issue.unit_amount, v_issue.amount)
        is distinct from row(v_line.textbook_id, v_line.location_id, v_line.copy_scope, -v_line.quantity, v_line.unit_price, -v_line.quantity * v_line.unit_price) then
        raise exception using errcode = '23514', message = 'textbook_sale_stock_conflict';
      end if;
    elsif v_line.status = 'issued' then
      raise exception using errcode = '23514', message = 'textbook_sale_stock_conflict';
    else
      insert into public.textbook_stock_moves
        (textbook_id, location_id, sale_line_id, move_type, quantity, unit_amount, amount, memo, copy_scope, created_by)
      values (v_line.textbook_id, v_line.location_id, v_line.id, 'sale_issue', -v_line.quantity,
        v_line.unit_price, -v_line.quantity * v_line.unit_price, v_line.teacher_name, v_line.copy_scope, v_actor);
    end if;
  else
    if v_line.status not in ('issued', 'returned') then
      raise exception using errcode = '23514', message = 'textbook_sale_state_conflict';
    end if;
    if v_issue.id is null or v_issue.quantity >= 0 then
      raise exception using errcode = '23514', message = 'textbook_sale_stock_conflict';
    end if;
    if v_return.id is not null then
      if row(v_return.textbook_id, v_return.location_id, v_return.copy_scope, v_return.quantity, v_return.unit_amount, v_return.amount)
        is distinct from row(v_issue.textbook_id, v_issue.location_id, v_issue.copy_scope, -v_issue.quantity, v_issue.unit_amount, -v_issue.amount) then
        raise exception using errcode = '23514', message = 'textbook_sale_stock_conflict';
      end if;
    elsif v_line.status = 'returned' then
      raise exception using errcode = '23514', message = 'textbook_sale_stock_conflict';
    else
      -- Reverse the actual issue, even if a later edit changed the sale line.
      insert into public.textbook_stock_moves
        (textbook_id, location_id, sale_line_id, move_type, quantity, unit_amount, amount, memo, copy_scope, created_by)
      values (v_issue.textbook_id, v_issue.location_id, v_line.id, 'return_in', -v_issue.quantity,
        v_issue.unit_amount, -v_issue.amount, v_issue.memo, v_issue.copy_scope, v_actor);
    end if;
  end if;

  if v_line.status is distinct from p_target_status then
    update public.textbook_sale_lines set status = p_target_status
    where id = v_line.id returning * into v_line;
    if not found then
      raise exception using errcode = '42501', message = 'textbook_sale_forbidden';
    end if;
  end if;
  return to_jsonb(v_line);
end;
$$;

revoke all on function public.transition_textbook_sale_line_v1(uuid, text) from public, anon;
grant execute on function public.transition_textbook_sale_line_v1(uuid, text) to authenticated;
notify pgrst, 'reload schema';
