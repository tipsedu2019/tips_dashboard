import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCreateRequestSchema, aiRequestListQuerySchema, aiRequestSchema, aiRequestListSchema, aiMessageInputSchema, aiCredentialGrantSchema } from '../src/features/ai-agent/ai-agent-request-contract.ts';

const id='aa030000-0000-4000-8000-000000000001';
const create={title:'수신 확인',body:'합성 테스트',notifyOnDone:false};
test('create rejects a caller-selected requester',()=>{
  for(const field of ['requester','actor','status','role','tokenHash']) assert.equal(aiCreateRequestSchema.safeParse({...create,[field]:id}).success,false);
});
test('create bounds Unicode content and notification consent',()=>{
  assert.deepEqual(aiCreateRequestSchema.parse(create),create);
  for(const input of [{...create,title:' '},{...create,title:'가'.repeat(201)},{...create,body:'가'.repeat(20001)},{...create,notificationSpace:'space_1'},{...create,notifyOnDone:true},{...create,notifyOnDone:true,notificationSpace:'unknown'}]) assert.equal(aiCreateRequestSchema.safeParse(input).success,false);
  assert.equal(aiCreateRequestSchema.safeParse({...create,notifyOnDone:true,notificationSpace:'space_1'}).success,true);
  assert.equal(aiCreateRequestSchema.safeParse({...create,title:'😀'.repeat(200)}).success,true);
  assert.equal(aiCreateRequestSchema.safeParse({...create,title:'😀'.repeat(201)}).success,false);
});
test('employee listing uses bounded pages and rejects bot cursor mixing',()=>{
  assert.deepEqual(aiRequestListQuerySchema.parse({}),{page:1,pageSize:10,scope:'own'});
  for(const input of [{pageSize:50},{page:0},{page:1.5},{cursor:'x'},{limit:50},{requester:id},{status:'unknown'}]) assert.equal(aiRequestListQuerySchema.safeParse(input).success,false);
});
const request={id,requesterId:id,requesterName:null,title:'합성 요청',body:'본문',status:'pending',version:'1',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',readyAt:'2026-10-03T00:00:00Z',openQuestionId:null,result:null,notifyOnDone:false,notificationSpace:null};
test('strict DTO accepts nullable identity metadata and refuses secret/internal state',()=>{
  assert.equal(aiRequestSchema.safeParse(request).success,true);
  assert.equal(aiRequestListSchema.safeParse({items:[request],total:1,page:1,pageSize:10}).success,true);
  for(const field of ['token','tokenHash','claimToken','claimTokenHash','credentialId','issuerId']) assert.equal(aiRequestSchema.safeParse({...request,[field]:id}).success,false);
  assert.equal(aiRequestSchema.safeParse({...request,version:0}).success,false);
  assert.equal(aiRequestSchema.safeParse({...request,version:'9007199254740993'}).success,true);
  assert.equal(aiRequestSchema.safeParse({...request,version:'9223372036854775808'}).success,false);
});
test('message inputs enforce answer linkage and bounded strict comments',()=>{
  assert.equal(aiMessageInputSchema.safeParse({kind:'answer',questionId:id,text:'답변'}).success,true);
  for(const input of [{kind:'answer',text:'답변'},{kind:'comment',text:' '},{kind:'comment',text:'가'.repeat(5001)},{kind:'comment',questionId:id,text:'a'},{kind:'progress',text:'a'},{kind:'comment',text:'a',actor:id}]) assert.equal(aiMessageInputSchema.safeParse(input).success,false);
});
test('purpose grants are explicit and class authority is never accepted',()=>{
  const grant={queues:['employee_requests'],actions:['read']};
  assert.equal(aiCredentialGrantSchema.safeParse(grant).success,true);
  for(const input of [{},{queues:[],actions:['read']},{...grant,all_classes:true},{...grant,queues:['all']},{...grant,actions:['classes:read']},{spaceKeys:['space_1'],purposes:[]},{spaceKeys:['unknown'],purposes:['ai_completion']}]) assert.equal(aiCredentialGrantSchema.safeParse(input).success,false);
});
