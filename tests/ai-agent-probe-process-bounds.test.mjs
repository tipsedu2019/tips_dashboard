import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {createAiAgentProbeRuntime} from '../scripts/lib/ai-agent-probe-runtime.mjs';

const batchProbe = await readFile(new URL('./probe-timetable-batch-save-concurrency.mjs', import.meta.url), 'utf8');
// Exercise both actual consumer patterns through the unchanged session reader.
// The injected child is an in-memory stream: no Docker, SQL or network executes.
const outcomePatterns = [...batchProbe.matchAll(/lineBefore\((?:first|second), (\/\^OUTCOME:[^\n]+?\/[a-z]+), deadlineAt\)/gu)]
  .map(([, literal]) => {
    const delimiter = literal.lastIndexOf('/');
    return new RegExp(literal.slice(1, delimiter), literal.slice(delimiter + 1));
  });

function mockOutcomeSession() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let closed = false;
  const close = () => { if (!closed) { closed = true; child.emit('close', 0, null); } };
  child.stdin.on('finish', close);
  child.kill = () => { close(); return true; };
  const runtime = createAiAgentProbeRuntime({assert, randomUUID: () => 'synthetic-outcome', spawn: () => child});
  runtime.configureContainer('supabase_db_tips_supabase_db_qa_0123456789ab');
  return {child, runtime, session: runtime.session(2000), close};
}

test('batch OUTCOME framing binds both actual first and waited consumers', () => {
  assert.equal(outcomePatterns.length, 2);
});

for (const [index, pattern] of outcomePatterns.entries()) {
  for (const newline of ['\n', '\r\n']) {
    test(`batch OUTCOME framing consumer ${index} waits for a complete ${JSON.stringify(newline)} line`, async () => {
      const {child, runtime, session} = mockOutcomeSession();
      try {
        const payload = {sqlstate: '00000', message: null, result: {padding: 'x'.repeat(8192), permissions: {canEdit: true}}};
        const json = JSON.stringify(payload);
        child.stdout.write(`OUTCOME:${json.slice(0, 4020)}`);
        let settled = false;
        const pending = session.line(pattern).then(value => { settled = true; return value; });
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(settled, false, 'partial JSON must not be consumed');
        child.stdout.write(json.slice(4020));
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(settled, false, 'even valid JSON must wait for the record boundary');
        child.stdout.write(newline);
        assert.deepEqual(JSON.parse((await pending)[1]), payload);
      } finally { await runtime.finishRuntime(); }
    });
  }
  test(`batch OUTCOME framing consumer ${index} rejects unterminated output on child exit`, async () => {
    const {child, runtime, session, close} = mockOutcomeSession();
    try {
      child.stdout.write('OUTCOME:{"sqlstate":"00000"}'); close();
      await assert.rejects(session.line(pattern), /checkpoint child ended/);
    } finally { await runtime.finishRuntime(); }
  });
  test(`batch OUTCOME framing consumer ${index} preserves malformed JSON rejection`, async () => {
    const {child, runtime, session} = mockOutcomeSession();
    try {
      child.stdout.write('OUTCOME:{"sqlstate":\n');
      const match = await session.line(pattern);
      assert.throws(() => JSON.parse(match[1]), SyntaxError);
    } finally { await runtime.finishRuntime(); }
  });
}

for(const probe of ['auth','claim','space-policy','chat-runtime','http-producer']){
  test(`${probe}: hung owned child requires TERM, KILL and confirmed reaping`,{timeout:12000},async()=>{
    const child=spawn(process.execPath,[`tests/probe-ai-agent-${probe}${probe==='http-producer'?'':'-concurrency'}.mjs`,'--self-test-timeout'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    try{
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      assert.equal(code,0,stderr);
      const evidence=JSON.parse(stdout.trim());
      assert.deepEqual(evidence,{status:'passed',hungChildTimedOut:true,signals:['SIGTERM','SIGKILL'],confirmedReaped:true});
    }finally{clearTimeout(timer);}
  });
}

test('standalone safety runtime blocks are generated from one canonical source and reject drift',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {checkGeneratedRuntime}=await import('../scripts/generate-ai-agent-probe-runtime.mjs');
  for(const probe of ['auth','claim','space-policy','chat-runtime','http-producer']){
    const source=await readFile(`tests/probe-ai-agent-${probe}${probe==='http-producer'?'':'-concurrency'}.mjs`,'utf8');
    assert.equal(checkGeneratedRuntime(source),true,`${probe}: regenerate stale runtime`);
    for(const [before,after]of [["signals.push('SIGKILL')","signals.push('SIGTERM')"],['PGAPPNAME=','UNSCOPED='],['await closeSessions(...ownedSessions)','await Promise.resolve()']]){
      assert.ok(source.includes(before));
      assert.equal(checkGeneratedRuntime(source.replace(before,after)),false,`${probe}: safety mutation must fail freshness`);
    }
  }
});
