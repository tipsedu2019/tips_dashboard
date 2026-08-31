begin;
select no_plan();
select has_function('public','list_textbook_closing_page_v1',array['jsonb','text','integer','integer'],'saved closing page exists');
select has_function('public','list_textbook_closing_movement_page_v1',array['jsonb','text','integer','integer'],'independent movement page exists');
select has_function('public','get_textbook_closing_detail_v1',array['uuid'],'saved closing detail exists');
select has_function('public','get_textbook_closing_preview_v1',array['jsonb'],'complete closing preview exists');
select has_function('public','get_class_textbook_sale_context_v1',array['jsonb'],'complete selected class context exists');
select has_function('public','get_textbook_purchase_handoff_context_v1',array['jsonb','text'],'complete purchase handoff exists');
select has_function('public','get_textbook_billing_handoff_context_v1',array['jsonb'],'complete billing handoff exists');
select has_function('public','get_textbook_closing_save_context_v1',array['text','text'],'complete closing save context exists');
select has_function('public','get_textbook_closing_movement_export_v1',array['jsonb'],'complete movement export exists');
set local timezone='UTC';
set local statement_timeout='30s';
select diag('TASK3C_FLOAT_CONFIG extra_float_digits='||current_setting('extra_float_digits'));
create function pg_temp.cid(n integer)returns uuid language sql immutable as $$select ('3c000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.cf(p jsonb default '{}')returns jsonb language sql immutable as $$select '{"month":"all","subject":"__t3c__","status":"all"}'::jsonb||p$$;
create function pg_temp.mf(p jsonb default '{}')returns jsonb language sql immutable as $$select '{"closingMonth":"2099-08","subject":"science","search":""}'::jsonb||p$$;
create function pg_temp.pf(p jsonb default '{}')returns jsonb language sql immutable as $$select '{"mode":"order","search":"__t3c__","boardScope":"all","requestFilter":"all","orderFilter":"all"}'::jsonb||p$$;
create function pg_temp.sf(p jsonb default '{}')returns jsonb language sql immutable as $$select '{"search":"__t3c__","status":"all"}'::jsonb||p$$;
create function pg_temp.ci(n integer default 600,b integer default 1)returns jsonb language sql immutable as $$select jsonb_build_object('classId',pg_temp.cid(n),'textbookId',pg_temp.cid(b),'chargeMonth','2099-08','locationId',pg_temp.cid(900))$$;
create temp table sends_before as select(select count(*)from dashboard_private.notification_events)events,(select count(*)from dashboard_private.notification_event_fanout_jobs)jobs,(select count(*)from dashboard_private.notification_deliveries)deliveries;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.cid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','task3c-'||n||'@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()from generate_series(901,903)n;
insert into public.profiles(id,role,name,email)values(pg_temp.cid(901),'admin','합성 관리자','task3c-901@example.invalid'),(pg_temp.cid(902),'staff','합성 직원','task3c-902@example.invalid'),(pg_temp.cid(903),'teacher','합성 교사','task3c-903@example.invalid')on conflict(id)do update set role=excluded.role;
-- Baseline capture contains schema, not the historical taxonomy seed data.
insert into public.academic_subject_settings(subject,grade_levels)values('과학',array['고1','고2','고3'])on conflict(subject)do nothing;
insert into public.academic_subject_areas(subject,area_key,label,sort_order,is_active)values('과학','integrated_science','통합과학',10,true)on conflict(subject,area_key)do update set is_active=true;
insert into public.textbook_inventory_locations(id,code,name,sort_order)values(pg_temp.cid(900),'__t3c_main__','본관',10),(pg_temp.cid(910),'__t3c_annex__','별관',20);
insert into public.textbook_publishers(id,name)values(pg_temp.cid(710),'__t3c__ 출판사');
insert into public.textbook_suppliers(id,name,contact)values(pg_temp.cid(720),'__t3c__ 외부','담당'),(pg_temp.cid(721),'팁스 서점','담당');
insert into public.textbook_publisher_supplier_links(id,publisher_id,supplier_id,priority,is_primary)values(pg_temp.cid(730),pg_temp.cid(710),pg_temp.cid(720),99,true),(pg_temp.cid(731),pg_temp.cid(710),pg_temp.cid(721),0,false);
insert into public.textbooks(id,title,name,subject,publisher,publisher_id,default_supplier_id,category,price,sale_price,school_level,grade_level,school_levels,grade_levels,subject_area_key,sub_subject,status)
select pg_temp.cid(n),case n when 4 then '__t3c_small__'else '__t3c__ 교재 '||n end,case n when 4 then '__t3c_small__'else '__t3c__ 교재 '||n end,
 case n when 2 then 'english'when 3 then 'math'else 'science'end,'__t3c__ 출판사',pg_temp.cid(710),case when n=2 then pg_temp.cid(721)end,'독해',10001,10001,
 case when n in(1,4)then 'high'else 'middle'end,case when n in(1,4)then 'h1'else 'm2'end,
 case when n in(1,4)then array['high']else array['middle']end,case when n in(1,4)then array['h1','h2','h3']else array['m2']end,
 case when n in(1,4)then 'integrated_science'end,'독해','active'from generate_series(1,4)n;
insert into public.textbook_publishers(id,name)values(pg_temp.cid(711),'팁스서점');
insert into public.textbooks(id,title,name,subject,publisher,publisher_id,sale_price,price,school_level,grade_level,school_levels,grade_levels,category,sub_subject,status)values
(pg_temp.cid(5),'__t3c__ decimal','__t3c__ decimal','english','__t3c__ 출판사',pg_temp.cid(710),100.1,100.1,'middle','m2',array['middle'],array['m2'],'독해','독해','active'),
(pg_temp.cid(6),'__t3c__ whitespace','__t3c__ whitespace','english',' ',pg_temp.cid(711),100.1,100.1,'middle','m2',array['middle'],array['m2'],'독해','독해','active');
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,unit_amount,amount,moved_at,copy_scope)values
(pg_temp.cid(2300),pg_temp.cid(5),pg_temp.cid(900),'sale_issue',-1,0,0,'2097-01-01T00:00:00Z','student'),
(pg_temp.cid(2301),pg_temp.cid(6),pg_temp.cid(900),'sale_issue',-1,0,0,'2097-02-01T00:00:00Z','student'),
(pg_temp.cid(2302),pg_temp.cid(5),pg_temp.cid(900),'sale_issue',-1,0.0000001,0.0000001,'2097-03-01T00:00:00Z','student'),
(pg_temp.cid(2303),pg_temp.cid(5),pg_temp.cid(900),'sale_issue',-3,0,0,'2097-04-01T00:00:00Z','student'),
(pg_temp.cid(2304),pg_temp.cid(5),pg_temp.cid(900),'stock_adjustment',1,0,0.25,'2097-05-01T00:00:00Z','student'),
(pg_temp.cid(2305),pg_temp.cid(5),pg_temp.cid(900),'stock_adjustment',1,0,1e16,'2097-05-03T00:00:00Z','student'),
(pg_temp.cid(2306),pg_temp.cid(5),pg_temp.cid(900),'stock_adjustment',-1,0,-1e16,'2097-05-02T00:00:00Z','student'),
(pg_temp.cid(2307),pg_temp.cid(5),pg_temp.cid(900),'sale_issue',-1,0.5555555555555555,0,'2097-06-01T00:00:00Z','student');
insert into public.students(id,name,uid,school,grade,contact,parent_contact,status,class_ids,waitlist_class_ids)
select pg_temp.cid(1000+n),'합성 학생 '||n,'task3c-'||n,'합성학교','중2','','','재원','[]','[]'from generate_series(1,111)n;
insert into public.classes(id,name,class_type,subject,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
values(pg_temp.cid(600),'큰반','정규','영어','수강',(select jsonb_agg(pg_temp.cid(1000+n))from generate_series(1,111)n)||jsonb_build_array(pg_temp.cid(1001)),'[]','[]','[]','{}'),
(pg_temp.cid(601),'작은반','정규','영어','수강',jsonb_build_array(pg_temp.cid(1001),pg_temp.cid(1001),'legacy'), '[]','[]','[]','{}'),
(pg_temp.cid(602),'빈반','정규','영어','수강','[]','[]','[]','[]','{}');
insert into public.textbook_monthly_closings(id,closing_month,subject)select pg_temp.cid(8000+n),'__t3c__'||lpad(n::text,3,'0'),'__t3c__'from generate_series(1,112)n;
insert into public.textbook_monthly_closings(id,closing_month,subject,opening_quantity,sale_quantity,ending_quantity,settlement_difference,received_amount,supplier_payment_amount,memo)
values(pg_temp.cid(8200),'2099-08','science',200,112,88,112000.49,99999,123,'메모 보존'),(pg_temp.cid(8201),'2099-09','science',10,2,8,4000.5,900,1,'소규모 상세');
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,unit_amount,amount,moved_at,copy_scope)
select pg_temp.cid(2000+n),pg_temp.cid(1),pg_temp.cid(900),'sale_issue',-1,10001,0,'2099-08-01T00:00:00Z','student'from generate_series(1,112)n;
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,unit_amount,amount,moved_at,copy_scope)values
(pg_temp.cid(2200),pg_temp.cid(4),pg_temp.cid(900),'sale_issue',-2,0,-40000,'2099-09-01T00:00:00Z','student'),
(pg_temp.cid(2201),pg_temp.cid(1),pg_temp.cid(900),'opening',500,2,0,'2098-01-01T00:00:00Z','student'),
(pg_temp.cid(2202),pg_temp.cid(1),pg_temp.cid(910),'opening',10,2,0,'2098-01-01T00:00:00Z','teacher'),
(pg_temp.cid(2203),pg_temp.cid(2),pg_temp.cid(900),'sale_issue',-1,10001,0,'2099-10-01T00:00:00Z','student'),
(pg_temp.cid(2204),pg_temp.cid(3),pg_temp.cid(900),'sale_issue',-1,10001,0,'2099-10-01T00:00:00Z','teacher'),
(pg_temp.cid(2205),pg_temp.cid(1),pg_temp.cid(900),'sale_issue',-1,10,0,'2099-11-30T23:30:00Z','student'),
(pg_temp.cid(2206),pg_temp.cid(3),pg_temp.cid(900),'return_out',-1,10001,0,'2099-10-01T00:00:00Z','student'),
(pg_temp.cid(2207),pg_temp.cid(3),pg_temp.cid(900),'transfer_in',3,5,0,'2099-10-01T00:00:00Z','student'),
(pg_temp.cid(2208),pg_temp.cid(3),pg_temp.cid(900),'stock_adjustment',-2,5,0,'2099-10-01T00:00:00Z','student');
insert into public.textbook_purchase_orders(id,requested_by,order_date,status,created_by,created_at,updated_at)values
(pg_temp.cid(5000),'합성 교사','2099-08-01','ordered',pg_temp.cid(901),'2099-08-01T00:00:00Z',null),
(pg_temp.cid(5001),'합성 교사','2099-08-01','partially_received',pg_temp.cid(901),'2099-08-01T00:00:00Z',null);
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,class_id,location_id,requested_quantity,ordered_quantity,received_quantity,copy_scope,created_at,updated_at)
select pg_temp.cid(3000+n),pg_temp.cid(5000),pg_temp.cid(1),pg_temp.cid(600),pg_temp.cid(900),1,1,0,'student','2099-08-01T00:00:00Z',null from generate_series(1,112)n;
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,class_id,location_id,requested_quantity,ordered_quantity,received_quantity,copy_scope,created_at,updated_at)values
(pg_temp.cid(3200),pg_temp.cid(5001),pg_temp.cid(4),pg_temp.cid(601),pg_temp.cid(900),2,2,1,'student','2099-08-01T00:00:00Z',null),
(pg_temp.cid(3201),pg_temp.cid(5001),pg_temp.cid(4),pg_temp.cid(601),pg_temp.cid(910),1,1,1,'teacher','2099-08-01T00:00:00Z',null);
insert into public.textbook_sales(id,class_id,charge_month,sale_date,status,created_at,updated_at)values(pg_temp.cid(6000),pg_temp.cid(600),'2099-08','2099-08-01','charged','2099-08-01T00:00:00Z',null),(pg_temp.cid(6001),pg_temp.cid(601),'2099-08','2099-08-01','charged','2099-08-01T00:00:00Z',null);
insert into public.textbook_sale_lines(id,sale_id,student_id,class_id,textbook_id,charge_month,quantity,unit_price,location_id,status,copy_scope,created_at,updated_at)
select pg_temp.cid(4000+n),pg_temp.cid(6000),pg_temp.cid(1000+least(n,111)),pg_temp.cid(600),pg_temp.cid(1),'2099-08',1,0,pg_temp.cid(900),'paid','student','2099-08-01T00:00:00Z',null from generate_series(1,112)n;
insert into public.textbook_sale_lines(id,sale_id,student_id,class_id,textbook_id,charge_month,quantity,unit_price,location_id,status,copy_scope,created_at,updated_at)values
(pg_temp.cid(4200),pg_temp.cid(6001),pg_temp.cid(1001),null,pg_temp.cid(4),'2099-08-25',2,0,pg_temp.cid(900),'paid','student','2099-08-01T00:00:00Z',null),
(pg_temp.cid(4201),pg_temp.cid(6001),null,pg_temp.cid(601),pg_temp.cid(4),'2099-08',1,0,pg_temp.cid(900),'charged','teacher','2099-08-01T00:00:00Z',null),
(pg_temp.cid(4202),pg_temp.cid(6001),pg_temp.cid(1001),pg_temp.cid(601),pg_temp.cid(4),'2099-08',1,0,pg_temp.cid(900),'excluded','student','2099-08-01T00:00:00Z',null);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cid(901)::text,true);
select is(dashboard_private.textbook_context_roster_v1('[0,false,null,"",1e-7,[1e-7,null,true],{}," legacy "]'), '["1e-7","1e-7,,true","[object Object]","legacy"]'::jsonb,'complete roster uses original JS number and nested array string forms');
select is(dashboard_private.textbook_context_roster_v1(to_jsonb('[" legacy ","legacy",1e-7]'::text)), '["legacy","legacy","1e-7"]'::jsonb,'JSON-encoded roster retains original numeric spelling and repeats');
select is(dashboard_private.textbook_context_roster_v1(to_jsonb(' legacy, legacy , ,other'::text)), '["legacy","legacy","other"]'::jsonb,'comma roster keeps repeated IDs and drops only blank items');
-- Literal contracts established against the untouched original JS closing body.
select is(public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-01","subject":"english"}'))#>>'{rows,0,marginAmount}','10.099999999999994','display margin preserves original binary-double result');
select is((public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-01","subject":"english","search":"10.099999999999994"}'))->>'sourceLineCount')::int,1,'search sees original exact decimal margin spelling');
select is((public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-03","subject":"english","search":"1e-7"}'))->>'sourceLineCount')::int,1,'search uses JS exponent spelling without leading exponent zero');
select is((public.get_textbook_closing_movement_export_v1(pg_temp.mf(jsonb_build_object('closingMonth','2097-01','subject','english','search',U&'출고\FEFF__t3c__')))->>'sourceLineCount')::int,1,'ECMAScript interior FEFF query whitespace collapses');
select is((public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-02","subject":"english"}'))#>>'{rows,0,marginAmount}')::numeric,100.1::numeric,'whitespace book publisher falls back to referenced current Tips publisher');
select is((public.get_textbook_closing_preview_v1('{"closingMonth":"2097-02","subject":"english","openingQuantity":0,"openingAmount":0}')#>>'{closing,textbookMarginAmount}')::numeric,100.1::numeric,'ledger also preserves current referenced Tips publisher fallback');
select is(public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-04","subject":"english"}'))#>>'{rows,0,marginAmount}','30.299999999999983','display subtracts unit prices before quantity multiplication');
select is(public.get_textbook_closing_preview_v1('{"closingMonth":"2097-04","subject":"english","openingQuantity":0,"openingAmount":0}')#>>'{closing,textbookMarginAmount}','30.299999999999955','ledger multiplies each line amount before subtraction');
select is(public.get_textbook_closing_preview_v1('{"closingMonth":"2097-05","subject":"english","openingQuantity":0,"openingAmount":2.5}')#>>'{closing,adjustmentAmount}','0.25','signed fractional reduce preserves native event and ID order');
select is(public.get_textbook_closing_preview_v1('{"closingMonth":"2097-05","subject":"english","openingQuantity":0,"openingAmount":2.5}')#>>'{closing,endingAmount}','2.75','signed fractional ending keeps actual ledger opening amount arithmetic');
select is(public.get_textbook_closing_save_context_v1('2097-05','english')->'sourceLineIds',jsonb_build_array(pg_temp.cid(2305),pg_temp.cid(2306),pg_temp.cid(2304)),'complete raw save preserves the same native reduce order as preview');
select is(dashboard_private.textbook_closing_cost_v1(0.5555555555555555::double precision,'student','외부','외부'),0::double precision,'actual Math.round binary product immediately below half rounds down');
select is(public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-06","subject":"english"}'))#>>'{rows,0,marginAmount}','0.5555555555555555','display retains below-half boundary margin');
select is(public.get_textbook_closing_preview_v1('{"closingMonth":"2097-06","subject":"english","openingQuantity":0,"openingAmount":0}')#>>'{closing,textbookMarginAmount}','0.5555555555555555','ledger retains below-half boundary margin');
savepoint caller_float_precision;
set local extra_float_digits=0;
select is(dashboard_private.textbook_context_number_text_v1(10.099999999999994::double precision),'10.099999999999994','JS number spelling does not inherit lossy caller output precision');
select is(public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-01","subject":"english"}'))#>>'{rows,0,marginAmount}','10.099999999999994','display JSON retains precision under caller extra_float_digits0');
select is((public.list_textbook_closing_movement_page_v1(pg_temp.mf('{"closingMonth":"2097-01","subject":"english","search":"10.099999999999994"}'),'event-desc',1,10)->>'totalCount')::int,1,'exact display search retains precision under caller extra_float_digits0');
select is(public.get_textbook_closing_preview_v1('{"closingMonth":"2097-04","subject":"english","openingQuantity":0,"openingAmount":0}')#>>'{closing,textbookMarginAmount}','30.299999999999955','preview JSON retains precision under caller extra_float_digits0');
select is(current_setting('extra_float_digits'),'0','purpose reads do not mutate caller output precision');
rollback to savepoint caller_float_precision;
release savepoint caller_float_precision;
create function pg_temp.preview_or_error(value jsonb)returns jsonb language plpgsql as $$begin return public.get_textbook_closing_preview_v1(value);exception when others then return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);end$$;
select is(pg_temp.preview_or_error('{"closingMonth":"2099-09","subject":"science","openingQuantity":2.5,"openingAmount":0}')#>'{closing,endingQuantity}','0.5'::jsonb,'finite fractional preview opening and ending quantities accepted');
select is(pg_temp.preview_or_error('{"closingMonth":"2099-09","subject":"science","openingQuantity":0.5,"openingAmount":0}')#>'{closing,needsReview}','true'::jsonb,'fractional negative ending keeps original needsReview behavior');
select is((public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',11,10)->>'totalCount')::int,112,'saved page counts complete source beyond100');
select is(jsonb_array_length(public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',11,10)->'rows'),10,'direct page11 has10 rows');
select is(public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',11,10)#>>'{rows,0,id}',pg_temp.cid(8012)::text,'month-desc ID ordering reaches page11 directly');
select is(jsonb_array_length(public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',999,20)->'rows'),0,'out of range empty while full count retained');
select is((public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',999,20)->>'totalCount')::int,112,'out of range complete saved count');
select is((public.list_textbook_closing_page_v1(pg_temp.cf('{"month":"__t3c__001"}'),'month-desc',1,10)->>'totalCount')::int,1,'physical legacy month text remains queryable');
select is((public.list_textbook_closing_movement_page_v1(pg_temp.mf(),'event-desc',11,10)->>'totalCount')::int,112,'independent movement count beyond100');
select is((select count(*)from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',p,size)->'rows')r),112::bigint,'every saved page has no omitted or repeated rows at size'||size)from(values(10),(15),(20))v(size);
select is((select count(distinct r->>'id')from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',p,size)->'rows')r),112::bigint,'saved page IDs remain distinct at size'||size)from(values(10),(15),(20))v(size);
select is((select count(*)from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_closing_movement_page_v1(pg_temp.mf(),'event-desc',p,size)->'rows')r),112::bigint,'every movement page has no omitted or repeated rows at size'||size)from(values(10),(15),(20))v(size);
select is((select count(distinct r->>'id')from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_closing_movement_page_v1(pg_temp.mf(),'event-desc',p,size)->'rows')r),112::bigint,'movement page IDs remain distinct at size'||size)from(values(10),(15),(20))v(size);
savepoint last_page_deleted;
reset role;
delete from public.textbook_monthly_closings where id in(pg_temp.cid(8001),pg_temp.cid(8002));
set local role authenticated;
select is((public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',12,10)->>'totalCount')::int,110,'deleted final page retains authoritative new count');
select is(jsonb_array_length(public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',12,10)->'rows'),0,'deleted final page returns empty requested page without clamping');
rollback to savepoint last_page_deleted;
release savepoint last_page_deleted;
select is(public.list_textbook_closing_movement_page_v1(pg_temp.mf(),'event-desc',11,10)#>>'{rows,0,id}',pg_temp.cid(2101)::text,'native event ties resolve real IDs ascending');
select is((public.list_textbook_closing_movement_page_v1(pg_temp.mf('{"search":"2026-08"}'),'event-desc',1,10)->>'totalCount')::int,0,'displayed date is not searchable');
select is((public.list_textbook_closing_movement_page_v1(pg_temp.mf('{"search":" 출고   __t3c__ "}'),'event-desc',1,10)->>'totalCount')::int,112,'original collapsed query matches joined haystack');
select is((public.get_textbook_closing_preview_v1('{"closingMonth":"2099-08","subject":"science","openingQuantity":200,"openingAmount":0}')#>>'{closing,saleQuantity}')::int,112,'preview covers every offpage move');
select is((public.get_textbook_closing_preview_v1('{"closingMonth":"2099-08","subject":"science","openingQuantity":200,"openingAmount":0}')#>>'{closing,saleAmount}')::numeric,1120112::numeric,'ledger unit amount fallback retained');
select is((public.get_textbook_closing_detail_v1(pg_temp.cid(8200))#>>'{preview,closing,textbookMarginAmount}')::numeric,112000::numeric,'full current external rounded90percent margin');
select is((public.get_textbook_closing_detail_v1(pg_temp.cid(8200))#>>'{preview,closing,paymentDifference}')::numeric,0::numeric,'detail ignores stored cash fields');
select is(public.get_textbook_closing_detail_v1(pg_temp.cid(99999)),'{"row":null,"preview":null}'::jsonb,'missing saved detail is legitimate null');
select is((public.get_textbook_closing_save_context_v1('2099-08','science')->>'sourceLineCount')::int,112,'save context complete beyond100');
select is(jsonb_array_length(public.get_textbook_closing_save_context_v1('2099-08','science')->'stockMoves'),112,'no implicit save cap or page-as-context');
select is(jsonb_array_length(public.get_textbook_closing_save_context_v1('2099-08','science')->'textbooks'),1,'save references only selected book');
select is((public.get_textbook_closing_movement_export_v1(pg_temp.mf())->>'sourceLineCount')::int,112,'clipboard export covers full searched rows');
select is(public.get_textbook_closing_movement_export_v1(pg_temp.mf())#>>'{rows,111,id}',pg_temp.cid(2112)::text,'clipboard includes offpage final move');
select is((public.get_textbook_closing_preview_v1('{"closingMonth":"2099-09","subject":"science","openingQuantity":10,"openingAmount":0}')#>>'{closing,textbookMarginAmount}')::numeric,4000::numeric,'ledger explicit amount/quantity unit fallback is not display margin');
select is((public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2099-09"}'))#>>'{rows,0,marginAmount}')::numeric,2000::numeric,'movement display catalog fallback remains distinct');
select is((public.get_textbook_closing_preview_v1('{"closingMonth":"2099-10","subject":"all","openingQuantity":0,"openingAmount":0}')#>>'{closing,textbookMarginAmount}')::numeric,20002::numeric,'Tips and teacher zero cost; return does not reverse sale-only margin');
select is((public.get_textbook_closing_preview_v1('{"closingMonth":"2099-10","subject":"all","openingQuantity":0,"openingAmount":0}')#>>'{closing,adjustmentQuantity}')::int,-2,'stock adjustment classification');
select is((public.get_textbook_purchase_handoff_context_v1(pg_temp.pf(),'order')->>'sourceLineCount')::int,114,'purchase export full publisher search includes small book raw lines beyond100');
select is(jsonb_array_length(public.get_textbook_purchase_handoff_context_v1(pg_temp.pf(),'order')->'lines'),114,'purchase snapshot does not collapse display parents');
select is((public.get_textbook_purchase_handoff_context_v1(pg_temp.pf('{"search":"__t3c_small__"}'),'return')->>'sourceLineCount')::int,2,'return full eligible student and teacher raw lines');
select is((public.get_textbook_billing_handoff_context_v1(pg_temp.sf())->>'sourceLineCount')::int,112,'billing complete source beyond100');
select is((public.get_textbook_billing_handoff_context_v1(pg_temp.sf('{"search":"__t3c_small__"}'))->>'sourceLineCount')::int,1,'billing excludes teacher and excluded raw statuses');
select is(jsonb_array_length(public.get_class_textbook_sale_context_v1(pg_temp.ci())->'enrolledStudentIds'),112,'class full repeated enrolled sequence beyond100');
select is(jsonb_array_length(public.get_class_textbook_sale_context_v1(pg_temp.ci())->'students'),111,'unique student records distinct from repeated roster');
select is((public.get_class_textbook_sale_context_v1(pg_temp.ci())->>'duplicateLineCount')::int,112,'full duplicate raw line count');
select is((public.get_class_textbook_sale_context_v1(pg_temp.ci())->>'duplicateCount')::int,111,'duplicate count uses distinct nonblank students');
select is((public.get_class_textbook_sale_context_v1(pg_temp.ci())#>>'{inventory,currentQuantity}')::int,387,'class inventory is alltime selected location, not closing month/page');
select is(public.get_class_textbook_sale_context_v1(pg_temp.ci(601,4))->'missingStudentIds','["legacy"]'::jsonb,'noncanonical missing roster identity fallback');
select is((public.get_class_textbook_sale_context_v1(pg_temp.ci(601,4))->>'duplicateCount')::int,1,'class and normalized month fallback with teacher/excluded removed');
select is(public.get_class_textbook_sale_context_v1(pg_temp.ci(602,4))->'enrolledStudentIds','[]'::jsonb,'empty class roster is valid complete context');
savepoint legacy_class_context;
reset role;
update public.classes set student_ids='[0,false,null,"",1e-7,[1e-7,null,true],{}," legacy "]'where id=pg_temp.cid(602);
insert into public.textbook_sales(id,class_id,charge_month,status)values(pg_temp.cid(6002),pg_temp.cid(602),'2099-08','charged');
insert into public.textbook_sale_lines(id,sale_id,textbook_id,charge_month,status)values(pg_temp.cid(4203),pg_temp.cid(6002),pg_temp.cid(4),'2099-08','paid'),(pg_temp.cid(4204),pg_temp.cid(6002),pg_temp.cid(4),'2099-08','charged');
set local role authenticated;
select is(public.get_class_textbook_sale_context_v1(pg_temp.ci(602,4))->'enrolledStudentIds','["1e-7","1e-7,,true","[object Object]","legacy"]'::jsonb,'actual class context preserves complete legacy roster string forms');
select is(public.get_class_textbook_sale_context_v1(pg_temp.ci(602,4))->'missingStudentIds','["1e-7","1e-7,,true","[object Object]","legacy"]'::jsonb,'actual class context keeps every absent legacy identity fallback');
select is((public.get_class_textbook_sale_context_v1(pg_temp.ci(602,4))->>'duplicateCount')::int,2,'null student duplicate identities fall back to full raw line count');
select is(public.get_class_textbook_sale_context_v1(pg_temp.ci(602,4))->'duplicateStudentIds','[]'::jsonb,'null student raw duplicates do not invent student identities');
rollback to savepoint legacy_class_context;
release savepoint legacy_class_context;
set local timezone='Asia/Seoul';
select is((public.get_textbook_closing_save_context_v1('2099-11','science')->>'sourceLineCount')::int,0,'serialized caller timezone prefix excludes next local month');
select is((public.get_textbook_closing_save_context_v1('2099-12','science')->>'sourceLineCount')::int,1,'serialized caller timezone prefix includes next local month');
select matches(public.get_textbook_closing_save_context_v1('2099-12','science')#>>'{stockMoves,0,moved_at}','^2099-12-01T08:30:00','actual raw DTO uses caller timezone serialization');
set local timezone='UTC';
select is((public.get_textbook_closing_save_context_v1('2099-11','science')->>'sourceLineCount')::int,1,'UTC raw serialized month remains distinct');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.ci(99999))$$,'22023','textbook_class_context_unavailable','missing authorized required class context fails explicitly');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.ci(600,99999))$$,'22023','textbook_class_context_unavailable','missing required book fails explicitly');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.ci()||jsonb_build_object('locationId',pg_temp.cid(99999)))$$,'22023','textbook_class_context_unavailable','missing required location fails explicitly');
select throws_ok($$select public.get_textbook_closing_detail_v1(null)$$,'22023','textbook_closing_id_invalid','detail null ID invalid');
select throws_ok($$select public.get_textbook_closing_preview_v1('{"closingMonth":"x","subject":"all","openingQuantity":"NaN","openingAmount":0}')$$,'22023','textbook_closing_input_invalid','non-number preview opening invalid');
select throws_ok($$select public.get_textbook_closing_preview_v1('{"closingMonth":"x","subject":"all","openingQuantity":1e400,"openingAmount":0}')$$,'22023','textbook_closing_input_invalid','nonfinite JS preview opening invalid');
select throws_ok($$select public.get_textbook_purchase_handoff_context_v1(pg_temp.pf(),'bad')$$,'22023','textbook_handoff_kind_invalid','kind invalid exact state');
select throws_ok($$select public.get_textbook_closing_save_context_v1(null,'all')$$,'22023','textbook_closing_scope_invalid','null save scope invalid');
select throws_ok(format('select public.%I(%s,%L,0,10)',rpc,filters,sort),'22023','textbook_page_invalid','zero page invalid: '||rpc)from(values('list_textbook_closing_page_v1','pg_temp.cf()','month-desc'),('list_textbook_closing_movement_page_v1','pg_temp.mf()','event-desc'))r(rpc,filters,sort);
select throws_ok(format('select public.%I(%s,%L,1,25)',rpc,filters,sort),'22023','textbook_page_size_invalid','invalid page size: '||rpc)from(values('list_textbook_closing_page_v1','pg_temp.cf()','month-desc'),('list_textbook_closing_movement_page_v1','pg_temp.mf()','event-desc'))r(rpc,filters,sort);
select throws_ok($$select public.get_textbook_closing_movement_export_v1('{"closingMonth":"x","subject":"all","search":"","extra":true}')$$,'22023','textbook_context_input_invalid','extra filter key invalid');

-- Untouched small complete final-wire scopes. Never truncate a context for diagnostics.
select diag('TASK3C_WIRE '||jsonb_build_object('method',method,'input',input,'data',data,'actorId',auth.uid())::text)from(values
('listTextbookClosingPage',jsonb_build_object('page',1,'pageSize',10,'filters',pg_temp.cf('{"month":"__t3c__001"}'),'sort','month-desc'),public.list_textbook_closing_page_v1(pg_temp.cf('{"month":"__t3c__001"}'),'month-desc',1,10)),
('listTextbookClosingMovementPage',jsonb_build_object('page',1,'pageSize',10,'filters',pg_temp.mf('{"closingMonth":"2099-09"}'),'sort','event-desc'),public.list_textbook_closing_movement_page_v1(pg_temp.mf('{"closingMonth":"2099-09"}'),'event-desc',1,10)),
('getTextbookClosingDetail',to_jsonb(pg_temp.cid(8201)),public.get_textbook_closing_detail_v1(pg_temp.cid(8201))),
('getTextbookClosingPreview','{"closingMonth":"2099-09","subject":"science","openingQuantity":10,"openingAmount":0}'::jsonb,public.get_textbook_closing_preview_v1('{"closingMonth":"2099-09","subject":"science","openingQuantity":10,"openingAmount":0}')),
('getClassTextbookSaleContext',pg_temp.ci(601,4),public.get_class_textbook_sale_context_v1(pg_temp.ci(601,4))),
('getTextbookPurchaseHandoff',jsonb_build_array(pg_temp.pf('{"search":"__t3c_small__"}'),'order'),public.get_textbook_purchase_handoff_context_v1(pg_temp.pf('{"search":"__t3c_small__"}'),'order')),
('getTextbookPurchaseHandoff',jsonb_build_array(pg_temp.pf('{"search":"__t3c_small__"}'),'return'),public.get_textbook_purchase_handoff_context_v1(pg_temp.pf('{"search":"__t3c_small__"}'),'return')),
('getTextbookBillingHandoff',pg_temp.sf('{"search":"__t3c_small__"}'),public.get_textbook_billing_handoff_context_v1(pg_temp.sf('{"search":"__t3c_small__"}'))),
('getTextbookClosingSaveContext',jsonb_build_array('2099-09','science'),public.get_textbook_closing_save_context_v1('2099-09','science')),
('getTextbookClosingSaveContext',jsonb_build_array('2097-05','english'),public.get_textbook_closing_save_context_v1('2097-05','english')),
('getTextbookClosingPreview','{"closingMonth":"2097-05","subject":"english","openingQuantity":0,"openingAmount":2.5}'::jsonb,public.get_textbook_closing_preview_v1('{"closingMonth":"2097-05","subject":"english","openingQuantity":0,"openingAmount":2.5}')),
('getTextbookClosingMovementExport',pg_temp.mf('{"closingMonth":"2097-04","subject":"english"}'),public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2097-04","subject":"english"}'))),
('getTextbookClosingPreview','{"closingMonth":"2097-04","subject":"english","openingQuantity":0,"openingAmount":0}'::jsonb,public.get_textbook_closing_preview_v1('{"closingMonth":"2097-04","subject":"english","openingQuantity":0,"openingAmount":0}')),
('getTextbookClosingMovementExport',pg_temp.mf('{"closingMonth":"2099-09"}'),public.get_textbook_closing_movement_export_v1(pg_temp.mf('{"closingMonth":"2099-09"}'))))r(method,input,data);

reset role;
create temp table purpose_calls(sql text);
insert into purpose_calls values($$select public.list_textbook_closing_page_v1(pg_temp.cf(),'month-desc',1,10)$$),($$select public.list_textbook_closing_movement_page_v1(pg_temp.mf(),'event-desc',1,10)$$),
($$select public.get_textbook_closing_detail_v1(pg_temp.cid(8200))$$),($$select public.get_textbook_closing_preview_v1('{"closingMonth":"2099-08","subject":"science","openingQuantity":200,"openingAmount":0}')$$),
($$select public.get_class_textbook_sale_context_v1(pg_temp.ci())$$),($$select public.get_textbook_purchase_handoff_context_v1(pg_temp.pf(),'order')$$),($$select public.get_textbook_billing_handoff_context_v1(pg_temp.sf())$$),
($$select public.get_textbook_closing_save_context_v1('2099-08','science')$$),($$select public.get_textbook_closing_movement_export_v1(pg_temp.mf())$$);
grant select on purpose_calls to authenticated,anon;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cid(902)::text,true);
select lives_ok(sql,'staff caller can read purpose')from purpose_calls;
select set_config('request.jwt.claim.sub',pg_temp.cid(903)::text,true);
select throws_ok(sql,'42501','textbook_management_read_forbidden','teacher cannot read management purpose')from purpose_calls;
select set_config('request.jwt.claim.sub','',true);
select throws_ok(sql,'42501','textbook_management_read_forbidden','authenticated role without actual identity is forbidden')from purpose_calls;
set local role anon;
select throws_ok(sql,'42501',null,'anon execute denied')from purpose_calls;
reset role;
select ok(not p.prosecdef and p.provolatile='s','purpose stays stable security invoker: '||p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('list_textbook_closing_page_v1','list_textbook_closing_movement_page_v1','get_textbook_closing_detail_v1','get_textbook_closing_preview_v1','get_class_textbook_sale_context_v1','get_textbook_purchase_handoff_context_v1','get_textbook_billing_handoff_context_v1','get_textbook_closing_save_context_v1','get_textbook_closing_movement_export_v1');
select is((select count(*)from dashboard_private.notification_events),(select events from sends_before),'no notification events');
select is((select count(*)from dashboard_private.notification_event_fanout_jobs),(select jobs from sends_before),'no fanout jobs');
select is((select count(*)from dashboard_private.notification_deliveries),(select deliveries from sends_before),'no deliveries');
select * from finish();
rollback;
