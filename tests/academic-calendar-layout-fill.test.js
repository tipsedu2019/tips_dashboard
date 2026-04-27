import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const indexCssPath = path.join(root, 'src/index.css');
const tdsDashboardPath = path.join(root, 'src/styles/tds-dashboard.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('academic calendar desktop layout reserves full workspace height without auto-height overrides', () => {
  const indexCss = read(indexCssPath);

  assert.equal(indexCss.includes('.academic-calendar-app .academic-calendar-main {\n    height: auto !important;'), false);
  assert.equal(indexCss.includes('.academic-calendar-app .academic-month-grid {\n    display: flex;\n    flex-direction: column;\n    height: auto !important;'), false);
  assert.equal(indexCss.includes('.academic-calendar-app .academic-month-weeks {\n    display: flex;\n    flex-direction: column;\n    height: auto !important;'), false);
});

test('academic calendar workspace uses full remaining height and zero internal padding', () => {
  const tdsDashboardCss = read(tdsDashboardPath);

  assert.equal(tdsDashboardCss.includes('padding: 0 0 calc(36px + var(--shell-safe-bottom));'), false);
  assert.equal(tdsDashboardCss.includes(".main-content.main-content-academic-calendar {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  height: 100%;\n  padding: 0;"), true);
  assert.equal(
    tdsDashboardCss.includes(".academic-calendar-workspace {\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr);\n  gap: 0;"),
    true
  );
  assert.equal(tdsDashboardCss.includes('padding: 0 !important;'), true);
  assert.equal(tdsDashboardCss.includes('height: calc(100dvh - 58px - var(--shell-safe-bottom)) !important;'), true);
});

test('embedded school annual board also stretches to the remaining workspace height', () => {
  const tdsDashboardCss = read(tdsDashboardPath);

  assert.equal(
    tdsDashboardCss.includes(".academic-roadmap-embed {\n  display: flex;\n  flex-direction: column;"),
    true
  );
  assert.equal(tdsDashboardCss.includes('.academic-roadmap-embed {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;'), true);
  assert.equal(tdsDashboardCss.includes('height: 100%;'), true);
  assert.equal(tdsDashboardCss.includes('overflow: hidden;'), true);
  assert.equal(tdsDashboardCss.includes('.academic-roadmap-embed__report {\n  display: flex;\n  flex: 1 1 auto;'), true);
  assert.equal(tdsDashboardCss.includes('margin: 0 16px 0;'), true);
  assert.equal(tdsDashboardCss.includes('.academic-roadmap-embed__filters {\n  display: grid;\n  gap: 12px;\n  padding: 12px 16px 0;'), true);
  assert.equal(tdsDashboardCss.includes('.academic-roadmap-embed__report-sheet {\n  flex: 1 1 auto;\n  min-width: 1080px;\n  min-height: 100%;'), true);
});
