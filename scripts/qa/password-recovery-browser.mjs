// Synthetic credentials and intercepted auth only; no email, real account, or provider request.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3213'
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const out = process.env.QA_OUTPUT || 'output/playwright/password-recovery'
await fs.mkdir(out, { recursive: true })
const user = id => ({ id, aud: 'authenticated', email: `${id}@example.invalid`, role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' })
const makeSession = id => {
  const payload = { sub: id, exp: 2000000000, iat: 1700000000, session_id: `synthetic-${id}`, role: 'authenticated' }
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url'), Buffer.from('synthetic-signature').toString('base64url')].join('.')
  return { access_token: token, refresh_token: `synthetic-refresh-${id}`, expires_in: 3600, expires_at: 2000000000, token_type: 'bearer', user: user(id) }
}
const recovery = makeSession('recovery-user'), normal = makeSession('normal-user')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
try {
 for (const width of [1440, 390]) {
  for (const scenario of ['missing', 'expired', 'invalid-token', 'otp-reused', 'otp-valid', 'implicit-refresh-submit', 'network', 'normal-login-preserved']) {
   const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block' })
   const counters = { otp: 0, update: 0, signout: 0, normalSignout: 0, blocked: 0 }
   const errors = []
   if (scenario === 'normal-login-preserved') {
    await context.addInitScript(value => localStorage.setItem('sb-recovery-auth-token', JSON.stringify(value)), normal)
   }
   await context.routeWebSocket(/.*/, socket => socket.close())
   await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === base && ['GET', 'HEAD'].includes(req.method())) return route.continue()
    if (url.origin !== 'https://recovery.test.invalid') { counters.blocked++; return route.abort() }
    const isNormal = req.headers().authorization === `Bearer ${normal.access_token}`
    if (url.pathname === '/auth/v1/verify') {
     counters.otp++
     assert.equal(req.postDataJSON().type, 'recovery')
     if (scenario === 'otp-reused') return route.fulfill({ status: 403, json: { error_code: 'otp_expired', msg: 'synthetic expired' } })
     if (scenario === 'network') return route.fulfill({ status: 503, json: { message: 'synthetic unavailable' } })
     return route.fulfill({ json: recovery })
    }
    if (url.pathname === '/auth/v1/user') {
     if (req.method() === 'PUT') {
      counters.update++
      assert.equal(isNormal, false, 'the dashboard login must never update')
      assert.equal(req.postDataJSON().password, 'Synthetic-password-123!')
      await new Promise(resolve => setTimeout(resolve, 200))
     }
     if (scenario === 'invalid-token') return route.fulfill({ status: 401, json: { error_code: 'bad_jwt', msg: 'synthetic bad token' } })
     return route.fulfill({ json: isNormal ? normal.user : recovery.user })
    }
    if (url.pathname === '/auth/v1/logout') {
     counters.signout++
     if (isNormal) counters.normalSignout++
     assert.equal(url.searchParams.get('scope'), 'local')
     return route.fulfill({ status: 204, body: '' })
    }
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: { id: normal.user.id, role: 'admin', name: '합성 사용자', email: normal.user.email } })
    throw new Error(`Unexpected synthetic endpoint ${url.pathname}`)
   })
   const page = await context.newPage()
   page.on('pageerror', error => errors.push(error.message))
   let suffix = ''
   if (['implicit-refresh-submit', 'invalid-token', 'normal-login-preserved'].includes(scenario)) suffix = `#access_token=${recovery.access_token}&refresh_token=${recovery.refresh_token}&type=recovery`
   if (['otp-valid', 'otp-reused', 'network'].includes(scenario)) suffix = '?token_hash=synthetic-only&type=recovery&next=https://outside.invalid'
   if (scenario === 'expired') suffix = '#error=access_denied&error_code=otp_expired&error_description=UNTRUSTED-PROVIDER-TEXT'
   await page.goto(base + '/reset-password' + suffix)
   const ready = ['implicit-refresh-submit', 'normal-login-preserved', 'otp-valid'].includes(scenario)
   if (ready) {
    await page.getByLabel('새 비밀번호', { exact: true }).waitFor()
    if (scenario === 'implicit-refresh-submit') {
     await page.reload()
     await page.getByLabel('새 비밀번호', { exact: true }).waitFor()
    }
    await page.screenshot({ path: `${out}/${scenario}-ready-${width}.png` })
    await page.getByLabel('새 비밀번호', { exact: true }).fill('Synthetic-password-123!')
    await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('mismatch')
    await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click()
    assert.equal(counters.update, 0, 'mismatch never updates')
    await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('Synthetic-password-123!')
    // Dispatch two submissions in the same turn to exercise the synchronous lock.
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
    await page.getByRole('status').filter({ hasText: '비밀번호가 변경되었습니다' }).waitFor()
    assert.equal(counters.update, 1)
    assert.equal(counters.normalSignout, 0)
    assert.equal(await page.getByLabel('새 비밀번호', { exact: true }).count(), 0)
    if (scenario === 'otp-valid') assert.equal(counters.otp, 1)
    if (scenario === 'normal-login-preserved') {
     assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sb-recovery-auth-token'))), normal)
    }
    await page.screenshot({ path: `${out}/${scenario}-complete-${width}.png` })
    await page.reload()
    await page.getByRole('link', { name: '새 재설정 링크 요청' }).waitFor()
   } else {
    await page.getByRole('link', { name: '새 재설정 링크 요청' }).waitFor()
    assert.equal(await page.getByLabel('새 비밀번호', { exact: true }).count(), 0)
    assert.equal(counters.update, 0)
    const text = await page.locator('body').innerText()
    assert.equal(text.includes('UNTRUSTED-PROVIDER-TEXT'), false)
    if (scenario === 'network') assert.match(text, /연결 상태/)
   }
   assert.equal(page.url(), base + '/reset-password', 'credentials and redirect targets are removed')
   assert.equal(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer')
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
   await page.getByRole('link', { name: '로그인으로 돌아가기' }).focus()
   assert.equal(await page.getByRole('link', { name: '로그인으로 돌아가기' }).evaluate(el => el === document.activeElement), true)
   await page.screenshot({ path: `${out}/${scenario}-${width}.png` })
   assert.deepEqual(errors, [])
   assert.equal(counters.blocked, 0)
   results.push({ width, scenario, ...counters, passed: true })
   await context.close()
  }
 }
} finally {
 await browser.close()
 await fs.writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
}
console.log(JSON.stringify({ passed: results.length, scenarios: results }))
