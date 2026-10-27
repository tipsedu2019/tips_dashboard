import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classScheduleYearMonths, parseClassScheduleMonthSummary } from '../src/features/operations/class-schedule-month-summary.ts';
import { createOperationsReadService } from '../src/features/operations/operations-read-service.js';
const id='bd200000-0000-4000-8000-000000000100';
const payload=()=>({classId:id,year:2026,authoritativeSource:'normalized',months:Array.from({length:12},(_,i)=>({month:i+1,count:i}))});
test('annual projection validates exact identity and twelve unique safe counts',()=>{
  assert.equal(parseClassScheduleMonthSummary(payload(),id,2026).months.length,12);
  for(const value of [null,{}, {...payload(),classId:'other'}, {...payload(),year:2027}, {...payload(),authoritativeSource:'error'},
    {...payload(),months:[]}, {...payload(),months:Array(12).fill({month:1,count:0})},
    ...[-1,1.2,'1',Number.MAX_SAFE_INTEGER+1].map(count=>({...payload(),months:[{month:1,count},...payload().months.slice(1)]}))]) {
    assert.throws(()=>parseClassScheduleMonthSummary(value,id,2026),/operations_month_summary_invalid/);
  }
  assert.deepEqual(parseClassScheduleMonthSummary({...payload(),authoritativeSource:'legacy'},id,2026).months,[]);
});
test('calendar metadata preserves year boundaries and leap days',()=>{
  assert.equal(classScheduleYearMonths(2028)[1].endDate,'2028-02-29');
  assert.equal(classScheduleYearMonths(2026)[11].endDate,'2026-12-31');
  assert.equal(classScheduleYearMonths(1)[0].startDate,'0001-01-01');
  for(const year of [0,9999,2026.5,NaN])assert.deepEqual(classScheduleYearMonths(year),[]);
});
test('annual transport sends bounded class/year once with deadline and no automatic retry',async()=>{
  const calls=[];
  const service=createOperationsReadService({actorScope:'synthetic:teacher',supabase:{rpc(name,args){
    const call={name,args};calls.push(call);return {abortSignal(signal){call.signal=signal;return this;},retry(value){call.retry=value;return Promise.resolve({data:payload(),error:null});}};
  }}});
  await service.loadClassScheduleMonthSummary({classId:id,year:2026});
  assert.equal(calls.length,1);assert.equal(calls[0].name,'get_class_schedule_month_summary_v1');
  assert.deepEqual(calls[0].args,{p_class_id:id,p_year:2026});assert.equal(calls[0].retry,false);assert.ok(calls[0].signal instanceof AbortSignal);
  for(const input of [{classId:'bad',year:2026},{classId:id,year:9999},{classId:id,year:'2026'}])await assert.rejects(service.loadClassScheduleMonthSummary(input));
  assert.equal(calls.length,1);
});
// Optional isolated producer capture validates the actual final SQL -> service DTO.
if(process.env.MONTH_SUMMARY_CAPTURE_PATH)test('isolated SQL payloads pass the real consumer unchanged',()=>{
  const rows=JSON.parse(readFileSync(process.env.MONTH_SUMMARY_CAPTURE_PATH,'utf8'));
  assert.equal(rows.length,3);
  assert.equal(parseClassScheduleMonthSummary(rows[0],id,2026).months[9].count,2);
  assert.equal(parseClassScheduleMonthSummary(rows[1],id,2028).months[1].count,1);
  assert.deepEqual(parseClassScheduleMonthSummary(rows[2],'bd200000-0000-4000-8000-000000000102',2026).months,[]);
});
