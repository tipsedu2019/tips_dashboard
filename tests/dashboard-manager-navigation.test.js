import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const appPath = path.join(root, 'src/App.jsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('app promotes student class and textbook management to standalone views', () => {
  const source = read(appPath);

  assert.match(source, /id: "students-manager"/);
  assert.match(source, /id: "classes-manager"/);
  assert.match(source, /id: "textbooks-manager"/);

  assert.equal(source.includes('id: "data-manager"'), false);
  assert.equal(source.includes('changeView("data-manager"'), false);
  assert.equal(source.includes('currentView === "data-manager"'), false);
});

test('timetable no longer exposes the duplicate class list tab', () => {
  const source = read(appPath);

  assert.equal(source.includes('"class-list"'), false);
  assert.equal(source.includes('ClassListWorkspace'), false);
  assert.match(source, /TIMETABLE_VIEW_IDS = \[/);
});

test('desktop-only manager menus stay out of the mobile bottom navigation', () => {
  const source = read(appPath);

  assert.match(source, /desktopOnly: true/);
  assert.match(source, /!item\.desktopOnly \|\| !isMobile/);
  assert.equal(source.includes('mobile-nav-data-manager'), false);
});

test('bottom navigation order and labels follow the dashboard-academic-planning-management flow', () => {
  const source = read(appPath);

  const statsIndex = source.indexOf('id: "stats"');
  const academicIndex = source.indexOf('id: "academic-calendar"');
  const timetableIndex = source.indexOf('id: "timetable"');
  const curriculumIndex = source.indexOf('id: "curriculum-roadmap"');
  const textbookIndex = source.indexOf('id: "textbooks-manager"');
  const classIndex = source.indexOf('id: "classes-manager"');
  const studentIndex = source.indexOf('id: "students-manager"');

  assert.ok(statsIndex >= 0);
  assert.ok(academicIndex > statsIndex);
  assert.ok(timetableIndex > academicIndex);
  assert.ok(curriculumIndex > timetableIndex);
  assert.ok(textbookIndex > curriculumIndex);
  assert.ok(classIndex > textbookIndex);
  assert.ok(studentIndex > classIndex);
  assert.match(source, /title: "\\uB300\\uC2DC\\uBCF4\\uB4DC"|title: "대시보드"/);
  assert.match(source, /title: "\\uC218\\uC5C5\\uACC4\\uD68D"|title: "수업계획"/);
});
