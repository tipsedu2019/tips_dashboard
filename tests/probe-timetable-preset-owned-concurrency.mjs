import { personalProbeRuntime } from './helpers/ai-personal-probe-runtime.mjs';
import { verifyPresetLockScope } from './helpers/timetable-preset-lock-scope.mjs';
const runtime=await personalProbeRuntime();
try {console.log(JSON.stringify(await verifyPresetLockScope(runtime)));}
finally {await runtime.finish();}
