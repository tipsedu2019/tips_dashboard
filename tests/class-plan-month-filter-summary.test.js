import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const previewSource = readFileSync(
  join(process.cwd(), "src", "components", "ClassSchedulePlanPreview.jsx"),
  "utf8",
);

const modalSource = readFileSync(
  join(process.cwd(), "src", "components", "ClassSchedulePlanModal.jsx"),
  "utf8",
);

const checkboxMenuSource = readFileSync(
  join(process.cwd(), "src", "components", "ui", "tds", "CheckboxMenu.jsx"),
  "utf8",
);

const styleSource = readFileSync(
  join(process.cwd(), "src", "index.css"),
  "utf8",
);

test("class plan month filter uses short labels and compact summary text", () => {
  assert.match(
    modalSource,
    /function formatMonthFilterLabel\(year,\s*month\)\s*\{[\s\S]*slice\(-2\)[\s\S]*`.*?년.*?\$\{month \+ 1\}.*?월`/,
  );
  assert.match(
    previewSource,
    /function buildCompactMonthFilterSummary\(\{[\s\S]*selectedOptions = \[\],[\s\S]*placeholder = "월 선택"/,
  );
  assert.match(previewSource, /summaryFormatter=\{buildCompactMonthFilterSummary\}/);
  assert.match(previewSource, /showCountMeta=\{false\}/);
  assert.match(checkboxMenuSource, /summaryFormatter,/);
});

test("class plan month filter keeps a compact width on mobile headers", () => {
  assert.match(
    styleSource,
    /\.class-plan-preview-month-filter\s*\{[\s\S]*flex:\s*0 1 148px;[\s\S]*min-width:\s*136px;[\s\S]*max-width:\s*148px;/,
  );
  assert.match(styleSource, /\.class-plan-preview-copy\s*\{[\s\S]*flex:\s*1 1 auto;/);
  assert.match(
    styleSource,
    /\.class-plan-preview-header-actions\s*\{[\s\S]*flex:\s*0 0 auto;/,
  );
});
