import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const modalSource = readFileSync(
  join(process.cwd(), "src", "components", "ClassSchedulePlanModal.jsx"),
  "utf8",
);

const styleSource = readFileSync(
  join(process.cwd(), "src", "index.css"),
  "utf8",
);

const exportSource = readFileSync(
  join(process.cwd(), "src", "lib", "exportAsImage.js"),
  "utf8",
);

test("readonly class plan header exposes only the image download action", () => {
  assert.match(modalSource, /data-testid="class-plan-download-button"/);
  assert.match(modalSource, /className="theme-toggle class-plan-header-icon-button"/);
  assert.match(modalSource, /<Download size=\{18\} \/>/);
  assert.match(modalSource, /const captureScale = isMobile \? 3 : 4;/);
  assert.doesNotMatch(modalSource, /const captureScale = isMobile \? 5 : 4;/);
  assert.doesNotMatch(modalSource, /data-testid="class-plan-pdf-share-button"/);
  assert.doesNotMatch(modalSource, /exportElementAsPdf/);
  assert.doesNotMatch(modalSource, /<Share2 size=\{18\} \/>/);
  assert.match(styleSource, /\.class-plan-header-action-group\s*\{/);
  assert.match(styleSource, /\.class-plan-header-icon-button\s*\{/);
  assert.match(exportSource, /export async function exportElementAsPdf/);
});
