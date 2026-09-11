import test from "node:test";
import assert from "node:assert/strict";

import {
  button,
  saleHistorySummary,
  saleRow,
  saleSummary,
  setup,
} from "./helpers/textbook-numbered-harness.mjs";

test("bulk sale progress disables competing actions while keeping selection input available", async (t) => {
  const h = await setup(t, {
    search: "?textbookTab=sales&textbookPage=1&textbookPageSize=10",
  });
  const row = saleRow(0);

  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_page_v1"), {
    rows: [row],
    page: 1,
    pageSize: 10,
    totalCount: 1,
  });
  await h.resolve(
    h.requests.find((request) => request.name === "get_textbook_sale_summary_v1"),
    saleSummary(1),
  );
  await h.resolve(
    h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1"),
    { rows: [], page: 1, pageSize: 10, totalCount: 0 },
  );
  await h.resolve(
    h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1"),
    saleHistorySummary(0),
  );

  const selection = document.querySelector('[aria-label="김선생 교재 101 출고 선택"]');
  assert.ok(selection);
  await h.act(() => selection.click());
  await h.act(() => button("선택 출고 일괄 완료").click());

  assert.equal(button("선택 출고 일괄 완료").disabled, true);
  assert.equal(button("선택 출고 일괄 완료").getAttribute("aria-busy"), "true");
  assert.equal(button("선택 출고 작업").disabled, true);
  assert.equal(button("출고 선택 해제").disabled, true);
  assert.equal(button("김선생 교재 101 출고 더보기").disabled, true);
  assert.ok(document.body.textContent.includes("출고 작업 처리 중…"));
  assert.equal(selection.disabled, false, "selection changes remain available for stale-result protection");

  const pendingDetail = h.requests.find((request) => request.name === "get_textbook_sale_detail_v1");
  assert.ok(pendingDetail);
  await h.reject(pendingDetail, { message: "합성 출고 상세 조회 실패" });
});
