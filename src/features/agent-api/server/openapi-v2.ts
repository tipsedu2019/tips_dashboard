import { z } from "zod";
import { classEditRequest, pastLessonStateCorrectionRequest } from "./class-edit-contract.ts";
import { calendarChange } from "./calendar-contract.ts";
const uuid={type:"string",format:"uuid"};
const query=(name:string,schema:unknown,required=true)=>({in:"query",name,required,schema});
const classId={in:"path",name:"classId",required:true,schema:uuid};
const envelope={type:"object",properties:{data:{type:["object","null"]},error:{type:["object","null"]}},required:["data","error"]};
const nullableString={type:["string","null"]};
const nullableInteger={type:["integer","null"]};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:"object",additionalProperties:false,properties,required});
const array=(items:unknown)=>({type:"array",items});
const workspaceSchema=object({
 id:uuid,version:{type:"string",pattern:"^[a-f0-9]{64}$"},verificationHash:{type:"string",pattern:"^[a-f0-9]{64}$"},timezone:{const:"Asia/Seoul"},
 window:object({from:{type:"string",format:"date"},to:{type:"string",format:"date"}}),
 basic:object({name:{type:"string"},classType:nullableString,subject:nullableString,subjectAreaKey:nullableString,grade:nullableString,capacity:nullableInteger,fee:{type:["number","null"]}}),
 weeklyScheduleComplete:{type:"boolean"},weeklySlots:array(object({id:{type:"string"},weekday:{type:"integer",minimum:0,maximum:6},startMinute:{type:"integer"},endMinute:{type:"integer"},teacherId:nullableString,classroomId:nullableString,sortOrder:{type:"integer"}})),
 lessons:array(object({id:{type:"string"},date:{type:"string",format:"date"},state:{type:"string",enum:["scheduled","cancelled","skipped","undecided","makeup"]},startMinute:nullableInteger,endMinute:nullableInteger,teacherId:nullableString,classroomId:nullableString,sourceSlotId:nullableString,makeupOfLessonId:nullableString,originalDate:nullableString,makeupDate:nullableString,materialized:{type:"boolean"}})),
 capabilities:object({basic:{type:"boolean"},existingWeeklySlots:{type:"boolean"},datedLessons:{type:"boolean"},pastChanges:{const:false},approvalWorkflow:{const:false}}),
});
const workspaceRef={$ref:"#/components/schemas/ClassWorkspace"};
const correctionKind={const:"past_lesson_state_correction"};
const correctionWarning=array(object({code:{const:"unknown_occupancy"},count:{type:"integer",minimum:0}}));
const correctionShared={kind:correctionKind,blockerReviewHash:{type:"string",pattern:"^[a-f0-9]{64}$"},unknownOccupancyCount:{type:"integer",minimum:0},warnings:correctionWarning,before:workspaceRef};
const correctionReviewSchema=object({...correctionShared,reviewOnly:{const:true},reviewRequired:{const:true},previewToken:{type:"null"}});
const correctionPreviewSchema=object({...correctionShared,reviewOnly:{const:false},reviewRequired:{const:false},previewToken:uuid,expiresAt:{type:"string",format:"date-time"},after:workspaceRef,notifications:object({state:{const:"not_requested"}})});
const correctionErrorSchema=object({data:{type:"null"},error:{type:"object",additionalProperties:false,required:["code"],properties:{code:{type:"string"},requestId:uuid,phase:{type:"string"},sqlstate:{type:"string",pattern:"^[0-9A-Z]{5}$"}}}});
const correctionRequestSchema={...z.toJSONSchema(pastLessonStateCorrectionRequest),allOf:[{oneOf:[
 {not:{anyOf:[{required:["blockerReviewHash"]},{required:["acknowledgeUnknownOccupancy"]}]}},
 {required:["blockerReviewHash","acknowledgeUnknownOccupancy"]},
]}]};
const calendarWorkspaceSchema=object({school:object({id:uuid,name:{type:"string"},category:nullableString}),schoolYear:{type:"integer",minimum:2000,maximum:2200},version:{type:"string"},verificationHash:{type:"string"},timezone:{const:"Asia/Seoul"},scienceAreas:array({type:"string"}),events:array(object({id:uuid,title:{type:"string"},type:nullableString,start:{type:"string",format:"date"},end:{type:"string",format:"date"},grade:{type:"string"},examTerm:nullableString,scienceAreaKey:nullableString,source:{type:["object","null"]}}))});
const calendarWorkspaceRef={$ref:"#/components/schemas/CalendarWorkspace"};
const calendarPreviewSchema=object({previewToken:uuid,expiresAt:{type:"string",format:"date-time"},before:calendarWorkspaceRef,after:calendarWorkspaceRef,diff:object({added:array({type:"object"}),changed:array({type:"object"}),unchanged:array({type:"object"})})});
const calendarOperationSchema={type:"object",required:["operationId","kind","state"],properties:{operationId:uuid,kind:{const:"calendar"},state:{enum:["applied","failed","unknown"]},calendar:calendarWorkspaceRef,error:object({code:{type:"string"},sqlstate:{type:"string"}}),retryWithNewKey:{const:false}},description:"Applied: calendar.school.id, calendar.schoolYear and calendar.verificationHash must match the recorded preview. Failed: durable error.code/sqlstate, without calendar. Unknown: retryWithNewKey=false. GET returns 200 even for a failed receipt; its envelope.error equals data.error."};
const responses={"200":{description:"Compare after.verificationHash with applied class.verificationHash or calendar.verificationHash, then read the same target again. Unknown is never a failed write.",content:{"application/json":{schema:envelope}}},"400":{description:"Invalid request"},"401":{description:"Missing, expired or revoked credential"},"403":{description:"Insufficient class/scope authority"},"409":{description:"Stale preview, duplicate key, or resource collision"},"422":{description:"Ambiguous, unsupported, or approval-owned change"},"429":{description:"60 calls per minute per credential"},"503":{description:"Disabled/unavailable; recover writes with the same operation key"}};
const get=(operationId:string,parameters:unknown[]=[],dataSchema:unknown={type:"object"})=>({operationId,security:[{bearerAuth:[]}],parameters,responses:{...responses,"200":{description:responses["200"].description,content:{"application/json":{schema:{...envelope,properties:{...envelope.properties,data:dataSchema}}}}}}});
const post=(operationId:string,schema:unknown,parameters:unknown[]=[],dataSchema:unknown={type:"object"})=>({...get(operationId,parameters,dataSchema),requestBody:{required:true,content:{"application/json":{schema}}}});
const correctionOperation={...post("previewPastLessonStateCorrection",{$ref:"#/components/schemas/PastLessonStateCorrection"},[classId],{oneOf:[correctionReviewSchema,correctionPreviewSchema]}),
 description:"Administrator-issued credential with existing class-details:read and lesson-plan:write and the exact class grant. Correct only the state of one existing legacy regular lesson strictly before today in Asia/Seoul, with complete stored times and resource IDs. No occupancy assignment, creation, deletion, makeup, weekly changes or billing/content rewrite. First request omits acknowledgment fields: 200 reviewRequired=true, previewToken=null, warning count and opaque blockerReviewHash; no write preview is created. Send the same request with BOTH blockerReviewHash and acknowledgeUnknownOccupancy=true to obtain a preview token. The exact unknown blocker set is rechecked under lock at commit; a changed review returns agent_review_stale (409), and known overlaps always block. Commit through /operations, persist the operation key before sending, and recover using the same key. Ordinary class edits still reject past dates and capabilities.pastChanges remains false.",
 responses:{"200":post("previewPastLessonStateCorrection",{},[],{oneOf:[correctionReviewSchema,correctionPreviewSchema]}).responses["200"],
 ...Object.fromEntries([400,401,403,404,409,413,415,422,429,503].map(status=>[status,{description:status===413?"Request exceeds 8192 bytes":status===415?"JSON required":status===409?"Stale source/review or known resource collision":"Typed failure",content:{"application/json":{schema:correctionErrorSchema}}}]))}};
export const agentEditOpenApi={
 openapi:"3.1.0",info:{title:"TIPS Class and School Calendar Changes",version:"2.1.0",description:"Asia/Seoul. Health classAccess.mode=all explicitly grants current and future classes; selected and legacy_all_read must not be interpreted as all-class write. Existing credentials are never expanded. Class changes remain atomic for one class. School calendar uses calendar:read/calendar:write, a March–February school year, and separate /calendar/operations receipts. Research official school sources outside this API; source provenance is agent-supplied evidence, not server-certified website content. No deletion by omission. Ambiguous existing calendar matches require exact IDs; conflicting older/lower-authority sources require explicit conflictResolution. Read, preview, commit once, requery and compare verificationHash. Student/payment writes, approval transitions, messages and external synchronization are not implemented by these endpoints."},servers:[{url:"/api/v2"}],
 components:{securitySchemes:{bearerAuth:{type:"http",scheme:"bearer"}},schemas:{ClassEdit:z.toJSONSchema(classEditRequest),ClassWorkspace:workspaceSchema,PastLessonStateCorrection:correctionRequestSchema,CalendarChange:z.toJSONSchema(calendarChange),CalendarWorkspace:calendarWorkspaceSchema}},
 paths:{
  "/health":{get:get("editHealth")},
  "/calendar/schools":{get:get("calendarSchools",[query("search",{type:"string",maxLength:100},false),query("page",{type:"integer",minimum:1,default:1},false)])},
  "/calendar/schools/{schoolId}":{get:get("calendarWorkspace",[{in:"path",name:"schoolId",required:true,schema:uuid},query("schoolYear",{type:"integer",minimum:2000,maximum:2200})],calendarWorkspaceRef)},
  "/calendar/changes/preview":{post:post("previewCalendarChanges",{$ref:"#/components/schemas/CalendarChange"},[],calendarPreviewSchema)},
  "/calendar/operations":{get:get("listCalendarOperations",[query("page",{type:"integer",minimum:1,default:1},false)]),post:post("commitCalendarChanges",{type:"object",additionalProperties:false,required:["previewToken"],properties:{previewToken:uuid,sourceReference:{type:"string",maxLength:500}}},[{in:"header",name:"Idempotency-Key",required:true,schema:uuid}],calendarOperationSchema)},
  "/calendar/operations/{requestKey}":{get:get("calendarOperation",[{in:"path",name:"requestKey",required:true,schema:uuid}],calendarOperationSchema)},
  "/classes/{classId}":{get:get("classWorkspace",[classId,query("from",{type:"string",format:"date"}),query("to",{type:"string",format:"date"})],workspaceRef)},
  "/classes/{classId}/catalogs":{get:get("classCatalogs",[classId,query("kind",{type:"string",enum:["teachers","classrooms"]}),query("search",{type:"string",maxLength:100},false),query("page",{type:"integer",minimum:1,default:1},false)])},
  "/classes/{classId}/changes/preview":{post:post("previewClassChanges",{$ref:"#/components/schemas/ClassEdit"},[classId])},
  "/classes/{classId}/lesson-state-corrections/preview":{post:correctionOperation},
  "/operations":{get:get("listClassOperations",[query("page",{type:"integer",minimum:1,default:1},false)]),post:post("commitClassChanges",{type:"object",additionalProperties:false,required:["previewToken"],properties:{previewToken:uuid,sourceReference:{type:"string",maxLength:500}}},[{in:"header",name:"Idempotency-Key",required:true,schema:uuid}])},
  "/operations/{requestKey}":{get:get("classOperation",[{in:"path",name:"requestKey",required:true,schema:uuid}])},
 },
};
