// Deterministic late-listener and HTTP negative-cache reproduction; no external traffic.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { bootstrapRecoveryScript } from '../../src/lib/bootstrap-recovery.ts';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url)('playwright');
const out = process.env.QA_OUTPUT || 'output/playwright/bootstrap-cache';
await fs.mkdir(out, { recursive: true });
let missingRequests = 0;
const server = createServer((req, res) => {
  if (req.url === '/_next/static/missing.js') {
    missingRequests++;
    res.writeHead(404, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
    return res.end('/* synthetic cached 404 */');
  }
  if (req.url === '/slow.css') {
    // Reproduce the actual Next head order: blocking CSS, async script, then inline.
    res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' });
    return setTimeout(() => res.end('body{margin:0;font-family:system-ui}'), 500);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="ko"><head><link rel="stylesheet" href="/slow.css"><script async src="/_next/static/missing.js"></script><script>${bootstrapRecoveryScript}</script></head><body><label>합성 초안 <input id="draft" value="미저장 값"></label></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { missingRequests: 0, responses: [], pages: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const width of [1440, 390]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', ({ response }) => {
      if (response.url.endsWith('/_next/static/missing.js')) report.responses.push({ status: response.status, fromDiskCache: !!response.fromDiskCache });
    });
    await page.goto(`${base}/admin/registration?taskPage=2#draft`);
    await page.getByRole('alert').waitFor();
    const entries = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.endsWith('/_next/static/missing.js')).map(e => ({ initiatorType: e.initiatorType, responseStatus: e.responseStatus, transferSize: e.transferSize })));
    assert.equal(entries[0].responseStatus, 404);
    assert.equal(await page.locator('#draft').inputValue(), '미저장 값');
    await page.screenshot({ path: `${out}/cached-${width}.png` });
    await page.locator('#draft').fill('수정한 합성 초안');
    await page.locator('#draft').focus();
    await page.evaluate(() => {
      const script = document.querySelector('script[src]');
      script.dispatchEvent(new Event('error'));
    });
    assert.equal(await page.getByRole('alert').count(), 1);
    assert.equal(await page.locator('#draft').inputValue(), '수정한 합성 초안');
    assert.equal(await page.locator('#draft').evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: '오류 안내 닫기' }).click();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.locator('#draft').inputValue(), '수정한 합성 초안');
    report.pages.push({ width, entries, noticeVisible: true, draftPreserved: true, dismissWorks: true });
    await page.close();
  }
  report.missingRequests = missingRequests;
  assert.equal(missingRequests, 1, 'second load must use the browser negative cache');
  assert.ok(report.responses.some(r => r.status === 404 && r.fromDiskCache), 'actual browser disk-cache 404 observed');
} finally {
  await fs.writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify(report, null, 2));
