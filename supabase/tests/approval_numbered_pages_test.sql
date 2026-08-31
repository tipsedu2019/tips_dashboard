begin;
select no_plan();
set local timezone='Asia/Seoul';
set local statement_timeout='45s';
create function pg_temp.aid(n integer) returns uuid language sql immutable as $$
 select ('ac000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.actor(n integer) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',coalesce(pg_temp.aid(n)::text,''),true);
 perform set_config('request.jwt.claims',case when n is null then '{}' else jsonb_build_object('sub',pg_temp.aid(n),'role','authenticated')::text end,true);
end $$;

-- Real signup users/profile rows and permitted transitions; never disable triggers.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.aid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','approval-numbered-'||n||'@test.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
from generate_series(801,805)n;
insert into public.profiles(id,role,name,email,created_at,updated_at)
select pg_temp.aid(n),case when n=804 then 'admin' else 'teacher' end,'검증자 '||n,'approval-numbered-'||n||'@test.invalid',now(),now() from generate_series(801,805)n
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
-- ECMAScript trims these edges, but preserves U+0085 and internal whitespace.
update public.profiles set name=E'\t\n'||chr(160)||chr(65279) where id in(pg_temp.aid(802),pg_temp.aid(803));
select pg_temp.actor(804);
create temp table seed_before as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
insert into public.approval_requests(id,title,requester_id,approver_id,status,body,memo,checklist_items)
select pg_temp.aid(n),'번호 문서 '||n,pg_temp.aid(case when n<=126 then 801 else 802 end),pg_temp.aid(case when n in(127,128) then 801 else 803 end),
 case when n in(122,123,124,125,128,129) then 'submitted' else 'draft' end,
 case when n=1 then E'\t\n'||chr(160)||chr(65279) else ' 본문 ' end,case when n=1 then ' 이전 메모 ' else null end,
 case when n=1 then 'null'::jsonb when n=2 then '{}'::jsonb when n=3 then '[null,7,{"id":"","label":"drop"},{"id":"a","label":" A ","checked":true},{"id":"a","label":" B ","checked":true,"state":"na","group":" G "}]'::jsonb else '[]'::jsonb end
from generate_series(1,130)n;
update public.approval_requests set
 title=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'||'문서 '||chr(133)||'  내부'||E'\t\n'||chr(160)||chr(65279),
 body=E'\t\n'||chr(160)||chr(65279)||chr(133)||E'  본문\n내부'||chr(133)||chr(160)||chr(65279),
 memo=E'\t\n'||chr(160)||chr(65279)||'메모'||chr(65279),
 report_month=E'\t2026-08\n',class_summary=chr(160)||'수업'||chr(65279),student_issues=E'\t문제\n',next_month_plan=chr(65279)||'계획'||chr(160),attachment_links=E'\t링크\n'
where id=pg_temp.aid(4);
update public.approval_requests set status='reviewing' where id in(pg_temp.aid(123),pg_temp.aid(124),pg_temp.aid(129));
update public.approval_requests set status='approved' where id in(pg_temp.aid(124),pg_temp.aid(129));
update public.approval_requests set status='returned' where id=pg_temp.aid(125);
update public.approval_requests set status='canceled' where id=pg_temp.aid(126);
insert into public.approval_comments(id,approval_id,author_id,body) values
 (pg_temp.aid(501),pg_temp.aid(1),pg_temp.aid(804),'페이지 밖 댓글'),
 (pg_temp.aid(502),pg_temp.aid(120),pg_temp.aid(804),'선택 페이지 댓글');
select pg_temp.actor(803);
insert into public.approval_comments(id,approval_id,author_id,body) values
 (pg_temp.aid(503),pg_temp.aid(2),pg_temp.aid(803),E'\t\n'||chr(160)||chr(65279)||'댓글  내부'||chr(133)||chr(65279));
select pg_temp.actor(804);
set constraints all immediate;
select is((select count(*)::integer from public.approval_requests where id between pg_temp.aid(1) and pg_temp.aid(130)),130,'valid fixture contains130 requests');
select is((select count(*)::integer from public.approval_requests where status='approved' and id between pg_temp.aid(1) and pg_temp.aid(130)),2,'approved fixtures used legal submitted-reviewing-approved transitions');
select ok((select count(*) from dashboard_private.notification_events)>(select events from seed_before),'seed transitions recorded local events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from seed_before),'seed did not fan out or send deliveries');
select diag('local seed event delta='||((select count(*) from dashboard_private.notification_events)-(select events from seed_before))||', job delta='||((select count(*) from dashboard_private.notification_event_fanout_jobs)-(select jobs from seed_before)));
select has_function('public','list_approval_numbered_page_v1',array['text','integer','integer'],'numbered approval API exists');
select has_function('public','get_approval_detail_v1',array['uuid'],'independent authorized detail API exists');
-- Keep source legacy checklist JSON; the production adapter uses the existing parser.
with signatures(signature) as(values('public.list_approval_numbered_page_v1(text,integer,integer)'),('public.get_approval_detail_v1(uuid)'))
select ok(not p.prosecdef and p.proconfig in(array['search_path='],array['search_path=""'])
 and has_function_privilege('authenticated',signature,'EXECUTE') and not has_function_privilege('anon',signature,'EXECUTE')
 and not has_function_privilege('public',signature,'EXECUTE'),signature||' invoker pinned path authenticated-only ACL')
from signatures join pg_proc p on p.oid=signature::regprocedure;
select ok((select relrowsecurity from pg_class where oid='public.approval_requests'::regclass),'requests retain RLS');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='approval_requests' and policyname='approval_requests_select_involved_or_admin'),'final involved/admin policy retained');
create temp table read_before as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.approval_events) approval_events,
 (select count(*) from public.approval_comments) comments;

select pg_temp.actor(801);
set local role authenticated;
create temp table approval_eleven as select public.list_approval_numbered_page_v1('mine',11,10) data;
select is((data->>'totalCount')::integer,126,'mine includes authored requests across every status') from approval_eleven;
select is(data#>>'{rows,0,id}',pg_temp.aid(26)::text,'page11 direct starts at26 in stable updated_at/idDESC order') from approval_eleven;
select is(data#>>'{rows,9,id}',pg_temp.aid(17)::text,'page11 final ID17') from approval_eleven;
select is(data->'tabCounts','{"mine":126,"review":2,"open":125,"done":1,"returned":1}'::jsonb,'all five counts use complete authorized set independently of selected page') from approval_eleven;
select is(public.list_approval_numbered_page_v1('review',1,10)#>>'{rows,0,id}',pg_temp.aid(128)::text,'review is assigned and not closed');
select is(public.list_approval_numbered_page_v1('open',1,10)#>>'{rows,0,id}',pg_temp.aid(128)::text,'open excludes canceled returned and approved');
select is(public.list_approval_numbered_page_v1('done',1,10)#>>'{rows,0,id}',pg_temp.aid(124)::text,'done=approved');
select is(public.list_approval_numbered_page_v1('returned',1,10)#>>'{rows,0,id}',pg_temp.aid(125)::text,'returned tab exact status');
select is(jsonb_array_length(public.list_approval_numbered_page_v1('mine',13,10)->'rows'),6,'partial final page');
select is(jsonb_array_length(public.list_approval_numbered_page_v1('mine',14,10)->'rows'),0,'out-of-range page returns count and no rows for controller clamp');
select is((public.list_approval_numbered_page_v1('mine',14,10)->>'page')::integer,14,'out-of-range retains requested page');
select is(jsonb_array_length(public.list_approval_numbered_page_v1('mine',1,15)->'rows'),15,'size15');
select is(jsonb_array_length(public.list_approval_numbered_page_v1('mine',1,20)->'rows'),20,'size20');
select is((select count(distinct r->>'id')::integer from generate_series(1,13)p cross join lateral jsonb_array_elements(public.list_approval_numbered_page_v1('mine',p,10)->'rows')r),126,'static pages have no duplicate/omitted request');
select is(public.get_approval_detail_v1(pg_temp.aid(130)),null::jsonb,'unrelated request is not readable by direct ID');
select is(public.get_approval_detail_v1(pg_temp.aid(1))->>'body','이전 메모','detail preserves legacy body/memo fallback');
select is(public.get_approval_detail_v1(pg_temp.aid(1))->'checklistItems','null'::jsonb,'legacy JSONnull passes to shared checklist parser');
select is(public.get_approval_detail_v1(pg_temp.aid(2))->'checklistItems','{}'::jsonb,'legacy nonarray passes to shared checklist parser');
select is(public.get_approval_detail_v1(pg_temp.aid(1))#>>'{comments,0,body}','페이지 밖 댓글','direct off-page detail includes its comments');
select is((select count(*)::integer from public.profiles where id=pg_temp.aid(804)),0,'teacher cannot read another profile under final profile RLS');
select is(public.get_approval_detail_v1(pg_temp.aid(1))#>>'{comments,0,authorLabel}','작성자','comment label keeps fallback when author profile is hidden by RLS');
select is(public.get_approval_detail_v1(pg_temp.aid(1))->>'requesterLabel','검증자 801','visible requester profile label');
select is((select count(*)::integer from jsonb_array_elements(public.list_approval_numbered_page_v1('mine',1,10)->'rows')r cross join lateral jsonb_array_elements(r->'comments')c where c->>'body'='페이지 밖 댓글'),0,'off-page comments are not enriched into page');
select is((select count(*)::integer from jsonb_array_elements(public.list_approval_numbered_page_v1('mine',1,10)->'rows')r cross join lateral jsonb_array_elements(r->'comments')c where c->>'body'='선택 페이지 댓글'),1,'selected-page parent comments enriched');
select ok(not exists(select 1 from jsonb_array_elements(public.list_approval_numbered_page_v1('mine',1,10)->'rows')r cross join lateral jsonb_array_elements(r->'events')e where e->>'approvalId'<>r->>'id'),'page event histories belong only to selected parent IDs');
select throws_ok($$select public.list_approval_numbered_page_v1(null,1,10)$$,'22023',null,'null view rejected');
select throws_ok($$select public.list_approval_numbered_page_v1('all',1,10)$$,'22023',null,'invalid view rejected');
select throws_ok($$select public.list_approval_numbered_page_v1('mine',null,10)$$,'22023',null,'null page rejected');
select throws_ok($$select public.list_approval_numbered_page_v1('mine',0,10)$$,'22023',null,'zero page rejected');
select throws_ok($$select public.list_approval_numbered_page_v1('mine',1,null)$$,'22023',null,'null size rejected');
select throws_ok($$select public.list_approval_numbered_page_v1('mine',1,5)$$,'22023',null,'size5 rejected');
select throws_ok($$select public.list_approval_numbered_page_v1('mine',1,30)$$,'22023',null,'size30 rejected');
select lives_ok($$select public.list_approval_numbered_page_v1('mine',2147483647,20)$$,'bigint offset avoids integer overflow');
select throws_ok($$select public.get_approval_detail_v1(null)$$,'22023',null,'null direct ID rejected');
reset role;
select pg_temp.actor(805);set local role authenticated;
select is(public.list_approval_numbered_page_v1('mine',1,10)->'tabCounts','{"mine":0,"review":0,"open":0,"done":0,"returned":0}'::jsonb,'unrelated actor empty authoritative count');
select is(public.get_approval_detail_v1(pg_temp.aid(1)),null::jsonb,'unrelated actor cannot bypass RLS');
reset role;
select pg_temp.actor(804);set local role authenticated;
select is(public.list_approval_numbered_page_v1('mine',1,10)->'tabCounts','{"mine":0,"review":0,"open":126,"done":2,"returned":1}'::jsonb,'actual admin role sees every authorized status but mine stays own');
select is(public.get_approval_detail_v1(pg_temp.aid(130))->>'id',pg_temp.aid(130)::text,'admin direct detail visibility');
select is(public.get_approval_detail_v1(pg_temp.aid(1))#>>'{comments,0,authorLabel}','검증자 804','admin visible-profile comment label');
select ok((public.get_approval_detail_v1(pg_temp.aid(1))->>'createdAt') like '%T%','timestamp retains ISO transport shape');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'title','문서 '||chr(133)||'  내부','all ECMAScript edge whitespace trimmed, internal whitespace and U0085 preserved');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'body',chr(133)||E'  본문\n내부'||chr(133),'body trims JS whitespace without deleting internal whitespace or U0085');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'memo','메모','memo trims tabs newlines NBSP FEFF');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'reportMonth','2026-08','report month source string trimmed');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'classSummary','수업','summary trims NBSP FEFF');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'studentIssues','문제','student issues trim tabs and newlines');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'nextMonthPlan','계획','next month plan trims JS whitespace');
select is(public.get_approval_detail_v1(pg_temp.aid(4))->>'attachmentLinks','링크','attachments trim tabs and newlines');
select is(public.get_approval_detail_v1(pg_temp.aid(130))->>'requesterLabel','approval-numbered-802@test.invalid','whitespace-only visible profile name falls through to email');
select is(public.get_approval_detail_v1(pg_temp.aid(130))->>'approverLabel','approval-numbered-803@test.invalid','approver whitespace name falls through to email');
select is(public.get_approval_detail_v1(pg_temp.aid(2))#>>'{comments,0,body}','댓글  내부'||chr(133),'comment trim preserves internal whitespace and U0085');
select is(public.get_approval_detail_v1(pg_temp.aid(2))#>>'{comments,0,authorLabel}','approval-numbered-803@test.invalid','comment label applies JS trim before profile fallback');
reset role;
select pg_temp.actor(null);set local role authenticated;
select throws_ok($$select public.list_approval_numbered_page_v1('mine',1,10)$$,'42501',null,'authenticated SQL role without UID cannot read');
select throws_ok($$select public.get_approval_detail_v1(pg_temp.aid(1))$$,'42501',null,'detail requires UID');
reset role;set local role anon;
select throws_ok($$select public.list_approval_numbered_page_v1('mine',1,10)$$,'42501',null,'anon page execute denied');
select throws_ok($$select public.get_approval_detail_v1(pg_temp.aid(1))$$,'42501',null,'anon detail execute denied');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from read_before),'read phase no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),(select jobs from read_before),'read phase no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from read_before),'read phase no deliveries');
select is((select count(*) from public.approval_events),(select approval_events from read_before),'read phase no approval events');
select is((select count(*) from public.approval_comments),(select comments from read_before),'read phase no comments');
select * from finish();
rollback;
