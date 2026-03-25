import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const indexCssPath = path.join(root, 'src/index.css');
const foundationCssPath = path.join(root, 'src/styles/tds-foundation.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function countOccurrences(source, needle) {
  return [...source.matchAll(needle)].length;
}

function findSemanticTokenOwners(source) {
  const blockPattern = /(:root|\[data-theme=["']dark["']\])\s*\{([\s\S]*?)\n\}/g;
  const semanticTokens = [
    '--bg-base',
    '--bg-surface',
    '--bg-surface-strong',
    '--bg-surface-hover',
    '--bg-surface-muted',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--border-color',
    '--border-strong',
    '--accent-color',
    '--accent-hover',
    '--accent-light',
    '--accent-soft',
    '--accent-strong',
    '--shadow-sm',
    '--shadow-md',
    '--sidebar-bg',
    '--sidebar-border',
    '--glass-highlight',
    '--glass-blur',
    '--page-gradient',
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--ui-primary',
    '--ui-primary-pressed',
    '--ui-primary-soft',
    '--ui-primary-softer',
    '--ui-canvas',
    '--ui-surface',
    '--ui-surface-strong',
    '--ui-surface-muted',
    '--ui-sidebar-surface',
    '--ui-sidebar-surface-strong',
    '--ui-text-strong',
    '--ui-text',
    '--ui-text-muted',
    '--ui-divider',
    '--ui-divider-strong',
    '--ui-shadow-soft',
    '--ui-shadow-medium',
    '--ui-shadow-strong',
    '--ui-radius-sm',
    '--ui-radius-md',
    '--ui-radius-lg',
    '--ui-radius-xl',
    '--ui-page-max',
  ];

  return [...source.matchAll(blockPattern)]
    .map((match) => ({
      selector: match[1],
      body: match[2],
      line: source.slice(0, match.index).split('\n').length,
    }))
    .filter(({ body }) => semanticTokens.some((token) => body.includes(token)));
}

test('index.css no longer owns the global semantic token root blocks', () => {
  const source = read(indexCssPath);
  const owners = findSemanticTokenOwners(source);

  assert.deepEqual(
    owners,
    [],
    `Expected semantic tokens to live only in tds-foundation.css, but index.css still owns: ${owners
      .map(({ selector, line }) => `${selector}@${line}`)
      .join(', ')}`,
  );
});

test('tds-foundation.css is the single semantic token source', () => {
  const source = read(foundationCssPath);

  assert.equal(countOccurrences(source, /@font-face/g), 1);
  assert.equal(countOccurrences(source, /--tds-font-family:/g), 1);
  assert.equal(countOccurrences(source, /--tds-state-primary:/g), 2);
  assert.equal(countOccurrences(source, /--ui-primary:/g), 2);
  assert.equal(source.includes('--tds-state-primary: var(--tds-color-grey-800);'), false);
  assert.equal(source.includes('--tds-state-primary: #f8fafc;'), false);
  assert.equal(source.includes('reintroduces an older neutral-primary block'), false);
});
