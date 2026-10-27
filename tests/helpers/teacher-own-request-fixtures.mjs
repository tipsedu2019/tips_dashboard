import { id } from './textbook-numbered-harness.mjs';
export const teacherActor = id(1804);
export const teacherAuth = { user:{id:teacherActor}, role:'teacher', isTeacher:true, isAdmin:false, isStaff:false, canManageAll:false };
export const inputs = {
 transfer:{student_id:id(30),memo:'가상 원문 메모',from_class_id:id(20),to_class_id:id(21),transfer_reason:'가상 전반 사유',from_class_end_date:'2026-11-02',from_class_end_session:'1',to_class_start_date:'2026-11-04',to_class_start_session:'2',from_undistributed_textbooks:'가상 교재 A',to_undistributed_textbooks:'가상 교재 B'},
 withdrawal:{student_id:id(30),memo:'가상 원문 메모',class_id:id(20),withdrawal_date:'2026-11-02',withdrawal_session:'1',customer_reason:'가상 고객 사유',teacher_opinion:'가상 의견',undistributed_textbooks:'가상 교재'},
 makeup:{request_kind:'cancel_only',class_id:id(20),reason:'가상 휴강 사유',cancel_date:'2026-11-02',original_lesson_session_id:id(31),makeup_slots:[]},
 textbook:{title:'가상 신청 교재',textbookId:null,classId:id(20),locationId:null,studentQuantity:2,teacherQuantity:1,memo:'가상 원문 메모'},
};
export const classOptions = [{id:id(20),label:'가상 원래 반'},{id:id(21),label:'가상 새 반'}];
export const references = {classes:[{id:id(20),name:'가상 원래 반',scheduleStorageMode:'normalized'}],students:[{id:id(30),name:'가상 학생',status:'enrolled'}],rooms:[],sessions:[],approver:null};
export const makeupReferences = {...references,students:[],rooms:[{name:'가상 교실'}],sessions:[{id:id(31),date:'2026-11-02',startTime:'19:30:00',endTime:'21:30:00',revision:1}],approver:{label:'가상 지정 승인자',status:'resolved'}};
export function ownDetail(domain='textbook', patch={}) { return {id:id(600),domain,title:'가상 본인 신청',status:domain==='makeup'?'approval_pending':'requested',requesterId:teacherActor,createdAt:'2026-10-27T01:00:00Z',updatedAt:'2026-10-27T01:00:00Z',revision:'revision-a',allowedActions:['update','withdraw'],blockedReason:null,effectState:'none',referenceLabels:{student:'가상 학생',class:'가상 원래 반',fromClass:'가상 원래 반',toClass:'가상 새 반'},approver:domain==='makeup'?{profileId:id(1),label:'가상 지정 승인자'}:null,input:structuredClone(inputs[domain]),history:[],changes:[],...patch}; }
export function ownSummary(detail) { const {input,history,changes,...row}=detail;return row; }
export const page = rows => ({rows,totalCount:rows.length,page:1,pageSize:10});
export const changeRow = (domain='makeup',patch={}) => ({id:id(700),domain,requestId:id(600),requesterId:teacherActor,kind:'cancel_request',note:'가상 취소 요청',status:'pending',createdAt:'2026-10-27T01:00:00Z',resolvedAt:null,resolutionNote:null,revision:'change-a',title:'가상 변경 대상',requestStatus:'completed',anchorId:id(600),canResolve:domain!=='makeup',canRecordProgress:domain==='makeup',progressNotes:[],...patch});
