import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createObservationOpenHarness } from '../tests/helpers/registration-observation-open-harness.mjs'
const sourcePath = process.argv[2]
const outputPath = process.argv[3]
const workspaceSource = await readFile(sourcePath, 'utf8')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
for (const profile of [
  { name:'cold-data-slower', data:120, attempt:80, module:80, warm:false },
  { name:'cold-module-slower', data:40, attempt:30, module:120, warm:false },
  { name:'warm', data:120, attempt:80, module:80, warm:true },
]) {
  const runs=[]
  for (let index=0; index<11; index++) {
    const trace=[]
    let started=0, ready
    const step = async (name, ms) => {
      trace.push({name, phase:'start', ms:performance.now()-started})
      await delay(ms)
      trace.push({name, phase:'end', ms:performance.now()-started})
    }
    let harness
    harness = await createObservationOpenHarness({workspaceSource,
      loadDetail: async () => { await step('detail',profile.data); return harness.detail },
      loadAttempt: async () => { await step('attempt',profile.attempt); return harness.attempt },
      importEditor: async () => { await step('editor-import',profile.module); return {RegistrationApplication: function SyntheticEditor(){}} },
      onHost(host, render) {
        if (host.kind==='detail') {
          trace.push({name:'data-commit',phase:'end',ms:performance.now()-started})
          ready=render().then(()=>trace.push({name:'editor-ready',phase:'end',ms:performance.now()-started}))
        }
      },
    })
    if(profile.warm) await harness.preload()
    trace.length=0
    started=performance.now()
    await harness.open(harness.target)
    await ready
    if(index) runs.push({elapsed:performance.now()-started,trace,calls:harness.calls})
  }
  const sorted=runs.map(x=>x.elapsed).sort((a,b)=>a-b)
  results.push({profile,sampleCount:runs.length,medianMs:(sorted[4]+sorted[5])/2,minMs:sorted[0],maxMs:sorted.at(-1),runs})
}
await writeFile(outputPath,JSON.stringify({sourcePath,methodology:'Actual open callback, shared lazy module promise and ownership helper. React state setters/network/import replaced with synthetic controlled I/O; data commit starts lazy render. One warmup, ten measured iterations per cold/warm profile. No browser, DB, network or real student data.',results},null,2)+'\n')
console.log(JSON.stringify(results.map(({profile,sampleCount,medianMs,minMs,maxMs})=>({profile,sampleCount,medianMs,minMs,maxMs})),null,2))
