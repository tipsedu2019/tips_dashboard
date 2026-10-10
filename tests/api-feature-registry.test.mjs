import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {API_FEATURES,PERSONAL_FEATURES,featureForRoute} from '../src/features/agent-api/feature-registry.ts';
import {agentOpenApi} from '../src/features/agent-api/server/openapi.ts';
import {agentEditOpenApi} from '../src/features/agent-api/server/openapi-v2.ts';
test('every documented operation has exactly one registry entry and vice versa',()=>{
 const expected=[];
 for(const [version,doc] of [[1,agentOpenApi],[2,agentEditOpenApi]])for(const [path,item] of Object.entries(doc.paths))for(const [method,op]of Object.entries(item)){
  const feature=featureForRoute(version,method,path.slice(1).split('/').map(x=>x.startsWith('{')?'10000000-0000-4000-8000-000000000001':x));
  assert.ok(feature,`${method} ${path}`);assert.equal(feature.endpoint.operationId,op.operationId);assert.equal(op['x-tips-feature-id'],feature.id);assert.equal(op['x-tips-personal-default-granted'],false);expected.push(feature.id);
 }
 assert.deepEqual(expected.sort(),API_FEATURES.filter(x=>x.endpoint).map(x=>x.id).sort());assert.equal(new Set(API_FEATURES.map(x=>x.id)).size,API_FEATURES.length);
});
test('personal selection excludes internal, business-only and write endpoints',()=>{
 assert.equal(PERSONAL_FEATURES.length,3);assert.ok(PERSONAL_FEATURES.every(x=>x.endpoint.method==='get'&&x.mode==='read'&&x.surface==='external'));
 assert.ok(API_FEATURES.filter(x=>x.surface==='internal').every(x=>x.endpoint===null&&x.personal===null));
 assert.equal(featureForRoute(2,'POST',['classes','id']),undefined);assert.equal(featureForRoute(2,'GET',['new-feature']),undefined);
});
test('generated DB feature policy exactly matches the single registry',()=>{
 const result=spawnSync(process.execPath,['scripts/generate-personal-feature-permissions.mjs','--check'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const sql=readFileSync('docs/agents/proposals/personal-feature-permissions.sql','utf8');
 const encoded=sql.match(/as \$policy\$ select '([^']+)'::jsonb/)[1];const policy=JSON.parse(encoded);
 assert.deepEqual(Object.values(policy).map(x=>x.id).sort(),PERSONAL_FEATURES.map(x=>x.id).sort());
 assert.match(sql,/feature_ids text\[\] not null default '\{\}'/);
});
