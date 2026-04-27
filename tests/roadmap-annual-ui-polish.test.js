import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const indexCssPath = path.join(root, 'src/index.css');
const roadmapViewPath = path.join(root, 'src/components/CurriculumRoadmapView.jsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('school annual roadmap filter bar is frameless and uses strong active segments', () => {
  const css = read(indexCssPath);

  assert.match(
    css,
    /\.roadmap-school-filter-panel\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/
  );
  assert.match(
    css,
    /\.roadmap-school-filter-segment\s+\.tds-segmented__item\.is-active\s*\{[^}]*background:[^}]*color:[^}]*border-color:/
  );
});

test('school annual roadmap cell actions pin the calendar jump button to the top-right corner', () => {
  const css = read(indexCssPath);
  const roadmapView = read(roadmapViewPath);

  assert.match(css, /\.roadmap-cell-head\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/);
  assert.match(
    css,
    /\.roadmap-cell-head-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/
  );
  assert.doesNotMatch(css, /\.roadmap-cell-actions\s*\{[^}]*position:\s*absolute;/);
  assert.match(roadmapView, /className="roadmap-cell-head"/);
  assert.match(roadmapView, /className="roadmap-cell-head-actions"/);
});
