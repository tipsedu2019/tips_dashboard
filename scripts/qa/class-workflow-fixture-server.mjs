// Local-only transport for the actual Next UI. No upstream API or write is forwarded.
// Run Next on 3221 with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3222,
// NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only, then open http://127.0.0.1:3220/__fixture.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { FIXED_NOW, numberedPage, resolveFixtureRequest, studentsFor } from '../../tests/fixtures/premium-dashboard.mjs';

const user = { id: '00000000-0000-4000-8000-000000000099', email: 'fixture@example.invalid', user_metadata: { name: '합성 관리자' }, app_metadata: {}, aud: 'authenticated', created_at: FIXED_NOW };
const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.fixture';
const session = { access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user };
const students = studentsFor('D');
const createRecords = () => Array.from({ length: 24 }, (_, i) => ({ kind: 'classes', id: `00000000-0000-4000-8000-${String(i + 201).padStart(12, '0')}`, name: i === 0 ? '합성긴수업명'.repeat(10) : `합성 수업 ${String(i + 1).padStart(2, '0')}`, sortKey: String(i).padStart(2, '0'), status: '수강', subject: '영어', grade: '중3', teacher: '월담당, 수담당', teacherName: '월담당, 수담당', classroom: '본관 1강, 별관 2강', schedule: '월 19:30-21:30 (월담당, 본관 1강)\n수 18:00-20:00 (수담당, 별관 2강)', capacity: 20, fee: 100000, weeklyMinutes: 240, studentCount: 10, waitlistCount: 2, updatedAt: FIXED_NOW }));
let records = createRecords();
const log = [];
let saveAttempts = 0;
let mode = 'normal';
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:3220', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }); res.end(JSON.stringify(data)); };
export async function api(req, res) {
  if (req.method === 'OPTIONS') return json(res, {});
  const url = new URL(req.url, 'http://127.0.0.1');
  let body = ''; for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  log.push({ method: req.method, path: url.pathname, args });
  const path = url.pathname;
  if (path === '/__control') { mode = args.mode || 'normal'; saveAttempts = 0; records = createRecords(); return json(res, { mode }); }
  if (path === '/__evidence') return json(res, { mode, saveAttempts, log });
  if (path.endsWith('/user')) return json(res, user);
  if (path.endsWith('/profiles')) return json(res, { ...user, role: mode === 'viewer' ? 'viewer' : 'admin', name: '합성 관리자' });
  if (mode === 'loading' && /list_management_numbered_page_v1/.test(path)) await new Promise(resolve => setTimeout(resolve, 2500));
  if (path.endsWith('/list_management_numbered_page_v1')) {
    if (mode === 'read-error') return json(res, { code: 'fixture_read_error', message: '합성 조회 실패' }, 500);
    const rows = args.p_kind === 'students' ? students : records;
    const query = args.p_filters?.search || '';
    let matched = mode === 'empty' ? [] : rows.filter(row => row.name.includes(query));
    if (args.p_sort?.[0]?.desc) matched = [...matched].reverse();
    return json(res, numberedPage(matched, args));
  }
  if (path.endsWith('/get_management_detail_v1')) {
    if (args.p_kind === 'students') return json(res, { kind: 'students', record: students.find(row => row.id === args.p_id), enrollments: { rows: [], hasMore: false, nextCursor: null }, textbooks: [] });
    return json(res, { kind: 'classes', record: records.find(row => row.id === args.p_id), registeredStudents: { rows: students.slice(0, mode === 'partial' ? 2 : 10), hasMore: mode === 'partial', nextCursor: mode === 'partial' ? { sortValue: students[1].name, id: students[1].id } : null }, waitlistedStudents: { rows: students.slice(10, 12), hasMore: false, nextCursor: null }, textbooks: [], groups: [], schedule: { plan: null, slots: [] }, formReferences: { teacherCatalogs: [], classroomCatalogs: [], scienceSubjectAreas: [] } });
  }
  if (path.endsWith('/list_management_detail_relation_page_v1')) return json(res, { page: { rows: students.slice(2, 10), hasMore: false, nextCursor: null } });
  if (path.endsWith('/students') && req.method === 'GET') {
    const query = (url.searchParams.get('name') || '').replace(/^ilike\.[*%]/, '').replace(/[*%]$/, '');
    return json(res, students.slice(12).filter(row => row.name.includes(query)));
  }
  if (path.endsWith('/list_management_relation_picker_v1')) return json(res, students.slice(12));
  if (path.endsWith('/list_management_class_textbook_candidates_v1')) return json(res, []);
  if (path.endsWith('/registration_runtime_version')) return json(res, 1);
  if (path.endsWith('/classes') && req.method === 'POST') {
    saveAttempts += 1;
    await new Promise(resolve => setTimeout(resolve, 800));
    if (mode === 'save-error' && saveAttempts === 1) return json(res, { code: 'fixture_save_error', message: '저장하지 못했습니다. 다시 시도해 주세요.' }, 500);
    const patch = Array.isArray(args) ? args[0] : args;
    const record = records.find(row => row.id === patch.id);
    if (!record) return json(res, { message: 'Unknown fixture class' }, 400);
    Object.assign(record, patch);
    return json(res, [record]);
  }
  if (path === '/api/public-classes/cache/invalidate') return json(res, { ok: true });
  if (path.endsWith('/list_management_filter_options_v1')) return json(res, { subjects: ['영어'], grades: ['중3', '고1'], teachers: ['월담당', '수담당'], classrooms: ['본관 1강', '별관 2강'], schools: ['합성중고등학교'] });
  const data = resolveFixtureRequest(path, args, 'D');
  if (data !== undefined) return json(res, data);
  console.error('UNHANDLED', req.method, path);
  return json(res, { code: 'fixture_unhandled', message: `Undefined synthetic transport: ${path}` }, 501);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer((req, res) => { void api(req, res); }).listen(3222, '127.0.0.1');
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__fixture') {
      const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
      const target = url.searchParams.get('route') === 'students' ? '/admin/students' : '/admin/classes';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(theme)});location.replace(${JSON.stringify(target)})</script>`);
    }
    if (url.pathname.startsWith('/api/') || ['/__control', '/__evidence'].includes(url.pathname)) return void api(req, res);
    if (!['GET', 'HEAD'].includes(req.method) && url.pathname !== '/__nextjs_original-stack-frames') return json(res, { message: 'Unmocked writes blocked' }, 405);
    const proxy = http.request({ hostname: '127.0.0.1', port: 3221, path: req.url, method: req.method, headers: req.headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
    proxy.on('error', () => { res.writeHead(502); res.end('Start local Next on 3221'); }); req.pipe(proxy);
  }).listen(3220, '127.0.0.1', () => console.log('Synthetic UI: http://127.0.0.1:3220/__fixture'));
}
