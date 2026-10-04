import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAiCapture} from '../../scripts/lib/ai-producer-receipt.mjs';
test('capture protocol preserves JSON bytes and rejects missing, duplicate, unknown and malformed captures',()=>{
 const raw=' {"value": "한\\n글", "synthetic":true} ';
 assert.equal(extractAiCapture('step\nAI_HTTP_CAPTURE:'+raw+'\n','http').toString(),raw);
 for(const output of ['', 'AI_HTTP_CAPTURE:{}\nAI_HTTP_CAPTURE:{}\n','AI_UNKNOWN_CAPTURE:{}\nAI_HTTP_CAPTURE:{}\n','AI_HTTP_CAPTURE:{\n'])assert.throws(()=>extractAiCapture(output,'http'));
});

import {AI_PRODUCERS,AI_SQL_TESTS,AI_PROBES,ACCEPTED_AI_MIGRATIONS,snapshotAiSource,validateAiReceipt,suppressAiCaptures} from '../../scripts/lib/ai-producer-receipt.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFile,readFile,rm,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const hash=v=>createHash('sha256').update(v).digest('hex');
test('independent attestation rejects stale run/source, migration, closure, inventory and raw payload drift',async()=>{
 const source=await snapshotAiSource(),raw=Buffer.from(' {"test":"negative protocol only"} '),now=Date.now();
 const expected={runId:randomBytes(16).toString('hex'),nonce:randomBytes(32).toString('hex'),startedAt:now-1};
 const receipt={version:1,...expected,finishedAt:now,before:source,after:source,migrations:ACCEPTED_AI_MIGRATIONS,sqlTests:AI_SQL_TESTS,probes:AI_PROBES,captures:Object.fromEntries(Object.entries(AI_PRODUCERS).map(([name,p])=>[name,{producer:p.path,file:p.file,sourceSha256:source.closure.find(v=>v.path===p.path).sha256,sha256:hash(raw),bytes:raw.length}]))};
 assert.equal(validateAiReceipt(receipt,{expected,source,raw,identity:'http',now}),true);
 for(const mutate of [
  r=>r.runId='0'.repeat(32),r=>r.nonce='0'.repeat(64),r=>r.startedAt=now-900_001,r=>r.finishedAt=now+1,
  r=>r.before.sourceHead='0'.repeat(40),r=>r.after.closure.pop(),r=>r.after.closure[0].sha256='0'.repeat(64),
  r=>r.migrations[0].sha256='0'.repeat(64),r=>r.migrations.pop(),r=>r.migrations.push(r.migrations[0]),
  r=>r.sqlTests.pop(),r=>r.sqlTests[0]=r.sqlTests[1],r=>r.probes[0]='tests/unknown.mjs',
  r=>delete r.captures.chat,r=>r.captures.unexpected=r.captures.chat,
  r=>r.captures.http.producer=AI_PRODUCERS.chat.path,r=>r.captures.http.sourceSha256='0'.repeat(64),
  r=>r.captures.http.sha256='0'.repeat(64),r=>r.captures.http.bytes++,r=>r.captures.http.file='../other.json',
 ]){const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>validateAiReceipt(changed,{expected,source,raw,identity:'http',now}));}
 assert.equal(suppressAiCaptures('before\nAI_CHAT_RUNTIME_CAPTURE:{"token":"synthetic-private"}\nafter'),'before\n[private AI capture omitted]\nafter');
});

test('actual root consumers fail without a current capture and receipt; no optional skips',()=>{
 const result=spawnSync(process.execPath,['--test','--experimental-strip-types','tests/ai-agent-http-producer-parity.test.mjs','tests/ai-agent-chat-runtime-parity.test.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
 assert.equal(result.status,1);assert.match(result.stdout,/(?:#|ℹ) tests 2\n/u);assert.match(result.stdout,/(?:#|ℹ) pass 0\n/u);assert.match(result.stdout,/(?:#|ℹ) skipped 0\n/u);
 assert.match(result.stdout,/current-run capture receipt required/);
});

test('source snapshot rejects undeclared local imports, missing source and canonical migration drift',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-negative-'));
 try{
  // Only relevant source allowlist and six migrations, no dependency/app copy.
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...ACCEPTED_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const file=join(root,'src/features/ai-agent/server/ai-agent-auth.ts');
  await writeFile(file,(await readFile(file))+'\nimport x from "./undeclared.ts";\n');
  await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/);
  await rm(file);await assert.rejects(snapshotAiSource(root),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('source closure rejects side-effect imports before accepting source provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ai-receipt-side-effect-'));
 try{
  const {AI_SOURCE_CLOSURE}=await import('../../scripts/lib/ai-producer-receipt.mjs');
  for(const path of [...AI_SOURCE_CLOSURE,...ACCEPTED_AI_MIGRATIONS.map(m=>'supabase/migrations/'+m.fileName)]){
   await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),await readFile(path));
  }
  const file=join(root,'src/features/ai-agent/server/ai-agent-auth.ts'),original=await readFile(file);
  for(const statement of ['import "./unhashed-side-effect.ts";','import\n "./unhashed-side-effect.ts";','import "@/unhashed-side-effect";','import /* side effect */ "./unhashed-side-effect.ts";',String.raw`import "\u002e\u002funhashed-side-effect.ts";`,String.raw`import('\x2e\x2funhashed-side-effect.ts');`,String.raw`export {x} from "\u002e\u002funhashed-side-effect.ts";`,String.raw`import x from "\u002e\u002funhashed-side-effect.ts";`,String.raw`require("\u002e\u002funhashed-side-effect.ts");`]){
   await writeFile(file,original+'\n'+statement+'\n');
   await assert.rejects(snapshotAiSource(root),/import outside audited AI closure/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
