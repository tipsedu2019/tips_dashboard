import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {personalProbeRuntime,parsePersonalTap} from './helpers/ai-personal-probe-runtime.mjs';
import {runPersonalOwnerConcurrencyProbes} from './probe-ai-agent-personal-owner-concurrency.mjs';
import {runPersonalDashboardReadConcurrencyProbes} from './probe-agent-personal-dashboard-read-concurrency.mjs';
import {runDeadlineConcurrency,runCentralDomainDeadlineConcurrency,runPersonalInstallGuardProbe} from './probe-ai-agent-deadline-concurrency.mjs';
const requireRunning=()=>assert.notEqual(process.exitCode,1,'personal probe interrupted');
let runtime=await personalProbeRuntime();
try {
 console.log(JSON.stringify({suite:'personal_install_guard',...await runPersonalInstallGuardProbe(runtime,parsePersonalTap)}));
 const owner=await runPersonalOwnerConcurrencyProbes({runtime,parseTap:parsePersonalTap,requireRunning});
 console.log(JSON.stringify({suite:'personal_owner',...owner}));
} finally {await runtime.finish();}
runtime=await personalProbeRuntime();
try {
 const source=await readFile('supabase/tests/agent_personal_dashboard_read_test.sql','utf8');
 const marker='create temp table pd_evidence',end=source.indexOf(marker);
 assert.ok(end>0&&source.indexOf(marker,end+marker.length)<0&&source.includes('select plan(110);'));
 await runtime.query(source.slice(0,end).replace('select plan(110);','')+'commit;\n');
 const read=await runPersonalDashboardReadConcurrencyProbes({runtime,parseTap:parsePersonalTap,requireRunning});
 console.log(JSON.stringify({suite:'personal_dashboard_read',...read}));
} finally {await runtime.finish();}

const deadlines=[];
for(const deadline of ['credential','grant']) {
 runtime=await personalProbeRuntime();
 try {const result=await runDeadlineConcurrency(runtime,parsePersonalTap,deadline);deadlines.push(...result.cases);console.log(JSON.stringify({suite:'deadline_'+deadline,...result}));}
 finally {await runtime.finish();}
}
assert.deepEqual(deadlines.map(x=>x.deadline+':'+x.operation).sort(),['credential','grant'].flatMap(deadline=>['claim','claim_replay','done_replay','done_fk','prepare_budget','prepare_replay'].map(operation=>deadline+':'+operation)).sort());
console.log(JSON.stringify({suite:'deadline',status:'passed',cases:12,completeOperationDeadlineMatrix:true,providerSend:false}));
runtime=await personalProbeRuntime();
try {console.log(JSON.stringify({suite:'central_domain_deadline',...await runCentralDomainDeadlineConcurrency(runtime,parsePersonalTap)}));}
finally {await runtime.finish();}
