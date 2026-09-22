begin;
select no_plan();
set local statement_timeout='30s';
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('95100000-0000-4000-8000-000000000900','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ux-counts@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.profiles(id,role,name,email) values ('95100000-0000-4000-8000-000000000900','admin','합성 검증자','ux-counts@example.invalid') on conflict(id) do update set role='admin';
insert into public.students(id,name,uid,school,grade,contact,parent_contact,status,class_ids,waitlist_class_ids)
select ('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'인원 검증 '||n,'ux-counts-'||n,'합성중학교','중2','','','재원','[]','[]' from generate_series(1,65) n;
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
select ('95100000-0000-4000-8000-'||lpad((700+n)::text,12,'0'))::uuid,'인원 검증 '||n,'정규','영어','중2','합성 교사','월 18:00','합성실',100,0,'수강',
 coalesce((select jsonb_agg(('95100000-0000-4000-8000-'||lpad(i::text,12,'0'))) from generate_series(1,n) i),'[]'::jsonb),
 (select jsonb_agg(('95100000-0000-4000-8000-'||lpad(i::text,12,'0'))) from generate_series(1,31) i),'[]','[]','{}'
from unnest(array[0,30,31,65]) n;
select ok(not prosecdef and provolatile='s','final detail remains a stable invoker') from pg_proc where oid='public.get_management_detail_v1(text,uuid)'::regprocedure;
select ok(has_function_privilege('authenticated','public.get_management_detail_v1(text,uuid)','EXECUTE') and not has_function_privilege('anon','public.get_management_detail_v1(text,uuid)','EXECUTE'),'detail ACL is unchanged');
set local role authenticated;
select set_config('request.jwt.claim.sub','95100000-0000-4000-8000-000000000900',true);
select is((public.get_management_detail_v1('classes',('95100000-0000-4000-8000-'||lpad((700+n)::text,12,'0'))::uuid)->>'registeredCount')::integer,n,'registered total '||n) from unnest(array[0,30,31,65]) n;
select is((public.get_management_detail_v1('classes','95100000-0000-4000-8000-000000000765')->>'waitlistCount')::integer,31,'waitlist count exceeds the first page');
select is(jsonb_array_length(public.get_management_detail_v1('classes','95100000-0000-4000-8000-000000000765')#>'{registeredStudents,rows}'),30,'detail still loads only the bounded first page');
select throws_ok($$select public.list_management_detail_relation_page_v1('classes','95100000-0000-4000-8000-000000000765','invalid')$$,'22023','management_relation_invalid','existing validation SQLSTATE is preserved');
select * from finish();
rollback;
