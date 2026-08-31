import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validatePageSize } from '../src/lib/numbered-pagination.ts';

const file = new URL('../src/features/tasks/ops-task-list-navigation.ts', import.meta.url);
function load() {
  assert.ok(existsSync(file), 'task list restoration helper exists');
  const runtime = { exports: {} };
  const legacy = readFileSync(new URL('../src/features/tasks/ops-task-service.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('service.ts', legacy, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter((n) => ['assertOpsTaskPageFilters', 'canonicalJson'].includes(n.name?.text)).map((n) => n.getText(ast)).join('\n');
  const checks = { exports: {} };
  vm.runInThisContext(`(function(module,exports){${ts.transpileModule(declarations, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText}\nmodule.exports={assertOpsTaskPageFilters};})`)(checks, checks.exports);
  vm.runInThisContext(`(function(require,module,exports){${ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText}\n})`)((name) => name.includes('numbered-pagination') ? { validatePageSize } : checks.exports, runtime, runtime.exports);
  return runtime.exports;
}
const filters = { taskType: 'general', search: '유지 검색', statuses: [], queue: 'sent', requestedById: null, requestedTeam: null, assigneeId: null, assigneeTeam: null, focus: 'none', sort: 'priority' };
const snapshot = { version: 1, actorScope: '["actor","staff"]', pathname: '/admin/tasks', filters, page: 7, pageSize: 10, scrollY: 420 };
test('history snapshot validates actor role, route, filters and page and preserves Next state', () => {
  const { readOpsTaskListNavigation, writeOpsTaskListNavigation } = load();
  const target = { location: { pathname: '/admin/tasks', search: '?list=sent&taskId=record' }, history: { state: { __NA: true, tree: 'next' }, replaceState(state, _, url) { this.state = state; target.url = url; } } };
  writeOpsTaskListNavigation(target, snapshot);
  assert.equal(target.history.state.__NA, true); assert.equal(target.history.state.tree, 'next');
  assert.ok(target.url.includes('taskId=record')); assert.ok(target.url.includes('taskPage=7'));
  assert.deepEqual(readOpsTaskListNavigation(target.history.state, snapshot.actorScope, '/admin/tasks', 'general'), snapshot);
  assert.equal(readOpsTaskListNavigation(target.history.state, '["actor","teacher"]', '/admin/tasks', 'general'), null);
  assert.equal(readOpsTaskListNavigation(target.history.state, snapshot.actorScope, '/admin/transfer', 'general'), null);
  for (const patch of [{ page: 0 }, { pageSize: 5 }, { version: 0 }, { filters: { ...filters, extra: true } }, { scrollY: -1 }]) {
    assert.equal(readOpsTaskListNavigation({ tipsOpsTaskList: { ...snapshot, ...patch } }, snapshot.actorScope, '/admin/tasks', 'general'), null);
  }
});
test('exact observation URL stays five keys while history retains separate list context', () => {
  const { writeOpsTaskListNavigation } = load();
  const search = '?taskId=t&trackId=r&appointmentId=a&observationId=o&view=calendar';
  const target = { location: { pathname: '/admin/registration', search }, history: { state: {}, replaceState(state, _, url) { this.state = state; target.url = url; } } };
  writeOpsTaskListNavigation(target, snapshot);
  assert.equal(target.url, `/admin/registration${search}`);
  assert.deepEqual(target.history.state.tipsOpsTaskList, snapshot);
});
