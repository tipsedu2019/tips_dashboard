import test from 'node:test';
import assert from 'node:assert/strict';
import { findOperatingConflicts, suggestPlacements, operatingReferenceComplete } from '../src/features/academic/timetable-conflicts.ts';
import { requireTimetableOperatingReference } from '../src/features/academic/timetable-plan-service.ts';
import { validatePlacementEdit } from '../src/features/academic/timetable-plan-interaction.ts';
const slot={id:'slot',itemId:'item',planId:'plan',weekday:2,startMinute:1170,endMinute:1290,teacherId:'t',classroomId:'r',sourceSlotId:null};
const blocker={classId:'old',label:'기존 수업',scope:'all',resourceId:null,reason:'unresolved_resource',weekday:2,startMinute:1170,endMinute:1290,teacherId:'other',classroomId:null};
const ref={occupancyValidationVersion:2,asOfDate:'2026-09-27',shadowSlots:[],shadowClasses:[],catalogs:{teachers:[],classrooms:[]},unresolvedOccupancies:[blocker],shadowFingerprint:'f',datedSessions:[],datedUnresolvedOccupancies:[],datedFingerprint:'d',datedComplete:true,complete:false};
test('unresolved room reserves its interval while unrelated days and adjacent intervals stay editable',()=>{
 assert.equal(operatingReferenceComplete(ref),true);
 assert.equal(findOperatingConflicts([slot],ref)[0].kind,'unresolved');
 for(const safe of [{...slot,weekday:1},{...slot,startMinute:1290,endMinute:1350},{...slot,startMinute:1110,endMinute:1170}]) assert.deepEqual(findOperatingConflicts([safe],ref),[]);
});
test('a failed old response and capacity overflow never become usable through scoped validation',()=>{
 assert.equal(operatingReferenceComplete({...ref,occupancyValidationVersion:undefined}),false);
 assert.equal(operatingReferenceComplete({...ref,capacity:{exceeded:true}}),false);
});
test('dated uncertainty uses both requested period and exact weekday without globally locking the board',()=>{
 const dated={...ref,unresolvedOccupancies:[],datedUnresolvedOccupancies:[{...blocker,date:'2026-10-06'}],datedComplete:false};
 assert.equal(operatingReferenceComplete(dated,{startDate:'2026-10-01',endDate:'2026-10-31'}),true);
 assert.equal(findOperatingConflicts([slot],dated,{startDate:'2026-10-01',endDate:'2026-10-31'})[0].date,'2026-10-06');
 assert.deepEqual(findOperatingConflicts([{...slot,weekday:1}],dated,{startDate:'2026-10-01',endDate:'2026-10-31'}),[]);
 assert.deepEqual(findOperatingConflicts([slot],dated,{startDate:'2027-01-01',endDate:'2027-12-31'}),[]);
 assert.deepEqual(findOperatingConflicts([slot],dated),[]);
});
test('free slot suggestions exclude only affected uncertainty and real resource collisions',()=>{
 const result=suggestPlacements({slots:[],shadows:[],planId:'plan',itemId:'item',teacherId:'t',classroomId:'r',durationMinutes:30,weekdays:[2],fromMinute:1140,toMinute:1350,operatingReference:ref});
 assert.equal(result[0].startMinute,1140); assert.equal(result[1].startMinute,1290);
 assert.ok(result.every(s=>s.startMinute+30<=1170 || s.startMinute>=1290));
});
test('unknown bounds stay conservative; known resources constrain uncertainty with missing time',()=>{
 const unknown={...ref,unresolvedOccupancies:[{...blocker,weekday:null,startMinute:null,endMinute:null}]};
 assert.equal(findOperatingConflicts([{...slot,weekday:5}],unknown).length,1);
 const known={...unknown,unresolvedOccupancies:[{...unknown.unresolvedOccupancies[0],teacherId:'other',classroomId:'other-room'}]};
 assert.deepEqual(findOperatingConflicts([slot],known),[]);
});
test('invalid bounds or unsupported protocol fail at the real response consumer',()=>{
 assert.equal(requireTimetableOperatingReference(ref),ref);
 for(const invalid of [{...ref,occupancyValidationVersion:3},{...ref,unresolvedOccupancies:[{...blocker,weekday:9}]},{...ref,unresolvedOccupancies:[{...blocker,endMinute:1000}]},{...ref,unresolvedOccupancies:[{...blocker,startMinute:null}]}]) assert.throws(()=>requireTimetableOperatingReference(invalid),/invalid/);
});
test('metadata edits retain existing occupancy; a new affected placement explains the specific class',()=>{
 const snapshot={...ref,plan:{targetStartDate:null,targetEndDate:null},items:[{id:'item',name:'draft'}],slots:[slot]};
 assert.doesNotThrow(()=>validatePlacementEdit(snapshot,{operation:'save',item:{id:'item',name:'rename'},slots:[slot]}));
 assert.throws(()=>validatePlacementEdit({...snapshot,slots:[]},{operation:'save',item:{id:'item'},slots:[slot]}),/기존 수업의 시간·선생님·강의실/);
});

test('dated or English class conflict keeps its specific explanation through the real error formatter',async()=>{
 const {planErrorLabel}=await import('../src/features/academic/timetable-plan-interaction.ts');
 const snapshot={...ref,unresolvedOccupancies:[],datedUnresolvedOccupancies:[{...blocker,label:'conflict invalid legacy',date:'2026-10-06'}],plan:{targetStartDate:'2026-10-01',targetEndDate:'2026-10-31'},items:[],slots:[]};
 try { validatePlacementEdit(snapshot,{operation:'save',item:{id:'item'},slots:[slot]}); assert.fail('must block'); }
 catch(e) { assert.match(planErrorLabel(e),/^2026-10-06 · conflict invalid legacy의/); }
});
