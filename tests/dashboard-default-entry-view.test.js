import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const appPath = path.join(root, 'src/App.jsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('dashboard uses stats as the default entry view on every viewport', () => {
  const source = read(appPath);

  assert.match(
    source,
    /const defaultDashboardView = "stats";/,
  );
  assert.match(
    source,
    /const \[currentView, setCurrentView\] = useState\(\(\) => defaultDashboardView\);/,
  );
});

test('home actions return to the viewport-specific default dashboard view', () => {
  const source = read(appPath);

  assert.match(source, /const goHome = \(\) => \{\s*changeView\(defaultDashboardView\);/);
  assert.match(source, /setCurrentView\(defaultDashboardView\);/);
});
