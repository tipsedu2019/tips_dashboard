import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';

globalThis.fetch = async () => { throw new Error('external network forbidden by independent audit'); };
const teacher = n => ({ user: { id: id(n), email: 'synthetic-teacher@test.invalid' }, role: 'teacher', isTeacher: true, isAdmin: false, isStaff: false, canManageAll: false });
const row = (n, bookTitle = `합성 교재 ${n}`) => ({ id: n.toString(16).padStart(32,'0'), anchorLineId: id(n), bookTitle, className: `합성 수업 ${n}`, requesterLabel: '합성 신청자', requestedAt: '2026-10-23T09:00:00+09:00', studentQuantity: 2, teacherQuantity: 1 });
const calls = h => h.requests.filter(r => r.name === 'read_operational_common_v1');
function request(h, index = -1) { const r = calls(h).at(index); assert.ok(r, `common request ${index} exists`); return r; }
function envelope(r, rows, totalCount = rows.length) { return { rows, page: r.args.p_args.p_page, pageSize: r.args.p_args.p_page_size, totalCount }; }
async function change(h, value) {
  const input = document.querySelector('input[aria-label="교재요청 검색"]'); assert.ok(input);
  const props = input[Object.keys(input).find(k => k.startsWith('__reactProps$'))];
  await h.act(() => props.onChange({ target: { value } }));
}
function onlySafeTransport(h) {
  assert.deepEqual(h.requests.filter(r => r.table), [], 'no raw table reads or writes');
  assert.ok(h.requests.every(r => r.name === 'read_operational_common_v1'), 'only common read RPC');
  assert.ok(h.requests.every(r => r.args.p_operation === 'book_page' && r.retry === false), 'only book_page and no automatic retries');
}
async function mount(t) { return setup(t, { mode: 'requests', auth: teacher(1804) }); }

test('teacher request initial read failure exposes unknown counts instead of a successful zero result', async t => {
  const h = await mount(t);
  await h.reject(request(h), { code: 'XX000', message: 'SYNTHETIC_PRIVATE_FAILURE' });
  assert.match(document.body.textContent, /건수 미확인/);
  assert.doesNotMatch(document.body.textContent, /전체 0건|0건 · 0–0번째|교재요청 없음|등록된 교재요청이 없습니다/);
  assert.equal(button('다음 페이지').disabled, true);
  assert.equal(button('1 페이지'), undefined, 'unknown count has no fabricated first-page result');
  onlySafeTransport(h);
});

test('teacher request successful initial empty and searched empty have distinct guidance', async t => {
  const h = await mount(t); const first = request(h);
  await h.resolve(first, envelope(first, []));
  assert.match(document.body.textContent, /등록된 교재요청이 없습니다/);
  assert.match(document.body.textContent, /전체 0건/);
  await change(h, '가상 결과 없음'); const searched = request(h);
  await h.resolve(searched, envelope(searched, []));
  assert.match(document.body.textContent, /검색 조건에 맞는 교재요청이 없습니다/);
  assert.doesNotMatch(document.body.textContent, /등록된 교재요청이 없습니다/);
  assert.equal(document.querySelector('input[aria-label="교재요청 검색"]').value, '가상 결과 없음');
  assert.ok(button('교재요청 검색 초기화'));
  await h.act(() => button('교재요청 검색 초기화').click());
  assert.deepEqual(request(h).args.p_args, { p_search: '', p_page: 1, p_page_size: 15 });
  assert.ok(document.activeElement === document.querySelector('input[aria-label="교재요청 검색"]'));
  onlySafeTransport(h);
});

test('teacher request read recovery keeps the creation owner, draft guard and return trigger mounted', async t => {
  const h = await mount(t); const first = request(h);
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 32, height: 32 }]; };
  await h.resolve(first, envelope(first, [row(991, '가상 기존 요청')]));
  const input = document.querySelector('input[aria-label="교재요청 검색"]');
  const create = button('요청 추가');
  await change(h, '가상 실패 검색');
  await h.reject(request(h), { code: 'XX000', message: 'SYNTHETIC_PRIVATE_READ' });
  assert.equal(document.body.textContent.includes('가상 기존 요청'), false, 'ordinary failure retains the existing accepted-result discard policy');
  assert.ok(button('요청 추가') === create);
  const retry = button('교재요청 다시 조회');
  assert.ok(retry.closest('[data-slot="data-table-command-row"]'));
  await h.act(() => retry.click()); const pending = request(h);
  assert.ok(document.activeElement === input);
  await h.act(() => { create.focus(); create.click(); });
  const form = document.querySelector('form');
  const title = document.querySelector('[aria-label="요청 교재명"]');
  await h.act(() => title[Object.keys(title).find(key => key.startsWith('__reactProps$'))].onChange({ target: { value: '전송하지 않는 가상 초안' } }));
  await h.reject(pending, { code: 'XX000', message: 'SYNTHETIC_LATE_READ' });
  assert.ok(document.querySelector('form') === form, 'late read feedback cannot remount the form owner');
  assert.equal(title.value, '전송하지 않는 가상 초안');
  assert.ok(button('요청 추가') === create);
  await h.act(() => button('취소').click());
  assert.ok(document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'));
  await h.act(() => button('계속 편집').click());
  await h.act(() => new Promise(resolve => setTimeout(resolve, 25)));
  assert.equal(title.value, '전송하지 않는 가상 초안');
  await h.act(() => button('취소').click());
  await h.act(() => button('변경사항 버리기').click());
  await h.act(() => new Promise(resolve => setTimeout(resolve, 25)));
  assert.equal(document.querySelector('form'), null);
  assert.ok(document.activeElement === create, 'the stable create button receives close focus after list failure');
  await h.act(() => button('교재요청 다시 조회').click());
  const final = request(h);
  assert.equal(final.args.p_args.p_search, '가상 실패 검색');
  await h.resolve(final, envelope(final, [row(992, '가상 복구 결과')]));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok(document.querySelector('input[aria-label="교재요청 검색"]') === input);
  assert.ok(button('요청 추가') === create);
  onlySafeTransport(h);
});

test('teacher actual caller renders only common read rows and local read-only detail without extra RPC', async t => {
  const h = await mount(t); const first = request(h);
  assert.deepEqual(first.args, { p_operation:'book_page', p_args:{p_search:'',p_page:1,p_page_size:15} });
  const title = '<img src=x onerror=alert(1)> 한글 📘';
  await h.resolve(first, envelope(first, [row(101, title)]));
  assert.equal(document.querySelector('form'), null);
  assert.ok(button('요청 추가'), 'the explicitly approved new-request exception is available');
  assert.equal([...document.querySelectorAll('button')].some(b => /요청 수정|삭제|처리|주문서/.test(b.textContent)), false);
  const before = h.requests.length;
  await h.act(() => button(title).click());
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.match(document.querySelector('[role="dialog"]').textContent, /합성 수업 101/);
  assert.equal(document.querySelector('img'), null, 'untrusted text remains React text');
  assert.equal(h.requests.length, before, 'detail uses accepted common row only');
  assert.equal(document.querySelector('textarea'), null);
  onlySafeTransport(h);
});

test('page two and search use bounded page arguments, and search resets to page one', async t => {
  const h = await mount(t); const first = request(h);
  await h.resolve(first, envelope(first, Array.from({length:15},(_,i)=>row(i+1)),16));
  await h.act(() => button('다음 페이지').click());
  const second = request(h); assert.equal(second.args.p_args.p_page,2);
  await h.resolve(second,envelope(second,[row(16)],16));
  await change(h,'국어'); const searched=request(h);
  assert.deepEqual(searched.args.p_args,{p_search:'국어',p_page:1,p_page_size:15});
  await h.resolve(searched,envelope(searched,[]));
  assert.match(document.body.textContent,/검색 조건에 맞는 교재요청이 없습니다/);
  onlySafeTransport(h);
});

test('late success and late error cannot replace a newer accepted search result', async t => {
  const h=await mount(t); const original=request(h);
  await change(h,'이전'); const old=request(h);
  await change(h,'최신'); const fresh=request(h);
  assert.equal(original.signal.aborted,true); assert.equal(old.signal.aborted,true);
  await h.resolve(fresh,envelope(fresh,[row(203,'최신 결과')]));
  await h.resolve(original,envelope(original,[row(201,'STALE_ORIGINAL_CANARY')]));
  await h.reject(old,{code:'42501',message:'STALE_ERROR_CANARY'});
  assert.match(document.body.textContent,/최신 결과/);
  assert.equal(/STALE_|불러오지 못했습니다/.test(document.body.textContent),false);
  onlySafeTransport(h);
});

test('read failure clears prior rows/detail, shows safe error, and retries only after user action', async t => {
  const h=await mount(t); const first=request(h);
  await h.resolve(first,envelope(first,[row(301,'기존 선택 결과')]));
  await h.act(()=>button('기존 선택 결과').click());
  await change(h,'실패검색'); const failed=request(h);
  await h.reject(failed,{code:'42501',message:'PRIVATE_SERVER_ERROR_CANARY'});
  assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(document.body.textContent.includes('기존 선택 결과'),false);
  assert.match(document.querySelector('[role="alert"]').textContent,/교재요청 조회 권한 또는 로그인 상태를 확인해 주세요/);
  assert.equal(document.body.textContent.includes('PRIVATE_SERVER_ERROR_CANARY'),false);
  const before=calls(h).length; await h.act(()=>Promise.resolve()); assert.equal(calls(h).length,before);
  await h.act(()=>button('교재요청 다시 조회').click()); const retry=request(h);
  assert.equal(calls(h).length,before+1); assert.deepEqual(retry.args,failed.args);
  await h.resolve(retry,envelope(retry,[row(302,'복구 결과')]));
  assert.match(document.body.textContent,/복구 결과/); assert.equal(document.querySelector('[role="alert"]'),null);
  onlySafeTransport(h);
});

test('same-role user change remounts actual caller and rejects old detail and late response', async t => {
  const h=await mount(t); const first=request(h);
  await h.resolve(first,envelope(first,[row(401,'이전 사용자 선택')]));
  await h.act(()=>button('이전 사용자 선택').click());
  await change(h,'이전 사용자 대기'); const old=request(h);
  await h.auth(teacher(1805)); const fresh=request(h);
  assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(document.body.textContent.includes('이전 사용자 선택'),false);
  assert.equal(old.signal.aborted,true);
  await h.resolve(old,envelope(old,[row(402,'FORMER_USER_CANARY')]));
  await h.resolve(fresh,envelope(fresh,[row(403,'새 사용자 결과')]));
  assert.match(document.body.textContent,/새 사용자 결과/); assert.equal(document.body.textContent.includes('FORMER_USER_CANARY'),false);
  onlySafeTransport(h);
});

test('logout removes common rows/dialog and cannot accept a former request completion', async t => {
  const h=await mount(t); const old=request(h);
  await h.auth({user:null,role:null,loading:false,isTeacher:false,isAdmin:false,isStaff:false,canManageAll:false});
  assert.equal(old.signal.aborted,true);
  await h.resolve(old,envelope(old,[row(501,'LOGGED_OUT_CANARY')]));
  assert.equal(document.body.textContent.includes('LOGGED_OUT_CANARY'),false);
  assert.equal(document.querySelector('input[aria-label="교재요청 검색"]'),null);
  onlySafeTransport(h);
});

for(const malformed of ['extra-private-field','duplicate-identity'])test(`unsafe common DTO is rejected: ${malformed}`,async t=>{
  const h=await mount(t);const r=request(h);
  const rows=malformed==='extra-private-field'?[{...row(601),memo:'PRIVATE_MEMO_CANARY'}]:[row(601),row(601)];
  await h.resolve(r,envelope(r,rows));
  assert.match(document.body.textContent,/교재요청을 불러오지 못했습니다/);
  assert.equal(document.body.textContent.includes('PRIVATE_MEMO_CANARY'),false);
  assert.equal(document.querySelector('[role="dialog"]'),null);
  onlySafeTransport(h);
});

test('a shrinking page-two result recovers page one automatically or through its visible control',async t=>{
  const h=await mount(t);const first=request(h);
  await h.resolve(first,envelope(first,Array.from({length:15},(_,i)=>row(701+i)),16));
  await h.act(()=>button('다음 페이지').click());const second=request(h);
  assert.equal(second.args.p_args.p_page,2);
  const count=calls(h).length;
  await h.resolve(second,envelope(second,[],1));
  if(request(h).args.p_args.p_page!==1)await h.act(()=>button('1 페이지').click());
  assert.equal(calls(h).length,count+1,'page-one recovery must issue exactly one read automatically or through its visible control');
  assert.equal(request(h).args.p_args.p_page,1);
  onlySafeTransport(h);
});
