import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  beginManagementListLoad,
  createManagementListLoadState,
  getManagementListErrorRecoveryState,
  isManagementListLoading,
  settleManagementListLoad,
} from "../src/features/management/management-list-load-state.ts";

const root = new URL("../", import.meta.url);

test("a cold management visit stays pending through preference hydration until the request settles", () => {
  const coldVisit = createManagementListLoadState();
  assert.equal(isManagementListLoading(coldVisit), true);

  const requestStarted = beginManagementListLoad(coldVisit);
  assert.equal(isManagementListLoading(requestStarted), true);

  const firstPagePublished = settleManagementListLoad(requestStarted);
  assert.equal(isManagementListLoading(firstPagePublished), false);

  const firstRequestFailed = settleManagementListLoad(requestStarted);
  assert.equal(isManagementListLoading(firstRequestFailed), false);
});

test("management read errors expose retry for both empty and retained-row recovery", () => {
  assert.deepEqual(
    getManagementListErrorRecoveryState({
      error: "목록을 불러오지 못했습니다.",
      loading: false,
      rowCount: 0,
    }),
    { visible: true, retryDisabled: false, hasRetainedRows: false },
  );

  assert.deepEqual(
    getManagementListErrorRecoveryState({
      error: "새로고침에 실패했습니다.",
      loading: false,
      rowCount: 20,
    }),
    { visible: true, retryDisabled: false, hasRetainedRows: true },
  );

  assert.deepEqual(
    getManagementListErrorRecoveryState({
      error: "새로고침에 실패했습니다.",
      loading: true,
      rowCount: 20,
    }),
    { visible: true, retryDisabled: true, hasRetainedRows: true },
  );
});

test("the hook and page consume the tested loading and retry states", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const disabledBranch = hookSource.match(/if \(!enabled\) \{([\s\S]*?)\n    \}/)?.[1] || "";

  assert.match(hookSource, /useState\(createManagementListLoadState\)/);
  assert.match(hookSource, /setLoadState\(beginManagementListLoad\)/);
  assert.match(hookSource, /onPage:[\s\S]*?setLoadState\(settleManagementListLoad\)/);
  assert.match(hookSource, /onError:[\s\S]*?setLoadState\(settleManagementListLoad\)/);
  assert.ok(disabledBranch, "the disabled hydration branch should remain explicit");
  assert.doesNotMatch(disabledBranch, /setLoadState\(settleManagementListLoad\)/);

  assert.match(pageSource, /getManagementListErrorRecoveryState\(\{[\s\S]*?error,[\s\S]*?loading,[\s\S]*?rowCount: rows\.length/);
  assert.match(pageSource, /aria-label=\{`\$\{config\.emptyLabel\} 목록 다시 시도`\}/);
  assert.match(pageSource, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(pageSource, /disabled=\{errorRecovery\.retryDisabled\}/);
  assert.match(pageSource, /errorRecovery\.hasRetainedRows[\s\S]*?기존 목록은 유지됩니다\./);
});
