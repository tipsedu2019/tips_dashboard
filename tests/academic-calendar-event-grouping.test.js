import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const academicCalendarViewPath = path.join(root, 'src/components/AcademicCalendarView.jsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('academic calendar merges vacation and misc events into a single grouped type', () => {
  const source = read(academicCalendarViewPath);

  assert.match(source, /const VACATION_MISC_EVENT_TYPE = '방학·휴일·기타';/);
  assert.match(source, /name:\s*VACATION_MISC_EVENT_TYPE/);
  assert.equal(source.includes("name: '방학·휴일'"), false);
  assert.equal(source.includes("name: '기타'"), false);
  assert.match(source, /if \(next\.includes\('방학'\) \|\| next\.includes\('개학'\)\) return VACATION_MISC_EVENT_TYPE;/);
  assert.match(source, /if \(next\.includes\('휴일'\) \|\| next\.includes\('공휴일'\) \|\| next\.includes\('대체휴일'\) \|\| next\.includes\('휴강'\)\) return VACATION_MISC_EVENT_TYPE;/);
  assert.match(source, /if \(next\.includes\('기타'\)\) return VACATION_MISC_EVENT_TYPE;/);
});
