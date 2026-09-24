// Read-only validation: no Docker/Supabase execution and no production connection.
import { readFile, writeFile } from 'node:fs/promises';
import { runIsolatedSupabaseDbTests, validateManifestMigrations } from '../run-isolated-supabase-db-tests.mjs';
const root=process.cwd();
const result=await runIsolatedSupabaseDbTests({root,argv:['--review-head','--require-final','--test','supabase/tests/timetable_plan_import_test.sql']});
const manifest=result.manifest;
const catalog=JSON.parse(await readFile('supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json','utf8'));
await validateManifestMigrations({root,manifest,baselineVersions:catalog.migrationLedger.map(row=>row.version)});
const evidence={status:result.status,nonExecuting:true,verified:manifest.orderedNewMigrations.length,baselineSha256:manifest.baselineSha256,catalogSha256:manifest.catalogSha256,featureMigrations:manifest.orderedNewMigrations.filter(row=>row.fileName >= '20260923000000' && row.fileName.includes('_timetable_'))};
await writeFile(process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output')+1] : 'docs/qa/timetable-presets-20260923/evidence/task9-manifest-validation.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
