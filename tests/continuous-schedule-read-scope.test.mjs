import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {JSDOM} from 'jsdom';
import {act, createElement} from 'react';
import {loadNotificationComponent} from './helpers/notification-component-loader.mjs';

const dom = new JSDOM('<div id="root"></div>', {url:'https://test.invalid'});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => { throw Error('Synthetic hook test cannot access network'); };
const {createRoot} = await import('react-dom/client');
const {useContinuousClassSchedule} = loadNotificationComponent('src/features/operations/use-continuous-class-schedule.ts');
after(() => dom.window.close());

const input = (patch = {}) => ({classId:'synthetic-class-a',dateFrom:'2026-10-01',dateTo:'2026-10-31',refreshKey:0,...patch});
function reader() {
  const requests=[];
  return {requests,reset(){},load(args){const pending=Promise.withResolvers();requests.push({...pending,args});return pending.promise;}};
}
async function setup(t) {
  const client=reader(),renders=[];
  const root=createRoot(document.getElementById('root'));
  let current;
  function Probe({client,query}) {current=useContinuousClassSchedule(client,query);renders.push(current);return null;}
  const render=async(query,activeReader=client)=>{renders.length=0;await act(async()=>root.render(createElement(Probe,{client:activeReader,query})));return [...renders];};
  t.after(async()=>act(async()=>root.unmount()));
  const settle=async(request,value)=>act(async()=>request.resolve(value));
  await render(input());
  await settle(client.requests[0],{source:'normalized',data:{sessions:[{id:'old-a'}]}});
  assert.equal(current.status,'ready');
  return {client,render,settle,get current(){return current;}};
}

for (const [name,patch] of [
  ['month',{dateFrom:'2026-11-01',dateTo:'2026-11-30'}],
  ['year',{dateFrom:'2027-10-01',dateTo:'2027-10-31'}],
  ['class',{classId:'synthetic-class-b'}],
  ['refresh',{refreshKey:1}],
]) test(`schedule read never exposes preceding ready data on first ${name} render`,async t=>{
  const h=await setup(t);
  const renders=await h.render(input(patch));
  assert.equal(renders[0].status,'loading');
  assert.ok(renders.every(state=>state.status!=='ready'));
  assert.equal(h.client.requests.length,2,'one bounded request per input change');
  assert.equal(h.client.requests[1].args.dateFrom,input(patch).dateFrom);
});

test('schedule read isolates a replacement actor reader before effects run',async t=>{
  const h=await setup(t),other=reader();
  const renders=await h.render(input(),other);
  assert.equal(renders[0].status,'loading');
  assert.equal(other.requests.length,1);
  await h.settle(other.requests[0],{source:'normalized',data:{sessions:[]}});
  assert.deepEqual(h.current.value.data.sessions,[]);
});

for(const outcome of ['success','error']) test(`schedule A-B-A ignores superseded ${outcome} without prefetching other months`,async t=>{
  const h=await setup(t);
  await h.render(input({dateFrom:'2026-11-01',dateTo:'2026-11-30'}));
  const pendingB=h.client.requests[1];
  await h.render(input());
  await h.settle(h.client.requests[2],{source:'normalized',data:{sessions:[{id:'fresh-a'}]}});
  if(outcome==='error')await act(async()=>pendingB.reject(Error('late synthetic failure')));
  else await h.settle(pendingB,{source:'normalized',data:{sessions:[{id:'late-b'}]}});
  assert.deepEqual(h.current.value.data.sessions,[{id:'fresh-a'}]);
  assert.equal(h.client.requests.length,3);
});

test('current permission failure replaces success and idle drops old data',async t=>{
  const h=await setup(t);
  await h.render(input({refreshKey:1}));
  await h.settle(h.client.requests[1],{source:'error',error:{code:'42501'}});
  assert.equal(h.current.value.source,'error');
  assert.equal(h.current.value.error.code,'42501');
  const renders=await h.render(null);
  assert.equal(renders[0].status,'idle');
  assert.equal(h.client.requests.length,2);
});
