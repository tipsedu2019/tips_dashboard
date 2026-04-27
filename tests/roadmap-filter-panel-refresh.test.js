import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const roadmapViewPath = path.join(root, 'src/components/CurriculumRoadmapView.jsx');
const indexCssPath = path.join(root, 'src/index.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('school annual board uses a one-row bar with compact segments and switch-only linked event toggles', () => {
  const source = read(roadmapViewPath);

  assert.match(source, /import\s+\{\s*CheckboxMenu,\s*SegmentedControl,\s*Switch\s*\}\s+from\s+'\.\/ui\/tds'/);
  assert.match(source, /const ALL_SUBJECTS = 'all-subjects';/);
  assert.match(source, /const \[selectedSchoolKeys,\s*setSelectedSchoolKeys\] = useState\(\[\]\);/);
  assert.match(source, /const \[selectedSchoolGrades,\s*setSelectedSchoolGrades\] = useState\(\[\]\);/);
  assert.match(source, /const \[selectedSchoolPeriods,\s*setSelectedSchoolPeriods\] = useState\(\[\]\);/);
  assert.match(source, /const subjectSegmentItems =/);
  assert.match(source, /const schoolCategorySegmentItems =/);
  assert.match(source, /<SegmentedControl/);
  assert.equal(source.includes('label="?쒓린 ?좏깮"'), false);
  assert.equal(source.includes('label="?숆탳 ?좏깮"'), false);
  assert.equal(source.includes('label="?숇뀈 ?좏깮"'), false);
  assert.match(source, /const \[visibleScheduleColumnKeys,\s*setVisibleScheduleColumnKeys\]/);
  assert.match(source, /const visibleScheduleColumnOptions/);
  assert.match(source, /const showPastLinkedEvents = !hidePastLinkedEvents;/);
  assert.match(source, /key:\s*'vacation-misc'/);
  assert.match(source, /visibleScheduleColumnOptions\.map\(\(column\) => \(/);
  assert.match(source, /colSpan=\{selectedSchoolGradeColumns\.length \+ visibleScheduleColumnOptions\.length \+ 1\}/);
  assert.match(source, /roadmap-school-filter-panel__row/);
  assert.equal(source.includes('checked={showPastLinkedEvents}'), true);
  assert.match(source, /checked=\{showPastLinkedEvents\}/);
  assert.match(source, /<CheckboxMenu/);
  assert.match(source, /<Switch/);
});

test('school annual board filter bar styling keeps a single compact row and reserves scrollbar gutter space', () => {
  const css = read(indexCssPath);

  assert.match(css, /\.roadmap-school-filter-panel\s*\{/);
  assert.match(css, /\.roadmap-school-filter-panel__row\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.roadmap-school-filter-item\s*\{/);
  assert.match(css, /\.roadmap-school-filter-switch\s*\{/);
  assert.match(css, /\.roadmap-report-scroll\s*\{[\s\S]*scrollbar-gutter:\s*stable/);
  assert.equal(css.includes('.roadmap-school-filter-panel__toggle'), false);
});
