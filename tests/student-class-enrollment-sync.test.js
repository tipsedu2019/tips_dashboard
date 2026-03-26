import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const enrollmentSyncPath = path.join(root, 'src/lib/enrollmentSync.js');
const studentEditorPath = path.join(root, 'src/components/data-manager/DataManagerEditors.jsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

async function loadEnrollmentSync() {
  return import(pathToFileURL(enrollmentSyncPath).href);
}

test('reconcileRosterRelations merges student-side and class-side enrollment links in both directions', async () => {
  const { reconcileRosterRelations } = await loadEnrollmentSync();

  const result = reconcileRosterRelations({
    students: [
      {
        id: 'student-1',
        name: '민지',
        classIds: ['class-1'],
        waitlistClassIds: ['class-2'],
      },
      {
        id: 'student-2',
        name: '현우',
        classIds: [],
        waitlistClassIds: [],
      },
    ],
    classes: [
      {
        id: 'class-1',
        className: '중등 영어 A',
        studentIds: [],
        waitlistIds: [],
      },
      {
        id: 'class-2',
        className: '중등 수학 B',
        studentIds: ['student-2'],
        waitlistIds: [],
      },
      {
        id: 'class-3',
        className: '고등 영어 C',
        studentIds: ['student-1'],
        waitlistIds: [],
      },
    ],
  });

  const studentOne = result.students.find((student) => student.id === 'student-1');
  const studentTwo = result.students.find((student) => student.id === 'student-2');
  const classOne = result.classes.find((classItem) => classItem.id === 'class-1');
  const classTwo = result.classes.find((classItem) => classItem.id === 'class-2');
  const classThree = result.classes.find((classItem) => classItem.id === 'class-3');

  assert.deepEqual(studentOne.classIds, ['class-1', 'class-3']);
  assert.deepEqual(studentOne.waitlistClassIds, ['class-2']);
  assert.deepEqual(studentTwo.classIds, ['class-2']);
  assert.deepEqual(studentTwo.waitlistClassIds, []);

  assert.deepEqual(classOne.studentIds, ['student-1']);
  assert.deepEqual(classOne.waitlistIds, []);
  assert.deepEqual(classTwo.studentIds, ['student-2']);
  assert.deepEqual(classTwo.waitlistIds, ['student-1']);
  assert.deepEqual(classThree.studentIds, ['student-1']);
  assert.deepEqual(classThree.waitlistIds, []);
});

test('reconcileRosterRelations removes orphaned ids and keeps enrolled links ahead of waitlist links', async () => {
  const { reconcileRosterRelations } = await loadEnrollmentSync();

  const result = reconcileRosterRelations({
    students: [
      {
        id: 'student-1',
        name: '민지',
        classIds: ['class-1', 'missing-class'],
        waitlistClassIds: ['class-1', 'class-2'],
      },
    ],
    classes: [
      {
        id: 'class-1',
        className: '중등 영어 A',
        studentIds: ['student-1', 'missing-student'],
        waitlistIds: ['student-1'],
      },
      {
        id: 'class-2',
        className: '중등 수학 B',
        studentIds: [],
        waitlistIds: ['student-1', 'missing-student'],
      },
    ],
  });

  assert.deepEqual(result.students[0].classIds, ['class-1']);
  assert.deepEqual(result.students[0].waitlistClassIds, ['class-2']);
  assert.deepEqual(result.classes[0].studentIds, ['student-1']);
  assert.deepEqual(result.classes[0].waitlistIds, []);
  assert.deepEqual(result.classes[1].studentIds, []);
  assert.deepEqual(result.classes[1].waitlistIds, ['student-1']);
});

test('syncClassRosterToStudents removes stale class links from students when a class roster changes', async () => {
  const { syncClassRosterToStudents } = await loadEnrollmentSync();

  const result = syncClassRosterToStudents({
    classId: 'class-1',
    studentIds: ['student-1'],
    waitlistIds: ['student-3'],
    students: [
      {
        id: 'student-1',
        name: '민지',
        classIds: [],
        waitlistClassIds: ['class-1'],
      },
      {
        id: 'student-2',
        name: '현우',
        classIds: ['class-1'],
        waitlistClassIds: [],
      },
      {
        id: 'student-3',
        name: '서준',
        classIds: ['class-1'],
        waitlistClassIds: [],
      },
    ],
  });

  const studentOne = result.find((student) => student.id === 'student-1');
  const studentTwo = result.find((student) => student.id === 'student-2');
  const studentThree = result.find((student) => student.id === 'student-3');

  assert.deepEqual(studentOne.classIds, ['class-1']);
  assert.deepEqual(studentOne.waitlistClassIds, []);
  assert.deepEqual(studentTwo.classIds, []);
  assert.deepEqual(studentTwo.waitlistClassIds, []);
  assert.deepEqual(studentThree.classIds, []);
  assert.deepEqual(studentThree.waitlistClassIds, ['class-1']);
});

test('syncStudentEnrollmentToClasses removes stale student links from classes when a student enrollment changes', async () => {
  const { syncStudentEnrollmentToClasses } = await loadEnrollmentSync();

  const result = syncStudentEnrollmentToClasses({
    studentId: 'student-1',
    classIds: ['class-2'],
    waitlistClassIds: ['class-3'],
    classes: [
      {
        id: 'class-1',
        className: '중등 영어 A',
        studentIds: ['student-1'],
        waitlistIds: [],
      },
      {
        id: 'class-2',
        className: '중등 수학 B',
        studentIds: [],
        waitlistIds: ['student-1'],
      },
      {
        id: 'class-3',
        className: '고등 영어 C',
        studentIds: ['student-1'],
        waitlistIds: [],
      },
    ],
  });

  const classOne = result.find((classItem) => classItem.id === 'class-1');
  const classTwo = result.find((classItem) => classItem.id === 'class-2');
  const classThree = result.find((classItem) => classItem.id === 'class-3');

  assert.deepEqual(classOne.studentIds, []);
  assert.deepEqual(classOne.waitlistIds, []);
  assert.deepEqual(classTwo.studentIds, ['student-1']);
  assert.deepEqual(classTwo.waitlistIds, []);
  assert.deepEqual(classThree.studentIds, []);
  assert.deepEqual(classThree.waitlistIds, ['student-1']);
});

test('student editor uses all managed grades instead of limiting the dropdown to middle school only', () => {
  const source = read(studentEditorPath);

  assert.match(source, /getAllManagedGrades/);
  assert.match(source, /allGradeOptions\.map\(\(grade\) => \(/);
});
