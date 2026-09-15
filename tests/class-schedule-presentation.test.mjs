import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClassScheduleProgress as format, getClassScheduleProgressState as state } from '../src/features/operations/class-schedule-presentation.js';
test('accepted zero and nonzero progress preserve real units and denominator', () => {
  assert.deepEqual(format({completedSessions: 0, sessionCount: 0, state: 'accepted'}), {label:'계획 없음', countLabel:null, percent:null});
  assert.deepEqual(format({completedSessions: 5, sessionCount: 10, state: 'accepted'}), {label:'50%', countLabel:'5/10회', percent:50});
  assert.equal(format({completedSessions: 1, sessionCount: 0, state: 'accepted'}).label, '계획 회차 확인 필요');
});
test('unread, pending, failed, forbidden and no-period never claim empty plan', () => {
  const labels = new Set(['missing','loading','error','forbidden','noPeriod'].map(state => {
    const value = format({completedSessions:0,sessionCount:0,state});
    assert.equal(value.percent,null); assert.equal(value.countLabel,null); return value.label;
  }));
  assert.equal(labels.size,5); assert.ok(!labels.has('계획 없음'));
});
test('numbered identity summaries and incomplete plans are missing, explicit no period remains separate', () => {
  assert.equal(state({id:'1', name:'영어'}),'missing');
  assert.equal(state({schedule_plan:{}}),'missing');
  assert.equal(state({schedule_plan:{sessions:[],billingPeriods:[]}}),'noPeriod');
  const source={schedule_plan:{sessions:[],billingPeriods:[{id:'period'}]}};
  assert.equal(state(source),'accepted');
  assert.equal(state(source,'loading'),'loading'); assert.equal(state(source,'error'),'error');
});
