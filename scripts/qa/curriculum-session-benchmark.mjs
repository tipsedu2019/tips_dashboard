import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PsqlConnection } from '../verify-timetable-concurrency.mjs';

const container = process.argv[process.argv.indexOf('--container') + 1];
assert.ok(process.argv.includes('--local') && /^tips_timetable_perf_[a-z0-9_]+$/.test(container));
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(info.HostConfig.NetworkMode, 'none'); assert.deepEqual(info.NetworkSettings.Ports, {});
const db = new PsqlConnection(container);
const report = { source: 'isolated synthetic DB, not production latency', samplesPerVariant: 25, classes: 105, savedSessionsPerClass: 120, roleParity: [], samples: [] };
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const filters = extra => quote(JSON.stringify({ periodId: null, search: '__curriculum_perf__', status: null, subject: null, grade: null, teacher: null, classroom: null, viewMode: 'all', ...extra }))+'::jsonb';
try {
  await db.ok(`begin;set local statement_timeout='30s';set local timezone='Asia/Seoul';
    create function pg_temp.fid(n int) returns uuid language sql immutable as $$select ('cd280000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
    insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.fid(900),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','curriculum-perf@example.invalid');
    insert into public.profiles(id,role,name) values(pg_temp.fid(900),'admin','Synthetic performance actor') on conflict(id) do update set role=excluded.role;
    insert into public.classes(id,name,status,subject,grade,teacher,room,schedule_storage_mode,schedule_plan)
    select pg_temp.fid(n),'__curriculum_perf__ '||n,'개강 준비',case when n%2=0 then '수학' else '영어' end,'중2','합성 교사','합성 1강',
      case when n>100 then 'normalized' when n%2=0 then 'shadow' else 'legacy' end,
      jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object('id','session-'||d,'date',case when d%17=0 then '2026-02-31' else (current_date+d-60)::text end,'startTime','16:00','endTime','17:00','state',case when d%11=0 then 'skipped' when d%13=0 then 'force_active' else 'active' end)) from generate_series(1,120) d))
    from generate_series(1,105) n;
    select set_config('app.class_schedule_mutation','release2-rpc',true);
    insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,origin)
    select pg_temp.fid(n),'normalized-'||d,current_date+d-60,case when d%11=0 then 'skipped' else 'active' end,'manual' from generate_series(101,105) n cross join generate_series(1,120) d;
  `);
  let before = await readFile('supabase/migrations/20260922054047_curriculum_schedule_and_class_textbooks.sql','utf8');
  before = before.slice(before.indexOf('create function public.get_academic_curriculum_numbered_page_v2('));
  before = before.slice(0,before.indexOf('revoke all on function')).replace('public.get_academic_curriculum_numbered_page_v2','pg_temp.before_curriculum');
  await db.ok(before);
  for (const role of ['admin','staff','teacher','assistant','viewer']) {
    await db.ok(`reset role;update public.profiles set role='${role}' where id=pg_temp.fid(900);set local request.jwt.claim.sub='cd280000-0000-4000-8000-000000000900';set local role authenticated;`);
    for (const extra of [{},{viewMode:'unlinked'},{viewMode:'unscheduled'},{viewMode:'update'},{viewMode:'done'},{subject:'수학'},{search:'__no_matches__'}]) for (const metadata of [true,false]) {
      const equal = await db.value(`select (public.get_academic_curriculum_numbered_page_v2(${filters(extra)},2,20,${metadata})=pg_temp.before_curriculum(${filters(extra)},2,20,${metadata}))::text;`);
      assert.equal(equal,true,JSON.stringify({role,extra,metadata}));
    }
    report.roleParity.push({role,comparisons:14,equal:true});
  }
  await db.ok("reset role;update public.profiles set role='admin' where id=pg_temp.fid(900);set local role authenticated;");
  for (let n=-1;n<report.samplesPerVariant;n++) for (const [variant,fn] of [['before','pg_temp.before_curriculum'],['after','public.get_academic_curriculum_numbered_page_v2']]) {
    const plan = await db.value(`explain(analyze,buffers,format json) select ${fn}(${filters({})},1,20,false);`);
    if(n>=0) report.samples.push({variant,ms:plan[0]['Execution Time'],sharedHits:plan[0].Plan['Shared Hit Blocks'],tempReads:plan[0].Plan['Temp Read Blocks']});
  }
  for (const variant of ['before','after']) {
    const samples=report.samples.filter(s=>s.variant===variant).sort((a,b)=>a.ms-b.ms);
    report[variant]={n:samples.length,p50Ms:samples[Math.ceil(samples.length*.5)-1].ms,p95Ms:samples[Math.ceil(samples.length*.95)-1].ms,maxMs:samples.at(-1).ms};
  }
  report.passed=true;
} finally {
  await db.ok('rollback;');db.close();
  await mkdir('docs/reviews/performance-second-pass-20260928',{recursive:true});
  await writeFile('docs/reviews/performance-second-pass-20260928/benchmark.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({before:report.before,after:report.after,roleParity:report.roleParity,passed:report.passed}));
