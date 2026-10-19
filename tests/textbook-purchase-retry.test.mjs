import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/supabase') return { shortCircuit: true, url: 'data:text/javascript,export const supabase = null;' };
  if (specifier.startsWith('.')) { const p = fileURLToPath(new URL(specifier, context.parentURL)); if (!extname(p)) { const f = ['.ts','.js'].map(s => p+s).find(existsSync); if (f) specifier = pathToFileURL(f).href; } }
  return next(specifier, context);
} });
const { createPurchaseAttempt, resumePurchaseAttempt, savePurchaseAttempt, readPurchaseAttempt, finishPurchaseAttempt, discardUnwrittenPurchaseAttempt } = await import('../src/features/textbooks/textbook-purchase-retry.ts');
const actor = 'a9100000-0000-4000-8000-000000000001';
const book = 'a9100000-0000-4000-8000-000000000002';
const location = 'a9100000-0000-4000-8000-000000000003';
const draft = { memo: 'preserve input', studentOrderedQuantity: '2', teacherOrderedQuantity: '1', requestStage: 'order' };
const payloads = (stage='order') => ['student','teacher'].map(copyScope => ({ textbookId: book, locationId: location, requestStage: stage, copyScope, orderedQuantity: copyScope === 'student' ? 2 : 1, requestedQuantity: copyScope === 'student' ? 2 : 1, receivedQuantity: stage === 'receive' ? (copyScope === 'student' ? 2 : 1) : 0, unitCost: 12, statementNumber: stage === 'receive' ? 'statement' : '', memo: draft.memo }));
const clone = x => JSON.parse(JSON.stringify(x));
const sqlFailure = { data: null, status: 400, error: { code: '23514', message: 'synthetic constraint rejection', details: null, hint: null } };
function fixture(failAt=-1, failure=sqlFailure, commitBeforeFailure=false) {
  const rows = new Map(), writes=[], reads=[], storageRows=new Map(); let failed=false;
  const storage = { getItem: k => storageRows.get(k) ?? null, setItem: (k,v) => storageRows.set(k,v), removeItem: k=>storageRows.delete(k) };
  const client = { from(table) {
    let payload, id;
    const q={ insert(row) { payload=clone(row); return q; }, select() { return q; }, eq(k,v) { assert.equal(k,'id'); id=v; return q; },
      async single() {
        const index=writes.length; writes.push({table,row:payload});
        if (index===failAt && !failed) { failed=true; if(commitBeforeFailure) rows.set(payload.id,{...payload}); if(failure instanceof Error) throw failure; return clone(failure); }
        assert.ok(!rows.has(payload.id),'no repeated successful insert'); rows.set(payload.id,{...payload});
        return { data: clone(payload), error: null, status: 201 };
      },
      async maybeSingle() { reads.push({table,id}); return { data: clone(rows.get(id) ?? null), error:null, status:200 }; },
    }; return q;
  } };
  const checkpoint = attempt=>savePurchaseAttempt(attempt,storage);
  const run = attempt=>resumePurchaseAttempt(attempt,{actorId:actor,client,checkpoint,assertCurrent() {}});
  const start = (stage='order')=>{const attempt=createPurchaseAttempt(payloads(stage),actor,{...draft,requestStage:stage});checkpoint(attempt);return attempt;};
  return {client,rows,writes,reads,storage,checkpoint,run,start};
}
for (const stage of ['order','receive']) for (let position=0;position<(stage==='order'?4:6);position++) {
  test(`${stage}: explicit rollback at step ${position+1} retries only that step and unsent work`,async()=>{
    const f=fixture(position), a=f.start(stage), immutable=clone(a.steps.map(s=>s.row));
    await assert.rejects(f.run(a),/retry_ready/);
    const resumed=readPurchaseAttempt(actor,f.storage); assert.deepEqual(resumed.draft,{...draft,requestStage:stage});
    assert.equal(resumed.steps[position].state,'ready');
    await f.run(resumed); assert.deepEqual(resumed.steps.map(s=>s.row),immutable);
    assert.equal(f.rows.size,stage==='order'?4:6);assert.equal(f.writes.length,immutable.length+1);
    const lines=[...f.rows.values()].filter(r=>r.ordered_quantity);
    assert.deepEqual(lines.map(l=>l.ordered_quantity),[2,1]);
    if(stage==='receive') assert.deepEqual([...f.rows.values()].filter(r=>r.move_type).map(r=>[r.quantity,r.unit_amount]),[[2,12],[1,0]]);
    finishPurchaseAttempt(resumed,f.storage);assert.equal(readPurchaseAttempt(actor,f.storage),null);
  });
}
for(const failure of [{data:null,error:{message:'synthetic teacher line write failure'}}, {data:null,status:406,error:{code:'PGRST116',message:'client cardinality',details:'0',hint:null}}, {data:null,status:0,error:{code:'',message:'AbortError',details:'',hint:''}}, new Error('lost response'), {data:null,error:null,status:201}, {...sqlFailure,status:0}, {...sqlFailure,error:{code:'23514',message:'no server envelope'}}]) {
  test(`unknown result ${JSON.stringify(failure)} never resends an absent row`,async()=>{
    const f=fixture(3,failure),a=f.start(); await assert.rejects(f.run(a),/retry_unresolved/);
    const resumed=readPurchaseAttempt(actor,f.storage);assert.equal(resumed.steps[3].state,'unknown');
    await assert.rejects(f.run(resumed),/retry_unresolved/);assert.equal(f.writes.length,4);assert.equal(f.rows.size,3);
    assert.deepEqual(resumed.draft,draft);
  });
}
for(const stage of ['order','receive']) for(let position=0;position<(stage==='order'?4:6);position++) {
  test(`${stage}: committed reply loss step ${position+1} resumes only after exact verification`,async()=>{
    const f=fixture(position,new Error('lost reply'),true),a=f.start(stage);await assert.rejects(f.run(a),/retry_unresolved/);
    await f.run(readPurchaseAttempt(actor,f.storage));assert.equal(f.writes.length,a.steps.length);assert.equal(f.rows.size,a.steps.length);
  });
}
test('23505 verifies same ID, never treats conflict as permission to insert',async()=>{
  for(const matches of [true,false]) {const f=fixture(1,{...sqlFailure,error:{...sqlFailure.error,code:'23505'}},matches),a=f.start();
    if(matches) await f.run(a);else await assert.rejects(f.run(a),/retry_unresolved/);
    assert.equal(f.writes.length,matches?4:2);
  }
});
test('confirmed or uncertain changed/deleted rows halt without recreation/overwrite',async()=>{
  for(const uncertain of [false,true]) for(const change of ['delete','edit']) {
    const f=fixture(uncertain?0:3,uncertain?new Error('lost'):sqlFailure,uncertain),a=f.start();await assert.rejects(f.run(a));
    const row=a.steps[0].row;if(change==='delete')f.rows.delete(row.id);else f.rows.get(row.id).memo='other staff edit';
    const before=f.writes.length;await assert.rejects(f.run(readPurchaseAttempt(actor,f.storage)),/retry_unresolved/);assert.equal(f.writes.length,before);
  }
});
test('whole form validates before any write, and same content after completion is a new attempt',async()=>{
  const f=fixture();assert.throws(()=>createPurchaseAttempt([...payloads('receive').slice(0,1),{...payloads('receive')[1],statementNumber:''}],actor,draft),/statement number/);assert.equal(f.writes.length,0);
  const a=f.start();await f.run(a);finishPurchaseAttempt(a,f.storage);
  const b=f.start();assert.notEqual(a.id,b.id);assert.notDeepEqual(a.steps.map(s=>s.row.id),b.steps.map(s=>s.row.id));await f.run(b);assert.equal(f.rows.size,8);
});
test('actor mismatch, storage failure and malformed checkpoint deny writes',async()=>{
  const f=fixture(),a=f.start();
  await assert.rejects(resumePurchaseAttempt(a,{actorId:book,client:f.client,checkpoint:f.checkpoint,assertCurrent(){}}),/retry_invalid/);
  assert.equal(readPurchaseAttempt(book,f.storage),null);
  assert.throws(()=>savePurchaseAttempt(a,{setItem(){throw Error('quota');}}),/retry_storage/);
  f.storage.setItem(`tips.textbook-new-purchase.v1:${actor}`,'broken');assert.throws(()=>readPurchaseAttempt(actor,f.storage),/retry_storage/);assert.equal(f.writes.length,0);
});
test('actor or lifecycle change after a response prevents the next statement',async()=>{
  const f=fixture(),a=f.start();let current=true;
  await assert.rejects(resumePurchaseAttempt(a,{actorId:actor,client:{from(){let payload;const q={insert(p){payload=p;return q},select(){return q},single:async()=>{current=false;f.rows.set(payload.id,clone(payload));return{data:payload,error:null,status:201}}};return q}},checkpoint:f.checkpoint,assertCurrent(){if(!current)throw Error('actor changed')}}),/actor changed/);
  assert.equal(f.rows.size,1);assert.equal(readPurchaseAttempt(actor,f.storage).steps[0].state,'confirmed');assert.equal(readPurchaseAttempt(book,f.storage),null);
});

test('only wholly unwritten attempts can be abandoned to correct input', async()=>{
  const f=fixture(0),a=f.start();await assert.rejects(f.run(a),/retry_ready/);discardUnwrittenPurchaseAttempt(a,f.storage);assert.equal(readPurchaseAttempt(actor,f.storage),null);
  for(const failure of [sqlFailure,new Error('unknown')]) {const g=fixture(1,failure),b=g.start();await assert.rejects(g.run(b));assert.throws(()=>discardUnwrittenPurchaseAttempt(b,g.storage),/retry_storage/);}
});
for(const [code,status] of [['23502',400],['23503',409],['23514',400],['22P02',400],['22003',400],['42501',401],['42501',403],['40001',500],['40P01',500],['P0001',400]]) test(`PostgREST PostgreSQL rollback envelope ${code}/${status}`,async()=>{
  const f=fixture(0,{...sqlFailure,status,error:{...sqlFailure.error,code}}),a=f.start();await assert.rejects(f.run(a),/retry_ready/);assert.equal(a.steps[0].state,'ready');
});
test('SQLSTATE with an incompatible HTTP status is uncertain',async()=>{
  const f=fixture(0,{...sqlFailure,status:503}),a=f.start();await assert.rejects(f.run(a),/retry_unresolved/);assert.equal(a.steps[0].state,'unknown');
});

test('valid JSON with damaged actor, graph, states, fields, or quantities cannot resume',async()=>{
  const f=fixture(),original=f.start('receive');
  for(const damage of [a=>a.steps[0].row.created_by=book,a=>a.steps[1].row.purchase_order_id=book,a=>a.steps[2].row.purchase_order_line_id=book,a=>delete a.steps[1].row.ordered_quantity,a=>a.steps[1].row.ordered_quantity=-1,a=>a.steps[2].row.amount=999,a=>a.steps[1].state='confirmed',a=>a.steps[0].row.extra='not permitted',a=>a.steps.splice(1,1),a=>a.steps[2].row.created_by=book]) {
    const a=clone(original);damage(a);f.storage.setItem(`tips.textbook-new-purchase.v1:${actor}`,JSON.stringify(a));assert.throws(()=>readPurchaseAttempt(actor,f.storage),/retry_storage/);
    await assert.rejects(f.run(a),/retry_invalid/);
  }
  assert.equal(f.writes.length,0);
});
test('same attempt cannot run concurrently and completion does not trust missing checkpoints',async()=>{
  const f=fixture(),a=f.start();let unblock;const waiting=new Promise(resolve=>unblock=resolve);let calls=0;
  const client={from(table){const q=f.client.from(table);const original=q.single;q.single=async()=>{calls++;if(calls===1)await waiting;return original()};return q}};
  const first=resumePurchaseAttempt(a,{actorId:actor,client,checkpoint:f.checkpoint,assertCurrent(){}});
  await assert.rejects(resumePurchaseAttempt(a,{actorId:actor,client,checkpoint:f.checkpoint,assertCurrent(){}}),/retry_busy/);
  unblock();await first;assert.equal(f.writes.length,4);
  f.storage.removeItem(`tips.textbook-new-purchase.v1:${actor}`);assert.throws(()=>finishPurchaseAttempt(a,f.storage),/retry_storage/);
});
