// Synthetic UI transport, bound to loopback. Never forwards an API request.
// NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3262 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only
// TIPS_AGENT_API_ENABLED=true next dev --hostname 127.0.0.1 --port 3261
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const user={id:'aa290000-0000-4000-8000-000000000001',email:'fixture@example.invalid',user_metadata:{name:'합성 관리자'},app_metadata:{},aud:'authenticated',created_at:'2026-09-29T00:00:00Z'};
const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:2000000000,role:'authenticated'})).toString('base64url')+'.fixture';
const session={access_token:token,refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:2000000000,user};
const classes=[{id:'aa290000-0000-4000-8000-000000000301',name:'합성 영어 A',teacher:'합성 선생님',schedule:'월 09:00–10:00'},{id:'aa290000-0000-4000-8000-000000000302',name:'합성 수학 B',teacher:'합성 선생님',schedule:'화 10:00–11:00'}];
let rows=[];let mode='normal';const log=[];
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'http://127.0.0.1:3260','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(data));}
async function api(req,res){
 if(req.method==='OPTIONS')return json(res,{});
 const url=new URL(req.url,'http://127.0.0.1');let body='';for await(const chunk of req)body+=chunk;
 const args=body?JSON.parse(body):{};const path=url.pathname;
 if(path==='/__control'){mode=args.mode||'normal';return json(res,{mode});}
 if(path==='/__evidence')return json(res,{mode,log});
 log.push({path,method:req.method,...(path.includes('agent_')?{args}: {})});
 if(path.endsWith('/user'))return json(res,user);
 if(path.endsWith('/profiles'))return json(res,{...user,role:mode==='viewer'?'viewer':'admin',name:'합성 관리자'});
 if(path.endsWith('/list_agent_credentials_v1')){if(mode==='error')return json(res,{message:'fixture failure'},500);if(mode==='loading')await new Promise(r=>setTimeout(r,2000));const offset=(args.p_page-1)*args.p_page_size;return json(res,{items:rows.slice(offset,offset+args.p_page_size),total:rows.length});}
 if(path.endsWith('/create_agent_credential_v1') || path.endsWith('/create_agent_credential_v2')){const row={id:randomUUID(),label:args.p_label,scopes:args.p_scopes,classIds:args.p_class_ids,classAccess:{mode:args.p_all_classes?'all':'selected',includesFutureClasses:args.p_all_classes===true},expiresAt:args.p_expires_at,createdAt:new Date().toISOString(),revokedAt:null,lastUsedAt:null};rows.unshift(row);return json(res,{...row,token:'fixture-only-not-a-real-key'});}
 if(path.endsWith('/revoke_agent_credential_v1')){rows=rows.map(row=>row.id===args.p_id?{...row,revokedAt:new Date().toISOString()}:row);return json(res,null);}
 if(path.endsWith('/classes'))return json(res,classes);
 if(path.endsWith('/academic_schools'))return json(res,[{id:'aa290000-0000-4000-8000-000000000701',name:'합성 고등학교',category:'high',color:'#999999',sort_order:1}]);
 const data=resolveFixtureRequest(path,args,'D');if(data!==undefined)return json(res,data);
 return json(res,{code:'fixture_unhandled'},501);
}
http.createServer((req,res)=>{void api(req,res).catch(()=>json(res,{code:'fixture_error'},500));}).listen(3262,'127.0.0.1');
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/__fixture'){
  const target=url.searchParams.get('route')==='schools'?'/admin/settings/schools':'/admin/settings/agent-access';
  res.writeHead(200,{'Content-Type':'text/html'});return res.end(`<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(url.searchParams.get('theme')==='dark'?'dark':'light')});location.replace(${JSON.stringify(target)})</script>`);
 }
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__control')||url.pathname==='/__evidence')return void api(req,res);
 if(!['GET','HEAD'].includes(req.method)&&url.pathname!=='/__nextjs_original-stack-frames')return json(res,{code:'unmocked_write_blocked'},405);
 const proxy=http.request({hostname:'127.0.0.1',port:3261,path:req.url,method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});proxy.on('error',()=>{res.writeHead(502);res.end('Start local Next on 3261');});req.pipe(proxy);
}).listen(3260,'127.0.0.1',()=>console.log('Synthetic UI: http://127.0.0.1:3260/__fixture'));
