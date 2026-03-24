import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const studentTabPath = path.join(root, 'src/components/data-manager/StudentManagerTab.jsx');
const classTabPath = path.join(root, 'src/components/data-manager/ClassManagerTab.jsx');
const textbookTabPath = path.join(root, 'src/components/data-manager/TextbookManagerTab.jsx');
const commandBarPath = path.join(root, 'src/components/data-manager/ManagementCommandBar.jsx');
const settingsPanelPath = path.join(root, 'src/components/data-manager/ManagementViewSettingsPanel.jsx');
const headerPath = path.join(root, 'src/components/data-manager/ManagementHeader.jsx');
const dashboardCssPath = path.join(root, 'src/styles/tds-dashboard.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('manager tabs adopt the shared management command bar', () => {
  const student = read(studentTabPath);
  const classes = read(classTabPath);
  const textbook = read(textbookTabPath);

  assert.match(student, /ManagementCommandBar/);
  assert.match(classes, /ManagementCommandBar/);
  assert.match(textbook, /ManagementCommandBar/);
});

test('class manager no longer renders the standalone timetable filter panel on desktop', () => {
  const classes = read(classTabPath);

  assert.equal(classes.includes('TimetableUnifiedFilterPanel'), false);
  assert.match(classes, /management-command-bar__filter--term/);
  assert.match(classes, /management-command-bar__filter--subject/);
  assert.match(classes, /management-command-bar__filter--grade/);
  assert.match(classes, /management-command-bar__filter--teacher/);
  assert.match(classes, /management-command-bar__filter--classroom/);
});

test('management command bar keeps a fixed primary action and collapses the rest into overflow and settings menus', () => {
  const commandBar = read(commandBarPath);
  const settingsPanel = read(settingsPanelPath);

  assert.match(commandBar, /primaryAction/);
  assert.match(commandBar, /overflowActions/);
  assert.match(commandBar, /settingsContent/);
  assert.match(commandBar, /MoreHorizontal/);
  assert.match(commandBar, /SlidersHorizontal/);
  assert.match(settingsPanel, /sortState/);
  assert.match(settingsPanel, /toggleColumnVisibility/);
});

test('management header is reduced to selection feedback only', () => {
  const header = read(headerPath);

  assert.equal(header.includes('management-search-row'), false);
  assert.equal(header.includes('management-toolbar'), false);
  assert.match(header, /selectedCount <= 0/);
  assert.match(header, /management-selection-banner/);
});

test('dashboard styles define a compact single-bar management command layout', () => {
  const css = read(dashboardCssPath);

  assert.match(css, /\.management-command-bar\s*\{/);
  assert.match(css, /\.management-command-bar__main\s*\{/);
  assert.match(css, /\.management-command-bar__filters\s*\{/);
  assert.match(css, /\.management-command-bar__overflow-panel\s*\{/);
  assert.match(css, /\.management-command-bar__settings-panel\s*\{/);
});

test('manager tabs use a shared inset shell so the command bar aligns with the list body', () => {
  const student = read(studentTabPath);
  const classes = read(classTabPath);
  const textbook = read(textbookTabPath);
  const css = read(dashboardCssPath);

  assert.match(student, /management-pane-shell/);
  assert.match(classes, /management-pane-shell/);
  assert.match(textbook, /management-pane-shell/);
  assert.match(student, /management-top-shell/);
  assert.match(classes, /management-top-shell/);
  assert.match(textbook, /management-top-shell/);
  assert.match(css, /\.management-pane-shell\s*\{/);
  assert.match(css, /padding:\s*8px clamp\(16px,\s*1\.8vw,\s*32px\) 0/);
  assert.match(css, /\.management-top-shell\s*\{[\s\S]*padding-inline:\s*16px;/);
});
