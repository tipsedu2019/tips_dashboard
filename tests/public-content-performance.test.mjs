import assert from 'node:assert/strict';
import test from 'node:test';
import { createContentAdminHandlers } from '../src/features/public-content/server/content-routes.ts';
import { publicAsset } from '../src/features/public-content/server/content-store.ts';
const env = { PUBLIC_CONTENT_MANAGEMENT_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' };
const path = (n, ext = 'webp') => `teachers/a0000000-0000-4000-8000-${String(n).padStart(12, '0')}.${ext}`;
const entries = Array.from({ length: 20 }, (_, n) => ({ id: String(n), kind: 'teacher', data: { portraitUrl: `storage:${path(n)}`, videoUrl: `storage:${path(n, 'mp4')}` }, sort_order: n, is_published: false, version: 1 }));
function fixture(t, { published = true, failBatch = false } = {}) {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'a0000000-0000-4000-8000-000000000001' });
    if (url.pathname === '/rest/v1/rpc/current_dashboard_role') return Response.json('admin');
    if (url.pathname === '/rest/v1/public_site_entries') return Response.json(url.searchParams.has('is_published') ? published ? [{ id: 'published' }] : [] : entries, { headers: { 'Content-Range': '0-19/20' } });
    if (url.pathname === '/storage/v1/object/sign/public-site-media') {
      if (failBatch) return Response.json({ message: 'storage unavailable' }, { status: 503 });
      const { paths, expiresIn } = JSON.parse(init.body); assert.equal(expiresIn, 600);
      return Response.json(paths.map((path, i) => ({ path, signedURL: i === 1 ? null : `/object/sign/${path}?token=fixture`, error: i === 1 ? 'not found' : null })));
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/public-site-media/')) return Response.json({ signedURL: '/object/sign/fixture?token=fixture' });
    throw Error(`unexpected ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = previous; });
  return calls;
}
test('20 teacher media previews use one deduplicated signing batch with per-file failures', async t => {
  const calls = fixture(t);
  entries[19].data.portraitUrl = entries[0].data.portraitUrl;
  entries[19].data.videoUrl = '/assets/landing/v14/teachers/02/frame-000.webp';
  const response = await createContentAdminHandlers({ env }).entries(new Request('https://fixture.invalid/api/admin/public-content?kind=teacher&pageSize=20', { headers: { authorization: 'Bearer fixture' } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  const signs = calls.filter(c => c.url.pathname.includes('/object/sign/'));
  assert.equal(signs.length, 1);
  assert.equal(signs[0].body.paths.length, 38);
  assert.equal(result.entries[0].previewUrls.videoUrl, '');
  assert.ok(result.entries[0].previewUrls.portraitUrl.startsWith('https://fixture.invalid/storage/v1/'));
  assert.equal(result.entries[19].previewUrls.portraitUrl, result.entries[0].previewUrls.portraitUrl);
  assert.ok(result.entries[19].previewUrls.videoUrl.startsWith('https://tipsedu.co.kr/assets/'));
});
test('batch failure preserves list and local assets without retry fanout', async t => {
  const calls = fixture(t, { failBatch: true });
  const response = await createContentAdminHandlers({ env }).entries(new Request('https://fixture.invalid/api/admin/public-content?kind=teacher', { headers: { authorization: 'Bearer fixture' } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.entries[0].previewUrls.portraitUrl, '');
  assert.equal(calls.filter(c => c.url.pathname.includes('/object/sign/')).length, 1);
});
test('public media checks one exact published reference without downloading teacher content', async t => {
  const calls = fixture(t);
  await publicAsset(env, path(1));
  const query = calls.find(c => c.url.pathname === '/rest/v1/public_site_entries').url.searchParams;
  assert.equal(query.get('select'), 'id');
  assert.equal(query.get('limit'), '1');
  assert.equal(query.get('kind'), 'eq.teacher');
  assert.equal(query.get('is_published'), 'eq.true');
  assert.equal(query.get('or'), `(data->>portraitUrl.eq.storage:${path(1)},data->>videoUrl.eq.storage:${path(1)})`);
});
test('unpublished media and invalid paths never reach service-role signing', async t => {
  const calls = fixture(t, { published: false });
  await assert.rejects(publicAsset(env, path(2)), /not_found/);
  await assert.rejects(publicAsset(env, 'teachers/x,kind.eq.review'), /not_found/);
  assert.equal(calls.filter(c => c.url.pathname.includes('/object/sign/')).length, 0);
  assert.equal(calls.length, 1);
});
