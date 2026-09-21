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
select lives_ok($$insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.sid(4),'authenticated','authenticated','legacy-internal@tipsedu.co.kr','{}','{}')$$,'internal login alias remains compatible');
select is((select count(*) from public.profiles where id=pg_temp.sid(4)),0::bigint,'internal alias reuses the original identity');
select is((select role from public.profiles where id=pg_temp.sid(3)),'staff','internal alias preserves existing access role');
select * from finish();
rollback;
