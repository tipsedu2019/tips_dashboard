begin transaction read only;
set local statement_timeout='8s';
do $$begin perform set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' order by id limit 1),true);end$$;
set local role authenticated;
do $measure$declare test_case record; n integer; plan json; receipt jsonb:='[]';
begin
 for test_case in select * from (values(2,false),(1,true)) t(page,metadata) loop
  for n in 0..5 loop
   execute format('explain(analyze,buffers,format json) select public.get_academic_curriculum_numbered_page_v2(%L::jsonb,%s,10,%L::boolean)',
    '{"periodId":null,"search":"","status":"수강","subject":null,"grade":null,"teacher":null,"classroom":null,"viewMode":"all"}',test_case.page,test_case.metadata) into plan;
   if n>0 then receipt:=receipt||jsonb_build_array(jsonb_build_object('page',test_case.page,'metadata',test_case.metadata,'sample',n,'executionMs',plan->0->'Execution Time','sharedHits',plan#>'{0,Plan,Shared Hit Blocks}','tempReadBlocks',plan#>'{0,Plan,Temp Read Blocks}'));end if;
  end loop;
 end loop;
 perform set_config('app.curriculum_perf_receipt',receipt::text,true);
end $measure$;
select jsonb_build_object('atUTC',now(),'samples',current_setting('app.curriculum_perf_receipt')::jsonb,'functionMd5',md5(pg_get_functiondef('public.get_academic_curriculum_numbered_page_v2(jsonb,integer,integer,boolean)'::regprocedure))) receipt;
rollback;
