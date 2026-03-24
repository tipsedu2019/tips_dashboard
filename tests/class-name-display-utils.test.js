import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareClassDisplayNames,
  getEditableClassNameSeed,
} from '../src/lib/classNameDisplay.js';

test('getEditableClassNameSeed strips the leading bracket prefix from class names', () => {
  assert.equal(
    getEditableClassNameSeed({
      className: '[중1영 한지현] 중1B1',
    }),
    '중1B1',
  );
});

test('compareClassDisplayNames sorts by visible class name with numeric order', () => {
  const classes = [
    { className: '[중3 수학 김소연] 중3 내신집중 2반' },
    { className: '[중1 영어 한지현] 중1B1' },
    { className: '[중3 수학 김소연] 중3 내신집중 1반' },
  ];

  const sorted = [...classes].sort(compareClassDisplayNames);

  assert.deepEqual(
    sorted.map((item) => item.className),
    [
      '[중1 영어 한지현] 중1B1',
      '[중3 수학 김소연] 중3 내신집중 1반',
      '[중3 수학 김소연] 중3 내신집중 2반',
    ],
  );
});
