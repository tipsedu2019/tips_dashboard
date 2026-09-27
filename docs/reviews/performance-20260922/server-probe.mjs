import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const sourceRoot=process.argv[2] || process.cwd();
const { createContentAdminHandlers }=await import(pathToFileURL(path.join(sourceRoot,'src/features/public-content/server/content-routes.ts')));
const { publicAsset }=await import(pathToFileURL(path.join(sourceRoot,'src/features/public-content/server/content-store.ts')));

const assetPath = (i, extension) => `teachers/a0000000-0000-4000-8000-${String(i).padStart(12,'0')}.${extension}`;
const entries = Array.from({length:20},(_,i)=>({id:String(i),kind:'teacher',data:{portraitUrl:`storage:${assetPath(i,'webp')}`,videoUrl:`storage:${assetPath(i,'mp4')}`},sortOrder:i,isPublished:true,version:1}));
let active=0,maxActive=0,calls=0;
const handler=createContentAdminHandlers({env:{PUBLIC_CONTENT_MANAGEMENT_ENABLED:'true'},authenticate:async()=>({role:'admin',store:{list:async()=>({entries,totalCount:20}),preview:async(reference)=>{calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,20));active--;return `https://fixture.invalid/${reference}`;}}})}).entries;
let start=performance.now();
const response=await handler(new Request('https://fixture.invalid/api/admin/public-content?kind=teacher&pageSize=20'));
const signedPreview={status:response.status,rows:20,simulatedEachSignLatencyMs:20,signCalls:calls,maxConcurrency:maxActive,elapsedMs:Math.round(performance.now()-start)};

let catalogQueries=0,signRequests=0;
const realFetch=globalThis.fetch;
globalThis.fetch=async(input)=>{
  const url=new URL(String(input));
  if(url.pathname==='/rest/v1/public_site_entries') {catalogQueries++;return Response.json(entries.map(row=>({id:row.id,kind:row.kind,data:row.data,sort_order:row.sortOrder,is_published:true})));}
  if(url.pathname.startsWith('/storage/v1/object/sign/')) {signRequests++;return Response.json({signedURL:'/object/sign/fixture?token=mock'});}
  throw Error(`unexpected mocked URL ${url.pathname}`);
};
try{
  const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'};
  await Promise.all(Array.from({length:5},(_,i)=>publicAsset(env,assetPath(i,'webp'))));
}finally{globalThis.fetch=realFetch;}
console.log(JSON.stringify({signedPreview,publicAsset:{uniqueAssets:5,catalogQueries,catalogRowsPerQuery:20,signRequests,note:'Mocked transport only; no network or production mutation'}},null,2));
