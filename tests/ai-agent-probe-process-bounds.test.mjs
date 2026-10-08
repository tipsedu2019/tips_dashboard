import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';

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
