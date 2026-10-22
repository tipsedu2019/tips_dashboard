import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildClassEditDtoProbeSql, assertClassEditDtoProbe } from './helpers/agent-class-edit-dto.mjs';

// Consume actual final SQL gateway DTOs, not a hand-written matching mock.
const url=new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8');
const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture=await readFile('supabase/tests/agent_api_class_changes_test.sql','utf8');
const sql=buildClassEditDtoProbeSql(fixture);
const child=spawn('docker',['exec','-i',`supabase_db_${project}`,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
const chunks=[],errors=[];child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk));
const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});child.stdin.end(sql);
assert.equal(await completed,0,Buffer.concat(errors).toString('utf8'));
const stdout=Buffer.concat(chunks).toString('utf8');assert.doesNotMatch(stdout,/(?:^|\n)not ok \d+/);
const dto=JSON.parse(stdout.split('\n').findLast(line=>line.startsWith('{')));
console.log(JSON.stringify(assertClassEditDtoProbe(dto)));
