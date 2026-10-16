import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { requireTimetableBatchResult } from '../src/features/academic/timetable-plan-service.ts';

// This probe accepts only the isolated runner's disposable PostgreSQL container.
// The actual ordered SQL producer output goes into the unchanged app consumer.
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.equal(url.pathname, '/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/m)?.[1];
assert.ok(project); assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture = await readFile('supabase/tests/timetable_plan_batch_save_test.sql', 'utf8');
const start = fixture.indexOf('-- Batch DTO fixture setup start');
const end = fixture.indexOf('-- Batch DTO fixture setup end');
assert.ok(start >= 0 && end > start);
const sql = `begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local statement_timeout='30s';
select no_plan();
${fixture.slice(start, end)}
select jsonb_build_object('command',c.command,'result',r.result)
from batch_commands c join batch_results r using(key) where key='swap';
rollback;
`;
const child = spawn('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-XqAt', '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
  stdio: ['pipe', 'pipe', 'pipe'], signal: AbortSignal.timeout(45_000),
});
const chunks = [], errors = []; let bytes = 0;
const collect = (target, chunk) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) child.kill('SIGTERM'); else target.push(chunk); };
child.stdout.on('data', chunk => collect(chunks, chunk));
child.stderr.on('data', chunk => collect(errors, chunk));
const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
child.stdin.on('error', () => {}); child.stdin.end(sql);
assert.equal(await completed, 0, Buffer.concat(errors).toString('utf8'));
assert.ok(bytes <= 4 * 1024 * 1024);
const stdout = Buffer.concat(chunks).toString('utf8');
assert.doesNotMatch(stdout, /(?:^|\n)not ok \d+/);
const produced = JSON.parse(stdout.split('\n').findLast(line => line.startsWith('{')));
const result = requireTimetableBatchResult(produced.result, produced.command);
assert.equal(result.acknowledgements.length, 2);
assert.equal(result.snapshot.slots.length, 2);
assert.ok(result.snapshot.items.some(item => item.pendingSlots.length > 0));
assert.equal(result.committedChangeSequence, produced.command.expectedChangeSequence + 1);
console.log(JSON.stringify({ status: 'passed', actualBatchTargetsConsumed: result.acknowledgements.length, actualSlotsConsumed: result.snapshot.slots.length, nullablePendingSlotConsumed: true }));
