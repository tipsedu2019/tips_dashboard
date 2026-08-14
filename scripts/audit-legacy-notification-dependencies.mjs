import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=resolve(fileURLToPath(new URL("..",import.meta.url))); const SCOPES=["src","scripts","supabase/functions","package.json","vercel.json",".github/workflows"];
export async function auditLegacyNotificationDependencies({root=ROOT,write=writeFile}={}) {
 const manifest=JSON.parse(await readFile(resolve(root,"docs/operations/legacy-notification-object-manifest.json"),"utf8"));
 if(!Array.isArray(manifest.objects)||!Array.isArray(manifest.legacyCronNames)) throw new Error("legacy_notification_manifest_invalid");
 const active=[]; for(const object of manifest.objects){ let count=0; for(const scope of SCOPES){ try { const text=await readFile(resolve(root,scope),"utf8"); count+=text.includes(object.name.split(".").at(-1))?1:0; } catch{} } active.push({object:object.name,decision:object.decision,source:{available:true,count},relationWrites:{available:false,status:"unknown"},functionCalls:{available:false,status:"unknown"},trigger:{available:false,status:"unknown"}}); }
 return {version:1,activeDependencyScopes:SCOPES,objects:active,cron:manifest.legacyCronNames.map((name)=>({name,available:false,status:"unknown"})),readyForDestructiveReview:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) auditLegacyNotificationDependencies().then((v)=>process.stdout.write(`${JSON.stringify(v)}\n`)).catch((e)=>{process.stderr.write(`${e.message}\n`);process.exitCode=1});
