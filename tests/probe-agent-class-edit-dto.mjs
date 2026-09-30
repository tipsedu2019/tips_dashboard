import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { classWorkspace, compileClassEdit } from '../src/features/agent-api/server/class-edit-compiler.mjs';

// Consume actual final SQL gateway DTOs, not a hand-written matching mock.
const url=new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8');
const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture=await readFile('supabase/tests/agent_api_class_changes_test.sql','utf8');
const end=fixture.indexOf('-- Existing approval work owns its transition');assert.ok(end>0);
const sql=fixture.slice(0,end).replace('begin;','begin;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path=public,extensions;')+`
set local role service_role;
select jsonb_build_object(
 'legacy',pg_temp.api2('context',jsonb_build_object('classId',pg_temp.eid(3)))->'data',
 'normalized',pg_temp.api2('context',jsonb_build_object('classId',pg_temp.eid(30)))->'data',
 'legacyPreview',(select v->'data' from ev where k='legacy'),
 'legacyReceipt',(select v->'data' from ev where k='saved'),
 'normalizedPreview',(select v->'data' from ev where k='normalized'),
 'normalizedReceipt',pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.eid(502)))->'data'
);
rollback;
`;
const child=spawn('docker',['exec','-i',`supabase_db_${project}`,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
const chunks=[],errors=[];child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk));
const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});child.stdin.end(sql);
assert.equal(await completed,0,Buffer.concat(errors).toString('utf8'));
const stdout=Buffer.concat(chunks).toString('utf8');assert.doesNotMatch(stdout,/(?:^|\n)not ok \d+/);
const dto=JSON.parse(stdout.split('\n').findLast(line=>line.startsWith('{')));
const window={from:'2099-10-01',to:'2099-10-31'};
for(const mode of ['legacy','normalized']) {
 const context=dto[mode];const workspace=classWorkspace(context,window);
 assert.equal(workspace.basic.subject,'영어');assert.ok(workspace.lessons.length>0);assert.ok(workspace.weeklySlots.length>0);
 assert.ok(context.catalogs.teachers.some(row=>row.name==='T' && row.isVisible===true));
 assert.doesNotMatch(JSON.stringify(workspace),/SECRET_|KEEP_PRIVATE_NOTE|KEEP_STUDENT|teacher_note|schedule_plan/);
 const preview=dto[mode+'Preview'],receipt=dto[mode+'Receipt'];assert.equal(receipt.state,'applied');
 const expected=classWorkspace(preview.afterContext,preview.window),actual=classWorkspace(receipt.classContext,receipt.window);
 assert.equal(actual.id,expected.id);assert.equal(actual.verificationHash,expected.verificationHash,`${mode} saved meaning must match actual preview`);
 const command=compileClassEdit(context,{expectedVersion:workspace.version,window,reason:'DTO probe',basic:{grade:'고2'}});
 assert.deepEqual(command.patch,{grade:'고2'});
}
console.log(JSON.stringify({status:'passed',actualGatewayContextsConsumed:2,previewReceiptHashesMatch:true,privateFieldsExcluded:true}));
