import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createAiAgentProbeRuntime} from './lib/ai-agent-probe-runtime.mjs';

export const probes=['auth','claim','space-policy','chat-runtime'].map(name=>`tests/probe-ai-agent-${name}-concurrency.mjs`).concat('tests/probe-ai-agent-http-producer.mjs');
const warning='// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs';
const blocks={
 RUNTIME:`${warning}\nconst {closeSessions,selfTestBounds,startDeadline,configureContainer,session,query,finishRuntime}=(${createAiAgentProbeRuntime.toString()})({assert,spawn,randomUUID});\nif(process.argv.includes('--self-test-timeout')) {await selfTestBounds();process.exit(0);}\nstartDeadline();`,
 'SESSION SETUP':`${warning}\nconfigureContainer(container);`,
 CLEANUP:`${warning}\nawait finishRuntime();`,
};
export function renderGeneratedRuntime(source){
 for(const [name,body]of Object.entries(blocks)){
  const start=`// BEGIN GENERATED AI PROBE ${name}`,end=`// END GENERATED AI PROBE ${name}`;
  const first=source.indexOf(start),last=source.indexOf(end);
  if(first<0||last<=first||source.indexOf(start,first+start.length)>=0||source.indexOf(end,last+end.length)>=0)throw new Error(`ambiguous generated marker: ${name}`);
  source=source.slice(0,first)+start+'\n'+body+'\n'+source.slice(last);
 }
 return source;
}
export function checkGeneratedRuntime(source){try{return renderGeneratedRuntime(source)===source;}catch{return false;}}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--check'))throw new Error('usage: node scripts/generate-ai-agent-probe-runtime.mjs [--check]');
 const check=args[0]==='--check';
 for(const file of probes){const path=new URL('../'+file,import.meta.url),source=await readFile(path,'utf8'),next=renderGeneratedRuntime(source);if(check&&next!==source)throw new Error(`stale generated AI probe: ${file}`);if(!check&&next!==source)await writeFile(path,next);}
 console.log(check?'AI probe runtime generation is current':'AI probe runtime copies regenerated');
}
