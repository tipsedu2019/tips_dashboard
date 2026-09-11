import test from "node:test";
import assert from "node:assert/strict";
import { setup, masterRow, masterSummary, purchaseRow, purchaseSummary, id, button } from "./helpers/textbook-numbered-harness.mjs";

const masterOptions = { publisherOptions: [], subSubjectOptions: ["문법"], categoryOptions: ["문법"], bulkCategoryOptions: ["문법"], scienceSubjectAreas: [], counts: { publisherOptions: 0, subSubjectOptions: 1, categoryOptions: 1, bulkCategoryOptions: 1, scienceSubjectAreas: 0 }, complete: true };
async function mountMaster(t) {
  const h = await setup(t);
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 30, height: 30 }]; };
  window.navigation = Object.assign(new window.EventTarget(), { traverseTo: () => ({ committed: Promise.resolve(), finished: Promise.resolve() }) });
  await h.resolve(h.requests.find(r => r.name === "list_textbook_master_page_v1"), { rows: [masterRow(1)], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(r => r.name === "get_textbook_master_summary_v1"), masterSummary(1));
  const options = h.requests.find(r => r.name === "get_textbook_master_options_v1");
  if (options) await h.resolve(options, masterOptions);
  return h;
}
const confirmation = () => document.querySelector('[data-testid="draft-navigation-confirm-dialog"]');
const settle = h => h.act(() => new Promise(resolve => setTimeout(resolve, 30)));
async function input(h, label, value) {
  const el = document.querySelector(`[aria-label="${label}"]`);
  assert.ok(el, label);
  const props = el[Object.keys(el).find(k => k.startsWith("__reactProps$"))];
  await h.act(() => { el.focus(); props.onChange({ target: { value } }); });
}
async function confirm(h, label) { await h.act(() => [...confirmation().querySelectorAll("button")].find(x => x.textContent === label).click()); await settle(h); }

test("master close requires explicit discard and cancellation preserves input", async t => {
  const h = await mountMaster(t); await h.act(() => button("신규 등록").click());
  await input(h, "교재명", "교재 초안"); await h.act(() => button("교재 등록 취소").click());
  assert.ok(confirmation(), "edited master must not close silently");
  await confirm(h, "계속 편집"); assert.equal(document.querySelector('[aria-label="교재명"]').value, "교재 초안");
  await h.act(() => button("교재 등록 취소").click()); await confirm(h, "변경사항 버리기");
  assert.equal(document.querySelector('[aria-label="교재명"]'), null); assert.equal(h.requests.some(r => r.table), false);
});

test("bulk master cancel preserves selected books until explicit draft discard", async t => {
  const h = await mountMaster(t); await h.act(() => document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());
  await h.act(() => button("속성 변경").click()); await input(h, "일괄 출판사", "미저장 출판사");
  await h.act(() => button("선택 교재 속성 변경 취소").click()); assert.ok(confirmation());
  await confirm(h, "계속 편집"); assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value, "미저장 출판사");
  await h.act(() => button("선택 교재 속성 변경 취소").click()); await confirm(h, "변경사항 버리기");
  assert.match(document.querySelector('[aria-label="선택한 교재 일괄 작업"]').textContent, /1개 선택/); assert.equal(h.requests.some(r => r.table), false);
});

const unloadBlocked = () => { const event = new window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
async function appIntent(h, target = "/admin/dashboard") { const { requestAppNavigation } = h.load("src/lib/guarded-navigation.ts"); await h.act(() => requestAppNavigation(() => h.routes.push(target))); }

test("master clean/reverted draft closes freely; dirty app navigation and Back preserve the first intent", async t => {
  const h = await mountMaster(t); await h.act(() => button("신규 등록").click());
  assert.equal(unloadBlocked(), false); await input(h,"교재명","돌릴 입력"); assert.equal(unloadBlocked(),true);
  await input(h,"교재명",""); assert.equal(unloadBlocked(),false);
  await h.act(() => button("교재 등록 취소").click()); assert.equal(confirmation(),null);
  await h.act(() => button("신규 등록").click()); await input(h,"교재명","새 초안");
  await h.act(() => { const event = new window.Event("navigate",{cancelable:true});Object.assign(event,{navigationType:"traverse",destination:{sameDocument:true,key:"previous"}});window.navigation.dispatchEvent(event);assert.equal(event.defaultPrevented,true); });
  assert.ok(confirmation());await confirm(h,"계속 편집");assert.equal(document.querySelector('[aria-label="교재명"]').value,"새 초안");
  await appIntent(h,"/first");await appIntent(h,"/second");assert.equal(h.routes.length,0);await confirm(h,"변경사항 버리기");assert.deepEqual(h.routes,["/first"]);
});

for (const [tab,openLabel,field,closeLabel] of [
  ["requests","교재 요청 추가","요청 메모","교재 요청·주문 창 닫기"],
  ["purchase","교재 주문 추가","학생용 주문 수량","교재 요청·주문 창 닫기"],
  ["sales","교재 출고 추가","출고월","교재 출고 창 닫기"],
]) test(`${tab}: delayed defaults remain clean; edited form cancel and discard keep their contract`, async t => {
  const h=await setup(t,{search:`?textbookTab=${tab}`});
  await h.act(()=>button(openLabel).click());
  const location=h.requests.find(r=>r.name==="list_textbook_location_reference_page_v1");
  if(location)await h.resolve(location,{rows:[{value:id(900),label:"본관",searchText:"본관 main"}],page:1,pageSize:20,totalCount:1,defaultLocation:{id:id(900),code:"main",name:"본관"}});
  assert.equal(unloadBlocked(),false,"opening and accepted defaults are clean");
  await input(h,field,tab==="sales"?"2027-02":tab==="purchase"?"9":"미저장 입력");assert.equal(unloadBlocked(),true);
  await h.act(()=>button(closeLabel).click());assert.ok(confirmation());await confirm(h,"계속 편집");
  assert.equal(document.querySelector(`[aria-label="${field}"]`).value,tab==="sales"?"2027-02":tab==="purchase"?"9":"미저장 입력");
  await h.act(()=>button(closeLabel).click());await confirm(h,"변경사항 버리기");assert.equal(unloadBlocked(),false);assert.equal(h.requests.some(r=>r.table),false);
});

test("inventory drafts survive tab changes and a clean local editor close, and keep route protection", async t => {
  const h=await setup(t,{search:"?textbookTab=inventory"}),locationId=id(900);
  await h.resolve(h.requests.find(r=>r.name==="list_textbook_location_reference_page_v1"),{rows:[{value:locationId,label:"본관",searchText:"main"}],page:1,pageSize:20,totalCount:1,defaultLocation:{id:locationId,code:"main",name:"본관"}});
  const source=masterRow(399,{locationQuantities:{[locationId]:3},studentLocationQuantities:{[locationId]:3},totalQuantity:3,studentQuantity:3});
  const row={source,id:source.id,title:source.title,publisher:source.publisher,locationId,locationName:"본관",currentQuantity:3,latestCountAt:"",daysSinceLatestCount:null,isCountedThisCycle:false,isRecommended:true,status:"recommended",reason:"실사 필요",dueLabel:"지금"};
  await h.resolve(h.requests.find(r=>r.name==="list_textbook_inventory_page_v1"),{rows:[row],page:1,pageSize:10,totalCount:1});
  await h.resolve(h.requests.find(r=>r.name==="get_textbook_inventory_summary_v1"),masterSummary(1,{locations:[{id:locationId,code:"main",name:"본관",sortOrder:1}],auditCounts:{all:1,recommended:1,pending:1,done:0}}));
  const qty=document.querySelector('[data-prepared-surface="inventory-desktop"] input[aria-label$="실사 수량"]'),memo=document.querySelector('[data-prepared-surface="inventory-desktop"] input[aria-label$="실사 메모"]');
  await input(h,memo.getAttribute("aria-label"),"현장 메모");assert.equal(unloadBlocked(),true,"a memo alone is a draft");
  await input(h,qty.getAttribute("aria-label"),"0");
  await appIntent(h);await confirm(h,"계속 편집");assert.equal(qty.value,"0");assert.equal(memo.value,"현장 메모");
  let syntheticPopstates = 0; window.addEventListener("popstate", () => { syntheticPopstates += 1; });
  await h.act(()=>document.querySelector('[role="tab"][aria-label="교재 재고"]').dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true,button:0})));assert.equal(confirmation(),null,"tabs preserve stock-count drafts"); assert.equal(syntheticPopstates,0,"internal query changes are not browser traversals");
  await h.resolve(h.requests.findLast(r=>r.name==="list_textbook_master_page_v1"),{rows:[masterRow(1)],page:1,pageSize:10,totalCount:1});
  await h.act(()=>button("신규 등록").click());await h.act(()=>button("교재 등록 취소").click());assert.equal(confirmation(),null,"closing another clean form does not discard inventory");assert.equal(unloadBlocked(),true);
  await h.act(()=>button("신규 등록").click());await input(h,"교재명","함께 열린 초안");await h.act(()=>button("교재 등록 취소").click());assert.ok(confirmation());await confirm(h,"변경사항 버리기");assert.equal(unloadBlocked(),true,"discarding the master draft leaves inventory protected");
  await appIntent(h);assert.ok(confirmation());await confirm(h,"계속 편집");
});

test("bulk order defaults are clean and explicit discard retains the selected members", async t => {
  const h=await setup(t,{search:"?textbookTab=purchase"}),row=purchaseRow("order");
  await h.resolve(h.requests.find(r=>r.name==="list_textbook_purchase_page_v1"),{rows:[row],page:1,pageSize:10,totalCount:1});
  await h.resolve(h.requests.find(r=>r.name==="get_textbook_purchase_summary_v1"),purchaseSummary("order",1));
  await h.act(()=>document.querySelector('[data-prepared-surface="purchase-desktop"] [role="checkbox"]').click());
  await h.act(()=>button("선택 요청 일괄 주문").click());assert.equal(unloadBlocked(),false);
  const qty=document.querySelector('[aria-label="일괄 주문 수량"] input');await input(h,qty.getAttribute("aria-label"),"9");
  await h.act(()=>button("선택 요청 일괄 주문 창 닫기").click());assert.ok(confirmation());await confirm(h,"계속 편집");assert.equal(qty.value,"9");
  await h.act(()=>button("선택 요청 일괄 주문 창 닫기").click());await confirm(h,"변경사항 버리기");assert.equal(unloadBlocked(),false);assert.ok(button("선택 요청 일괄 주문"));assert.equal(h.requests.some(r=>r.table),false);
});

test("failed and pending bulk save stay guarded; accepted retry clears only that draft", async t => {
  const h=await mountMaster(t);await h.act(()=>document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());await h.act(()=>button("속성 변경").click());await input(h,"일괄 출판사","저장할 출판사");
  await h.act(()=>{button("선택 교재 변경 저장").click();button("선택 교재 변경 저장").click();});
  const first=h.requests.find(r=>r.table==="textbooks");assert.ok(first);assert.equal(h.requests.filter(r=>r.table==="textbooks").length,1);assert.equal(unloadBlocked(),true);
  await appIntent(h);await confirm(h,"계속 편집");await h.reject(first,{message:"합성 실패"});assert.equal(unloadBlocked(),true);
  await appIntent(h);await confirm(h,"계속 편집");assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value,"저장할 출판사");
  await h.act(()=>button("선택 교재 변경 저장").click());const second=h.requests.filter(r=>r.table==="textbooks")[1];await h.resolve(second,masterRow(1,{publisher:"저장할 출판사"}));
  for(const r of h.requests.filter(r=>r.sequence>second.sequence&&r.name)){
    if(r.name==="list_textbook_master_page_v1")await h.resolve(r,{rows:[masterRow(1,{publisher:"저장할 출판사"})],page:1,pageSize:10,totalCount:1});
    else if(r.name==="get_textbook_master_summary_v1")await h.resolve(r,masterSummary(1));
    else if(r.name==="get_textbook_operations_summary_v1")await h.resolve(r,{requestCount:0,unregisteredRequestCount:0,orderNeededCount:0,receivingBacklogCount:0,partialReceiptCount:0,issueWaitingCount:0,stockRiskCount:0});
    else if(r.name==="get_textbook_master_options_v1")await h.resolve(r,masterOptions);
  }
  await settle(h);assert.equal(unloadBlocked(),false);await appIntent(h);assert.equal(confirmation(),null);assert.deepEqual(h.routes,["/admin/dashboard"]);
});
