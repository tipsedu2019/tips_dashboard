begin;
select no_plan();
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('a9600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(1),'authenticated','authenticated','identity-collision@gmail.com','{}','{"name":"기존 교사"}');
-- Recreate a pre-migration profile whose login ID was the local part.
update public.profiles set login_id='identity-collision',role='teacher' where id=pg_temp.sid(1);
update public.teacher_catalogs set dashboard_role='teacher',is_visible=false where profile_id=pg_temp.sid(1);
create temp table previous_profile as select to_jsonb(p) value from public.profiles p where id=pg_temp.sid(1);
create temp table previous_teacher as select to_jsonb(t) value from public.teacher_catalogs t where profile_id=pg_temp.sid(1);
select lives_ok($$insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(2),'authenticated','authenticated','identity-collision@naver.com','{}','{"name":"다른 교사"}')$$,'same local part in another domain signs up independently');
select is((select to_jsonb(p) from public.profiles p where id=pg_temp.sid(1)),(select value from previous_profile),'existing profile remains byte-for-byte unchanged');
select is((select to_jsonb(t) from public.teacher_catalogs t where profile_id=pg_temp.sid(1)),(select value from previous_teacher),'existing teacher identity and visibility unchanged');
select is((select role from public.profiles where id=pg_temp.sid(2)),'viewer','new account starts as viewer');
select is((select email from public.profiles where id=pg_temp.sid(2)),'identity-collision@naver.com','new auth ID owns its profile');
select is((select login_id from public.profiles where id=pg_temp.sid(2)),'identity-collision@naver.com','external login ID preserves complete identity');
select is((select count(*) from public.teacher_catalogs where profile_id=pg_temp.sid(2)),1::bigint,'new profile has its own teacher row');
select ok((select teacher_catalog_id from public.profiles where id=pg_temp.sid(1)) is distinct from
 (select teacher_catalog_id from public.profiles where id=pg_temp.sid(2)),'teacher links remain separate');
-- Existing internal login aliases continue to resolve to their original profile.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(3),'authenticated','authenticated','legacy-alias@example.invalid','{}','{}');
update public.profiles set login_id='legacy-internal',role='staff' where id=pg_temp.sid(3);
update public.teacher_catalogs set dashboard_role='staff',is_visible=false where profile_id=pg_temp.sid(3);
create temp table internal_teacher_before as select to_jsonb(t) value from public.teacher_catalogs t where profile_id=pg_temp.sid(3);
select lives_ok($$insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(4),'authenticated','authenticated','legacy-internal@tipsedu.co.kr','{}','{}')$$,'internal login alias remains compatible');
select is((select count(*) from public.profiles where id=pg_temp.sid(4)),0::bigint,'internal alias reuses the original identity');
select is((select role from public.profiles where id=pg_temp.sid(3)),'staff','internal alias preserves existing access role');
select is((select to_jsonb(t) from public.teacher_catalogs t where profile_id=pg_temp.sid(3)),(select value from internal_teacher_before),'internal alias preserves teacher role, visibility and account identity');
-- A user-selected display name never proves ownership of a pre-created teacher.
insert into public.teacher_catalogs(id,name,account_email,dashboard_role,is_visible)
values(pg_temp.sid(100),'동명이인 교사','reserved@example.invalid','teacher',false);
create temp table reserved_teacher_before as select to_jsonb(t) value from public.teacher_catalogs t where id=pg_temp.sid(100);
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(5),'authenticated','authenticated','unrelated@example.invalid','{}','{"name":"동명이인 교사"}');
select is((select to_jsonb(t) from public.teacher_catalogs t where id=pg_temp.sid(100)),(select value from reserved_teacher_before),'display-name collision cannot claim or modify the reserved teacher');
select isnt((select teacher_catalog_id from public.profiles where id=pg_temp.sid(5)),pg_temp.sid(100),'same-name signup receives a separate teacher identity');
-- An unconfirmed address is not a trusted claim to a pre-created catalog.
insert into public.teacher_catalogs(id,name,account_email,dashboard_role,is_visible)
values(pg_temp.sid(101),'이메일 예약 교사','unconfirmed@example.invalid','teacher',false);
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(6),'authenticated','authenticated','unconfirmed@example.invalid','{}','{"name":"새 가입자"}');
select is((select profile_id from public.teacher_catalogs where id=pg_temp.sid(101)),null::uuid,'unconfirmed signup cannot claim an email-reserved teacher');
-- Ordinary email/password signup confirms by UPDATE after the auth row exists.
select is((select teacher_catalog_id from public.profiles where id=pg_temp.sid(6)),null::uuid,'reserved signup defers catalog allocation until email confirmation');
select is((select count(*) from public.teacher_catalogs where profile_id=pg_temp.sid(6)),0::bigint,'unconfirmed reserved signup creates no duplicate catalog');
select lives_ok($$update auth.users set email_confirmed_at=now() where id=pg_temp.sid(6)$$,'deferred email confirmation completes signup');
select is((select profile_id from public.teacher_catalogs where id=pg_temp.sid(101)),pg_temp.sid(6),'confirmation update claims the exact-email reserved catalog');
select is((select teacher_catalog_id from public.profiles where id=pg_temp.sid(6)),pg_temp.sid(101),'confirmation publishes the matching reverse link');
select is((select count(*) from public.teacher_catalogs where profile_id=pg_temp.sid(6)),1::bigint,'confirmation creates exactly one linked catalog');
select is((select role from public.profiles where id=pg_temp.sid(6)),'viewer','confirmation cannot elevate profile privileges');
select is((select dashboard_role from public.teacher_catalogs where id=pg_temp.sid(101)),'viewer','reserved catalog cannot elevate confirmed account privileges');
update public.teacher_catalogs set dashboard_role='teacher',is_visible=false where id=pg_temp.sid(101);
create temp table confirmed_teacher_before as select to_jsonb(t) value from public.teacher_catalogs t where id=pg_temp.sid(101);
update auth.users set email_confirmed_at=now()+interval '1 day',raw_user_meta_data='{"name":"재확인 이름"}' where id=pg_temp.sid(6);
select is((select to_jsonb(t) from public.teacher_catalogs t where id=pg_temp.sid(101)),(select value from confirmed_teacher_before),'repeated confirmation updates preserve existing teacher settings');
-- A normal signup with an existing owned catalog remains linked on confirmation.
update auth.users set email_confirmed_at=now() where id=pg_temp.sid(1);
select is((select to_jsonb(t) from public.teacher_catalogs t where profile_id=pg_temp.sid(1)),(select value from previous_teacher),'later confirmation preserves an already owned catalog');
-- Verified email remains a supported ownership signal.
insert into public.teacher_catalogs(id,name,account_email,dashboard_role,is_visible)
values(pg_temp.sid(102),'확인된 이메일 교사','confirmed@example.invalid','viewer',false);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(7),'authenticated','authenticated','confirmed@example.invalid',now(),'{}','{"name":"본인 가입"}');
select is((select profile_id from public.teacher_catalogs where id=pg_temp.sid(102)),pg_temp.sid(7),'verified address can claim its reserved teacher');
-- A stale reverse link must not overwrite a catalog already owned by someone else.
update public.profiles set login_id='stale-internal',teacher_catalog_id=
 (select teacher_catalog_id from public.profiles where id=pg_temp.sid(1)) where id=pg_temp.sid(3);
select lives_ok($$insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(8),'authenticated','authenticated','stale-internal@tipsedu.co.kr',now(),'{}','{}')$$,'signup repairs a stale reverse link without claiming another owner');
select is((select to_jsonb(t) from public.teacher_catalogs t where id=(select teacher_catalog_id from public.profiles where id=pg_temp.sid(1))),
 (select value from previous_teacher),'stale reverse link cannot overwrite another owner');
select isnt((select teacher_catalog_id from public.profiles where id=pg_temp.sid(3)),
 (select teacher_catalog_id from public.profiles where id=pg_temp.sid(1)),'stale reverse link is replaced with an independently owned teacher');
-- Name allocation is bounded and failure rolls back the whole signup.
insert into public.teacher_catalogs(id,name)
select pg_temp.sid(1000+n),'가입 이름 한도' || case when n=1 then '' else ' ('||n::text||')' end
from generate_series(1,100) n;
select throws_ok($$insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(9),'authenticated','authenticated','name-limit@example.invalid','{}','{"name":"가입 이름 한도"}')$$,
 '23505','signup_teacher_name_conflict','exhausted name allocation raises exact unique-conflict SQLSTATE');
select is((select count(*) from auth.users where id=pg_temp.sid(9)),0::bigint,'failed name allocation leaves no auth account');
select is((select count(*) from public.profiles where id=pg_temp.sid(9)),0::bigint,'failed name allocation leaves no partial profile');
select * from finish();
rollback;
