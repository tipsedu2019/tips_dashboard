const rootPath=process.argv[2] || process.cwd();
const {createRequire}=require('node:module'),{readFileSync,existsSync,writeFileSync}=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=createRequire(rootPath+'/package.json'), ts=req('typescript'), {JSDOM}=req('jsdom'), React=req('react'), {act,createElement}=React,{createRoot}=req('react-dom/client');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor={user:{id:'ab000000-0000-4000-8000-000000000001'},role:'admin',loading:false};
const preference={pageSize:10,ready:true,setPreference(){}};
function modules(supabase,overrides={}) {
 const cache=new Map(); function load(file){ if(cache.has(file))return cache.get(file).exports;
 const runtime={exports:{}};cache.set(file,runtime);
 const source=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const resolve=specifier=>{if(specifier in overrides)return overrides[specifier];if(specifier==='@/lib/supabase')return {supabase};if(specifier==='@/providers/auth-provider')return {useAuth:()=>actor};if(specifier==='@/hooks/use-data-table-page-size')return {useDataTablePageSize:()=>preference};if(!specifier.startsWith('.')&&!specifier.startsWith('@/'))return req(specifier);const base=specifier.startsWith('@/')?path.join(rootPath,'src',specifier.slice(2)):path.resolve(path.dirname(file),specifier);return load([base,base+'.ts',base+'.tsx',base+'.js'].find(existsSync));};
 vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename:file})(resolve,runtime,runtime.exports);return runtime.exports;}
 return entry=>load(path.join(rootPath,entry));
}
async function harness(component){const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/admin/curriculum'});globalThis.window=dom.window;globalThis.document=dom.window.document;const root=createRoot(document.getElementById('root'));return {render:async props=>act(async()=>root.render(createElement(component,props))),close:async()=>{await act(async()=>root.unmount());dom.window.close();}};}
function deferredTransport(){const calls=[];return {calls,supabase:{rpc(name,args){let resolve;const promise=new Promise(r=>resolve=r),record={name,args,resolve};calls.push(record);return {then:promise.then.bind(promise),abortSignal(signal){record.signal=signal;return this;},retry(){return promise;}};}}};}
(async()=>{
const findings={commit:'b0f16bf5e5001edcdb25410fd68a8be3297adde3',evidence:'Real hooks and services transpiled in React/JSDOM with mocked RPC transport; no database or network.'};
// Metadata requests across page-only navigation.
{
 const calls=[];const supabase={rpc(name,args){calls.push({name,args});return {abortSignal(){return this;},retry(){let data={};if(name==='get_management_stats_v1')data={total:100};if(name==='list_management_numbered_page_v1')data={page:args.p_page,pageSize:args.p_page_size,totalCount:100,rows:Array.from({length:args.p_page_size},(_,i)=>({kind:'students',id:`p${args.p_page}-${i}`,name:`학생${i}`,status:'재원',sortKey:`${i}`,updatedAt:'2026-09-22',grade:null,school:null,contact:null,parentContact:null}))};return Promise.resolve({data,error:null});}};}};
 const {useManagementRecords}=modules(supabase)('src/features/management/use-management-records.ts');
 function Probe({page}){useManagementRecords('students',{kind:'students',search:'',status:null,schoolCategory:null,school:null,grade:null},{pageSize:10,enabled:true,authorizationScope:'actor:admin',page});return null;}
 const h=await harness(Probe);for(let page=1;page<=5;page++)await h.render({page});await h.close();
 findings.managementPaging={pages:5,rpcCounts:Object.fromEntries([...new Set(calls.map(x=>x.name))].map(name=>[name,calls.filter(x=>x.name===name).length]))};
}
// The real range hooks own no transport abort signal; old requests remain active.
for(const domain of ['academic','operations']){
 const io=deferredTransport();const filename=domain==='academic'?'src/features/academic/use-academic-workspace-data.ts':'src/features/operations/use-operations-workspace-data.ts';const hook=modules(io.supabase)(filename)[domain==='academic'?'useAcademicWorkspaceData':'useOperationsWorkspaceData'];
 function Probe({day}){hook(domain==='academic'?{mode:'timetable',dateFrom:`2026-09-${String(day).padStart(2,'0')}`,dateTo:`2026-09-${String(day+6).padStart(2,'0')}`,filters:{classGroupId:null,status:null,subject:null}}:{mode:'calendar',dateFrom:`2026-09-${String(day).padStart(2,'0')}`,dateTo:`2026-09-${String(day+6).padStart(2,'0')}`});return null;}
 const h=await harness(Probe);for(const day of [1,8,15])await h.render({day});const range=io.calls.filter(x=>x.name.includes('range'));
 findings[domain+'Range']={rangeRequests:range.length,abortedAfter3Views:range.filter(x=>x.signal.aborted).length};await h.close();findings[domain+'Range'].abortedAfterUnmount=range.filter(x=>x.signal.aborted).length;
}
// Separate input updates trigger all intermediate curriculum requests.
{
 const io=deferredTransport(),{useAcademicWorkspaceData}=modules(io.supabase)('src/features/academic/use-academic-workspace-data.ts');
 function Probe({search}){useAcademicWorkspaceData({mode:'curriculum',search,status:null,subject:null,grade:null,teacher:null,classroom:null,viewMode:'all',cursor:null});return null;}
 const h=await harness(Probe);for(const search of ['', 'a','ab','abc','abcd'])await h.render({search});
 findings.curriculumSearch={rpcRequests:io.calls.length,searches:io.calls.map(x=>x.args.p_filters.search),abortedSupersededRequests:io.calls.filter(x=>x.signal.aborted).length,scopeMetadataFlags:io.calls.map(x=>x.args.p_include_scope_metadata)};await h.close();
}
writeFileSync(process.argv[3] || '/tmp/tips-frontend-review.json',JSON.stringify(findings,null,2));console.log(JSON.stringify(findings,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
