import { buildLegacyMakeupApprovalPlan } from '../../src/features/makeup-requests/makeup-approval-plan.js';
import { buildMakeupCalendarDrafts, extractMakeupCalendarMeta } from '../../src/features/makeup-requests/makeup-request-model.js';
import { buildAcademicEventMutationPayload } from '../../src/features/operations/academic-event-utils.js';

// Synthetic producer fixture. PostgreSQL updates only the request generation
// to the live isolated row's value before passing this patch to the final writer.
const fixture={
  "plan": {
    "subject": "영어",
    "className": "Synthetic legacy adoption",
    "selectedDays": [
      3,
      5
    ],
    "billingPeriods": [
      {
        "id": "synthetic-billing",
        "month": 10,
        "label": "Synthetic billing",
        "startDate": "2050-10-01",
        "endDate": "2050-10-31"
      }
    ],
    "sessionStates": {
      "2050-10-20": {
        "state": "exception",
        "makeupDate": "2050-10-06",
        "memo": "Preserved cancellation memo"
      }
    },
    "sessionSchedules": {},
    "extension": {
      "keep": true
    },
    "sessions": [
      {
        "id": "legacy-original-alpha",
        "sessionKey": "legacy-original-alpha",
        "date": "2050-10-20",
        "state": "exception",
        "scheduleState": "exception",
        "makeupDate": "2050-10-06",
        "billingId": "synthetic-billing",
        "teacherNote": "Preserved original note",
        "memo": "Preserved original memo",
        "textbookEntries": [
          {
            "textbookId": "synthetic-book",
            "actual": {
              "start": 8,
              "end": 10
            }
          }
        ],
        "progressStatus": "done"
      },
      {
        "id": "legacy-makeup-alpha",
        "sessionKey": "legacy-makeup-alpha",
        "date": "2050-10-06",
        "state": "makeup",
        "scheduleState": "makeup",
        "originalDate": "2050-10-20",
        "originalSessionId": "legacy-original-alpha",
        "billingId": "synthetic-billing",
        "teacherNote": "Preserved makeup note",
        "memo": "Preserved makeup memo",
        "textbookEntries": [
          {
            "textbookId": "synthetic-book",
            "actual": {
              "start": 11,
              "end": 14
            }
          }
        ],
        "progressStatus": "done"
      }
    ]
  },
  "request": {
    "id": "af061106-0000-4000-8000-000000000003",
    "class_id": "af061106-0000-4000-8000-000000000004",
    "class_name": "Synthetic legacy adoption",
    "subject": "영어",
    "status": "approval_pending",
    "request_kind": "cancel_makeup",
    "cancel_date": "2050-10-20",
    "teacher_catalog_id": "af061106-0000-4000-8000-000000000001",
    "makeup_start_at": "2050-10-06T09:00:00Z",
    "makeup_end_at": "2050-10-06T11:00:00Z",
    "makeup_classroom": "Synthetic requested room",
    "makeup_slots": [
      {
        "startAt": "2050-10-06T18:00:00+09:00",
        "endAt": "2050-10-06T20:00:00+09:00",
        "classroom": "Synthetic requested room"
      }
    ],
    "updated_at": "2050-10-01T00:00:00.123456+00:00"
  },
  "teacher": {
    "id": "af061106-0000-4000-8000-000000000001",
    "name": "Synthetic requested teacher"
  },
  "room": {
    "id": "af061106-0000-4000-8000-000000000002",
    "name": "Synthetic requested room"
  }
};
export function adoptionDbFixture(){
 const {plan,request,teacher,room}=structuredClone(fixture);
 const id=n=>'af061106-0000-4000-8000-'+String(n).padStart(12,'0');
 const binding={version:1,mode:'reuse',requestId:request.id,classId:request.class_id,requestUpdatedAt:request.updated_at,cancelDate:request.cancel_date,originalId:plan.sessions[0].id,makeupId:plan.sessions[1].id,startAt:'2050-10-06T09:00:00.000Z',endAt:'2050-10-06T11:00:00.000Z',classroom:room.name,occupancy:{id:'legacy-session:'+request.class_id+':'+plan.sessions[1].id,classId:request.class_id,className:request.class_name,date:'2050-10-06',startMinute:1170,endMinute:1290,classroom:room.name,uncertain:false,allRooms:false}};
 const after=buildLegacyMakeupApprovalPlan(plan,request,{teacher,classrooms:[room],legacyBinding:binding});
 const events=buildMakeupCalendarDrafts(request).map((draft,index)=>{
  const mutation=buildAcademicEventMutationPayload(draft,[]);
  if(!mutation.isValid||!mutation.payload)throw new Error('Invalid synthetic adoption calendar fixture');
  const p=mutation.payload;return{id:id(100+index),title:p.title,date:p.start||p.start_date||p.date,type:p.type,grade:p.grade||'all',note:p.note};
 });
 const cancel=events.find(e=>extractMakeupCalendarMeta(e.note)?.kind==='cancel'),makeups=events.filter(e=>extractMakeupCalendarMeta(e.note)?.kind==='makeup');
 const patch={actor_profile_id:id(801),final_note:'Synthetic pair adoption',schedule_plan_before:plan,schedule_plan_after:after,cancel_academic_event_id:cancel.id,makeup_academic_event_id:makeups[0].id,makeup_academic_event_ids:makeups.map(e=>e.id),calendar_events:events};
 return{plan,request,teacher,room,binding,after,patch};
}
export function adoptionDbFixtureSql(){return '-- BEGIN ACTUAL ADOPTION PRODUCER\ncreate function pg_temp.producer_fixture() returns jsonb language sql immutable as $fn$ select $json$'+JSON.stringify(adoptionDbFixture())+'$json$::jsonb $fn$;\n-- END ACTUAL ADOPTION PRODUCER\n';}
