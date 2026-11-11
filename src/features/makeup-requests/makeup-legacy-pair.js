const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'?x:'';
const identity=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=512;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(`${x}T00:00:00Z`))&&new Date(`${x}T00:00:00Z`).toISOString().slice(0,10)===x;
const minute=x=>Number.isInteger(x)&&x>=0&&x<=1440;
const instant=x=>typeof x==='string'&&/(?:Z|[+-]\d{2}:?\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const slotInstant=x=>instant(x)&&date(x.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(x);
const day=x=>new Date(Date.parse(x)+9*3600000).toISOString().slice(0,10);
const state=x=>text(x.scheduleState||x.state);
const owns=x=>Object.hasOwn(x,'makeupAdoption')||['makeupRequestId','makeupRequestRole'].some(k=>Object.hasOwn(x,k)&&x[k]!==null&&x[k]!=='');
function cleanIdentity(row){return identity(row?.id)&&(!Object.hasOwn(row,'sessionKey')||row.sessionKey===row.id);}

// Structure only. The locked SQL writer proves current ownership, competitor
// absence and the exact permitted delta. This is never authorization.
export function findLegacyMakeupPair(plan,cancelDate,makeupDate){
 if(!object(plan)||!Array.isArray(plan.sessions)||!plan.sessions.every(object)||!date(cancelDate)||!date(makeupDate)||cancelDate===makeupDate)return null;
 const canceled=plan.sessions.filter(s=>s.date===cancelDate),made=plan.sessions.filter(s=>s.date===makeupDate);
 if(canceled.length!==1||made.length!==1)return null;
 const original=canceled[0],makeup=made[0];
 if(!cleanIdentity(original)||!cleanIdentity(makeup)||original.id===makeup.id||state(original)!=='exception'||state(makeup)!=='makeup')return null;
 if([original,makeup].some(s=>owns(s)||(s.state&&s.scheduleState&&s.state!==s.scheduleState)))return null;
 if(original.makeupDate!==makeupDate||makeup.originalDate!==cancelDate||makeup.originalSessionId!==original.id)return null;
 if(original.originalDate||original.originalSessionId||makeup.makeupDate)return null;
 if(plan.sessions.some(s=>s!==original&&s!==makeup&&(s.id===original.id||s.id===makeup.id||s.sessionKey===original.id||s.sessionKey===makeup.id||s.originalSessionId===original.id||s.originalDate===cancelDate||s.makeupDate===makeupDate)))return null;
 for(const key of ['sessionStates','sessionSchedules']){
  if(Object.hasOwn(plan,key)&&!object(plan[key]))return null;
  for(const [d,wanted] of [[cancelDate,'exception'],[makeupDate,'makeup']]){
   const map=plan[key]?.[d];
   if(map===undefined)continue;
   if(typeof map==='string'){if(map!==wanted)return null;continue;}
   if(!object(map)||['state','scheduleState'].some(k=>Object.hasOwn(map,k)&&map[k]!==wanted))return null;
   if(d===cancelDate){
    if(Object.hasOwn(map,'makeupDate')&&map.makeupDate!==makeupDate||map.originalDate||map.originalSessionId)return null;
   }else if(Object.hasOwn(map,'originalDate')&&map.originalDate!==cancelDate||Object.hasOwn(map,'originalSessionId')&&map.originalSessionId!==original.id||map.makeupDate)return null;
  }
 }
 return {original,makeup};
}

export function isLegacyMakeupBinding(value){
 if(!object(value)||value.version!==1||!['reuse','bound'].includes(value.mode)||!UUID.test(value.requestId)||!UUID.test(value.classId)
  ||!instant(value.requestUpdatedAt)||!date(value.cancelDate)||!identity(value.originalId)||!identity(value.makeupId)||value.originalId===value.makeupId
  ||!slotInstant(value.startAt)||!slotInstant(value.endAt)||Date.parse(value.startAt)>=Date.parse(value.endAt)||!identity(value.classroom))return false;
 const start=new Date(Date.parse(value.startAt)+9*3600000),end=new Date(Date.parse(value.endAt)+9*3600000);
 const startMinute=start.getUTCHours()*60+start.getUTCMinutes();
 const endMinute=day(value.endAt)!==day(value.startAt)?1440:end.getUTCHours()*60+end.getUTCMinutes();
 if(start.getUTCSeconds()||start.getUTCMilliseconds()||end.getUTCSeconds()||end.getUTCMilliseconds()
  ||Date.parse(value.endAt)-Date.parse(value.startAt)>=86400000
  ||day(value.endAt)!==day(value.startAt)&&end.getUTCHours()+end.getUTCMinutes()!==0
  ||value.cancelDate===day(value.startAt))return false;
 const o=value.occupancy;
 return object(o)&&o.id===`legacy-session:${value.classId}:${value.makeupId}`&&o.classId===value.classId&&date(o.date)&&o.date===day(value.startAt)
  &&typeof o.className==='string'&&identity(o.classroom)&&minute(o.startMinute)&&minute(o.endMinute)&&o.startMinute<o.endMinute
  &&o.uncertain===false&&o.allRooms===false
  &&(value.mode!=='bound'||o.startMinute===startMinute&&o.endMinute===endMinute&&o.classroom===value.classroom);
}

export function matchingLegacyMakeupBinding(request,slots,bindings){
 if(!object(request)||!Array.isArray(slots)||slots.length!==1||!Array.isArray(bindings))return null;
 if(request.original_lesson_session_id||request.originalLessonSessionId)return null;
 const requestSlots=request.makeupSlots??request.makeup_slots;
 if(requestSlots!=null&&!Array.isArray(requestSlots))return null;
 if(Array.isArray(requestSlots)&&requestSlots.length>0&&(requestSlots.length!==1||!object(requestSlots[0])
  ||!slotInstant(requestSlots[0].startAt)||!slotInstant(requestSlots[0].endAt)||!identity(requestSlots[0].classroom)))return null;
 const found=bindings.filter(b=>b?.requestId===request.id);if(found.length!==1||!isLegacyMakeupBinding(found[0]))return null;
 const b=found[0],slot=slots[0];
 if((request.requestKind??request.request_kind)!=='cancel_makeup'||b.classId!==(request.classId??request.class_id)
  ||b.cancelDate!==(request.cancelDate??request.cancel_date)||b.requestUpdatedAt!==(request.updatedAt??request.updated_at)
  ||Date.parse(b.startAt)!==Date.parse(slot.startAt)||Date.parse(b.endAt)!==Date.parse(slot.endAt)||b.classroom!==slot.classroom)return null;
 if(b.mode==='reuse'&&request.status!=='approval_pending'||b.mode==='bound'&&!['completed','makeup_pending'].includes(request.status))return null;
 return b;
}

export function excludesLegacyMakeupOccupancy(binding,row){
 if(!binding||!object(row))return false;
 return ['id','classId','date','startMinute','endMinute','classroom','uncertain','allRooms'].every(k=>row[k]===binding.occupancy[k]);
}

