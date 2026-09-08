begin;
set lock_timeout = '5s';
set statement_timeout = '30s';

-- A receipt survives deletion of the count, so a delayed retry cannot recreate it.
create table public.textbook_stock_count_requests (
  request_id uuid primary key,
  actor_id uuid not null,
  intent jsonb not null,
  count_id uuid references public.textbook_stock_counts(id) on delete set null
);
-- The receipt table is created empty in this transaction; there are no existing writers.
-- squawk-ignore require-concurrent-index-creation
create index textbook_stock_count_requests_count_idx on public.textbook_stock_count_requests(count_id) where count_id is not null;
alter table public.textbook_stock_count_requests enable row level security;
revoke all on public.textbook_stock_count_requests from public, anon, authenticated;
grant select, insert on public.textbook_stock_count_requests to authenticated;
create policy textbook_count_receipt_read on public.textbook_stock_count_requests for select to authenticated
  using ((select public.current_dashboard_role()) in ('admin','staff'));
create policy textbook_count_receipt_insert on public.textbook_stock_count_requests for insert to authenticated
  with check (actor_id=(select auth.uid()) and (select public.current_dashboard_role()) in ('admin','staff'));

create function public.create_textbook_stock_count_v1(
  p_request_id uuid, p_textbook_id uuid, p_location_id uuid,
  p_expected_quantity integer, p_counted_quantity integer, p_counted_at date,
  p_unit_amount numeric, p_memo text
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
  v_actor uuid := auth.uid();
  v_intent jsonb;
  v_receipt public.textbook_stock_count_requests%rowtype;
  v_count public.textbook_stock_counts%rowtype;
  v_current bigint;
  v_difference bigint;
  v_move_id uuid;
begin
  if v_actor is null or public.current_dashboard_role() is null or public.current_dashboard_role() not in ('admin','staff') then
    raise exception using errcode='42501', message='textbook_count_forbidden';
  end if;
  if p_request_id is null or p_textbook_id is null or p_expected_quantity is null or p_counted_quantity is null
    or p_counted_quantity<0 or p_counted_at is null or not isfinite(p_counted_at)
    or p_unit_amount is null or p_unit_amount<0 or p_unit_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='22023', message='textbook_count_input_invalid';
  end if;
  -- Expected balance and price are refreshed read data, not a new user intent on retry.
  v_intent := jsonb_build_object('textbookId',p_textbook_id,'locationId',p_location_id,
    'countedQuantity',p_counted_quantity,'countedAt',p_counted_at,'memo',coalesce(p_memo,''));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('textbook-count-request:'||p_request_id::text,0));
  select * into v_receipt from public.textbook_stock_count_requests where request_id=p_request_id;
  if found then
    if v_receipt.actor_id<>v_actor then
      raise exception using errcode='42501', message='textbook_count_forbidden';
    end if;
    if v_receipt.intent is distinct from v_intent then
      raise exception using errcode='23514', message='textbook_count_request_conflict';
    end if;
    select * into v_count from public.textbook_stock_counts where id=v_receipt.count_id for share;
    if not found then
      raise exception using errcode='23514', message='textbook_count_request_deleted';
    end if;
    if v_count.textbook_id<>p_textbook_id or v_count.location_id is distinct from p_location_id
      or v_count.counted_quantity<>p_counted_quantity or v_count.counted_at<>p_counted_at or v_count.memo<>coalesce(p_memo,'')
      or (v_count.counted_quantity<>v_count.expected_quantity and v_count.adjustment_move_id is null) then
      raise exception using errcode='23514', message='textbook_count_history_conflict';
    end if;
    return to_jsonb(v_count);
  end if;

  -- Serialize counts for one book, including the all-locations view. Other ledger
  -- movements remain additive; this never replaces or rewrites a stock balance.
  perform 1 from public.textbooks where id=p_textbook_id for no key update;
  if not found then raise exception using errcode='22023', message='textbook_count_input_invalid'; end if;
  select coalesce(sum(quantity),0) into v_current from public.textbook_stock_moves
    where textbook_id=p_textbook_id and (p_location_id is null or location_id=p_location_id);
  if v_current<>p_expected_quantity then
    raise exception using errcode='23514', message='textbook_count_balance_changed';
  end if;
  v_difference := p_counted_quantity::bigint-p_expected_quantity;
  if v_difference not between -2147483648 and 2147483647 then
    raise exception using errcode='22023', message='textbook_count_input_invalid';
  end if;
  if v_difference<>0 then
    -- Preserve the existing combined student/teacher count UI and student adjustment scope.
    insert into public.textbook_stock_moves(textbook_id,location_id,move_type,quantity,unit_amount,amount,memo,created_by,copy_scope)
    values(p_textbook_id,p_location_id,'stock_adjustment',v_difference::integer,p_unit_amount,
      v_difference*p_unit_amount,coalesce(p_memo,''),v_actor,'student') returning id into v_move_id;
  end if;
  insert into public.textbook_stock_counts(id,textbook_id,location_id,expected_quantity,counted_quantity,counted_at,adjustment_move_id,memo,created_by,copy_scope)
  values(p_request_id,p_textbook_id,p_location_id,p_expected_quantity,p_counted_quantity,p_counted_at,v_move_id,coalesce(p_memo,''),v_actor,'student')
  returning * into v_count;
  insert into public.textbook_stock_count_requests(request_id,actor_id,intent,count_id)
    values(p_request_id,v_actor,v_intent,v_count.id);
  return to_jsonb(v_count);
end $$;

create function public.delete_textbook_inventory_history_v1(p_kind text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
  v_count_id uuid;
  v_book_id uuid;
  v_move_id uuid;
  v_count public.textbook_stock_counts%rowtype;
  v_move public.textbook_stock_moves%rowtype;
  v_deleted integer;
begin
  if auth.uid() is null or public.current_dashboard_role() is null or public.current_dashboard_role() not in ('admin','staff') then
    raise exception using errcode='42501', message='textbook_count_forbidden';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('count','move') then
    raise exception using errcode='22023', message='textbook_count_input_invalid';
  end if;
  if p_kind='count' then v_count_id:=p_id;
  else select id into v_count_id from public.textbook_stock_counts where adjustment_move_id=p_id order by id limit 1;
  end if;
  if v_count_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('textbook-count-request:'||v_count_id::text,0));
    select textbook_id into v_book_id from public.textbook_stock_counts where id=v_count_id;
    perform 1 from public.textbooks where id=v_book_id for no key update;
    select * into v_count from public.textbook_stock_counts where id=v_count_id for update;
    if not found then return jsonb_build_object('kind',p_kind,'id',p_id,'deleted',false); end if;
    v_move_id:=v_count.adjustment_move_id;
    if v_count.textbook_id is distinct from v_book_id or (p_kind='move' and v_move_id is distinct from p_id)
      or (v_move_id is null and v_count.counted_quantity<>v_count.expected_quantity) then
      raise exception using errcode='23514', message='textbook_count_history_conflict';
    end if;
    if v_move_id is not null then
      select * into v_move from public.textbook_stock_moves where id=v_move_id for update;
      if not found or v_move.move_type<>'stock_adjustment' or v_move.textbook_id<>v_count.textbook_id
        or v_move.location_id is distinct from v_count.location_id or v_move.copy_scope<>v_count.copy_scope
        or v_move.quantity::bigint<>v_count.counted_quantity::bigint-v_count.expected_quantity
        or exists(select 1 from public.textbook_stock_counts where adjustment_move_id=v_move_id and id<>v_count_id) then
        raise exception using errcode='23514', message='textbook_count_history_conflict';
      end if;
    end if;
    delete from public.textbook_stock_counts where id=v_count_id;
    get diagnostics v_deleted=row_count;
    if v_deleted<>1 then raise exception using errcode='42501', message='textbook_count_forbidden'; end if;
    if v_move_id is not null then
      delete from public.textbook_stock_moves where id=v_move_id;
      get diagnostics v_deleted=row_count;
      if v_deleted<>1 then raise exception using errcode='42501', message='textbook_count_forbidden'; end if;
    end if;
    return jsonb_build_object('kind',p_kind,'id',p_id,'deleted',true);
  end if;
  select textbook_id into v_book_id from public.textbook_stock_moves where id=p_id;
  perform 1 from public.textbooks where id=v_book_id for no key update;
  perform 1 from public.textbook_stock_moves where id=p_id for update;
  if not found then return jsonb_build_object('kind',p_kind,'id',p_id,'deleted',false); end if;
  -- A concurrent legacy link must not be silently detached by the foreign key.
  if exists(select 1 from public.textbook_stock_counts where adjustment_move_id=p_id) then
    raise exception using errcode='23514', message='textbook_count_history_conflict';
  end if;
  delete from public.textbook_stock_moves where id=p_id;
  get diagnostics v_deleted=row_count;
  if v_deleted<>1 then raise exception using errcode='42501', message='textbook_count_forbidden'; end if;
  return jsonb_build_object('kind',p_kind,'id',p_id,'deleted',true);
end $$;

revoke all on function public.create_textbook_stock_count_v1(uuid,uuid,uuid,integer,integer,date,numeric,text) from public,anon;
revoke all on function public.delete_textbook_inventory_history_v1(text,uuid) from public,anon;
grant execute on function public.create_textbook_stock_count_v1(uuid,uuid,uuid,integer,integer,date,numeric,text) to authenticated;
grant execute on function public.delete_textbook_inventory_history_v1(text,uuid) to authenticated;

commit;
