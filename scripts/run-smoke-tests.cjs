const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';

const workspaceRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(workspaceRoot, 'src');
const compiledRoot = path.join(workspaceRoot, '.codex-temp', 'smoke-compiled');
const compiledSourceRoot = path.join(compiledRoot, 'src');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function compileSourceTree() {
  fs.rmSync(compiledRoot, { recursive: true, force: true });
  ensureDirectory(compiledSourceRoot);
  fs.writeFileSync(
    path.join(compiledRoot, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2),
    'utf8'
  );

  const queue = [sourceRoot];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    entries.forEach((entry) => {
      const sourcePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(sourceRoot, sourcePath);
      const outputPath = path.join(compiledSourceRoot, relativePath);

      if (entry.isDirectory()) {
        ensureDirectory(outputPath);
        queue.push(sourcePath);
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      if (/\.(js|jsx)$/i.test(entry.name)) {
        const sourceCode = fs.readFileSync(sourcePath, 'utf8').replace(/import\.meta\.env\./g, 'process.env.');
        const { code } = babel.transformSync(sourceCode, {
          babelrc: false,
          configFile: false,
          filename: sourcePath,
          presets: [
            ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
            ['@babel/preset-react', { runtime: 'automatic' }],
          ],
          sourceMaps: 'inline',
        });
        ensureDirectory(path.dirname(outputPath));
        fs.writeFileSync(outputPath, code, 'utf8');
        return;
      }

      ensureDirectory(path.dirname(outputPath));
      fs.copyFileSync(sourcePath, outputPath);
    });
  }
}

compileSourceTree();
require.extensions['.jsx'] = require.extensions['.js'];

const dom = new JSDOM('<!doctype html><html lang="ko"><body></body></html>', {
  url: 'http://127.0.0.1:5175/',
});

const { window } = dom;

function copyWindowProperties(target, source) {
  Object.getOwnPropertyNames(source).forEach((key) => {
    if (key in target) {
      return;
    }
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
  });
}

global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.getComputedStyle = window.getComputedStyle.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
copyWindowProperties(global, window);

if (!window.crypto && global.crypto) {
  Object.defineProperty(window, 'crypto', {
    value: global.crypto,
    configurable: true,
  });
}

window.matchMedia = window.matchMedia || function matchMedia(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  };
};

window.scrollTo = window.scrollTo || (() => {});
window.requestAnimationFrame = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
window.cancelAnimationFrame = window.cancelAnimationFrame || ((id) => clearTimeout(id));
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || (() => {});
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.PointerEvent = window.PointerEvent || window.MouseEvent;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

global.ResizeObserver = global.ResizeObserver || ResizeObserverMock;
global.IntersectionObserver = global.IntersectionObserver || IntersectionObserverMock;

const React = require('react');
const { render, screen, cleanup, waitFor } = require('@testing-library/react');
const userEvent = require('@testing-library/user-event').default;

const { AuthProvider } = require(path.join(compiledSourceRoot, 'contexts', 'AuthContext.jsx'));
const { ToastProvider } = require(path.join(compiledSourceRoot, 'contexts', 'ToastContext.jsx'));
const App = require(path.join(compiledSourceRoot, 'App.jsx')).default;
const DataManager = require(path.join(compiledSourceRoot, 'components', 'DataManager.jsx')).default;
const PublicClassListView = require(path.join(compiledSourceRoot, 'components', 'PublicClassListView.jsx')).default;
const ClassListWorkspace = require(path.join(compiledSourceRoot, 'components', 'ClassListWorkspace.jsx')).default;
const AcademicCalendarView = require(path.join(compiledSourceRoot, 'components', 'AcademicCalendarView.jsx')).default;
const CurriculumRoadmapView = require(path.join(compiledSourceRoot, 'components', 'CurriculumRoadmapView.jsx')).default;
const TeacherWeeklyView = require(path.join(compiledSourceRoot, 'components', 'TeacherWeeklyView.jsx')).default;
const ClassEditor = require(path.join(compiledSourceRoot, 'components', 'data-manager', 'ClassEditor.jsx')).default;
const { createE2EMockData } = require(path.join(compiledSourceRoot, 'testing', 'e2e', 'mockAppData.js'));
const { e2eDataService } = require(path.join(compiledSourceRoot, 'testing', 'e2e', 'mockDataService.js'));
const { ACTIVE_CLASS_STATUS } = require(path.join(compiledSourceRoot, 'lib', 'classStatus.js'));

function setViewport(width, height = 900) {
  window.innerWidth = width;
  window.innerHeight = height;
  window.dispatchEvent(new window.Event('resize'));
}

function enableE2EMode(role = 'staff') {
  window.history.replaceState({}, '', `/?e2e=1&role=${role}`);
}

function resetAppState() {
  cleanup();
  window.document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  setViewport(1280, 900);
  if (typeof e2eDataService.reset === 'function') {
    e2eDataService.reset();
  }
}

async function runTest(name, fn) {
  resetAppState();
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  } finally {
    cleanup();
  }
}

async function renderClassListWorkspace(width) {
  const data = createE2EMockData();
  enableE2EMode('staff');
  setViewport(width, width <= 768 ? 844 : 900);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(ClassListWorkspace, {
          classes: data.classes,
          data,
          dataService: e2eDataService,
        })
      )
    )
  );
  await waitFor(() => {
    assert.ok(screen.getByTestId('management-search-input'));
  });
}

async function renderDataManager(width) {
  const data = createE2EMockData();
  enableE2EMode('staff');
  setViewport(width, width <= 768 ? 844 : 900);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(DataManager, {
          data,
          dataService: e2eDataService,
          onOpenCurriculum: () => {},
          onOpenTermManager: () => {},
        })
      )
    )
  );

  await waitFor(() => {
    assert.ok(document.querySelector('.h-segment-container .h-segment-btn'));
  });
}

async function renderAppMobile(role = 'staff') {
  enableE2EMode(role);
  setViewport(390, 844);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(App)
      )
    )
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('mobile-nav-timetable'));
    assert.ok(screen.getByTestId('mobile-nav-academic-calendar'));
  });
}

async function renderAppDesktop(role = 'staff') {
  enableE2EMode(role);
  setViewport(1440, 960);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(App)
      )
    )
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('sidebar-nav-timetable'));
  });
}

async function renderAcademicCalendar(width) {
  const data = createE2EMockData();
  enableE2EMode('staff');
  setViewport(width, width <= 768 ? 844 : 900);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(AcademicCalendarView, {
          data,
          dataService: e2eDataService,
          onOpenRoadmap: () => {},
        })
      )
    )
  );
  await waitFor(() => {
    if (width <= 768) {
      assert.ok(screen.getByTestId('calendar-mobile-summary'));
      return;
    }
    assert.ok(screen.getByTestId('calendar-month-grid'));
  });
}

async function renderCurriculumRoadmap(width) {
  const data = createE2EMockData();
  enableE2EMode('staff');
  setViewport(width, width <= 768 ? 844 : 900);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(CurriculumRoadmapView, {
          data,
          dataService: e2eDataService,
        })
      )
    )
  );
  await waitFor(() => {
    if (width <= 768) {
      assert.ok(screen.getByTestId('roadmap-mobile-summary'));
      return;
    }
    assert.ok(screen.getByTestId('roadmap-school-annual-board'));
  });
}

async function renderTeacherWeeklyView(width) {
  const data = createE2EMockData();
  enableE2EMode('staff');
  setViewport(width, width <= 768 ? 844 : 900);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(TeacherWeeklyView, {
          classes: data.classes,
          allClasses: data.classes,
          data,
          dataService: e2eDataService,
          defaultStatus: ACTIVE_CLASS_STATUS,
          defaultPeriod: '',
          termKey: 'workspace',
          termStatus: ACTIVE_CLASS_STATUS,
          terms: data.classTerms || [],
          embedded: true,
          floatingFilters: false,
          subjectOptions: ['전체', '영어', '수학'],
          selectedSubject: '전체',
          onSelectSubject: () => {},
        })
      )
    )
  );
  await waitFor(() => {
    assert.ok(screen.getByTestId('teacher-weekly-axis-picker'));
    assert.ok(screen.getByTestId('teacher-weekly-mobile-agenda'));
  });
}

async function renderClassEditor(overrides = {}) {
  const data = createE2EMockData();
  enableE2EMode('staff');
  setViewport(1440, 960);
  render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(ClassEditor, {
          cls: {
            id: 'class-draft',
            className: '',
            subject: '영어',
            grade: '중3',
            teacher: '민예성',
            classroom: '별관 7강',
            schedule: '',
            studentIds: [],
            waitlistIds: [],
            textbookIds: [],
            lessons: [],
            ...overrides.cls,
          },
          textbooks: data.textbooks,
          students: data.students,
          classTerms: data.classTerms,
          academicSchools: data.academicSchools,
          teacherCatalogs: data.teacherCatalogs,
          classroomCatalogs: data.classroomCatalogs,
          allClasses: data.classes,
          academicExamDays: data.academicExamDays,
          academicEventExamDetails: data.academicEventExamDetails,
          academicEvents: data.academicEvents,
          onSave: async () => {},
          onCancel: () => {},
          isSaving: false,
        })
      )
    )
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('class-editor-schedule-input'));
  });
}

async function main() {
  await runTest('public search empty state', async () => {
    const user = userEvent.setup();
    const data = createE2EMockData();
    setViewport(390, 844);

    render(React.createElement(PublicClassListView, {
      classes: data.classes,
      onLogin: () => {},
    }));

    const searchInput = screen.getByTestId('public-class-search-input');
    await user.clear(searchInput);
    await user.type(searchInput, 'zz-not-found-2026');

    await waitFor(() => {
      assert.equal(screen.queryAllByTestId(/public-class-card-/).length, 0);
    });
  });

  await runTest('public class card opens mobile schedule sheet', async () => {
    const user = userEvent.setup();
    const data = createE2EMockData();
    setViewport(390, 844);

    render(React.createElement(PublicClassListView, {
      classes: data.classes,
      onLogin: () => {},
    }));

    assert.ok(screen.getByTestId('public-class-list-view'));
    assert.ok(screen.getByTestId('public-login-button'));

    const classCards = screen.getAllByTestId(/public-class-card-/);
    assert.ok(classCards.length > 0);

    await user.click(classCards[0]);

    await waitFor(() => {
      assert.ok(screen.getByTestId('class-schedule-plan-modal'));
      assert.ok(screen.getByTestId('class-schedule-plan-sheet'));
      assert.ok(screen.getByTestId('class-schedule-mobile-summary'));
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      assert.equal(screen.queryByTestId('class-schedule-plan-sheet'), null);
      assert.ok(screen.getAllByTestId(/public-class-card-/).length > 0);
    });
  });

  await runTest('public mobile quick subject chips narrow the class list', async () => {
    const user = userEvent.setup();
    const data = createE2EMockData();
    setViewport(390, 844);

    render(React.createElement(PublicClassListView, {
      classes: data.classes,
      onLogin: () => {},
    }));

    const initialCount = screen.getAllByTestId(/public-class-card-/).length;
    const quickButtons = screen.getAllByTestId(/public-mobile-quick-subject-/);
    assert.ok(quickButtons.length > 1);

    await user.click(quickButtons[1]);

    await waitFor(() => {
      assert.ok(screen.getAllByTestId(/public-class-card-/).length < initialCount);
    });
  });

  await runTest('public mobile filter sheet opens and resets active filters', async () => {
    const user = userEvent.setup();
    const data = createE2EMockData();
    setViewport(390, 844);

    render(React.createElement(PublicClassListView, {
      classes: data.classes,
      onLogin: () => {},
    }));

    await user.click(screen.getByTestId('public-filter-button'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('public-filter-sheet'));
    });

    const filterSheet = screen.getByTestId('public-filter-sheet');
    const subjectButtons = filterSheet.querySelectorAll('.public-filter-button-grid-subject button');
    assert.ok(subjectButtons.length > 1);
    await user.click(subjectButtons[1]);

    await waitFor(() => {
      assert.equal(screen.getAllByTestId(/public-class-card-/).length, 1);
    });
  });

  await runTest('mobile academic hub switcher swaps between calendar and roadmap', async () => {
    const user = userEvent.setup();
    await renderAppMobile('staff');

    await user.click(screen.getByTestId('mobile-nav-academic-calendar'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('mobile-academic-switcher'));
    });

    await user.click(screen.getByTestId('mobile-academic-tab-roadmap'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('roadmap-mobile-summary'));
    });
  });

  await runTest('mobile timetable filter sheet includes unified term filter', async () => {
    const user = userEvent.setup();
    await renderAppMobile('staff');

    await user.click(screen.getByTestId('mobile-nav-timetable'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('timetable-filter-button'));
    });

    await user.click(screen.getByTestId('timetable-filter-button'));

    await waitFor(() => {
      assert.ok(screen.queryByTestId('timetable-unified-filter'));
      assert.ok(screen.queryByTestId('timetable-term-select'));
    });

    assert.equal(screen.queryByTestId('management-search-input'), null);
  });

  await runTest('desktop timetable unified filters narrow teacher and classroom options by subject', async () => {
    const user = userEvent.setup();
    await renderAppDesktop('staff');

    await user.click(screen.getByTestId('sidebar-nav-timetable'));

    await waitFor(() => {
      assert.ok(document.querySelector('.timetable-unified-filter'));
    });

    const subjectButtons = document.querySelectorAll('.timetable-unified-filter-section-subject .timetable-unified-chip');
    assert.ok(subjectButtons.length >= 2);
    assert.ok(document.querySelectorAll('.timetable-unified-filter-section-teacher .timetable-unified-chip').length >= 2);
    assert.ok(document.querySelectorAll('.timetable-unified-filter-section-classroom .timetable-unified-chip').length >= 2);

    await user.click(subjectButtons[0]);

    await waitFor(() => {
      assert.equal(document.querySelectorAll('.timetable-unified-filter-section-teacher .timetable-unified-chip').length, 1);
      assert.equal(document.querySelectorAll('.timetable-unified-filter-section-classroom .timetable-unified-chip').length, 1);
    });
  });

  await runTest('class list mobile card opens the schedule plan sheet', async () => {
    const user = userEvent.setup();
    await renderAppMobile('staff');

    await user.click(screen.getByTestId('mobile-nav-timetable'));

    await waitFor(() => {
      assert.ok(screen.getAllByTestId(/data-list-mobile-card-/).length > 0);
    });

    await user.click(screen.getAllByRole('button', { name: '상세 보기' })[0]);

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: '상세 정보' }));
    });

    await user.click(screen.getByRole('button', { name: '상세 정보' }));

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: '크게 보기' }));
    });

    await user.click(screen.getByRole('button', { name: '크게 보기' }));

    await waitFor(() => {
      assert.ok(screen.getByTestId('class-schedule-plan-sheet'));
    });
  });

  await runTest('class list quick filters narrow teacher and classroom options', async () => {
    const user = userEvent.setup();
    await renderClassListWorkspace(1280);

    await waitFor(() => {
      assert.equal(screen.getAllByTestId('quick-filter-option-subject').length, 2);
      assert.equal(screen.getAllByTestId('quick-filter-option-teacher').length, 2);
      assert.equal(screen.getAllByTestId('quick-filter-option-classroom').length, 2);
    });

    await user.click(screen.getAllByTestId('quick-filter-option-subject')[0]);

    await waitFor(() => {
      assert.equal(screen.getAllByTestId('quick-filter-option-teacher').length, 1);
      assert.equal(screen.getAllByTestId('quick-filter-option-classroom').length, 1);
    });
  });

  await runTest('class list mobile advanced filter sheet reveals overflow filters', async () => {
    const user = userEvent.setup();
    await renderClassListWorkspace(390);

    assert.equal(screen.queryByTestId('quick-filter-teacher'), null);

    await user.click(screen.getByTestId('management-filter-button'));

    await waitFor(() => {
      assert.ok(screen.getByRole('dialog'));
      assert.ok(screen.getByTestId('quick-filter-teacher'));
      assert.ok(screen.getByTestId('quick-filter-classroom'));
    });
  });

  await runTest('class manager uses unified filter panel and keeps desktop controls', async () => {
    const user = userEvent.setup();
    await renderDataManager(1440);

    const tabButtons = Array.from(document.querySelectorAll('.h-segment-container .h-segment-btn'));
    assert.ok(tabButtons.length >= 2);

    await user.click(tabButtons[1]);

    await waitFor(() => {
      assert.ok(screen.getByTestId('timetable-unified-filter'));
      assert.ok(screen.getByTestId('timetable-term-select'));
      assert.ok(screen.getByTestId('management-filter-button'));
      assert.ok(screen.getByTestId('management-columns-button'));
      assert.equal(screen.queryByTestId('management-search-input'), null);
      assert.equal(screen.queryByTestId('quick-filter-subject'), null);
    });
  });

  await runTest('class list mobile renders class cards', async () => {
    await renderClassListWorkspace(390);

    await waitFor(() => {
      const cards = screen.getAllByTestId(/data-list-mobile-card-/);
      assert.ok(cards.length > 0);
    });
  });

  await runTest('academic calendar mobile filter and create sheets open', async () => {
    const user = userEvent.setup();
    await renderAcademicCalendar(390);

    await user.click(screen.getByTestId('calendar-filter-button'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('calendar-filter-sheet'));
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      assert.equal(screen.queryByTestId('calendar-filter-sheet'), null);
    });

    await user.click(screen.getByTestId('calendar-add-button'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('calendar-create-sheet'));
    });

    assert.equal(screen.queryByTestId('academic-editor-grade-options'), null);
    await user.selectOptions(screen.getByTestId('academic-editor-category-select'), 'middle');

    await waitFor(() => {
      assert.ok(screen.getByTestId('academic-editor-grade-options'));
    });
  });

  await runTest('academic calendar mobile mode toggle swaps month and agenda', async () => {
    const user = userEvent.setup();
    await renderAcademicCalendar(390);

    assert.ok(screen.getByTestId('calendar-month-grid'));
    assert.equal(screen.queryByTestId('calendar-agenda-list'), null);

    await user.click(screen.getByTestId('calendar-mobile-mode-agenda'));

    await waitFor(() => {
      assert.equal(screen.queryByTestId('calendar-month-grid'), null);
      assert.ok(screen.getByTestId('calendar-agenda-list'));
    });

    await user.click(screen.getByTestId('calendar-mobile-mode-month'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('calendar-month-grid'));
    });
  });

  await runTest('curriculum roadmap mobile filter sheet and editor open', async () => {
    const user = userEvent.setup();
    await renderCurriculumRoadmap(390);

    await user.click(screen.getByTestId('roadmap-filter-button'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('roadmap-filter-sheet'));
      assert.ok(screen.getByTestId('roadmap-mobile-context-card'));
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      assert.equal(screen.queryByTestId('roadmap-filter-sheet'), null);
    });

    const roadmapCells = screen.getAllByTestId(/roadmap-school-cell-|roadmap-school-board-cell-|roadmap-academy-cell-/);
    assert.ok(roadmapCells.length > 0);

    await user.click(roadmapCells[0]);

    await waitFor(() => {
      assert.ok(screen.getByTestId('roadmap-editor-sheet'));
      assert.ok(screen.getByTestId('roadmap-editor-context-card'));
    });

    const scheduleTypeSelect = screen.getByTestId('roadmap-schedule-type-select');
    assert.equal(scheduleTypeSelect.value, '영어시험일');
    const scheduleTypeOptions = Array.from(scheduleTypeSelect.options).map((option) => option.value);
    assert.ok(scheduleTypeOptions.includes('시험기간'));
    assert.ok(scheduleTypeOptions.includes('영어시험일'));
    assert.ok(scheduleTypeOptions.includes('체험학습'));
    assert.ok(scheduleTypeOptions.includes('방학·휴일'));
    assert.ok(scheduleTypeOptions.includes('기타'));
  });

  await runTest('teacher weekly mobile agenda shows compact axis picker', async () => {
    const user = userEvent.setup();
    await renderTeacherWeeklyView(390);

    const axisPicker = screen.getByTestId('teacher-weekly-axis-picker');
    assert.ok(axisPicker);
    assert.ok(screen.getByTestId('teacher-weekly-mobile-agenda'));

    const dayTabs = screen.getAllByRole('button', { name: /월|화|수|목|금|토|일/ });
    assert.ok(dayTabs.length > 0);
    await user.click(dayTabs[0]);
  });

  await runTest('academic calendar roadmap action supports schedule-column event types', async () => {
    const user = userEvent.setup();
    const intents = [];
    const data = createE2EMockData();
    enableE2EMode('staff');
    setViewport(1440, 960);
    render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AcademicCalendarView, {
            data,
            dataService: e2eDataService,
            onOpenRoadmap: (intent) => intents.push(intent),
          })
        )
      )
    );

    await waitFor(() => {
      assert.ok(screen.getByTestId('calendar-month-grid'));
      assert.ok(screen.getByTestId('calendar-event-event-field-trip'));
    });

    await user.click(screen.getByTestId('calendar-event-event-field-trip'));

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: '교재·진도 열기' }));
    });

    await user.click(screen.getByRole('button', { name: '교재·진도 열기' }));

    await waitFor(() => {
      assert.equal(intents.length, 1);
      assert.equal(intents[0].focusTarget, 'schedule-column');
      assert.equal(intents[0].scheduleColumnKey, 'field-trip');
      assert.equal(intents[0].eventType, '체험학습');
      assert.equal(intents[0].eventId, 'event-field-trip');
    });
  });

  await runTest('curriculum roadmap school tab uses annual board only and supports reverse academic selection', async () => {
    const user = userEvent.setup();
    const intents = [];
    const data = createE2EMockData();
    enableE2EMode('staff');
    setViewport(1440, 960);
    render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(CurriculumRoadmapView, {
            data,
            dataService: e2eDataService,
            onOpenAcademicCalendar: (intent) => intents.push(intent),
            navigationIntent: {
              tab: 'school',
              schoolId: 'school-1',
              schoolKey: '테스트중학교',
              grade: '중3',
              academicYear: new Date().getFullYear(),
              subject: '영어',
              eventId: 'event-assessment',
            },
          })
        )
      )
    );

    await waitFor(() => {
      assert.ok(screen.getByTestId('roadmap-school-annual-board'));
      assert.equal(screen.queryByTestId('roadmap-school-preset-tabs'), null);
      assert.ok(screen.getByTestId('roadmap-event-filter-chip-시험기간'));
      assert.ok(screen.getByTestId('roadmap-hide-past-toggle'));
    });

    await user.click(screen.getByTestId('roadmap-calendar-link-schedule-school-1-field-trip'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('roadmap-calendar-event-picker'));
    });

    await user.click(screen.getByTestId('roadmap-calendar-event-option-event-field-trip-2'));

    await waitFor(() => {
      assert.equal(intents.length, 1);
      assert.equal(intents[0].eventId, 'event-field-trip-2');
      assert.equal(intents[0].schoolId, 'school-1');
      assert.equal(intents[0].grade, '중3');
    });
  });

  await runTest('academic calendar navigation intent preserves existing filters', async () => {
    const user = userEvent.setup();
    const data = createE2EMockData();
    enableE2EMode('staff');
    setViewport(1440, 960);
    const view = render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AcademicCalendarView, {
            data,
            dataService: e2eDataService,
            onOpenRoadmap: () => {},
          })
        )
      )
    );

    await waitFor(() => {
      assert.ok(screen.getByTestId('calendar-filter-type-방학·휴일'));
    });

    await user.click(screen.getByTestId('calendar-filter-type-시험기간'));
    await user.click(screen.getByTestId('calendar-filter-type-영어시험일'));
    await user.click(screen.getByTestId('calendar-filter-type-수학시험일'));
    await user.click(screen.getByTestId('calendar-filter-type-체험학습'));
    await user.click(screen.getByTestId('calendar-filter-type-기타'));

    assert.equal(screen.getByTestId('calendar-filter-type-방학·휴일').getAttribute('aria-pressed'), 'true');
    assert.equal(screen.getByTestId('calendar-filter-type-체험학습').getAttribute('aria-pressed'), 'false');

    view.rerender(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(AcademicCalendarView, {
            data,
            dataService: e2eDataService,
            onOpenRoadmap: () => {},
            navigationIntent: {
              nonce: Date.now(),
              eventId: 'event-field-trip',
              eventType: '체험학습',
              date: data.academicEvents.find((event) => event.id === 'event-field-trip')?.start,
            },
          })
        )
      )
    );

    await waitFor(() => {
      assert.equal(screen.getByTestId('calendar-filter-type-방학·휴일').getAttribute('aria-pressed'), 'true');
      assert.equal(screen.getByTestId('calendar-filter-type-체험학습').getAttribute('aria-pressed'), 'false');
      assert.ok(screen.getByTestId('calendar-month-grid'));
    });
  });

  await runTest('curriculum roadmap navigation intent preserves existing filters', async () => {
    const user = userEvent.setup();
    const data = createE2EMockData();
    enableE2EMode('staff');
    setViewport(1440, 960);
    const view = render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(CurriculumRoadmapView, {
            data,
            dataService: e2eDataService,
            onOpenAcademicCalendar: () => {},
          })
        )
      )
    );

    await waitFor(() => {
      assert.ok(screen.getByTestId('roadmap-filter-subject-select'));
    });

    await user.selectOptions(screen.getByTestId('roadmap-filter-subject-select'), '수학');
    assert.equal(screen.getByTestId('roadmap-filter-subject-select').value, '수학');

    view.rerender(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(CurriculumRoadmapView, {
            data,
            dataService: e2eDataService,
            onOpenAcademicCalendar: () => {},
            navigationIntent: {
              nonce: Date.now(),
              tab: 'school',
              schoolId: 'school-1',
              schoolKey: '테스트중학교',
              grade: '중3',
              academicYear: new Date().getFullYear(),
              subject: '영어',
              focusTarget: 'schedule-column',
              scheduleColumnKey: 'field-trip',
              eventId: 'event-field-trip',
            },
          })
        )
      )
    );

    await waitFor(() => {
      assert.equal(screen.getByTestId('roadmap-filter-subject-select').value, '수학');
      assert.ok(screen.getByTestId('roadmap-calendar-link-schedule-school-1-field-trip'));
    });
  });

  await runTest('overview ignores timetable panel selections', async () => {
    const user = userEvent.setup();
    await renderAppDesktop('staff');

    await user.click(screen.getByTestId('sidebar-nav-timetable'));
    await waitFor(() => {
      assert.ok(screen.getByTestId('timetable-unified-filter'));
    });

    const subjectButtons = document.querySelectorAll('.timetable-unified-filter-section-subject .timetable-unified-chip');
    assert.ok(subjectButtons.length > 0);
    await user.click(subjectButtons[0]);

    await waitFor(() => {
      assert.equal(document.querySelectorAll('.timetable-unified-filter-section-teacher .timetable-unified-chip').length, 1);
    });

    await user.click(screen.getByTestId('sidebar-nav-stats'));

    await waitFor(() => {
      assert.equal(screen.getByTestId('stats-total-classes').textContent.trim(), '2개');
    });
  });

  await runTest('mock data service saves and emits class terms', async () => {
    let snapshot = null;
    const unsubscribe = e2eDataService.subscribe((nextSnapshot) => {
      snapshot = nextSnapshot;
    });

    await e2eDataService.upsertClassTerms([
      {
        id: 'term-1',
        academicYear: new Date().getFullYear(),
        name: '2026 1학기',
        status: '수업 진행 중',
        startDate: '2026-03-01',
        endDate: '2026-06-30',
        sortOrder: 0,
      },
      {
        id: 'term-2',
        academicYear: new Date().getFullYear(),
        name: '2026 여름특강',
        status: '준비 중',
        startDate: '2026-07-01',
        endDate: '2026-08-15',
        sortOrder: 1,
      },
    ]);

    await waitFor(() => {
      assert.ok(Array.isArray(snapshot?.classTerms));
      assert.equal(snapshot.classTerms.length, 2);
      assert.equal(snapshot.classTerms[1].name, '2026 여름특강');
    });

    unsubscribe();
  });

  await runTest('class editor shows live schedule conflicts while typing', async () => {
    const user = userEvent.setup();
    await renderClassEditor({
      cls: {
        subject: '영어',
        grade: '중1',
        teacher: '이정미',
        classroom: '301',
      },
    });

    assert.equal(screen.queryByTestId('class-editor-live-conflicts'), null);

    await user.type(screen.getByTestId('class-editor-schedule-input'), '월 16:00-17:30');

    await waitFor(() => {
      const warningBox = screen.getByTestId('class-editor-live-conflicts');
      assert.ok((warningBox.textContent || '').trim().length > 0);
    });
  });

  console.log('All smoke tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
