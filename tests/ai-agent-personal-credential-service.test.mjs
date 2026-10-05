import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

const { createAiAgentPersonalCredentialService, personalCredentialIssueSchema } =
  loadNotificationComponent('src/features/ai-agent/ai-agent-personal-credential-service.ts');
const issuer = { userId: '10000000-0000-4000-8000-000000000001', role: 'admin' };
const owner = { userId: '10000000-0000-4000-8000-000000000002', role: 'teacher' };
const other = '10000000-0000-4000-8000-000000000003';
const key = '20000000-0000-4000-8000-000000000001';
const issued = {
  id: key, label: 'synthetic personal', credentialKind: 'personal',
  ownerProfileId: owner.userId, issuerProfileId: issuer.userId,
  ownerName: '합성 선생님', issuerName: null,
  scopes: ['ai-agent:requests:read'], grant: { queues: ['employee_requests'], actions: ['read'] },
  expiresAt: '2026-10-06T00:00:00Z', token: 'tips_agent_' + 'a'.repeat(64),
};
const payload = {
  label: issued.label, ownerProfileId: owner.userId,
  scopes: issued.scopes, grant: issued.grant, expiresAt: null,
};
const listed = { ...issued, createdAt: '2026-10-05T00:00:00Z', revokedAt: null, lastUsedAt: null };
delete listed.token;
const list = { supportEnabled: false, total: 1, items: [listed] };
const service = (actor, rpc) => createAiAgentPersonalCredentialService({
  actor, getCurrentActor: () => actor, rpc,
});

test('personal issue requires separate owner/issuer and rejects central or secret metadata', () => {
  assert.equal(personalCredentialIssueSchema.parse(issued).ownerProfileId, owner.userId);
  assert.equal(personalCredentialIssueSchema.parse({ ...issued, token: null }).token, null);
  for (const data of [
    { ...issued, credentialKind: 'central', ownerProfileId: null },
    { ...issued, tokenHash: 'b'.repeat(64) },
    { ...issued, grant: { spaceKeys: ['space_1'], purposes: ['bridge_reply'], bridgeSourceId: key } },
  ]) assert.equal(personalCredentialIssueSchema.safeParse(data).success, false);
  const { ownerProfileId: omitted, ...legacy } = issued;
  assert.equal(omitted, owner.userId);
  assert.equal(personalCredentialIssueSchema.safeParse(legacy).success, false);
});

test('admin issuance calls only dedicated personal RPC with owner and exact idempotency key', async () => {
  const calls = [];
  const client = service(issuer, async (name, args) => {
    calls.push({ name, args });
    return { data: issued, error: null };
  });
  assert.deepEqual(await client.create(payload, key), issued);
  assert.deepEqual(calls, [{ name: 'ai_agent_personal_credential_api_v1', args: {
    p_action: 'create', p_input: { ...payload, idempotencyKey: key },
  } }]);
});

test('mismatched owner or issuer blocks raw credential response', async () => {
  for (const data of [{ ...issued, ownerProfileId: other }, { ...issued, issuerProfileId: other }]) {
    const client = service(issuer, async () => ({ data, error: null }));
    await assert.rejects(client.create(payload, key), /personal_credential_invalid/);
  }
});

test('teacher can manage own metadata but cannot issue credentials', async () => {
  let calls = 0;
  const client = service(owner, async () => { calls++; return { data: list, error: null }; });
  assert.equal(client.active(), true);
  assert.equal(client.canCreate(), false);
  await assert.rejects(client.create(payload, key), /actor_changed/);
  await assert.rejects(client.owners(), /actor_changed/);
  assert.equal(calls, 0);
  assert.deepEqual(await client.list(1, 10), list);
  assert.equal(calls, 1);
});

test('owner choices are admin-only paged display metadata and retain UUID identity for duplicate names', async () => {
  const choices = { page: 1, pageSize: 20, total: 2, items: [
    { id: owner.userId, name: null }, { id: other, name: null },
  ] };
  const calls = [];
  const client = service(issuer, async (name, args) => { calls.push({ name, args }); return { data: choices, error: null }; });
  assert.deepEqual(await client.owners(), choices);
  assert.deepEqual(calls, [{ name: 'ai_agent_personal_credential_api_v1', args: {
    p_action: 'owners', p_input: { page: 1, pageSize: 20 },
  } }]);
  for (const data of [
    { ...choices, page: 2 }, { ...choices, pageSize: 10 },
    { ...choices, total: 1 },
    { ...choices, items: [choices.items[0], choices.items[0]] },
    { ...choices, items: [{ ...choices.items[0], email: 'private@test.invalid' }] },
  ]) await assert.rejects(service(issuer, async () => ({ data, error: null })).owners(), /personal_credential_invalid/);
  assert.deepEqual(await service(issuer, async () => ({ data: { ...list, items: [{ ...listed, ownerName: '동명이인', issuerName: '동명이인' }] }, error: null })).list(1, 10),
    { ...list, items: [{ ...listed, ownerName: '동명이인', issuerName: '동명이인' }] });
});

test('owner enumeration preserves current-actor boundary and invalid pagination makes zero RPC calls', async () => {
  let current = issuer;
  const pending = Promise.withResolvers();
  const client = createAiAgentPersonalCredentialService({ actor: issuer, getCurrentActor: () => current, rpc: () => pending.promise });
  const result = client.owners();
  current = { ...issuer, role: 'teacher' };
  pending.resolve({ data: { page: 1, pageSize: 20, total: 1, items: [{ id: owner.userId, name: '숨길 표시명' }] }, error: null });
  await assert.rejects(result, /actor_changed/);
  let calls = 0;
  const valid = service(issuer, async () => { calls++; return { data: null, error: null }; });
  for (const [page, size] of [[0, 20], [1, 50], [10001, 10]]) await assert.rejects(valid.owners(page, size));
  assert.equal(calls, 0);
});

test('list validates current owner/issuer authority and accepts support-disabled management', async () => {
  assert.deepEqual(await service(issuer, async () => ({ data: list, error: null })).list(1, 15), list);
  for (const [actor, field] of [[owner, 'ownerProfileId'], [issuer, 'issuerProfileId']]) {
    const wrong = { ...list, items: [{ ...listed, [field]: other }] };
    await assert.rejects(service(actor, async () => ({ data: wrong, error: null })).list(1, 20),
      /personal_credential_invalid/);
  }
});

test('late issuance and list results are rejected after actor or role changes', async () => {
  for (const [actor, operation, data] of [[issuer, 'create', issued], [owner, 'list', list]]) {
    for (const next of [{ ...actor, userId: other }, { ...actor, role: 'viewer' }, null]) {
      let current = actor;
      const pending = Promise.withResolvers();
      const client = createAiAgentPersonalCredentialService({
        actor, getCurrentActor: () => current, rpc: () => pending.promise,
      });
      const result = operation === 'create' ? client.create(payload, key) : client.list(1, 10);
      current = next;
      pending.resolve({ data, error: null });
      await assert.rejects(result, /actor_changed/);
    }
  }
});

test('metadata-only issuance retry never reconstructs a raw token', async () => {
  const client = service(issuer, async () => ({ data: { ...issued, token: null }, error: null }));
  assert.equal((await client.create(payload, key)).token, null);
});

test('invalid owner, bridge grants, and unknown authority inputs make zero RPC calls', async () => {
  let calls = 0;
  const client = service(issuer, async () => { calls++; return { data: issued, error: null }; });
  for (const input of [
    { ...payload, ownerProfileId: 'bad' },
    { ...payload, credentialKind: 'central' },
    { ...payload, grant: { spaceKeys: ['space_1'], purposes: ['bridge_reply'], bridgeSourceId: key } },
  ]) await assert.rejects(client.create(input, key));
  await assert.rejects(client.create(payload, 'bad'));
  assert.equal(calls, 0);
});

test('revocation uses personal RPC and rejects a mismatched receipt', async () => {
  const revoked = { id: key, revokedAt: '2026-10-05T00:00:00Z' };
  const calls = [];
  const client = service(owner, async (name, args) => {
    calls.push({ name, args }); return { data: revoked, error: null };
  });
  assert.deepEqual(await client.revoke(key, key), revoked);
  assert.deepEqual(calls[0], { name: 'ai_agent_personal_credential_api_v1', args: {
    p_action: 'revoke', p_input: { id: key, idempotencyKey: key },
  } });
  await assert.rejects(service(owner, async () => ({ data: { ...revoked, id: other }, error: null }))
    .revoke(key, key), /personal_credential_invalid/);
});

test('DB denial is definite, transport uncertainty remains retryable without leaking provider text', async () => {
  const denied = service(issuer, async () => ({ data: null, error: { code: '42501', message: 'secret provider text' } }));
  await assert.rejects(denied.create(payload, key), error => error.definite === true && !error.message.includes('secret'));
  const uncertain = service(issuer, async () => { throw new Error('secret provider text'); });
  await assert.rejects(uncertain.create(payload, key), error => error.definite === false && !error.message.includes('secret'));
  for (const role of ['staff', 'assistant', 'viewer']) {
    let calls = 0;
    const client = service({ ...owner, role }, async () => { calls++; return { data: list, error: null }; });
    await assert.rejects(client.list(1, 10), /actor_changed/);
    assert.equal(calls, 0);
  }
});
