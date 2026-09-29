import { z } from "zod";
import { classEditRequest } from "./class-edit-contract.ts";
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
const responses={"200":{description:"Typed result. Compare after.verificationHash with the applied class.verificationHash. Unknown is never a failed write.",content:{"application/json":{schema:envelope}}},"400":{description:"Invalid request"},"403":{description:"Insufficient class/scope authority"},"409":{description:"Stale preview, duplicate key, or resource collision"},"422":{description:"Ambiguous, unsupported, or approval-owned change"},"429":{description:"60 calls per minute per credential"},"503":{description:"Disabled/unavailable; recover writes with the same operation key"}};
const get=(operationId:string,parameters:unknown[]=[],dataSchema:unknown={type:"object"})=>({operationId,security:[{bearerAuth:[]}],parameters,responses:{...responses,"200":{description:responses["200"].description,content:{"application/json":{schema:{...envelope,properties:{...envelope.properties,data:dataSchema}}}}}}});
const post=(operationId:string,schema:unknown,parameters:unknown[]=[])=>({...get(operationId,parameters),requestBody:{required:true,content:{"application/json":{schema}}}});
export const agentEditOpenApi={
 openapi:"3.1.0",info:{title:"TIPS Class Changes",version:"2.0.0",description:"Asia/Seoul. Explicit class grants. Read workspace and catalog IDs, preview, commit once, verify durable receipt. Basic fields, edits to existing weekly slots, and bounded future lesson/cancellation/makeup changes are atomic for one class. Weekly edits change the template immediately; use explicit dated lessons for a bounded effective period. No student/payment/history deletion, approval transitions or messages. Existing v1 keys are not expanded. Raw schedule plans and private notes are never returned."},servers:[{url:"/api/v2"}],
 components:{securitySchemes:{bearerAuth:{type:"http",scheme:"bearer"}},schemas:{ClassEdit:z.toJSONSchema(classEditRequest),ClassWorkspace:workspaceSchema}},
 paths:{
  "/health":{get:get("editHealth")},
  "/classes/{classId}":{get:get("classWorkspace",[classId,query("from",{type:"string",format:"date"}),query("to",{type:"string",format:"date"})],workspaceRef)},
  "/classes/{classId}/catalogs":{get:get("classCatalogs",[classId,query("kind",{type:"string",enum:["teachers","classrooms"]}),query("search",{type:"string",maxLength:100},false),query("page",{type:"integer",minimum:1,default:1},false)])},
  "/classes/{classId}/changes/preview":{post:post("previewClassChanges",{$ref:"#/components/schemas/ClassEdit"},[classId])},
  "/operations":{get:get("listClassOperations",[query("page",{type:"integer",minimum:1,default:1},false)]),post:post("commitClassChanges",{type:"object",additionalProperties:false,required:["previewToken"],properties:{previewToken:uuid,sourceReference:{type:"string",maxLength:500}}},[{in:"header",name:"Idempotency-Key",required:true,schema:uuid}])},
  "/operations/{requestKey}":{get:get("classOperation",[{in:"path",name:"requestKey",required:true,schema:uuid}])},
 },
};
