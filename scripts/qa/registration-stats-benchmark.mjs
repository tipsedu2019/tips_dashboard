import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { PsqlConnection } from '../verify-timetable-concurrency.mjs';

const container = process.argv[process.argv.indexOf('--container') + 1];
assert.ok(process.argv.includes('--local') && /^tips_timetable_perf_[a-z0-9_]+$/.test(container));
const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none');
assert.deepEqual(inspection.NetworkSettings.Ports, {});
const db = new PsqlConnection(container);
const report = { source: 'isolated synthetic DB; not field latency', cases: 500, tracks: 1000, samplesPerVariant: 25, parity: [], samples: [] };
const q = value => "'" + value.replaceAll("'", "''") + "'";
try {
  const fixture = await readFile('supabase/tests/ops_task_numbered_pages_test.sql', 'utf8');
  const end = fixture.indexOf('-- The current withdrawal source');
  assert.ok(end > 0);
  await db.ok(fixture.slice(0, end));
  await db.ok(`
    insert into public.ops_tasks(id,title,type,status,priority,requested_by,subject,student_name)
    select ('96910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      'stats-scale '||n,'registration','requested','normal',
      '94000000-0000-4000-8000-000000000002','영어, 수학','scale student '||n from generate_series(1,500) n;
    insert into public.ops_registration_details(task_id,parent_phone,school_name)
    select id,'010-0000-0000','synthetic school' from public.ops_tasks where title like 'stats-scale%';
    insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,waiting_kind,observation_return_workflow_status,director_profile_id,director_assignment_source,director_assigned_at)
    select ('96920000-0000-4000-8000-'||lpad(series.n::text,12,'0'))::uuid,
      ('96910000-0000-4000-8000-'||lpad(((series.n+1)/2)::text,12,'0'))::uuid,
      case when series.n%2=1 then '영어' else '수학' end,pipeline,workflow,1,waiting_kind,
      case when view_key='observation' then 'consultation_completed' end,
      '94000000-0000-4000-8000-000000000001','manual',now()
    from generate_series(1,1000) series(n) join stage_fixture stage on stage.n=1+(series.n-1)%15;
    analyze public.ops_tasks; analyze public.ops_registration_details; analyze public.ops_registration_subject_tracks;
  `);
  const before = await readFile('docs/reviews/performance-latency-20260928/before-registration-stats-helper.sql', 'utf8');
  await db.ok(before.replace('dashboard_private.ops_registration_task_stats_v1', 'pg_temp.before_stats_helper')+';');
  const wrapper = await db.ok("select pg_get_functiondef('public.get_ops_task_list_stats_v1(text,jsonb)'::regprocedure);");
  await db.ok(wrapper.replace('public.get_ops_task_list_stats_v1','pg_temp.before_stats').replaceAll('dashboard_private.ops_registration_task_stats_v1','pg_temp.before_stats_helper')+';');
  const base = {taskType:'registration', search:'', statuses:[], view:'inquiry', consultationOwnerId:null};
  const filters = [base, {...base,search:'scale student 12'}, {...base,view:'consultation_requested',consultationOwnerId:'94000000-0000-4000-8000-000000000001'}, {...base,statuses:['requested'],view:'completed'}];
  await db.ok("set local role authenticated; set local request.jwt.claim.sub='94000000-0000-4000-8000-000000000001';");
  report.firstInvocation = [];
  for (const [variant,fn] of [['before','pg_temp.before_stats'],['after','public.get_ops_task_list_stats_v1']]) {
    const plan=await db.value(`explain(analyze,buffers,format json) select ${fn}('registration',${q(JSON.stringify(base))}::jsonb);`);
    report.firstInvocation.push({variant,ms:plan[0]['Execution Time'],sharedHits:plan[0].Plan['Shared Hit Blocks']});
  }
  for (const actor of [1,2,3]) {
    await db.ok(`reset role; set local role authenticated; set local request.jwt.claim.sub='94000000-0000-4000-8000-${String(actor).padStart(12,'0')}';`);
    for (const [i,filter] of filters.entries()) {
      const equal = await db.value(`select (public.get_ops_task_list_stats_v1('registration',${q(JSON.stringify(filter))}::jsonb)=pg_temp.before_stats('registration',${q(JSON.stringify(filter))}::jsonb))::text;`);
      assert.equal(equal,true); report.parity.push({actor,filter:i,equal});
    }
  }
  await db.ok("set local request.jwt.claim.sub='94000000-0000-4000-8000-000000000001';");
  for (const [filterIndex, filter] of filters.entries()) {
    for (let n=-2;n<report.samplesPerVariant;n++) {
      const variants = [['before','pg_temp.before_stats'],['after','public.get_ops_task_list_stats_v1']];
      if (n%2===0) variants.reverse();
      for (const [variant,fn] of variants) {
        const plan = await db.value(`explain(analyze,buffers,format json) select ${fn}('registration',${q(JSON.stringify(filter))}::jsonb);`);
        if(n>=0) report.samples.push({filter:filterIndex,variant,ms:plan[0]['Execution Time'],sharedHits:plan[0].Plan['Shared Hit Blocks']});
      }
    }
  }
  report.results = filters.map((filter,i)=>({filter,...Object.fromEntries(['before','after'].map(variant=>{
    const rows=report.samples.filter(r=>r.variant===variant&&r.filter===i).sort((a,b)=>a.ms-b.ms);
    return [variant,{n:rows.length,p50Ms:rows[12].ms,p95Ms:rows[23].ms,maxMs:rows[24].ms,maxSharedHits:Math.max(...rows.map(r=>r.sharedHits))}];
  }))}));
  assert.ok(report.results[0].after.p50Ms < report.results[0].before.p50Ms, 'empty-search median must improve');
  assert.ok(report.results[0].after.maxSharedHits < report.results[0].before.maxSharedHits * .6, 'empty search must remove unnecessary reads');
  report.passed=true;
} finally {
  await db.ok('rollback;'); db.close();
  await writeFile('docs/reviews/performance-latency-20260928/benchmark.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({results:report.results,parity:report.parity,passed:report.passed},null,2));
