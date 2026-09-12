-- Isolated local database only. Uses fictional values and a fixture role resolver.
begin;
select plan(39);
create temporary table recruiting_qa_results(label text primary key, payload jsonb);
grant all on recruiting_qa_results to service_role;

select is((select prosecdef from pg_proc where oid = 'public.submit_recruiting_application_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,integer)'::regprocedure), false, 'intake is security invoker');
select is((select prosecdef from pg_proc where oid = 'public.purge_expired_recruiting_applications_v1()'::regprocedure), false, 'purge is security invoker');
select ok(not has_function_privilege('anon', 'public.submit_recruiting_application_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,integer)', 'execute'), 'anonymous cannot invoke intake RPC directly');
select ok(not has_function_privilege('authenticated', 'public.purge_expired_recruiting_applications_v1()', 'execute'), 'authenticated cannot invoke purge');
select ok(not has_table_privilege('anon', 'public.recruiting_applications', 'select'), 'anonymous has no application read grant');
select ok(not has_table_privilege('authenticated', 'public.recruiting_application_receipts', 'select'), 'request receipts are private');
select ok(not has_table_privilege('authenticated', 'public.recruiting_application_rate_limits', 'select'), 'fingerprints are private');
select is((select count(*)::integer from cron.job where jobname='recruiting-retention-cleanup' and active and schedule='13 * * * *'), 1, 'hourly cleanup installed and active');

set local role service_role;
insert into recruiting_qa_results values ('first', public.recruiting_fixture_submit('a0000000-0000-4000-8000-000000000001'));
select is((select payload->>'status' from recruiting_qa_results where label='first'), 'accepted', 'valid submission accepted');
select is((select count(*)::integer from public.recruiting_applications), 1, 'one application stored');
select is((public.recruiting_fixture_submit('a0000000-0000-4000-8000-000000000001')->>'applicationId'), (select payload->>'applicationId' from recruiting_qa_results where label='first'), 'retry returns same ID');
select is((public.recruiting_fixture_submit('a0000000-0000-4000-8000-000000000001', 'contact', 'ip', 'changed')->>'status'), 'conflict', 'same request ID with changed content conflicts');
select ok((select retention_days=365 and consent_version='talent-pool-v1' and expires_at=consented_at+interval '365 days' from public.recruiting_applications limit 1), 'consent and expiry use one retention policy');
select throws_ok($$select public.submit_recruiting_application_v1(gen_random_uuid(), 'invalid', repeat('a',64), repeat('b',64), repeat('c',64), 'QA', '01000000000', '과학', 'fixture', 'fixture motivation', null, 'talent-pool-v1', 365)$$, '22023', 'recruiting_request_invalid', 'RPC invalid input uses exact 22023, never a business 40001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select set_config('recruiting.fixture_role', 'staff', true);
select is((select count(*)::integer from public.recruiting_applications), 0, 'staff cannot read applications');
select is((select count(*)::integer from public.recruiting_retention_status), 0, 'staff cannot read retention metadata');
select throws_ok($$select public.recruiting_fixture_submit(gen_random_uuid())$$, '42501', 'permission denied for function submit_recruiting_application_v1', 'authenticated cannot bypass public validation with direct RPC');
with removed as (delete from public.recruiting_applications returning id) select is(count(*)::integer, 0, 'staff cannot delete an application') from removed;
select set_config('recruiting.fixture_role', 'admin', true);
select is((select count(*)::integer from public.recruiting_applications), 1, 'admin reads retained applications');
select is((select count(*)::integer from public.recruiting_retention_status), 1, 'admin sees cleanup health');
select throws_ok($$update public.recruiting_applications set motivation='changed content'$$, '42501', 'permission denied for table recruiting_applications', 'admin cannot alter consent or application content');
with removed as (delete from public.recruiting_applications returning id) select is(count(*)::integer, 1, 'admin can permanently delete requested application') from removed;

set local role service_role;
select is((select count(*)::integer from public.recruiting_application_receipts where application_id is null), 1, 'deletion leaves only a PII-free random request receipt');
select is(public.recruiting_fixture_submit('a0000000-0000-4000-8000-000000000001')->>'status', 'gone', 'delayed retry cannot recreate deleted application');
insert into recruiting_qa_results values ('expired', public.recruiting_fixture_submit('a0000000-0000-4000-8000-000000000002', 'expiry-contact', 'expiry-ip'));
update public.recruiting_applications set created_at=now()-interval '400 days', consented_at=now()-interval '400 days', expires_at=now()-interval '35 days';
update public.recruiting_application_receipts set expires_at=now()-interval '35 days' where application_id is not null;
set local role authenticated;
select is((select count(*)::integer from public.recruiting_applications), 0, 'expired content is hidden even before physical purge');
set local role service_role;
select is((public.purge_expired_recruiting_applications_v1()->>'applications')::integer, 1, 'purge physically deletes expired content');
select is((select count(*)::integer from public.recruiting_application_receipts where application_id is not null), 0, 'purge removes expired receipts');
update public.recruiting_retention_status set last_succeeded_at=now()-interval '4 hours';
select is(public.recruiting_fixture_submit(gen_random_uuid(), 'health-contact', 'health-ip')->>'status', 'unavailable', 'stale cleanup health closes intake');
select public.purge_expired_recruiting_applications_v1();
select is(public.recruiting_fixture_submit(gen_random_uuid(), 'health-contact', 'health-ip')->>'status', 'accepted', 'successful cleanup restores intake');

insert into recruiting_qa_results select 'contact-'||n, public.recruiting_fixture_submit(gen_random_uuid(), 'quota-contact', 'quota-contact-ip-'||n) from generate_series(1,4) as n;
select is((select count(*)::integer from recruiting_qa_results where label like 'contact-%' and payload->>'status'='accepted'), 3, 'contact quota permits three daily submissions');
select is((select payload->>'status' from recruiting_qa_results where label='contact-4'), 'rate_limited', 'fourth contact submission rate-limited');
insert into recruiting_qa_results select 'ip-'||n, public.recruiting_fixture_submit(gen_random_uuid(), 'quota-ip-contact-'||n, 'quota-ip') from generate_series(1,6) as n;
select is((select count(*)::integer from recruiting_qa_results where label like 'ip-%' and payload->>'status'='accepted'), 5, 'IP quota permits five hourly submissions');
select is((select payload->>'status' from recruiting_qa_results where label='ip-6'), 'rate_limited', 'sixth IP submission rate-limited');
update public.recruiting_application_rate_limits set request_count=100 where fingerprint=repeat(md5('global'),2);
select is(public.recruiting_fixture_submit(gen_random_uuid(), 'global-contact', 'global-ip')->>'status', 'rate_limited', 'global quota also limits new identities');

-- The policy switch applies only to new applications; saved v1 timestamps remain authoritative.
create temporary table recruiting_qa_legacy as select id, consent_version, retention_days, consented_at, expires_at from public.recruiting_applications;
update public.recruiting_application_rate_limits set request_count=1 where fingerprint=repeat(md5('global'),2);
insert into recruiting_qa_results values ('two-year', public.submit_recruiting_application_v1(gen_random_uuid(), repeat(md5('v2-request'),2), repeat(md5('v2-ip'),2), repeat(md5('v2-contact'),2), repeat(md5('global'),2), '모의 지원자', '01000000000', '과학', '모의 경력', '실제 지원서가 아닌 테스트 동기입니다.', null, 'talent-pool-v2', 730));
select is((select payload->>'status' from recruiting_qa_results where label='two-year'), 'accepted', 'new v2 submission accepted');
select ok((select retention_days=730 and consent_version='talent-pool-v2' and expires_at=consented_at+interval '730 days' from public.recruiting_applications where id=(select (payload->>'applicationId')::uuid from recruiting_qa_results where label='two-year')), 'v2 stores the exact 730-day expiry pair');
select ok(not exists(select 1 from recruiting_qa_legacy old left join public.recruiting_applications current on current.id=old.id where row(current.consent_version,current.retention_days,current.consented_at,current.expires_at) is distinct from row(old.consent_version,old.retention_days,old.consented_at,old.expires_at)), 'new v2 intake does not extend or modify any retained v1 record');
select throws_ok($$select public.submit_recruiting_application_v1(gen_random_uuid(), repeat('a',64), repeat('b',64), repeat('c',64), repeat('d',64), 'QA', '01000000000', '과학', 'fixture', 'fixture motivation', null, 'talent-pool-v2', 365)$$, '22023', 'recruiting_request_invalid', 'v2 cannot be paired with 365 days');
select throws_ok($$select public.submit_recruiting_application_v1(gen_random_uuid(), repeat('a',64), repeat('b',64), repeat('c',64), repeat('d',64), 'QA', '01000000000', '과학', 'fixture', 'fixture motivation', null, 'talent-pool-v1', 730)$$, '22023', 'recruiting_request_invalid', 'v1 consent cannot be paired with longer 730-day retention');

reset role;
select * from finish();
rollback;
