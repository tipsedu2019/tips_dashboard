// LOCAL SYNTHETIC ONLY. Explicit allowlist, fixed actor/container, no network DB URL.
import { spawn } from 'node:child_process';
const actor='00000000-0000-4000-8000-000000000099';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const allowed={
 list_active_science_subject_areas_v1:{},
 preview_timetable_plan_transfer_v1:{p_request:'jsonb'},commit_timetable_plan_transfer_v1:{p_command:'jsonb'},
 get_academic_timetable_range_v1:{p_date_from:'date',p_date_to:'date',p_class_group_id:'text',p_status:'text',p_subject:'text'},
 list_timetable_plans_v1:{p_search:'text',p_archived:'boolean',p_page:'integer',p_page_size:'integer'},
 get_timetable_plan_v1:{p_plan_id:'uuid'},get_timetable_plan_revision_v1:{p_plan_id:'uuid'},
 list_timetable_share_candidates_v1:{},mutate_timetable_plan_v1:{p_command:'jsonb'},mutate_timetable_plan_item_v1:{p_command:'jsonb'},
};
export function isPlanFixtureRpc(name){return Object.hasOwn(allowed,name);}
export async function planFixtureRpc(name,args){
 if(!isPlanFixtureRpc(name)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(allowed[name],k)))throw Error('Unknown fixture RPC or argument');
 const parameters=Object.entries(args).map(([key,value])=>`${key} => ${value===null?'null':quote(allowed[name][key]==='jsonb'?JSON.stringify(value):value)}::${allowed[name][key]}`).join(',');
 const query=name==='list_active_science_subject_areas_v1'?`select coalesce(jsonb_agg(to_jsonb(area)),'[]'::jsonb)::text from public.${name}(${parameters}) area`:`select public.${name}(${parameters})::text`;
 const sql=`begin; set local role authenticated; set local request.jwt.claim.sub = ${quote(actor)}; set local request.jwt.claims = ${quote(JSON.stringify({sub:actor,role:'authenticated'}))}; ${query}; commit;`;
 return new Promise((resolve,reject)=>{const child=spawn('/Users/hyunjun/.local/bin/docker',['exec','-i','tips_timetable_20260923','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>{out+=d;if(out.length>8e6)child.kill();});child.stderr.on('data',d=>{err+=d;});child.on('error',reject);child.on('close',code=>{if(code){const match=err.match(/ERROR:\s+([A-Z0-9]{5}):\s+([^\n]+)/);resolve({error:{code:match?.[1]||'XX000',message:match?.[2]||'fixture_database_error'}});}else{try{resolve({data:JSON.parse(out.trim())});}catch{reject(Error('fixture_invalid_response'));}}});child.stdin.end(sql);});
}
