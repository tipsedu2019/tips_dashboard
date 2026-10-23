import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
globalThis.fetch=async()=>{throw Error('external network forbidden by independent audit')};
const auth=n=>({user:{id:id(n),email:'synthetic@test.invalid'},role:'teacher',isTeacher:true,isAdmin:false,isStaff:false,canManageAll:false});
const row=(n,title=`합성 교재 ${n}`)=>({id:n.toString(16).padStart(32,'0'),anchorLineId:id(n),bookTitle:title,className:`합성 수업 ${n}`,requesterLabel:'공통 담당',requestedAt:'2026-10-23',studentQuantity:2,teacherQuantity:1});
const href=n=>`?textbookTab=requests&textbookDetailKind=purchase&textbookDetail=${id(n)}&marker=retained`;
const calls=(h,operation)=>h.requests.filter(r=>r.name==='read_operational_common_v1'&&r.args.p_operation===operation);
const page=h=>calls(h,'book_page').at(-1);
const detail=h=>calls(h,'book_detail').at(-1);
const envelope=(r,rows,totalCount=rows.length)=>({rows,page:r.args.p_args.p_page,pageSize:r.args.p_args.p_page_size,totalCount});
async function change(h,text){const i=document.querySelector('input[aria-label="교재요청 검색"]');const p=i[Object.keys(i).find(k=>k.startsWith('__reactProps$'))];await h.act(()=>p.onChange({target:{value:text}}));}
function safe(h){assert.equal(h.requests.some(r=>r.table),false);assert.equal(h.requests.some(r=>r.name!=='read_operational_common_v1'),false);assert.equal(h.requests.some(r=>!['book_page','book_detail'].includes(r.args.p_operation)||r.retry!==false),false);}
const dialog=()=>document.querySelector('[role="dialog"]');

test('off-page URL loads safe common detail only and close preserves unrelated query controls',async t=>{
 const h=await setup(t,{mode:'requests',search:href(901),auth:auth(1804)});
 assert.deepEqual(detail(h).args,{p_operation:'book_detail',p_args:{p_anchor:id(901)}});
 await h.resolve(page(h),envelope(page(h),[]));
 await h.resolve(detail(h),row(901,'목록 밖 한글 📘'));
 assert.equal(Boolean(dialog()),true);assert.match(dialog().textContent,/목록 밖 한글/);
 assert.equal(Boolean(document.querySelector('form,textarea')),false);
 const before=h.requests.length;const close=document.querySelector('[data-slot="dialog-close"]');assert.equal(Boolean(close),true);
 await h.act(()=>close.click());
 assert.equal(Boolean(dialog()),false);assert.equal(new URLSearchParams(window.location.search).get('marker'),'retained');
 assert.equal(new URLSearchParams(window.location.search).has('textbookDetail'),false);assert.equal(h.requests.length,before);safe(h);
});

test('URL A to B aborts A and late A cannot replace the accepted B detail',async t=>{
 const h=await setup(t,{mode:'requests',search:href(911),auth:auth(1804)});const a=detail(h);
 await h.navigate(href(912));const b=detail(h);assert.notEqual(a,b);assert.equal(a.signal.aborted,true);
 await h.resolve(b,row(912,'최신 URL B'));await h.resolve(a,row(911,'STALE_URL_A_CANARY'));
 assert.match(dialog().textContent,/최신 URL B/);assert.equal(document.body.textContent.includes('STALE_URL_A_CANARY'),false);safe(h);
});

test('missing URL detail has a safe error, does not auto retry, and accepts one explicit detail retry',async t=>{
 const h=await setup(t,{mode:'requests',search:href(921),auth:auth(1804)});const first=detail(h);
 await h.resolve(page(h),envelope(page(h),[]));await h.resolve(first,null);
 assert.equal(Boolean(dialog()),false);assert.match(document.body.textContent,/教|교재요청을 찾을 수 없습니다/);
 const before=calls(h,'book_detail').length;await h.act(()=>Promise.resolve());assert.equal(calls(h,'book_detail').length,before);
 await h.act(()=>button('상세 다시 조회').click());const retry=detail(h);assert.equal(calls(h,'book_detail').length,before+1);
 assert.deepEqual(retry.args,first.args);await h.resolve(retry,row(921,'재조회 상세 복구'));
 assert.match(dialog().textContent,/재조회 상세 복구/);assert.equal(document.body.textContent.includes('찾을 수 없습니다'),false);safe(h);
});

test('choosing visible row B supersedes a still-pending off-page URL detail A',async t=>{
 const h=await setup(t,{mode:'requests',search:href(931),auth:auth(1804)});const a=detail(h);
 await h.resolve(page(h),envelope(page(h),[row(932,'사용자 선택 B')]));
 await h.act(()=>button('사용자 선택 B').click());assert.match(dialog().textContent,/사용자 선택 B/);
 await h.resolve(a,row(931,'LATE_UNSELECTED_A_CANARY'));
 assert.equal(dialog().textContent.includes('사용자 선택 B'),true,'latest visible row selection must retain ownership of the detail');
 assert.equal(document.body.textContent.includes('LATE_UNSELECTED_A_CANARY'),false);safe(h);
});

test('page permission denial clears count/rows/detail and cannot be undone by an older pending detail success',async t=>{
 const h=await setup(t,{mode:'requests',search:href(941),auth:auth(1804)});const oldDetail=detail(h);
 await h.resolve(page(h),envelope(page(h),[row(942,'이전 목록 공통정보')]));
 await change(h,'권한 재확인');await h.reject(page(h),{code:'42501',message:'PERMISSION_PRIVATE_CANARY'});
 assert.equal(document.body.textContent.includes('이전 목록 공통정보'),false);assert.equal(Boolean(dialog()),false);
 await h.resolve(oldDetail,row(941,'OLD_DETAIL_AFTER_DENIAL_CANARY'));
 assert.equal(Boolean(dialog()),false,'a prior detail read must not reappear after a permission-denied page read');
 assert.equal(document.body.textContent.includes('OLD_DETAIL_AFTER_DENIAL_CANARY'),false);
 assert.equal(document.body.textContent.includes('PERMISSION_PRIVATE_CANARY'),false);safe(h);
});

test('detail permission denial cannot retain an accepted old page or reveal a late page result',async t=>{
 const h=await setup(t,{mode:'requests',search:href(951),auth:auth(1804)});const pendingPage=page(h);
 await h.reject(detail(h),{code:'42501',message:'PERMISSION_PRIVATE_CANARY'});
 assert.equal(Boolean(dialog()),false);assert.equal(document.body.textContent.includes('PERMISSION_PRIVATE_CANARY'),false);
 await h.resolve(pendingPage,envelope(pendingPage,[row(952,'OLD_PAGE_AFTER_DENIAL_CANARY')],1));
 assert.equal(document.body.textContent.includes('OLD_PAGE_AFTER_DENIAL_CANARY'),false,'a prior page read must not publish after a common-read permission denial');
 assert.equal(document.body.textContent.includes('전체 1건'),false);safe(h);
});

test('actual caller role remount aborts a former teacher detail and never revives it after returning to teacher',async t=>{
 const h=await setup(t,{mode:'requests',search:href(961),auth:auth(1804)});const a=detail(h);
 await h.auth({role:'staff',isTeacher:false,isAdmin:false,isStaff:true,canManageAll:true});assert.equal(a.signal.aborted,true);
 await h.resolve(a,row(961,'FORMER_TEACHER_DETAIL_CANARY'));
 assert.equal(document.body.textContent.includes('FORMER_TEACHER_DETAIL_CANARY'),false);
 await h.auth(auth(1804));const fresh=detail(h);assert.notEqual(fresh,a);
 await h.resolve(fresh,row(961,'새 역할 수명 상세'));
 assert.match(dialog().textContent,/새 역할 수명 상세/);assert.equal(document.body.textContent.includes('FORMER_TEACHER_DETAIL_CANARY'),false);
 assert.equal(h.requests.some(r=>r.table),false);
});
