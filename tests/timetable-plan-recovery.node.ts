import test from 'node:test';
import assert from 'node:assert/strict';
import * as recovery from '../src/features/academic/timetable-plan-recovery.ts';
function storage() { const data=new Map<string,string>();return {get length(){return data.size},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}; }
test('one plan revocation preserves other plan submitted recovery and actor lifetime',()=>{
 const store=storage(), key=(id:string)=>recovery.timetableDraftStorageKey('actor',id);
 for(const id of ['revoked','allowed']) {store.setItem(key(id),`pending ${id}`);store.setItem(key(id)+':transfer',JSON.stringify({request:{source:{planId:id},target:{kind:'operational'}}}));}
 store.setItem(key('$metadata'),JSON.stringify({pending:{command:{operation:'clone',sourcePlanId:'revoked',planId:'new'}}}));store.setItem(key('$import'),'unrelated import');
 let retired=false;const stop=recovery.observeTimetableActorRetirement('actor',()=>{retired=true});
 recovery.clearTimetablePlanRecovery('actor','revoked',store);
 assert.equal(retired,false);assert.equal(store.getItem(key('revoked')),null);assert.equal(store.getItem(key('revoked')+':transfer'),null);assert.equal(store.getItem(key('$metadata')),null);
 assert.equal(store.getItem(key('allowed')),'pending allowed');assert.ok(store.getItem(key('allowed')+':transfer'));assert.equal(store.getItem(key('$import')),'unrelated import');
 recovery.clearTimetableActorRecovery('actor',store);assert.equal(retired,true);assert.equal(store.length,0);stop();
});
test('unrelated metadata remains while transfers targeting revoked plan are removed',()=>{
 const store=storage(), key=(id:string)=>recovery.timetableDraftStorageKey('actor',id);const metadata=JSON.stringify({pending:{command:{operation:'rename',planId:'allowed'}}});store.setItem(key('$metadata'),metadata);store.setItem(key('allowed'),'pending allowed');store.setItem(key('allowed')+':transfer',JSON.stringify({request:{source:{planId:'allowed'},target:{kind:'plan',planId:'revoked'}}}));
 let seen='';const stop=recovery.observeTimetablePlanRevocation('actor',id=>{seen=id});recovery.clearTimetablePlanRecovery('actor','revoked',store);stop();assert.equal(seen,'revoked');assert.equal(store.getItem(key('$metadata')),metadata);assert.equal(store.getItem(key('allowed')),'pending allowed');assert.equal(store.getItem(key('allowed')+':transfer'),null);
});
test('plan revocation tolerates unavailable storage',()=>{assert.doesNotThrow(()=>recovery.clearTimetablePlanRecovery('actor','p',null));});
