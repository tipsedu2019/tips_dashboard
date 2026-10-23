begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'create_textbook_request_v1',
  array['uuid', 'text', 'uuid', 'uuid', 'integer', 'integer', 'text']
);

select ok(
  (
    select procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'public.create_textbook_request_v1(uuid,text,uuid,uuid,integer,integer,text)'::regprocedure
  ),
  'textbook request RPC is a postgres-owned security-definer boundary'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_textbook_request_v1(uuid,text,uuid,uuid,integer,integer,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.create_textbook_request_v1(uuid,text,uuid,uuid,integer,integer,text)',
    'EXECUTE'
  ),
  'only authenticated API callers can enter the textbook request RPC'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '83000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'textbook-request-teacher@runtime.invalid',
    crypt('textbook-request-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"textbook-teacher-request-access"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'textbook-request-viewer@runtime.invalid',
    crypt('textbook-request-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"textbook-teacher-request-access"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'textbook-request-assistant@runtime.invalid',
    crypt('textbook-request-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"textbook-teacher-request-access"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '83000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'textbook-request-staff@runtime.invalid',
    crypt('textbook-request-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"textbook-teacher-request-access"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '83000000-0000-4000-8000-000000000001', 'teacher',
    '교재 요청 프로필 교사', 'textbook-request-teacher@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '83000000-0000-4000-8000-000000000002', 'viewer',
    '교재 요청 열람자', 'textbook-request-viewer@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '83000000-0000-4000-8000-000000000003', 'assistant',
    '교재 요청 조교', 'textbook-request-assistant@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '83000000-0000-4000-8000-000000000004', 'staff',
    '교재 요청 프로필 관리자', 'textbook-request-staff@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order,
  profile_id, account_email, dashboard_role
)
values (
  '83000000-0000-4000-8000-000000000101',
  '교재 런타임 교사',
  array['영어팀']::text[],
  true,
  9830,
  '83000000-0000-4000-8000-000000000001',
  'textbook-request-teacher@runtime.invalid',
  'teacher'
), (
  '83000000-0000-4000-8000-000000000102',
  '교재 런타임 관리자',
  array['영어팀']::text[],
  true,
  9831,
  '83000000-0000-4000-8000-000000000004',
  'textbook-request-staff@runtime.invalid',
  'staff'
)
on conflict (profile_id) where profile_id is not null do update set
  name = excluded.name,
  subjects = excluded.subjects,
  is_visible = excluded.is_visible,
  account_email = excluded.account_email,
  dashboard_role = excluded.dashboard_role;

create or replace function pg_temp.textbook_request_set_actor(
  p_actor uuid,
  p_email text
)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', p_email
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

select pg_temp.textbook_request_set_actor(
  '83000000-0000-4000-8000-000000000004',
  'textbook-request-staff@runtime.invalid'
);
set local role authenticated;

select lives_ok(
  $$
    select public.create_textbook_request_v1(
      null,
      '  교재 런타임 요청  ',
      null,
      null,
      2,
      1,
      '교재 런타임 메모'
    )
  $$,
  'staff can create a textbook request through the RPC'
);

reset role;

select results_eq(
  $$
    select status, requested_by, created_by
    from public.textbook_purchase_orders
    where created_by = '83000000-0000-4000-8000-000000000004'::uuid
  $$,
  $$
    values (
      'requested'::text,
      '교재 런타임 관리자'::text,
      '83000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  'staff RPC stores the server-owned requester and creator'
);

select results_eq(
  $$
    select
      purchase_order.status,
      line.copy_scope,
      line.requested_textbook_title,
      line.requested_quantity,
      line.ordered_quantity,
      line.received_quantity,
      line.teacher_ordered_quantity,
      line.teacher_received_quantity
    from public.textbook_purchase_order_lines as line
    join public.textbook_purchase_orders as purchase_order
      on purchase_order.id = line.purchase_order_id
    where purchase_order.created_by = '83000000-0000-4000-8000-000000000004'::uuid
    order by line.copy_scope
  $$,
  $$
    values
      ('requested'::text, 'student'::text, '교재 런타임 요청'::text, 2, 0, 0, 0, 0),
      ('requested'::text, 'teacher'::text, '교재 런타임 요청'::text, 1, 0, 0, 0, 0)
  $$,
  'staff RPC creates requested-only zero-fulfillment lines'
);

select is(
  (
    select pg_catalog.count(*)
    from public.textbook_stock_moves as stock_move
    where stock_move.purchase_order_line_id in (
      select line.id
      from public.textbook_purchase_order_lines as line
      join public.textbook_purchase_orders as purchase_order
        on purchase_order.id = line.purchase_order_id
      where purchase_order.created_by = '83000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  0::bigint,
  'staff RPC creates no stock moves'
);

-- Restricted roles retain their original identities; the normal creation above
-- uses a separate staff actor so quantities/ownership/stock assertions survive.
create temporary table textbook_request_denial_baseline as
select
  (select count(*) from public.textbook_purchase_orders) as orders,
  (select count(*) from public.textbook_purchase_order_lines) as lines,
  (select count(*) from public.textbook_stock_moves) as stock_moves;

select pg_temp.textbook_request_set_actor(
  '83000000-0000-4000-8000-000000000001',
  'textbook-request-teacher@runtime.invalid'
);
set local role authenticated;

select throws_ok(
  $$select public.create_textbook_request_v1(null, 'teacher denied', null, null, 1, 0, '')$$,
  '42501', 'textbook_request_access_denied',
  'teacher cannot create an operational textbook request'
);

select is(
  (public.read_operational_common_v1('book_page',
    '{"p_search":"교재 런타임 요청","p_page":1,"p_page_size":15}'::jsonb)->>'totalCount')::bigint,
  1::bigint,
  'teacher reads the existing staff request through the common book reader'
);
select ok(
  (select
    data#>>'{rows,0,bookTitle}' = '교재 런타임 요청'
    and (data#>>'{rows,0,studentQuantity}')::integer = 2
    and (data#>>'{rows,0,teacherQuantity}')::integer = 1
    and not ((data#>'{rows,0}') ?| array['memo','requestedBy','createdBy','supplier','unitPrice','purchasePrice'])
    and data::text not like '%교재 런타임 메모%'
   from (select public.read_operational_common_v1('book_page',
     '{"p_search":"교재 런타임 요청","p_page":1,"p_page_size":15}'::jsonb) data) response),
  'teacher common book DTO preserves requested quantities and excludes private order fields'
);

select results_eq(
  $$select
    (select count(*) from public.textbook_purchase_orders where created_by='83000000-0000-4000-8000-000000000004'::uuid),
    (select count(*) from public.textbook_purchase_order_lines)$$,
  $$values (0::bigint, 0::bigint)$$,
  'teacher raw request and line SELECT remain fenced despite common read access'
);
reset role;
select results_eq(
  $$select (select count(*) from public.textbook_purchase_orders),
           (select count(*) from public.textbook_purchase_order_lines),
           (select count(*) from public.textbook_stock_moves)$$,
  $$select orders, lines, stock_moves from textbook_request_denial_baseline$$,
  'teacher denial and common reads add no order, line, or stock movement'
);

select pg_temp.textbook_request_set_actor(
  '83000000-0000-4000-8000-000000000002',
  'textbook-request-viewer@runtime.invalid'
);
set local role authenticated;

select throws_ok(
  $$
    select public.create_textbook_request_v1(
      null, 'viewer denied', null, null, 1, 0, ''
    )
  $$,
  '42501',
  'textbook_request_access_denied',
  'viewer cannot call the textbook request RPC'
);

reset role;
select pg_temp.textbook_request_set_actor(
  '83000000-0000-4000-8000-000000000003',
  'textbook-request-assistant@runtime.invalid'
);
set local role authenticated;

select throws_ok(
  $$
    select public.create_textbook_request_v1(
      null, 'assistant denied', null, null, 1, 0, ''
    )
  $$,
  '42501',
  'textbook_request_access_denied',
  'assistant cannot call the textbook request RPC'
);

select throws_ok(
  $$select public.read_operational_common_v1('book_page',
      '{"p_search":"교재 런타임 요청","p_page":1,"p_page_size":15}'::jsonb)$$,
  '42501', 'operational_common_read_forbidden',
  'assistant cannot enter the operational common book reader'
);
reset role;
select results_eq(
  $$select (select count(*) from public.textbook_purchase_orders),
           (select count(*) from public.textbook_purchase_order_lines),
           (select count(*) from public.textbook_stock_moves)$$,
  $$select orders, lines, stock_moves from textbook_request_denial_baseline$$,
  'assistant denial adds no order, line, or stock movement'
);
select pg_temp.textbook_request_set_actor(
  '83000000-0000-4000-8000-000000000001',
  'textbook-request-teacher@runtime.invalid'
);
set local role authenticated;

select results_eq(
  $$
    with changed as (
      update public.textbook_purchase_orders
      set status = 'ordered'
      where created_by = '83000000-0000-4000-8000-000000000004'::uuid
      returning id
    )
    select pg_catalog.count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'teacher cannot directly update a textbook request'
);

select results_eq(
  $$
    with changed as (
      update public.textbook_purchase_order_lines
      set ordered_quantity = 1
      where purchase_order_id in (
        select purchase_order.id
        from public.textbook_purchase_orders as purchase_order
        where purchase_order.created_by = '83000000-0000-4000-8000-000000000004'::uuid
      )
      returning id
    )
    select pg_catalog.count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'teacher cannot directly update textbook request lines'
);

select results_eq(
  $$
    with deleted as (
      delete from public.textbook_purchase_orders
      where created_by = '83000000-0000-4000-8000-000000000004'::uuid
      returning id
    )
    select pg_catalog.count(*) from deleted
  $$,
  $$values (0::bigint)$$,
  'teacher cannot directly delete a textbook request'
);

select results_eq(
  $$
    with deleted as (
      delete from public.textbook_purchase_order_lines
      where purchase_order_id in (
        select purchase_order.id
        from public.textbook_purchase_orders as purchase_order
        where purchase_order.created_by = '83000000-0000-4000-8000-000000000004'::uuid
      )
      returning id
    )
    select pg_catalog.count(*) from deleted
  $$,
  $$values (0::bigint)$$,
  'teacher cannot directly delete textbook request lines'
);

reset role;

select results_eq(
  $$
    select
      pg_catalog.count(*)::bigint,
      pg_catalog.count(*) filter (where status = 'requested')::bigint
    from public.textbook_purchase_orders
    where created_by = '83000000-0000-4000-8000-000000000004'::uuid
  $$,
  $$values (1::bigint, 1::bigint)$$,
  'denied callers and teacher raw writes leave the existing staff request unchanged'
);

select * from finish();
rollback;
