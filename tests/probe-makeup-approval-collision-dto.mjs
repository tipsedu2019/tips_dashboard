import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildRoomAvailability } from '../src/features/makeup-requests/makeup-request-model.js';

// Only the disposable SQL runner's database; never connect to deployed data.
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project); assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture = await readFile('supabase/tests/makeup_approval_collision_candidates_test.sql', 'utf8');
const end = fixture.indexOf('create temp table before_counts');
assert.ok(end > 0);
// The wire probe uses fixture setup only; pgTAP is installed in the separate
// test transaction by the Supabase runner and is unnecessary here.
const sql = fixture.slice(0, end).replace('select no_plan();', '') + `
set local role service_role;
select jsonb_build_object('slots',pg_temp.slots(),'scoped',public.get_makeup_approval_collision_context_v1(pg_temp.slots()),
 'full',jsonb_build_object('classes',(select jsonb_agg(to_jsonb(c)) from
   (select id,name,subject,grade,teacher,room,schedule from public.classes)c),
 'requests',(select jsonb_agg(to_jsonb(r)) from
   (select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots from public.makeup_requests
    where status in('approval_pending','manager_pending','makeup_pending','completed'))r),
 'academicEvents',(select jsonb_agg(to_jsonb(e)) from
   (select id,title,note from public.academic_events where note like '%[[TIPS_MAKEUP]]%')e)));
rollback;`;
const child = spawn('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
const chunks = [], errors = [];
child.stdout.on('data', c => chunks.push(c)); child.stderr.on('data', c => errors.push(c));
const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
child.stdin.end(sql);
assert.equal(await completed, 0, Buffer.concat(errors).toString());
const wire = JSON.parse(Buffer.concat(chunks).toString().split('\n').findLast(line => line.startsWith('{')));
const collisions = context => buildRoomAvailability({ ...context, slots: wire.slots }).flatMap(room =>
  room.collisions.map(collision => `${room.name}:${collision.source}:${collision.id}`)).sort();
const before = collisions(wire.full), after = collisions(wire.scoped);
assert.ok(before.length >= 7, 'nonempty producer wire exercises classes, pending, legacy dates, and JS whitespace');
assert.deepEqual(after, before, 'real SQL candidates preserve actual JS collision decisions');
console.log(JSON.stringify({ status: 'passed', collisions: after.length,
  fullBytes: Buffer.byteLength(JSON.stringify(wire.full)), scopedBytes: Buffer.byteLength(JSON.stringify(wire.scoped)) }));
