import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const academicCalendarViewPath = path.join(root, 'src/components/AcademicCalendarView.jsx');
const curriculumRoadmapViewPath = path.join(root, 'src/components/CurriculumRoadmapView.jsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('academic calendar sidebar no longer exposes school or grade filter controls', () => {
  const source = read(academicCalendarViewPath);

  assert.equal(source.includes('label="학교 필터"'), false);
  assert.equal(source.includes('label="학년 필터"'), false);
});

test('academic calendar roadmap button opens the embedded school annual board intent', () => {
  const source = read(academicCalendarViewPath);

  assert.match(source, /setActiveWorkspaceTab\('school-annual-board'\)/);
  assert.match(source, /navigationIntent=\{embeddedNavigationIntent\}/);
  assert.match(source, /subject:\s*'all-subjects'/);
  assert.equal(source.includes('교재진도 열기'), false);
  assert.match(source, /학교 연간일정표 열기/);
});

test('embedded school annual board narrows to the same school category from calendar intent', () => {
  const source = read(curriculumRoadmapViewPath);

  assert.match(source, /navigationIntent\.schoolCategory/);
  assert.match(source, /setSelectedSchoolCategory\(/);
  assert.match(source, /setSelectedSchoolKeys\(\[\]\)/);
  assert.match(source, /setSelectedSchoolGrades\(\[\]\)/);
  assert.match(source, /setSelectedSchoolPeriods\(\[\]\)/);
});
