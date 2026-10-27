import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Same owned, disposable, no-network DB boundary as the repository probes.
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');
assert.ok(['postgres:','postgresql:'].includes(url.protocol));
assert.equal(url.pathname,'/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8');
const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture=await readFile('supabase/tests/class_schedule_month_summary_test.sql','utf8');
assert.ok(fixture.startsWith('begin;') && fixture.trimEnd().endsWith('rollback;'));
const sql=fixture.replace('begin;','begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions;');
const child=spawn('docker',['exec','-i',`supabase_db_${project}`,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
let stdout='',stderr='';
child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code));});
child.stdin.end(sql);
assert.equal(await done,0,stderr);
assert.doesNotMatch(stdout,/(?:^|\n)not ok \d+/);
const captures=stdout.split(/\r?\n/).filter(line=>line.startsWith('MONTH_SUMMARY_CAPTURE:'));
assert.equal(captures.length,1);
const value=JSON.parse(captures[0].slice('MONTH_SUMMARY_CAPTURE:'.length));
assert.equal(value.length,3);
console.log(captures[0]);
console.log(JSON.stringify({status:'passed',producerRows:value.length,source:'actual final RPC on synthetic isolated DB'}));
