import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("C:/Antigravity/tips_dashboard");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("editable class plan modal keeps the sticky save bar mobile-only", () => {
  const modalSource = read("src/components/ClassSchedulePlanModal.jsx");

  assert.match(
    modalSource,
    /actions=\{isEditableMode \? \(isMobile \? saveBar : null\) : null\}/,
  );
  assert.doesNotMatch(
    modalSource,
    /\{renderDesktopHeader\(\)\}[\s\S]*\{body\}[\s\S]*\{saveBar\}/,
  );
});

test("editor preview keeps tablet and desktop in a balanced two-column layout", () => {
  const previewSource = read("src/components/ClassSchedulePlanPreview.jsx");
  const styleSource = read("src/index.css");

  assert.match(
    previewSource,
    /const useCompactPreviewLayout = isShareImageVariant\s*\?\s*false\s*:\s*isMobile\s*\|\|\s*variant === "public-detail"\s*\|\|\s*variant === "planner-editor";/,
  );
  assert.match(
    styleSource,
    /\.class-plan-preview-layout\.is-desktop\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\);/,
  );
});
