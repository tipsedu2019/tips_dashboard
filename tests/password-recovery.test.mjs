import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPasswordRecoveryFlow } from '../src/lib/password-recovery.ts'

const recoveryURL = () => new URL('https://app.invalid/reset-password#access_token=synthetic-access&refresh_token=synthetic-refresh&type=recovery')
function setup({ resumed = false, session = null, getUserError = null, updateError = null, otpError = null } = {}) {
  const calls = []
  let current = session, marker = resumed ? 'synthetic-user' : null
  const user = { id: 'synthetic-user' }
  const auth = {
    setSession: async value => { calls.push(['setSession', value]); current = { user }; return { error: null } },
    verifyOtp: async value => { calls.push(['verifyOtp', value]); if (!otpError) current = { user }; return { error: otpError } },
    getSession: async () => { calls.push(['getSession']); return { data: { session: current }, error: null } },
    getUser: async () => { calls.push(['getUser']); return { data: { user: current?.user ?? null }, error: getUserError } },
    updateUser: async value => { calls.push(['updateUser', value]); return { error: updateError } },
    signOut: async options => { calls.push(['signOut', options]); current = null; return { error: null } },
  }
  const storage = {
    clear: () => { calls.push(['clear']); current = null; marker = null },
    readUser: () => marker,
    rememberUser: id => { marker = id },
  }
  const flow = createPasswordRecoveryFlow(auth, storage)
  const initialize = (url = recoveryURL()) => flow.initialize(url, () => calls.push(['scrub']))
  return { flow, auth, calls, initialize, storage, get marker() { return marker } }
}

test('missing credentials reject a normal session and cannot update a password', async () => {
  const f = setup({ session: { user: { id: 'synthetic-user' } } })
  assert.equal(await f.initialize(new URL('https://app.invalid/reset-password')), 'invalid')
  assert.equal(await f.flow.submit('synthetic-password'), 'invalid')
  assert.equal(f.calls.some(([name]) => name === 'updateUser'), false)
})

test('valid implicit recovery is verified before enabling and uses local sign-out', async () => {
  const f = setup()
  assert.equal(await f.initialize(), 'ready')
  assert.equal(f.calls[0][0], 'scrub')
  assert.equal(f.marker, 'synthetic-user')
  assert.equal(await f.flow.submit('synthetic-password'), 'complete')
  assert.deepEqual(f.calls.find(([name]) => name === 'signOut'), ['signOut', { scope: 'local' }])
  assert.equal(f.marker, null)
  assert.equal(await f.flow.submit('synthetic-password'), 'complete')
  assert.equal(f.calls.filter(([name]) => name === 'updateUser').length, 1)
  assert.equal(await f.initialize(), 'complete')
})

test('strict-effect replay consumes a recovery OTP only once', async () => {
  const f = setup()
  const url = new URL('https://app.invalid/reset-password?token_hash=synthetic&type=recovery')
  assert.deepEqual(await Promise.all([f.initialize(url), f.initialize(url)]), ['ready', 'ready'])
  assert.deepEqual(f.calls.filter(([name]) => name === 'verifyOtp'), [['verifyOtp', { token_hash: 'synthetic', type: 'recovery' }]])
  assert.equal(f.calls.filter(([name]) => name === 'scrub').length, 1)
})

for (const suffix of [
  '#error=access_denied&error_code=otp_expired&error_description=UNTRUSTED',
  '?error=access_denied&error_code=otp_expired',
  '#access_token=synthetic&type=recovery',
  '#access_token=synthetic&refresh_token=synthetic&type=signup',
  '?token_hash=synthetic&type=invite', '?code=synthetic', '?token=synthetic&type=recovery',
]) {
  test(`invalid or non-recovery callback is rejected (${suffix.split('=')[0]})`, async () => {
    const f = setup({ resumed: true, session: { user: { id: 'synthetic-user' } } })
    assert.equal(await f.initialize(new URL('https://app.invalid/reset-password' + suffix)), 'invalid')
    assert.equal(f.marker, null)
    assert.equal(f.calls.some(([name]) => ['verifyOtp', 'setSession', 'updateUser'].includes(name)), false)
  })
}

test('expired/reused OTP fails closed even with an older saved recovery session', async () => {
  const f = setup({ resumed: true, session: { user: { id: 'synthetic-user' } }, otpError: { code: 'otp_expired' } })
  assert.equal(await f.initialize(new URL('https://app.invalid/reset-password?token_hash=synthetic&type=recovery')), 'invalid')
  assert.equal(await f.flow.submit('synthetic-password'), 'invalid')
  assert.equal(f.marker, null)
})

test('refresh resumes only the isolated verified recovery identity', async () => {
  const f = setup({ resumed: true, session: { user: { id: 'synthetic-user' } } })
  assert.equal(await f.initialize(new URL('https://app.invalid/reset-password')), 'ready')
  assert.equal(f.calls.some(([name]) => ['verifyOtp', 'setSession'].includes(name)), false)
  const other = setup({ resumed: true, session: { user: { id: 'different-user' } } })
  assert.equal(await other.initialize(new URL('https://app.invalid/reset-password')), 'invalid')
})

test('remote identity validation failure rejects syntactically valid credentials', async () => {
  const f = setup({ getUserError: { code: 'bad_jwt' } })
  assert.equal(await f.initialize(), 'invalid')
  assert.equal(f.marker, null)
})

test('session loss or identity change before submit blocks mutation', async () => {
  const f = setup()
  await f.initialize()
  f.auth.getUser = async () => ({ data: { user: { id: 'other-user' } }, error: null })
  assert.equal(await f.flow.submit('synthetic-password'), 'invalid')
  assert.equal(f.calls.some(([name]) => name === 'updateUser'), false)
})

test('synchronous repeated submission makes one password update', async () => {
  const f = setup()
  await f.initialize()
  const pending = Promise.withResolvers()
  f.auth.updateUser = async () => { f.calls.push(['updateUser']); return pending.promise }
  const first = f.flow.submit('synthetic-password')
  const second = f.flow.submit('synthetic-password')
  assert.equal(await second, 'busy')
  pending.resolve({ error: null })
  assert.equal(await first, 'complete')
  assert.equal(f.calls.filter(([name]) => name === 'updateUser').length, 1)
})

test('password policy errors allow retry without disclosing provider messages', async () => {
  const f = setup({ updateError: { status: 422, message: 'UNTRUSTED-PROVIDER-DETAIL' } })
  await f.initialize()
  assert.equal(await f.flow.submit('synthetic-password'), 'retry')
  f.auth.updateUser = async () => ({ error: null })
  assert.equal(await f.flow.submit('synthetic-password'), 'complete')
})

test('authorization failure on update invalidates recovery', async () => {
  const f = setup({ updateError: { status: 401 } })
  await f.initialize()
  assert.equal(await f.flow.submit('synthetic-password'), 'invalid')
})

test('network failure during verification produces stable unavailable state', async () => {
  const f = setup()
  f.auth.setSession = async () => { throw new Error('UNTRUSTED-NETWORK-DETAIL') }
  assert.equal(await f.initialize(), 'unavailable')
  assert.equal(f.marker, null)
})

test('successful update remains complete if local sign-out transport fails', async () => {
  const f = setup()
  await f.initialize()
  f.auth.signOut = async () => { throw new Error('offline') }
  assert.equal(await f.flow.submit('synthetic-password'), 'complete')
  assert.equal(f.marker, null)
})

test('actual SDK returned 503 error is unavailable, not an expired OTP', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient('https://synthetic.invalid', 'synthetic-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      assert.equal(new URL(input).pathname, '/auth/v1/verify')
      return new Response(JSON.stringify({ message: 'synthetic unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const storage = { readUser: () => null, rememberUser: () => {}, clear: () => {} }
  const flow = createPasswordRecoveryFlow(client.auth, storage)
  assert.equal(await flow.initialize(new URL('https://app.invalid/reset-password?token_hash=synthetic&type=recovery'), () => {}), 'unavailable')
})

test('actual SDK retryable shape before update keeps the verified session retryable', async () => {
  const { AuthRetryableFetchError } = await import('@supabase/supabase-js')
  const f = setup()
  await f.initialize()
  const getUser = f.auth.getUser
  f.auth.getUser = async () => ({ data: { user: null }, error: new AuthRetryableFetchError('synthetic', 503) })
  assert.equal(await f.flow.submit('synthetic-password'), 'retry')
  assert.equal(f.marker, 'synthetic-user')
  f.auth.getUser = getUser
  assert.equal(await f.flow.submit('synthetic-password'), 'complete')
})

for (const failingMethod of ['rememberUser', 'clear']) {
  test(`confirmed success remains complete when ${failingMethod} cleanup throws`, async () => {
    const f = setup()
    await f.initialize()
    f.storage[failingMethod] = () => { throw new Error('synthetic storage blocked') }
    assert.equal(await f.flow.submit('synthetic-password'), 'complete')
    assert.equal(f.calls.filter(([name]) => name === 'signOut').length, 1)
    assert.equal(await f.flow.submit('synthetic-password'), 'complete')
  })
}
