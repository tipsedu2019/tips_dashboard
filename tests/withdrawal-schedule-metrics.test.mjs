import assert from "node:assert/strict";
import test from "node:test";

let withdrawalScheduleMetrics = {};
try {
  withdrawalScheduleMetrics = await import("../src/features/tasks/withdrawal-schedule-metrics.js");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const {
  getWithdrawalBillingCycleItems,
  getWithdrawalDateSelectionItem,
  getWithdrawalSessionNumber,
  isCountedWithdrawalScheduleState,
  normalizeWithdrawalScheduleSessions,
} = withdrawalScheduleMetrics;

function withLessonHours(items, lessonHours = 2) {
  return items.map((item) => ({ ...item, lessonHours }));
}

test("production-shaped withdrawal plan ignores skipped markers without inventing session numbers", () => {
  assert.equal(
    typeof normalizeWithdrawalScheduleSessions,
    "function",
    "withdrawal schedule metrics must normalize the raw schedule plan",
  );

  const schedulePlan = {
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      startDate: "2026-08-01",
      endDate: "2026-08-29",
      color: "#4f8e87",
    }],
    sessions: [
      ["session-01", "2026-08-01", "active", 1],
      ["session-02", "2026-08-04", "active", 2],
      ["session-03", "2026-08-06", "active", 3],
      ["session-04", "2026-08-07", "makeup", 4],
      ["session-skipped", "2026-08-07", "skipped", null],
      ["session-exception", "2026-08-08", "exception", null],
      ["session-05", "2026-08-11", "active", 5],
      ["session-06", "2026-08-13", "active", 6],
      ["session-07", "2026-08-18", "active", 7],
      ["session-08", "2026-08-20", "active", 8],
      ["session-09", "2026-08-22", "active", 9],
      ["session-10", "2026-08-25", "active", 10],
      ["session-11", "2026-08-27", "active", 11],
      ["session-12", "2026-08-29", "active", 12],
    ].map(([id, date, scheduleState, sessionNumber]) => ({
      id,
      date,
      scheduleState,
      sessionNumber,
    })),
  };
  const originalPlan = structuredClone(schedulePlan);

  const items = withLessonHours(normalizeWithdrawalScheduleSessions(schedulePlan));
  const selectedItem = getWithdrawalDateSelectionItem(items, "2026-08-29");
  const completedItems = getWithdrawalBillingCycleItems(items, selectedItem);

  assert.deepEqual(schedulePlan, originalPlan, "normalization must not mutate the saved schedule plan");
  assert.equal(items.find((item) => item.sessionId === "session-skipped")?.sessionNumber, 0);
  assert.deepEqual(
    completedItems.map((item) => item.sessionNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(
    completedItems.reduce((sum, item) => sum + item.lessonHours, 0),
    24,
  );
});

test("same-date normal and makeup sessions are preserved and the date selects the final counted session", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    }],
    sessions: [
      { id: "session-01", date: "2026-08-01", state: "active", sessionNumber: 1 },
      { id: "session-02", date: "2026-08-04", state: "active", sessionNumber: 2 },
      { id: "session-03", date: "2026-08-04", state: "makeup", sessionNumber: 3 },
    ],
  }));

  assert.deepEqual(items.map((item) => item.sessionId), ["session-01", "session-02", "session-03"]);
  const selectedItem = getWithdrawalDateSelectionItem(items, "2026-08-04");
  assert.equal(selectedItem?.sessionId, "session-03");
  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, selectedItem).map((item) => item.sessionNumber),
    [1, 2, 3],
  );
});

test("billing period ranges restore missing session billing IDs across calendar months", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      startDate: "2026-07-30",
      endDate: "2026-08-29",
    }],
    sessions: [
      { id: "session-01", date: "2026-07-30", state: "active", sessionNumber: 1 },
      { id: "session-02", date: "2026-08-01", state: "active", sessionNumber: 2 },
    ],
  }));

  assert.deepEqual(items.map((item) => item.billingId), ["period-august-2026", "period-august-2026"]);
  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items[1]).map((item) => item.dateKey),
    ["2026-07-30", "2026-08-01"],
  );
});

test("normalized legacy billing metadata keeps an out-of-range makeup in its original cycle", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      color: "#3182f6",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    }],
    sessions: [
      {
        id: "normalized-01",
        session_date: "2026-08-01",
        schedule_state: "active",
        legacy_billing_id: "period-august-2026",
        legacy_billing_label: "8월",
        legacy_billing_color: "#3182f6",
      },
      {
        id: "normalized-02",
        session_date: "2026-08-08",
        schedule_state: "active",
        legacyBillingId: "period-august-2026",
        legacyBillingLabel: "8월",
        legacyBillingColor: "#3182f6",
      },
      {
        id: "normalized-makeup",
        session_date: "2026-09-05",
        schedule_state: "makeup",
        legacyBillingId: "period-august-2026",
        legacyBillingLabel: "8월",
        legacyBillingColor: "#3182f6",
      },
    ],
  }));

  assert.deepEqual(items.map((item) => item.billingId), [
    "period-august-2026",
    "period-august-2026",
    "period-august-2026",
  ]);
  assert.equal(items.at(-1)?.billingLabel, "8월");
  assert.equal(items.at(-1)?.billingColor, "#3182f6");
  assert.deepEqual(items.map((item) => item.sessionNumber), [0, 0, 0]);
  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items.at(-1)).map((item) => item.sessionId),
    ["normalized-01", "normalized-02", "normalized-makeup"],
  );
});

test("legacy billing labels use only the contiguous cycle around the selected item", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "august-2025-01", date: "2025-08-02", state: "active", sessionNumber: 1, billingLabel: "8월" },
      { id: "august-2025-12", date: "2025-08-30", state: "active", sessionNumber: 12, billingLabel: "8월" },
      { id: "august-2026-01", date: "2026-08-01", state: "active", sessionNumber: 1, billingLabel: "8월" },
      { id: "august-2026-12", date: "2026-08-29", state: "active", sessionNumber: 12, billingLabel: "8월" },
    ],
  }));

  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items.at(-1)).map((item) => item.sessionId),
    ["august-2026-01", "august-2026-12"],
  );
});

test("legacy labels and session-order fallback preserve a cycle that crosses a calendar month", () => {
  const labeledItems = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "labeled-01", date: "2026-07-30", state: "active", sessionNumber: 1, billingLabel: "8월" },
      { id: "labeled-02", date: "2026-08-01", state: "normal", sessionNumber: 2, billingLabel: "8월" },
    ],
  }));
  const metadataFreeItems = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "fallback-01", date: "2026-07-30", state: "active", sessionNumber: 1 },
      { id: "fallback-02", date: "2026-08-01", state: "active", sessionNumber: 2 },
    ],
  }));

  assert.deepEqual(
    getWithdrawalBillingCycleItems(labeledItems, labeledItems[1]).map((item) => item.sessionId),
    ["labeled-01", "labeled-02"],
  );
  assert.deepEqual(
    getWithdrawalBillingCycleItems(metadataFreeItems, metadataFreeItems[1]).map((item) => item.sessionId),
    ["fallback-01", "fallback-02"],
  );
});

test("metadata-free missing-number fallback stays within the selected calendar month", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "july-unknown", date: "2026-07-30", state: "active", sessionNumber: null },
      { id: "august-unknown", date: "2026-08-01", state: "active", sessionNumber: null },
    ],
  }));

  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items[1]).map((item) => item.sessionId),
    ["august-unknown"],
  );
});

test("withdrawal state policy counts only active, normal, and makeup sessions", () => {
  assert.equal(typeof isCountedWithdrawalScheduleState, "function");
  for (const state of [undefined, "", "active", "normal", "makeup", " ACTIVE "]) {
    assert.equal(isCountedWithdrawalScheduleState(state), true, `${String(state)} should count`);
  }
  for (const state of ["skipped", "exception", "tbd", "canceled", "cancelled", "completed"]) {
    assert.equal(isCountedWithdrawalScheduleState(state), false, `${state} should not count`);
  }
});

test("withdrawal session numbers never fall back to schedule array positions", () => {
  assert.equal(
    typeof getWithdrawalSessionNumber,
    "function",
    "withdrawal schedule metrics must expose session-number normalization",
  );

  assert.equal(getWithdrawalSessionNumber({ sessionNumber: 12 }), 12);
  assert.equal(getWithdrawalSessionNumber({ session_number: "4" }), 4);
  assert.equal(getWithdrawalSessionNumber({ sessionNumber: null }), 0);
  assert.equal(getWithdrawalSessionNumber({}), 0);
});

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { applyAuthoredLegacyLessonEdit } from '../src/features/operations/legacy-authored-lesson-plan.ts';
import { buildClassScheduleRouteModel } from '../src/features/operations/records.js';
import * as withdrawal from '../src/features/tasks/withdrawal-schedule-metrics.js';
import { toDateKey } from '../src/features/tasks/ops-task-model.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSelectableRegistrationScheduleSessions } from '../src/features/tasks/registration-workflow.js';
{
const path = new URL('../src/features/tasks/ops-task-workspace.tsx',import.meta.url);
const source = fs.readFileSync(path,'utf8');
const ast = ts.createSourceFile(String(path),source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const start = ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text==='stringValue').getStart(ast);
const end = ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text==='getTransferTuitionAdjustment').end;
const slice = source.slice(start,end);

const js=ts.transpileModule(slice+'\nglobalThis.actualTransfer={getWithdrawalClassScheduleItems,getTransferMonthlyCycleContext,getTransferTuitionAdjustment};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const context=vm.createContext({...withdrawal,toDateKey,Date,Intl,Map,Set,console});
vm.runInContext(js,context);
const actual=context.actualTransfer;
const empty={selectedDays:[2,4],billingPeriods:[],sessions:[],sessionStates:{},sessionSchedules:{}};
const input={...empty,billingPeriods:[{id:'oct',label:'10월',month:10,startDate:'2026-10-01',endDate:'2026-10-27'}]};
const generated=applyAuthoredLegacyLessonEdit(input,empty);
const numbered={...generated,sessions:generated.sessions.map((x,i)=>({...x,sessionNumber:i+1}))};
const classItem=plan=>({id:'synthetic',name:'Synthetic',fee:800,schedule:'화목 14:00-16:00',schedulePlan:plan});
const values={};
test('narrow alternative max+1 reuses orphan number-only progress despite unique current numbers',()=>{
 const plan={sessions:[{id:'old',date:'2026-10-06',sessionNumber:1},{id:'new',date:'2026-10-01',sessionNumber:2}]};
 const result=buildClassScheduleRouteModel({classes:[{id:'synthetic',schedulePlan:plan}],progressLogs:[{class_id:'synthetic',session_order:2,session_id:'',status:'done',content:'orphan learning'}]});
 values.orphan=result.rows[0].raw.sessions.find(x=>x.id==='new');
 assert.equal(values.orphan.content,'orphan learning');
});
test('actual transfer consumer treats unique max+1 as served count even for chronological first lesson',()=>{
 const plan={selectedDays:[2,4],sessions:[{id:'old',date:'2026-10-06',sessionNumber:1,billingId:'oct',billingLabel:'10월',state:'active'},{id:'new',date:'2026-10-01',sessionNumber:2,billingId:'oct',billingLabel:'10월',state:'active'}]};
 const klass=classItem(plan),items=actual.getWithdrawalClassScheduleItems(klass);
 values.maxPlusOneTransfer=actual.getTransferMonthlyCycleContext(items,klass,items.find(x=>x.sessionId==='new'));
 assert.equal(values.maxPlusOneTransfer.servedSessionCount,2);
 assert.equal(values.maxPlusOneTransfer.remainingSessionCount,7);
});
test('REGRESSION: current new null-number month must not quote a spurious transfer refund',()=>{
 assert.equal(generated.sessions.length,8);
 assert.ok(generated.sessions.every(x=>x.sessionNumber===null));
 const args=from=>({fromClass:{...classItem(from),id:'synthetic-from'},toClass:{...classItem(numbered),id:'synthetic-to'},fromDate:'2026-10-06',toDate:'2026-10-08'});
 values.numberedTransfer=actual.getTransferTuitionAdjustment(args(numbered));
 values.nullTransfer=actual.getTransferTuitionAdjustment(args(generated));

 assert.equal(values.numberedTransfer.settlementType,'balanced');
 assert.equal(values.numberedTransfer.amountLabel,'0원');
 assert.equal(values.nullTransfer.settlementType,'balanced');
});
const adjust = (from = generated, to = generated, fromDate = '2026-10-06', toDate = '2026-10-08') => actual.getTransferTuitionAdjustment({
 fromClass: {...classItem(from), id:'from'}, toClass: {...classItem(to), id:'to'}, fromDate, toDate,
});
const cycle = (plan, id) => {
 const klass = classItem(plan), items = actual.getWithdrawalClassScheduleItems(klass);
 return actual.getTransferMonthlyCycleContext(items, klass, items.find(row => row.sessionId === id));
};
test('authored transfer counts actual IDs on both sides and keeps registration start identity',()=>{
 const before=structuredClone(generated), result=adjust();
 assert.equal(result.settlementType,'balanced');
 assert.equal(result.amountLabel,'0원');
 assert.equal(result.fromProgressLabel,'2/8회 (25%)');
 assert.equal(result.toProgressLabel,'6/8회 (75%)');
 const start=generated.sessions[2];
 const choice=getSelectableRegistrationScheduleSessions(generated,{normalized:false}).find(row=>row.value===`legacy:${start.id}`);
 assert.equal(choice.dateKey,'2026-10-08');
 assert.equal(cycle(generated,start.id).remainingSessionCount,6);
 assert.equal(cycle(generated,start.id).sessionNumber,0);
 assert.deepEqual(generated,before);
});
test('mixed cycles count chronological eligible IDs without changing old numbers, learning or memos',()=>{
 const mixed={...generated,sessions:generated.sessions.map((row,i)=>({...row,sessionNumber:i===0?null:i===1?99:i,content:`learning-${i}`,memo:`memo-${i}`}))};
 const before=structuredClone(mixed), result=adjust(mixed,mixed);
 assert.equal(result.settlementType,'balanced');
 assert.equal(result.fromProgressLabel,'2/8회 (25%)');
 assert.equal(cycle(mixed,mixed.sessions[1].id).sessionNumber,99);
 assert.deepEqual(mixed,before);
});
test('authored count uses exact billing identity, excluding same-label periods in other years',()=>{
 const plan={...generated,billingPeriods:[...generated.billingPeriods,{id:'old-oct',label:'10월',startDate:'2025-10-01',endDate:'2025-10-31'}],sessions:[
  {id:'old',date:'2025-10-01',sessionNumber:null,billingId:'old-oct',billingLabel:'10월',state:'active'},...generated.sessions,
  {id:'future',date:'2027-10-01',sessionNumber:null,billingId:'future-oct',billingLabel:'10월',state:'active'},
 ]};
 assert.equal(adjust(plan,generated).settlementType,'balanced');
 assert.equal(cycle(plan,generated.sessions[1].id).cycleSessionCount,8);
});
test('authored accounting excludes canceled markers and counts the linked makeup exactly once in its owning period',()=>{
 const plan={...generated,sessions:generated.sessions.map((row,i)=>i===0?{...row,state:'exception',scheduleState:'exception'}:row).concat([
  {id:'makeup',originalSessionId:generated.sessions[0].id,originalDate:'2026-10-01',date:'2026-11-01',sessionNumber:null,state:'makeup',billingId:'oct',billingLabel:'10월'},
  ...['tbd','skipped','canceled'].map((state,i)=>({id:`marker-${i}`,date:`2026-10-${10+i}`,state,sessionNumber:null,billingId:'oct',billingLabel:'10월'})),
 ])};
 const before=structuredClone(plan), second=cycle(plan,generated.sessions[1].id), makeup=cycle(plan,'makeup');
 assert.equal(second.servedSessionCount,1);
 assert.equal(second.cycleSessionCount,8);
 assert.equal(makeup.servedSessionCount,8);
 assert.equal(makeup.remainingSessionCount,1);
 assert.deepEqual(plan,before);
});
test('numbered legacy accounting preserves normal balanced/refund/additional and sparse historic totals',()=>{
 for(const [fromDate,toDate,type,amount] of [
  ['2026-10-06','2026-10-08','balanced','0원'],
  ['2026-10-01','2026-10-08','refund_or_carry','100원'],
  ['2026-10-08','2026-10-08','additional_payment','100원'],
 ]) {
  const result=adjust(numbered,numbered,fromDate,toDate);
  assert.equal(result.settlementType,type);assert.equal(result.amountLabel,amount);
 }
 const sparse={...numbered,sessions:[{...numbered.sessions[0],sessionNumber:1},{...numbered.sessions.at(-1),sessionNumber:12}]};
 assert.equal(cycle(sparse,sparse.sessions[1].id).cycleSessionCount,12);
 assert.equal(cycle(sparse,sparse.sessions[1].id).servedSessionCount,12);
});
test('unknown billing, nonunique/missing ID and same-date start ambiguity cannot fabricate a monetary quote',()=>{
 const missingBilling={...generated,billingPeriods:[],sessions:generated.sessions.map(({billingId,billingLabel,...row})=>row)};
 const duplicate={...generated,sessions:[...generated.sessions,{...generated.sessions[1],date:'2026-10-30',state:'exception'}]};
 const missingId={...generated,sessions:generated.sessions.map((row,i)=>i===1?{...row,id:'',sessionKey:''}:row)};
 const sameDate={...generated,sessions:[...generated.sessions,{...generated.sessions[2],id:'another-start'}]};
 for(const plan of [missingBilling,duplicate,missingId]) {
  const before=structuredClone(plan), result=adjust(plan,generated);
  assert.equal(result.settlementType,'not_ready');
  assert.equal(result.amountLabel,'확인 필요');
  assert.deepEqual(plan,before);
 }
 const result=adjust(generated,sameDate);
 assert.equal(result.settlementType,'not_ready');assert.equal(result.amountLabel,'확인 필요');
});
test('raw duplicate hidden by normalization and synthetic-ID collisions cannot resolve a financial identity',()=>{
 const hiddenNull={...numbered,sessions:[...numbered.sessions,{...numbered.sessions[1],sessionNumber:null,date:'2026-10-30'}]};
 const syntheticCollision={...generated,sessions:generated.sessions.map((row,i)=>i===1?{...row,id:'',sessionKey:''}:i===0?{...row,id:'source-index:1'}:row)};
 for(const plan of [hiddenNull,syntheticCollision]) {
  const result=adjust(plan,generated);
  assert.equal(result.settlementType,'not_ready');assert.equal(result.amountLabel,'확인 필요');
 }
});
test('actual React settlement panel displays authored progress and balanced result, never the former 200 refund',()=>{
 const names=['TransferAdjustmentMetric','TransferTuitionAdjustmentPanel'];
 const body=names.map(name=>{const node=ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);assert.ok(node);return source.slice(node.getStart(ast),node.end)}).join('\n');
 const compiled=ts.transpileModule(body+'\nglobalThis.Panel=TransferTuitionAdjustmentPanel;',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React},
 }).outputText;
 const ui=vm.createContext({React,Badge:({children})=>React.createElement('span',null,children)});
 vm.runInContext(compiled,ui);
 const html=renderToStaticMarkup(React.createElement(ui.Panel,{adjustment:adjust()}));
 assert.match(html,/2\/8회 \(25%\)/);assert.match(html,/6\/8회 \(75%\)/);
 assert.match(html,/정산 없음/);assert.match(html,/추가 납부나 환불\/이월 없이 맞습니다/);
 assert.doesNotMatch(html,/200원|환불\/이월 필요/);
 const ambiguous={...generated,sessions:[...generated.sessions,{...generated.sessions[2],id:'another'}]};
 const blocked=renderToStaticMarkup(React.createElement(ui.Panel,{adjustment:adjust(generated,ambiguous)}));
 assert.match(blocked,/회차 확인/);assert.match(blocked,/정산액을 확정하지 않습니다/);
});
}
