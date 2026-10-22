import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { verifyOwnedPresetProducer } from './helpers/timetable-preset-owned-consumer.mjs';

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
const sql = await readFile('supabase/tests/timetable_preset_owned_placements_test.sql', 'utf8');
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
assert.doesNotMatch(stdout, /(?:^|\n)(?:not ok \d+|Bail out!)|#\s*(?:SKIP|TODO)\b/i);
const plans = [...stdout.matchAll(/^1\.\.(\d+)$/gm)];
const results = [...stdout.matchAll(/^ok (\d+)(?:\s|$)/gm)];
assert.equal(plans.length, 1); assert.equal(results.length, Number(plans[0][1]));
assert.ok(results.every((r, i) => Number(r[1]) === i + 1));
const produced = JSON.parse(stdout.split('\n').findLast(line => line.startsWith('{')));
console.log(JSON.stringify({status:'passed',sqlAssertions:results.length,...await verifyOwnedPresetProducer(produced)}));
