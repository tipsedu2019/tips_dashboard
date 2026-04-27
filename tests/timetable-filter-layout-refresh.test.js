import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const appPath = path.join(root, 'src/App.jsx');
const topFilterBarPath = path.join(root, 'src/components/ui/TimetableTopFilterBar.jsx');
const segmentedControlPath = path.join(root, 'src/components/ui/tds/SegmentedControl.jsx');
const teacherWeeklyPath = path.join(root, 'src/components/TeacherWeeklyView.jsx');
const classroomWeeklyPath = path.join(root, 'src/components/ClassroomWeeklyView.jsx');
const dailyTeacherPath = path.join(root, 'src/components/DailyTeacherView.jsx');
const dailyClassroomPath = path.join(root, 'src/components/DailyClassroomView.jsx');
const utilsPath = path.join(root, 'src/components/timetableViewUtils.js');
const dashboardCssPath = path.join(root, 'src/styles/tds-dashboard.css');
const indexCssPath = path.join(root, 'src/index.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('timetable app removes student-weekly tab and clamps the dashboard grid selector to 1-2 columns', () => {
  const source = read(appPath);

  assert.equal(source.includes('StudentWeeklyView'), false);
  assert.equal(source.includes('student-weekly'), false);
  assert.equal(source.includes('학생 시간표'), false);
  assert.match(source, /const \[timetableGridColumns, setTimetableGridColumns\] = useState\(2\)/);
  assert.match(source, /onGridCountChange:\s*\(nextCount\)\s*=>\s*setTimetableGridColumns\(Math\.min\(2,\s*Math\.max\(1,\s*Number\(nextCount\) \|\| 2\)\)\)/);
});

test('timetable filter bar uses a narrower centered single-select subject segment and image-only export', () => {
  const topFilterBar = read(topFilterBarPath);
  const segmented = read(segmentedControlPath);
  const dashboardCss = read(dashboardCssPath);
  const indexCss = read(indexCssPath);

  assert.match(topFilterBar, /const gridOptions = \[1, 2\]\.map/);
  assert.match(topFilterBar, /selectionMode="single"/);
  assert.match(topFilterBar, /value=\{selectedSubjectValues\[0\] \|\| ''\}/);
  assert.match(topFilterBar, /handleSubjectValueChange/);
  assert.match(topFilterBar, /alignment="fixed"/);
  assert.match(segmented, /selectionMode = 'single'/);
  assert.match(dashboardCss, /\.timetable-top-filter-bar__segmented-subject/);
  assert.match(dashboardCss, /max-width:\s*160px/);
  assert.match(
    dashboardCss,
    /\.timetable-top-filter-bar__segmented-axis\.tds-segmented--alignment-(?:fluid|fixed)\s+\.tds-segmented__item\.is-active[\s\S]*border-color:/,
  );
  assert.match(topFilterBar, /import \{ Camera \} from 'lucide-react'/);
  assert.doesNotMatch(topFilterBar, />\s*PNG\s*</);
  assert.equal(topFilterBar.includes('FileImage'), false);
  assert.equal(topFilterBar.includes('PDF'), false);
  assert.equal(topFilterBar.includes('onExportPdf'), false);
  assert.match(indexCss, /\.timetable-card-camera\s*\{[^}]*top:\s*12px;[^}]*right:\s*12px;/s);
});

test('weekly and daily timetable views consume image export requests only and no longer rely on 3-4 grid density modes', () => {
  const teacherWeekly = read(teacherWeeklyPath);
  const classroomWeekly = read(classroomWeeklyPath);
  const dailyTeacher = read(dailyTeacherPath);
  const dailyClassroom = read(dailyClassroomPath);
  const utils = read(utilsPath);
  const indexCss = read(indexCssPath);

  assert.match(teacherWeekly, /onExportHandled = \(\) => \{\}/);
  assert.match(classroomWeekly, /onExportHandled = \(\) => \{\}/);
  assert.match(dailyTeacher, /selectedDayKeys = \[\]/);
  assert.match(dailyClassroom, /selectedDayKeys = \[\]/);
  assert.match(dailyTeacher, /const effectiveDesktopDays = Array\.isArray\(selectedDayKeys\)/);
  assert.match(dailyClassroom, /const effectiveDesktopDays = Array\.isArray\(selectedDayKeys\)/);
  assert.equal(teacherWeekly.includes('exportElementAsPdf'), false);
  assert.equal(classroomWeekly.includes('exportElementAsPdf'), false);
  assert.equal(dailyTeacher.includes('exportElementAsPdf'), false);
  assert.equal(dailyClassroom.includes('exportElementAsPdf'), false);
  assert.equal(teacherWeekly.includes('handleSaveFullPdf'), false);
  assert.equal(classroomWeekly.includes('handleSaveFullPdf'), false);
  assert.equal(dailyTeacher.includes('handleSaveFullPdf'), false);
  assert.equal(dailyClassroom.includes('handleSaveFullPdf'), false);
  assert.equal(utils.includes("'micro'"), false);
  assert.equal(utils.includes("'nano'"), false);
  assert.equal(indexCss.includes('.timetable-grid-shell.is-nano'), false);
  assert.equal(indexCss.includes('.timetable-grid-shell.is-micro'), false);
  assert.equal(indexCss.includes('.timetable-block.is-nano'), false);
  assert.equal(indexCss.includes('.timetable-block.is-micro'), false);
});

test('timetable export wiring stays image-only after removing pdf save', () => {
  const source = read(appPath);
  const topFilterBar = read(topFilterBarPath);

  assert.equal(source.includes('format: "pdf"'), false);
  assert.equal(source.includes('onExportPdf:'), false);
  assert.equal(source.includes('exportElementAsPdf'), false);
  assert.equal(topFilterBar.includes('PDF'), false);
  assert.equal(topFilterBar.includes('onExportPdf'), false);
  assert.doesNotMatch(topFilterBar, />\s*PNG\s*</);
});

test('daily timetable views use subject-filtered master axis options for visible columns', () => {
  const source = read(appPath);

  assert.match(
    source,
    /<DailyClassroomView[\s\S]*selectedClassroomNames=\{classroomOptions\}/
  );
  assert.match(
    source,
    /<DailyTeacherView[\s\S]*selectedTeacherNames=\{teacherOptions\}/
  );
  assert.doesNotMatch(
    source,
    /<DailyClassroomView[\s\S]*selectedClassroomNames=\{\[\]\}/
  );
  assert.doesNotMatch(
    source,
    /<DailyTeacherView[\s\S]*selectedTeacherNames=\{\[\]\}/
  );
});
