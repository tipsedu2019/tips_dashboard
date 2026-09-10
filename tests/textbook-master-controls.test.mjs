import test from "node:test";
import assert from "node:assert/strict";
import { setup, masterRow, masterSummary, button } from "./helpers/textbook-numbered-harness.mjs";
import { chooseFilter } from "./helpers/textbook-filter-actions.mjs";

async function acceptMaster(h) {
  await h.resolve(h.requests.find(r => r.name === "list_textbook_master_page_v1"), {rows:[masterRow(1)],page:1,pageSize:10,totalCount:1});
  await h.resolve(h.requests.find(r => r.name === "get_textbook_master_summary_v1"), masterSummary(1));
}
const acceptedMasterOptions = {
  publisherOptions: [], subSubjectOptions: ["문법"], categoryOptions: ["문법"], bulkCategoryOptions: ["문법"], scienceSubjectAreas: [],
  counts: { publisherOptions: 0, subSubjectOptions: 1, categoryOptions: 1, bulkCategoryOptions: 1, scienceSubjectAreas: 0 }, complete: true,
};
async function acceptMasterWithOptions(h) {
  await acceptMaster(h);
  await h.resolve(h.requests.find(r => r.name === "get_textbook_master_options_v1"), acceptedMasterOptions);
}
function changeInput(h, label, value) {
  const input = document.querySelector(`[aria-label="${label}"]`);
  const props = input[Object.keys(input).find(key => key.startsWith("__reactProps$"))];
  return h.act(() => props.onChange({ target: { value } }));
}
test("master selection preserves search and filter nodes and issues no reads", async t => {
  const h = await setup(t); await acceptMaster(h);
  const search = document.querySelector('input[aria-label="교재 검색"]');
  const filter = document.querySelector('[aria-label="교재 과목 필터"]');
  const actions = document.querySelector('[data-slot="textbook-master-actions"]');
  const requestCount = h.requests.length;
  await h.act(() => document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());
  assert.equal(document.querySelector('input[aria-label="교재 검색"]'), search);
  assert.equal(document.querySelector('[aria-label="교재 과목 필터"]'), filter);
  assert.equal(document.querySelector('[data-slot="textbook-master-actions"]'), actions);
  assert.equal(document.querySelector('#textbook-bulk-patch-controls'), null, "selection alone inserts no property editor");
  assert.ok(actions.textContent.includes("1개 선택"));
  assert.equal(h.requests.length, requestCount);
  await h.act(() => button("선택 교재 선택 해제").click());
  assert.ok(button("신규 등록"));
  assert.equal(document.querySelector('input[aria-label="교재 검색"]'), search);
  assert.equal(h.requests.length, requestCount);
});
test("master fixed-option filter retains controls and data through pending/error and reset performs one read", async t => {
  const h = await setup(t); await acceptMaster(h);
  const search = document.querySelector('input[aria-label="교재 검색"]');
  const reset = button("교재 필터 초기화");
  const row = document.querySelector('[data-prepared-surface="master-desktop"]');
  assert.equal(reset.disabled, true);
  await chooseFilter(h, "교재 과목 필터", "수학");
  const pending = h.requests.findLast(r => r.name === "list_textbook_master_page_v1");
  assert.equal(pending.args.p_filters.subject, "math");
  assert.equal(document.querySelector('[data-prepared-surface="master-desktop"]'), row);
  assert.equal(button("교재 필터 초기화"), reset);
  await h.reject(pending, {message:"합성 실패"});
  assert.equal(document.querySelector('input[aria-label="교재 검색"]'), search);
  assert.equal(document.querySelector('[data-prepared-surface="master-desktop"]'), row);
  const count = h.requests.filter(r=>r.name==="list_textbook_master_page_v1").length;
  await h.act(() => reset.click());
  assert.equal(h.requests.filter(r=>r.name==="list_textbook_master_page_v1").length,count+1);
  assert.equal(reset.disabled,true);
  await h.assertNoLegacyReads();
});
test("common search clears once and returns focus without scrolling", async t => {
  const h = await setup(t); await h.unmount();
  const React = await import("react");
  const {DataTableSearchField} = h.load("src/components/data-table/data-table-search-field.tsx");
  const changes = [];
  function Probe() {
    const [value,setValue] = React.useState("문법");
    return React.createElement(DataTableSearchField,{label:"검수 검색",value,onValueChange:next=>{changes.push(next);setValue(next);}});
  }
  await h.mountTestComponent(Probe,{});
  const input=document.querySelector('input[aria-label="검수 검색"]');
  let focusOptions;
  const originalFocus=input.focus.bind(input);
  input.focus=options=>{focusOptions=options; originalFocus(options);};
  await h.act(()=>button("검수 검색 초기화").click());
  assert.deepEqual(changes,[""]);
  assert.equal(input.value,"");
  assert.equal(document.activeElement,input);
  assert.deepEqual(focusOptions,{preventScroll:true});
  assert.equal(button("검수 검색 초기화").disabled,true);
});

test("master bulk edit dialog keeps selection while cancel resets the draft before reopen", async t => {
  const h = await setup(t); await acceptMasterWithOptions(h);
  await h.act(() => document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());
  assert.equal(button("속성 변경").disabled, false, document.body.textContent);
  await h.act(() => button("속성 변경").click());

  assert.ok(document.querySelector('[role="dialog"]')?.textContent.includes("선택 교재 속성 변경"));
  assert.equal(button("선택 교재 변경 저장").disabled, true, "unchanged bulk form cannot submit");
  await changeInput(h, "일괄 출판사", "취소할 출판사");
  assert.equal(button("선택 교재 변경 저장").disabled, false);

  await h.act(() => button("선택 교재 속성 변경 취소").click());
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]')?.textContent.includes("1개 선택"));

  await h.act(() => button("속성 변경").click());
  assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value, "", "cancelled draft resets before reopen");
  assert.equal(button("선택 교재 변경 저장").disabled, true);
});

test("master bulk edit dialog preserves a failed draft, blocks duplicate submit, and closes after retry succeeds", async t => {
  const h = await setup(t); await acceptMasterWithOptions(h);
  await h.act(() => document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());
  assert.equal(button("속성 변경").disabled, false, document.body.textContent);
  await h.act(() => button("속성 변경").click());
  await changeInput(h, "일괄 출판사", "실패 보존 출판사");

  const save = button("선택 교재 변경 저장");
  await h.act(() => { save.click(); save.click(); });
  let writers = h.requests.filter(request => request.table === "textbooks");
  assert.equal(writers.length, 1, "rapid repeated submit starts one write");
  assert.equal(button("선택 교재 변경 저장").disabled, true);

  await h.reject(writers[0], { message: "합성 저장 실패" });
  assert.ok(document.querySelector('[role="dialog"] [role="alert"]'));
  assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value, "실패 보존 출판사");
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]')?.textContent.includes("1개 선택"));
  assert.equal(button("선택 교재 변경 저장").disabled, false);

  await h.act(() => button("선택 교재 변경 저장").click());
  writers = h.requests.filter(request => request.table === "textbooks");
  assert.equal(writers.length, 2);
  await h.resolve(writers[1], masterRow(1, { publisher: "실패 보존 출판사" }));
  await h.act(() => Promise.resolve());

  const refreshes = h.requests.filter(request => request.sequence > writers[1].sequence && request.name);
  const operationsSummary = { requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0 };
  for (const request of refreshes) {
    if (request.name === "list_textbook_master_page_v1") await h.resolve(request, { rows: [masterRow(1, { publisher: "실패 보존 출판사" })], page: 1, pageSize: 10, totalCount: 1 });
    else if (request.name === "get_textbook_master_summary_v1") await h.resolve(request, masterSummary(1));
    else if (request.name === "get_textbook_operations_summary_v1") await h.resolve(request, operationsSummary);
    else if (request.name === "get_textbook_master_options_v1") await h.resolve(request, acceptedMasterOptions);
  }
  await h.act(() => Promise.resolve());

  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector('[aria-label="선택한 교재 일괄 작업"]'), null);
  assert.ok(document.body.textContent.includes("1개 교재를 수정했습니다."));
});

test("master bulk edit dialog revision rejects late failure and completion after reopening the same draft", async t => {
  const h = await setup(t); await acceptMasterWithOptions(h);
  await h.act(() => document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());
  await h.act(() => button("속성 변경").click());
  await changeInput(h, "일괄 출판사", "동일 초안 출판사");
  await h.act(() => button("선택 교재 변경 저장").click());
  const firstWriter = h.requests.find(request => request.table === "textbooks");
  assert.ok(firstWriter);

  await h.act(() => button("선택 교재 속성 변경 취소").click());
  await h.act(() => button("속성 변경").click());
  await changeInput(h, "일괄 출판사", "동일 초안 출판사");
  await h.reject(firstWriter, { message: "늦은 합성 실패" });

  assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value, "동일 초안 출판사");
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]')?.textContent.includes("1개 선택"));
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]'), null, "late failure cannot publish into the reopened form");

  await h.act(() => button("선택 교재 변경 저장").click());
  const secondWriter = h.requests.filter(request => request.table === "textbooks").at(-1);
  assert.notEqual(secondWriter, firstWriter);
  await h.act(() => button("선택 교재 속성 변경 취소").click());
  await h.act(() => button("속성 변경").click());
  await changeInput(h, "일괄 출판사", "동일 초안 출판사");
  const rpcCount = h.requests.filter(request => request.name).length;
  await h.resolve(secondWriter, masterRow(1, { publisher: "동일 초안 출판사" }));
  await h.act(() => Promise.resolve());

  assert.equal(h.requests.filter(request => request.name).length, rpcCount, "late completion cannot invalidate the reopened form");
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value, "동일 초안 출판사");
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]')?.textContent.includes("1개 선택"));
  assert.equal(document.body.textContent.includes("교재를 수정했습니다."), false, "late completion cannot publish stale success");
});
