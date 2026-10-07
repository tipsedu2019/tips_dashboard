import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {personalProbeRuntime,parsePersonalTap} from './helpers/ai-personal-probe-runtime.mjs';
import {runPersonalOwnerConcurrencyProbes} from './probe-ai-agent-personal-owner-concurrency.mjs';
import {runPersonalDashboardReadConcurrencyProbes} from './probe-agent-personal-dashboard-read-concurrency.mjs';
import {runDeadlineConcurrency,runCentralDomainDeadlineConcurrency} from './probe-ai-agent-deadline-concurrency.mjs';
const requireRunning=()=>assert.notEqual(process.exitCode,1,'personal probe interrupted');
let runtime=await personalProbeRuntime();
try {
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

runtime=await personalProbeRuntime();
try {console.log(JSON.stringify({suite:"deadline",...await runDeadlineConcurrency(runtime,parsePersonalTap)}));console.log(JSON.stringify({suite:'central_domain_deadline',...await runCentralDomainDeadlineConcurrency(runtime,parsePersonalTap)}));} finally {await runtime.finish();}
