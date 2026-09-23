import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PsqlConnection,validateLocalArguments} from '../verify-timetable-concurrency.mjs';
validateLocalArguments(process.argv.slice(2));
const db=new PsqlConnection(),results=[];
try{
 for(const migration of ['20260923131454_timetable_makeup_domain_sqlstates.sql','20260923134651_timetable_reference_aggregation.sql']){
  const source=await readFile('supabase/migrations/'+migration,'utf8');
  for(const match of source.matchAll(/create or replace function (dashboard_private\.\w+)\(/gi)){
   const rest=source.slice(match.index),tag=rest.match(/\$\w*\$/)[0],start=rest.indexOf(tag)+tag.length,body=rest.slice(start,rest.indexOf(tag,start));
   const row=await db.value(`select jsonb_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'config',p.proconfig,'securityDefiner',p.prosecdef,'anonExecute',has_function_privilege('anon',p.oid,'execute'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'execute'))::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dashboard_private' and p.proname='${match[1].split('.')[1]}';`);
   assert.equal(row.body,body);assert.equal(row.owner,'postgres');assert.equal(row.anonExecute,false);assert.equal(row.authenticatedExecute,false);assert.equal(row.securityDefiner,true);assert.deepEqual(row.config,['search_path=""']);assert.equal(/errcode\s*=\s*'40001'/i.test(row.body),false);
   const hash=createHash('sha256').update(body).digest('hex');delete row.body;results.push({migration,...row,exactSourceMatch:true,bodySha256:hash,manual40001:false});
  }
 }
 assert.equal(results.length,8);await writeFile('docs/qa/timetable-presets-20260923/final-sql-provenance.json',JSON.stringify({container:'tips_timetable_20260923',results},null,2));console.log(JSON.stringify({verifiedFunctions:results.length,exactSourceMatch:true,aclPreserved:true}));
}finally{db.close();}
