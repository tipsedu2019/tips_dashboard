import { buildSchedulePlanForSave } from '../../src/lib/class-schedule-planner.js';
export const id=n=>`ab290000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const window={from:'2099-10-01',to:'2099-10-31'};
export const timing={startMinute:600,endMinute:660,teacherId:id(1),classroomId:id(2)};
const dates=Array.from({length:31},(_,i)=>`2099-10-${String(i+1).padStart(2,'0')}`);
export const monday=dates.filter(date=>new Date(date+'T00:00:00Z').getUTCDay()===1);
export const target=dates.find(date=>new Date(date+'T00:00:00Z').getUTCDay()===2);
export function fixture(mode='legacy') {
 const plan=buildSchedulePlanForSave({selectedDays:[1],billingPeriods:[{id:'oct',month:'2099-10',startDate:window.from,endDate:window.to,label:'October',color:'#216e4e'}],sessionStates:{},sessionSchedules:{},sessions:[],history:[],textbooks:[]},{subject:'영어',className:'Synthetic',schedule:'월 10:00-11:00'});
 plan.generatedAt='2099-01-01T00:00:00Z';plan.privateNote='SECRET_ROOT';plan.history=[{private:'SECRET_HISTORY'}];plan.sessions.forEach((row,i)=>{row.id=id(100+i);row.sessionKey=row.id;row.publicNote='KEEP_'+i;row.teacherNote='SECRET_TEACHER_'+i;row.customField='KEEP_CUSTOM';});
 return {id:id(3),version:'a'.repeat(64),basic:{name:'Synthetic',classType:'regular',subject:'영어',subjectAreaKey:null,grade:'고1',capacity:10,fee:100000},storageMode:mode,schedule:'월 10:00-11:00',plan,sessions:[],weeklyScheduleComplete:true,weeklySlots:[{id:id(4),weekday:1,...timing,sortOrder:0}],catalogs:{teachers:[{id:id(1),name:'T',isVisible:true,subjects:['영어']}],classrooms:[{id:id(2),name:'R',isVisible:true,subjects:['영어']}]}};
}

export function makeSqlFixture(compile) {
 const context=fixture();let n=800;
 const command=compile(context,{expectedVersion:context.version,window,reason:'synthetic test',basic:{name:'Changed by agent'},lessons:[{date:monday[0],state:'cancelled',makeup:{date:target,...timing}}]},{uuid:()=>id(n++)});
 const after={...context,plan:command.patch.schedule_plan,basic:{...context.basic,name:'Changed by agent'}};
 const timingCommand=compile(after,{expectedVersion:after.version,window,reason:'dated time change',lessons:[{date:monday[1],state:'scheduled',timing:{...timing,startMinute:620,endMinute:680}}]},{uuid:()=>id(n++)});
 return {plan:context.plan,command,timingCommand,source:monday[0],target,timingDate:monday[1]};
}
