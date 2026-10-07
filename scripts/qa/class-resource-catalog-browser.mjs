// Actual route, isolated browser profile, synthetic reads only. Never clicks save.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { FIXED_NOW, resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url)('playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3279';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = process.env.QA_OUTPUT || 'output/playwright/class-resource-catalogs';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
const teachers = [
  ['eng', '영어 미배정 교사', ['영어팀']], ['math', '수학 미배정 교사', ['수학팀']],
  ['science', '과학 미배정 교사', ['과학팀']], ['wrong', '과학 소속만 있는 교사', ['과학']],
  ['shared', '공통 교사', []], ['hidden', '숨김 교사', ['과학팀'], false],
].map(([id, name, subjects, visible = true], i) => ({ id, name, subjects, is_visible: visible, sort_order: i }));
const rooms = [
  ['eng', '영어 2실', ['영어']], ['eng10', '영어 10실', ['영어']], ['math', '수학 미배정실', ['수학']],
  ['science', '과학 미배정실', ['과학']], ['wrong', '과학팀 소속만 있는 방', ['과학팀']],
  ['shared', '공통실', []], ['hidden', '숨김 강의실', ['과학'], false],
].map(([id, name, subjects, visible = true]) => ({ id, name, subjects, is_visible: visible, sort_order: 0 }));
const classRow = { id: '00000000-0000-4000-8000-000000000201', kind: 'classes', name: '합성 기존반', subject: '영어', grade: '고1', status: '수강', teacherName: '이전 교사', teacher: '이전 교사', sortKey: '1', weeklyMinutes: null, fee: 100000, classroom: '이전 강의실', schedule: '', capacity: 10, studentCount: 0, updatedAt: FIXED_NOW };
for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  const user = { id: '00000000-0000-4000-8000-000000000099', email: 'fixture@example.invalid', user_metadata: { name: '합성 관리자' }, app_metadata: {}, aud: 'authenticated', created_at: FIXED_NOW };
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.fixture';
  await context.addInitScript(({ user, token }) => localStorage.setItem('sb-tips-internal-fixture-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user })), { user, token });
  const report = { width, unhandled: [], errors: [], reads: [], checks: [] };
  let mode = 'normal', releaseCatalog, releaseAuth;
  let authRefreshes = 0;
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'tips-internal-fixture.supabase.co' || url.pathname.startsWith('/api/')) {
      let args = {}; try { args = req.postDataJSON() || {}; } catch {}
      let data;
      if (url.pathname.endsWith('/auth/v1/token') && process.env.QA_AUTH_DEADLINE === '1') {
        authRefreshes++;
        if (mode === 'auth-blocked') await new Promise(resolve => { releaseAuth = resolve; });
        return route.fulfill({ json: { access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user } }).catch(() => {});
      }
      if (/\/(teacher_catalogs|classroom_catalogs)$/.test(url.pathname)) {
        assert.equal(req.method(), 'GET');
        report.reads.push(url.pathname + url.search);
        if (mode === 'error') return route.fulfill({ status: 500, json: { message: 'synthetic unavailable' } });
        data = mode === 'empty' ? [] : (url.pathname.endsWith('/teacher_catalogs') ? teachers : rooms)
          .filter(row => url.searchParams.get('is_visible') !== 'eq.true' || row.is_visible)
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko', { numeric: true }));
        if (mode === 'delayed' && url.pathname.endsWith('/teacher_catalogs')) {
          await new Promise(resolve => { releaseCatalog = resolve; });
        }
      } else if (url.pathname.endsWith('/list_active_science_subject_areas_v1')) {
        data = [{ area_key: 'physics', label: '물리학', is_active: true, sort_order: 0 }];
      } else if (url.pathname.endsWith('/list_management_numbered_page_v1')) {
        data = { rows: [classRow], page: 1, pageSize: 10, totalCount: 1 };
      } else if (url.pathname.endsWith('/get_management_detail_v1')) {
        data = { kind: 'classes', record: classRow, textbooks: [], groups: [], registeredCount: 0, waitlistCount: 0,
          registeredStudents: { page: { rows: [], hasMore: false } }, waitlistedStudents: { page: { rows: [], hasMore: false } },
          formReferences: { teacherCatalogs: [{ id: 'stale', name: '오래된 상세 후보', subjects: ['영어팀'] }], classroomCatalogs: [], scienceSubjectAreas: [] } };
      } else if (url.pathname.endsWith('/list_management_class_textbook_candidates_v1')) {
        data = [];
      } else if (url.pathname.endsWith('/get_class_schedule_defaults_v1')) {
        data = { runtimeVersion: 0 };
      } else if (url.pathname.endsWith('/profiles')) data = { id: user.id, role: 'admin', name: '합성 관리자', email: user.email };
      else if (url.pathname.endsWith('/user')) data = user;
      else data = resolveFixtureRequest(url.pathname, args, 'A');
      if (data === undefined || (!['GET', 'HEAD'].includes(req.method()) && !url.pathname.includes('/rpc/'))) {
        report.unhandled.push(`${req.method()} ${url.pathname}`); return route.abort();
      }
      return route.fulfill({ json: data }).catch(() => {}); // A closed form may cancel its in-flight read.
    }
    if (url.origin !== base || !['GET', 'HEAD'].includes(req.method())) { report.unhandled.push(`${req.method()} ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept()); page.on('pageerror', e => report.errors.push(e.message));
  const dialog = page.getByRole('dialog');
  async function open() {
    await page.goto(base + '/admin/classes');
    await page.getByRole('button', { name: '수업 등록', exact: true }).click({ timeout: 60000 });
  }
  async function pick(label, value) {
    await dialog.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: value, exact: true }).click();
  }
  async function options(label) {
    await dialog.getByRole('combobox', { name: label, exact: true }).click();
    const values = await page.getByRole('option').allTextContents(); await page.keyboard.press('Escape'); return values;
  }
  async function ready() { await dialog.getByRole('combobox', { name: '선생님', exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('#classes-form-teacher')?.disabled); }
  try {
    await open();
    if (process.env.QA_BASELINE) {
      report.english = await options('선생님');
      await pick('과목', '과학');
      report.scienceTeacherTag = await page.locator('#classes-form-teacher').evaluate(el => el.tagName);
      report.scienceRoomTag = await page.locator('#classes-form-classroom').evaluate(el => el.tagName);
      assert.equal(report.scienceTeacherTag, 'INPUT'); assert.equal(report.scienceRoomTag, 'INPUT');
      await page.screenshot({ path: `${out}/baseline-${width}.png` });
      report.passed = true;
    } else {
      await ready();
      report.options = {};
      for (const subject of ['영어', '수학', '과학', '영어']) {
        await pick('과목', subject);
        const teacher = await options('선생님'), classroom = await options('강의실');
        report.options[subject] = { teacher, classroom };
        assert.ok(teacher.includes(`${subject} 미배정 교사`));
        assert.ok(!teacher.includes('이전 교사') && !teacher.includes('숨김 교사'));
        assert.ok(!classroom.includes('이전 강의실') && !classroom.includes('숨김 강의실'));
        if (subject === '과학') {
          assert.deepEqual(teacher, ['선택 안 함', '과학 미배정 교사']);
          assert.deepEqual(classroom, ['선택 안 함', '과학 미배정실']);
        }
      }
      assert.ok(report.options.영어.classroom.indexOf('영어 2실') < report.options.영어.classroom.indexOf('영어 10실'));
      await pick('선생님', '영어 미배정 교사'); await pick('강의실', '영어 2실');
      await pick('과목', '수학');
      assert.equal(await page.locator('#classes-form-teacher').innerText(), '선택 안 함');
      await pick('선생님', '수학 미배정 교사');
      await page.locator('#classes-form-name').fill('수동 입력 유지');
      assert.match(await page.locator('#classes-form-teacher').innerText(), /수학 미배정 교사/);
      await pick('과목', '과학'); await pick('선생님', '과학 미배정 교사'); await pick('강의실', '과학 미배정실');
      await options('선생님');
      await page.screenshot({ path: `${out}/science-${width}.png` });
      report.checks.push('subject transitions; active without classes; inactive excluded; exact science membership; natural room order; manual selection');

      mode = 'error'; await open();
      await dialog.getByRole('button', { name: '다시 시도', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: '등록 저장', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('#classes-form-teacher').getAttribute('role'), 'combobox');
      await page.locator('#classes-form-name').fill('재시도 후에도 보존');
      await page.screenshot({ path: `${out}/error-${width}.png` });
      mode = 'normal'; await dialog.getByRole('button', { name: '다시 시도', exact: true }).click(); await ready();
      assert.equal(await page.locator('#classes-form-name').inputValue(), '재시도 후에도 보존');
      report.checks.push('failure blocks save; explicit retry preserves draft');

      mode = 'empty'; await open();
      await dialog.getByText('이 과목에 선택 가능한 교사가 없습니다.', { exact: true }).waitFor();
      await pick('과목', '과학');
      await dialog.getByText('이 과목에 선택 가능한 교사가 없습니다.', { exact: true }).waitFor();
      assert.equal(await page.locator('#classes-form-teacher').getAttribute('role'), 'combobox');
      assert.equal(await page.locator('#classes-form-teacher').isDisabled(), true);
      assert.equal(await dialog.getByRole('button', { name: '등록 저장', exact: true }).isDisabled(), true);
      await page.screenshot({ path: `${out}/empty-${width}.png` });
      report.checks.push('successful empty remains disabled select, with empty-state text');

      mode = 'delayed'; await open();
      await dialog.getByText('교사·강의실 목록을 불러오는 중입니다.', { exact: true }).waitFor();
      assert.equal(await page.locator('#classes-form-teacher').isDisabled(), true);
      assert.equal(await dialog.getByRole('button', { name: '등록 저장', exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole('combobox', { name: '과목', exact: true }).isDisabled(), true);
      mode = 'normal'; releaseCatalog(); await ready();
      await pick('과목', '수학'); await pick('과목', '과학');
      assert.deepEqual(await options('선생님'), ['선택 안 함', '과학 미배정 교사']);
      report.checks.push('loading blocks premature subject changes; ready catalog uses latest subject');

      mode = 'delayed';
      await page.goto(base + '/admin/classes?classId=' + classRow.id);
      await page.locator('#class-schedule-slot-0-teacher').waitFor({ timeout: 30000 });
      await dialog.getByText('교사·강의실 목록을 불러오는 중입니다.', { exact: true }).waitFor();
      assert.equal(await page.locator('#classes-detail-subject').isDisabled(), true);
      assert.equal(await page.locator('#class-detail-schedule-section').locator('button,input').evaluateAll(els => els.every(el => el.disabled)), true);
      mode = 'normal'; releaseCatalog();
      await page.waitForFunction(() => !document.querySelector('#class-schedule-slot-0-teacher')?.disabled);
      assert.match(await page.locator('#class-schedule-slot-0-teacher').innerText(), /이전 교사/);
      assert.match(await page.locator('#class-schedule-slot-0-classroom').innerText(), /이전 강의실/);
      const editTeachers = await options('선생님');
      assert.ok(editTeachers.includes('영어 미배정 교사'));
      assert.ok(!editTeachers.includes('오래된 상세 후보'));
      await pick('선생님', '영어 미배정 교사');
      assert.match(await page.locator('#class-schedule-slot-0-teacher').innerText(), /영어 미배정 교사/);
      report.checks.push('legacy edit selection preserved; stale detail catalog cannot overwrite authoritative candidates');
      if (process.env.QA_AUTH_DEADLINE === '1') {
        await page.goto(base + '/admin/classes');
        await page.getByRole('button', { name: '수업 등록', exact: true }).waitFor();
        await page.waitForFunction(() => document.body.innerText.includes('합성 기존반'));
        mode = 'auth-blocked';
        await page.evaluate(() => {
          const key = 'sb-tips-internal-fixture-auth-token';
          const session = JSON.parse(localStorage.getItem(key));
          session.expires_at = 1;
          localStorage.setItem(key, JSON.stringify(session));
        });
        const initialReads = report.reads.length, initialRefreshes = authRefreshes;
        const started = Date.now();
        await page.getByRole('button', { name: '수업 등록', exact: true }).click();
        await page.locator('#classes-form-name').fill('인증 지연 중 초안');
        await dialog.getByRole('button', { name: '다시 시도', exact: true }).waitFor({ timeout: 12000 });
        const elapsedMs = Date.now() - started;
        assert.ok(elapsedMs < 10000, `recovery exceeded the eight-second budget plus UI tolerance: ${elapsedMs}`);
        assert.equal(authRefreshes - initialRefreshes, 1, 'one shared refresh while catalogs wait for authentication');
        assert.equal(report.reads.length, initialReads, 'no catalog HTTP request before auth completes');
        assert.equal(await dialog.getByRole('button', { name: '등록 저장', exact: true }).isDisabled(), true);
        await page.screenshot({ path: `${out}/auth-timeout-${width}.png` });
        mode = 'normal'; releaseAuth();
        await page.waitForTimeout(250);
        assert.equal(report.reads.length, initialReads, 'expired reads stay cancelled after late auth completion');
        await dialog.getByRole('button', { name: '다시 시도', exact: true }).click();
        await ready();
        assert.equal(await page.locator('#classes-form-name').inputValue(), '인증 지연 중 초안');
        await pick('선생님', '영어 미배정 교사');
        await page.waitForTimeout(100);
        assert.match(await page.locator('#classes-form-teacher').innerText(), /영어 미배정 교사/);
        assert.equal(report.reads.length - initialReads, 2, 'only the explicitly retried teacher/room pair reaches HTTP');
        report.authDeadline = { elapsedMs, refreshes: authRefreshes - initialRefreshes, catalogReads: report.reads.length - initialReads };
        report.checks.push('real SDK refresh blocked before REST; error within read budget (SDK lock errors may settle sooner); late auth cannot dispatch expired reads; manual retry preserves draft and selection');
        await page.screenshot({ path: `${out}/auth-recovered-${width}.png` });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      report.passed = true;
    }
  } catch (error) {
    report.error = error.stack; await page.screenshot({ path: `${out}/failure-${width}.png` });
    await fs.writeFile(`${out}/failure-${width}.txt`, await page.locator('body').innerText());
  }
  reports.push(report); console.log(width, report.passed ? 'PASS' : report.error); await context.close();
}
await browser.close(); await fs.writeFile(`${out}/results.json`, JSON.stringify(reports, null, 2));
assert.ok(reports.every(r => r.passed && !r.unhandled.length && !r.errors.length), JSON.stringify(reports));
