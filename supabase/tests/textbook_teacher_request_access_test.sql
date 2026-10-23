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

select lives_ok(
  $$select public.create_textbook_request_v1(null, 'teacher new request', null, null, 1, 0, '')$$,
  'teacher can create a new request through the narrow existing RPC'
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
  $$select orders+1, lines+1, stock_moves from textbook_request_denial_baseline$$,
  'teacher submission adds exactly one requested order and line with no stock movement'
);
update textbook_request_denial_baseline set
 orders=(select count(*) from public.textbook_purchase_orders),
 lines=(select count(*) from public.textbook_purchase_order_lines);

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

-- Latest approved exception: new teacher requests are atomic and replay-safe;
-- raw management, ownership, status and fulfillment are still server-controlled.
create function pg_temp.teacher_submission(title text default '멱등 교재') returns jsonb language sql as $$
 select jsonb_build_object('title',title,'textbookId',null,'classId',null,'locationId',null,
   'studentQuantity',2,'teacherQuantity',1,'memo','보존할 요청 메모')
$$;
select pg_temp.textbook_request_set_actor('83000000-0000-4000-8000-000000000001','textbook-request-teacher@runtime.invalid');
set local role authenticated;
select is(
 public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission()),
 public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission()),
 'same teacher request id and input replay the exact result');
select is((select count(*) from jsonb_object_keys(public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission()))),1::bigint,'submission response exposes only its own order id');
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission('다른 내용'))$$,'22023','idempotency_key_reused','same key with different input is rejected');
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000902',pg_temp.teacher_submission()||'{"created_by":"83000000-0000-4000-8000-000000000004"}')$$,'22023','textbook_request_input_invalid','teacher cannot inject another requester or management fields');
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000902',pg_temp.teacher_submission()||'{"studentQuantity":-1}')$$,'22023','textbook_request_input_invalid','negative quantity is not silently changed');
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000902',pg_temp.teacher_submission()||'{"classId":"83000000-0000-4000-8000-000000000999"}')$$,'23503',null,'invalid references roll back the complete submission');
select results_eq($$with x as(update public.textbook_purchase_orders set status='ordered' where created_by='83000000-0000-4000-8000-000000000001' returning id)select count(*)from x$$,$$values(0::bigint)$$,'teacher cannot edit even its own submitted request');
select results_eq($$with x as(delete from public.textbook_purchase_order_lines returning id)select count(*)from x$$,$$values(0::bigint)$$,'teacher cannot delete own or other submitted lines');
select throws_ok($$insert into public.textbook_purchase_orders(status,created_by)values('requested','83000000-0000-4000-8000-000000000001')$$,'42501',null,'direct insert cannot bypass server-owned request creation');
select ok((public.read_operational_common_v1('book_request_options','{"scope":"classes","search":"","page":1,"pageSize":15}')#>'{rows}') is not null,'new form can read bounded minimal class options');
select throws_ok($$select public.read_operational_common_v1('book_request_options','{"scope":"profiles","search":"","page":1,"pageSize":15}')$$,'22023','operational_common_read_invalid','options cannot select private relations');
select throws_ok($$select public.read_operational_common_v1('book_request_options','{"scope":"classes","search":"","page":1,"pageSize":100}')$$,'22023','operational_common_read_invalid','options are bounded to fifteen rows');
reset role;
select results_eq($$select o.status,o.created_by,l.copy_scope,l.requested_quantity,l.ordered_quantity,l.received_quantity,l.memo from public.textbook_purchase_orders o join public.textbook_purchase_order_lines l on l.purchase_order_id=o.id where l.requested_textbook_title='멱등 교재' order by l.copy_scope$$,
 $$values('requested'::text,'83000000-0000-4000-8000-000000000001'::uuid,'student'::text,2,0,0,'보존할 요청 메모'::text),('requested'::text,'83000000-0000-4000-8000-000000000001'::uuid,'teacher'::text,1,0,0,'보존할 요청 메모'::text)$$,
 'one request owns exactly two requested-only lines after repeated submissions and denied changes');
select is((select count(*) from dashboard_private.notification_request_ledger where request_kind='submit_teacher_textbook_request_v1'),1::bigint,'only one successful request receipt, no receipt for failed input or FK failure');
select is((select count(*) from public.textbook_stock_moves),(select stock_moves from textbook_request_denial_baseline),'teacher submission never purchases, fulfills, or moves inventory');
select pg_temp.textbook_request_set_actor('83000000-0000-4000-8000-000000000003','textbook-request-assistant@runtime.invalid');
set local role authenticated;
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission())$$,'42501','textbook_request_access_denied','assistant is rejected before existing receipt replay');
reset role;
select pg_temp.textbook_request_set_actor('83000000-0000-4000-8000-000000000002','textbook-request-viewer@runtime.invalid');
set local role authenticated;
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission())$$,'42501','textbook_request_access_denied','viewer remains unable to submit or replay a teacher request');
reset role;
update public.profiles set role='assistant' where id='83000000-0000-4000-8000-000000000001';
select pg_temp.textbook_request_set_actor('83000000-0000-4000-8000-000000000001','textbook-request-teacher@runtime.invalid');
set local role authenticated;
select throws_ok($$select public.submit_teacher_textbook_request_v1('83000000-0000-4000-8000-000000000901',pg_temp.teacher_submission())$$,'42501','textbook_request_access_denied','changed role loses submission and replay immediately with the same JWT identity');
reset role;

select * from finish();
rollback;
