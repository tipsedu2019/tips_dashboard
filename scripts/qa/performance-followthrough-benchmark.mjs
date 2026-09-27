import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { PsqlConnection } from '../verify-timetable-concurrency.mjs';

const container = process.argv[process.argv.indexOf('--container') + 1];
assert.ok(process.argv.includes('--local') && /^tips_timetable_perf_[a-z0-9_]+$/.test(container));
const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none'); assert.deepEqual(inspection.NetworkSettings.Ports, {});
const db = new PsqlConnection(container);
const report = { source: 'isolated synthetic DB; not field latency', samplesPerVariant: 25, students: 1000, classes: 535, samples: [], roleParity: [] };
try {
  const fixture = await readFile('supabase/tests/student_enrollment_status_test.sql', 'utf8');
  const initialEnd = fixture.indexOf('set local role authenticated;');
  const scaleStart = fixture.indexOf('insert into public.students(id,name,uid,grade,status,class_ids,waitlist_class_ids)');
  const scaleEnd = fixture.indexOf('create function pg_temp.student_status_explain()');
  assert.ok(initialEnd > 0 && scaleStart > initialEnd && scaleEnd > scaleStart);
  await db.ok(fixture.slice(0, initialEnd) + '\n' + fixture.slice(scaleStart, scaleEnd));
  const finalDefinition = await db.ok("select pg_get_functiondef('public.get_management_stats_v1(text,jsonb)'::regprocedure);");
  const beforeDefinition = finalDefinition.replace('public.get_management_stats_v1', 'pg_temp.before_stats')
    .replace('join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=student.id',
      'cross join lateral dashboard_private.management_student_enrollment_summary_v1(student.id) enrollment(value)');
  assert.notEqual(beforeDefinition, finalDefinition);
  await db.ok(beforeDefinition);
  const filters = `' {"kind":"students","search":"__enrollment_scale__","status":null,"schoolCategory":null,"school":null,"grade":null}'::jsonb`;
  for (const role of ['admin','staff','teacher','assistant','viewer']) {
    await db.ok(`reset role;update public.profiles set role='${role}' where id='95000000-0000-4000-8000-000000000900';set local role authenticated;set local request.jwt.claim.sub='95000000-0000-4000-8000-000000000900';`);
    const parity = await db.value(`select (public.get_management_stats_v1('students',${filters})=pg_temp.before_stats('students',${filters}))::text;`);
    assert.equal(parity, true); report.roleParity.push({ role, equal: parity });
  }
  await db.ok("reset role;update public.profiles set role='admin' where id='95000000-0000-4000-8000-000000000900';set local role authenticated;");
  for (let n = -1; n < report.samplesPerVariant; n++) for (const [variant, fn] of [['before','pg_temp.before_stats'],['after','public.get_management_stats_v1']]) {
    const plan = await db.value(`explain(analyze,buffers,format json) select ${fn}('students',${filters});`);
    if (n >= 0) report.samples.push({ variant, ms: plan[0]['Execution Time'], sharedHits: plan[0].Plan['Shared Hit Blocks'] });
  }
  for (const variant of ['before','after']) {
    const values = report.samples.filter(v => v.variant === variant).sort((a,b) => a.ms-b.ms);
    report[variant] = { n: values.length, p50Ms: values[Math.ceil(values.length*.5)-1].ms, p95Ms: values[Math.ceil(values.length*.95)-1].ms,
      maxMs: values.at(-1).ms, maxSharedHits: Math.max(...values.map(v => v.sharedHits)) };
  }
  assert.ok(report.after.maxSharedHits < report.before.maxSharedHits / 2, 'eliminate repeated scans, not only improve wall-clock noise');
  report.passed = true;
} finally {
  await db.ok('rollback;'); db.close();
  await writeFile('docs/reviews/performance-followthrough-20260927/benchmark.json', JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({ before: report.before, after: report.after, roleParity: report.roleParity, passed: report.passed }));
