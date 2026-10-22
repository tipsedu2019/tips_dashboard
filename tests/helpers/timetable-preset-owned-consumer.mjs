import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTimetablePlanService, requireTimetableBatchResult, requireTimetableTransferResult } from '../../src/features/academic/timetable-plan-service.ts';
import { createTimetablePlanController } from '../../src/features/academic/timetable-plan-model.ts';
import { buildPlanPanels } from '../../src/features/academic/timetable-plan-interaction.ts';
import { withRpcQueryControls } from './rpc-query-fixture.mjs';

// Only reads captured synthetic JSON. No network, provider or database fallback.
export async function verifyOwnedPresetProducer(data) {
  let assertions=0;
  const check=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
  check(data.presetOwnedConsumer,true);
  for(const key of ['empty','applied']) {
    const dto=data[key];
    const service=createTimetablePlanService({actorScope:'isolated-preset',client:withRpcQueryControls({rpc:()=>Promise.resolve({data:dto,error:null})})});
    const accepted=await service.readPlan(dto.plan.id);
    check(accepted,dto);
    for(const view of ['teacher-weekly','classroom-weekly','daily-teacher','daily-classroom']) {
      const blocks=buildPlanPanels(accepted,view).flatMap(panel=>panel.blocks);
      check(blocks.map(b=>b.id).sort(),[...dto.slots,...dto.appliedSnapshots.flatMap(a=>a.slots)].map(s=>s.id).sort());
      check(blocks.filter(b=>b.applied).map(b=>b.id).sort(),dto.appliedSnapshots.flatMap(a=>a.slots.map(s=>s.id)).sort());
    }
  }
  check(requireTimetableBatchResult(data.batch,data.batchCommand),data.batch);
  check(requireTimetableBatchResult(data.tombstone,data.tombstoneCommand),data.tombstone);
  for(const key of ['transfer','operational']) {
    const dto=data[key],pid=dto.snapshot.plan.id;
    check(requireTimetableTransferResult(dto,pid),dto);
    const controller=createTimetablePlanController({actorScope:'isolated-preset',planId:pid,autoSave:false,storage:null,service:{readPlan:async()=>structuredClone(dto.snapshot),saveItem:async()=>{throw Error('unexpected write');}}});
    try {
      await controller.load();controller.applyTransfer(dto);
      check(controller.snapshot().snapshot,dto.snapshot);
      const blocks=buildPlanPanels(controller.snapshot().snapshot,'teacher-weekly').flatMap(p=>p.blocks);
      check(blocks.filter(b=>b.applied).map(b=>b.id).sort(),dto.snapshot.appliedSnapshots.flatMap(a=>a.slots.map(s=>s.id)).sort());
      check(dto.addedShadowSlots,[]);
    } finally {controller.destroy();}
  }
  return {assertions,productionCalls:0};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href && process.argv[2]) console.log(JSON.stringify(await verifyOwnedPresetProducer(JSON.parse(readFileSync(process.argv[2],'utf8')))));
