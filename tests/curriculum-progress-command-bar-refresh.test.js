import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const workspacePath = path.join(root, 'src/components/CurriculumProgressWorkspace.jsx');
const dataManagerPath = path.join(root, 'src/components/DataManager.jsx');
const statsDashboardPath = path.join(root, 'src/components/StatsDashboard.jsx');
const publicLandingPath = path.join(root, 'src/components/PublicClassLandingView.jsx');
const dashboardCssPath = path.join(root, 'src/styles/tds-dashboard.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('curriculum progress workspace keeps grade filters fully visible and aligns single-line controls', () => {
  const source = read(workspacePath);
  const publicLanding = read(publicLandingPath);
  const dashboardCss = read(dashboardCssPath);

  assert.match(source, /ManagementCommandBar/);
  assert.match(source, /PublicLandingCard/);
  assert.match(source, /management-command-bar__filter--term/);
  assert.match(source, /management-command-bar__filter--subject/);
  assert.match(source, /management-command-bar__filter--grade/);
  assert.match(source, /management-command-bar__filter--teacher/);
  assert.equal(source.includes('management-command-bar__filter--classroom'), false);

  assert.match(
    source,
    /management-command-bar__filter--grade[\s\S]*alignment="fixed"[\s\S]*showArrowButtons=\{false\}[\s\S]*management-command-bar__segmented management-command-bar__segmented-grade/,
  );
  assert.match(
    source,
    /management-command-bar__filter--teacher[\s\S]*alignment="fluid"[\s\S]*management-command-bar__segmented management-command-bar__segmented-teacher/,
  );

  ['고3', '고2', '고1', '중3', '중2', '중1', '초6'].forEach((grade) => {
    assert.match(source, new RegExp(`'${grade}'`));
  });

  assert.match(source, /plannerActionLabel="수업 설계"/);
  assert.match(source, /plannerSelectedActionLabel="수업 설계"/);
  assert.match(source, />\s*진도 체크\s*</);
  assert.match(source, /mode=\{modalMode\}/);
  assert.match(source, /editable=\{modalMode !== 'readonly'\}/);

  assert.match(
    dashboardCss,
    /\.curriculum-progress-command-bar__filters\s*\{[\s\S]*minmax\(360px,\s*392px\)[\s\S]*minmax\(280px,\s*1fr\)/,
  );
  assert.match(
    dashboardCss,
    /\.management-command-bar__search-icon\s*\{[\s\S]*top:\s*50%[\s\S]*transform:\s*translateY\(-50%\);/,
  );
  assert.match(
    dashboardCss,
    /\.curriculum-progress-pane \.management-command-bar__search-input,\s*[\s\S]*min-height:\s*48px;/,
  );
  assert.match(
    dashboardCss,
    /\.curriculum-progress-pane \.management-command-bar__search-shell\s*\{[\s\S]*min-height:\s*48px;/,
  );
  assert.match(
    dashboardCss,
    /\.curriculum-progress-pane \.management-command-bar__search-shell,\s*[\s\S]*\.curriculum-progress-command-bar__filters \.management-command-bar__filter\s*\{[\s\S]*display:\s*flex[\s\S]*align-items:\s*stretch;/,
  );
  assert.match(
    dashboardCss,
    /\.curriculum-progress-command-bar__filters \.management-command-bar__menu \.tds-checkbox-menu__trigger,\s*[\s\S]*\.curriculum-progress-command-bar__filters \.management-command-bar__menu \.tds-checkbox-menu__trigger-copy\s*\{[\s\S]*display:\s*flex[\s\S]*align-items:\s*center;/,
  );
  assert.match(
    dashboardCss,
    /\.management-command-bar__segmented-grade\.tds-segmented--alignment-fixed \.tds-segmented__item\s*\{[\s\S]*min-width:\s*0[\s\S]*padding-inline:\s*10px;/,
  );
  assert.match(
    dashboardCss,
    /\.curriculum-progress-command-bar__filters \.management-command-bar__segmented \.tds-segmented__item\s*\{[\s\S]*min-height:\s*40px;/,
  );
  assert.match(
    dashboardCss,
    /\.management-command-bar__segmented-teacher \.tds-segmented__track\s*\{[\s\S]*padding-inline:\s*12px 16px;/,
  );
  assert.match(
    dashboardCss,
    /\.management-command-bar__segmented-grade \.tds-segmented__item span,\s*[\s\S]*\.management-command-bar__segmented-teacher \.tds-segmented__item span\s*\{[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*ellipsis;/,
  );

  assert.match(publicLanding, /plannerActionLabel/);
  assert.match(publicLanding, /plannerSelectedActionLabel/);
});

test('data manager content shell aligns the command bar without extra side inset', () => {
  const source = read(dataManagerPath);

  assert.match(source, /padding:\s*"12px 0 24px"/);
  assert.equal(source.includes('padding: "0 4px 24px"'), false);
});

test('dashboard absorbs the planning KPIs that were removed from the curriculum planning hub', () => {
  const source = read(statsDashboardPath);

  assert.match(source, /planningStats/);
  assert.match(source, /label: '계획 관리 반'/);
  assert.match(source, /label: '계획 총 회차'/);
  assert.match(source, /label: '계획 완료'/);
  assert.match(source, /label: '계획 대기'/);
});
