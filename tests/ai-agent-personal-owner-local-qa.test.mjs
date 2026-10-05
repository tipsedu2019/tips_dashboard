import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractPersonalOwnerLegacyCatalog, parsePersonalOwnerQaArguments, parsePersonalOwnerTap } from '../scripts/run-ai-agent-personal-owner-local-qa.mjs';

async function legacySources() {
  return Promise.all([
    '20260929110109_agent_api_scoped_schedule.sql',
    '20260930092804_agent_management_calendar.sql',
  ].map(async name => ({ path: `supabase/migrations/${name}`, bytes: await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url)) })));
}

test('legacy ACL prerequisites retain real final definitions and label bounded ACL projections', async () => {
  const sources = await legacySources();
  const statements = extractPersonalOwnerLegacyCatalog(...sources);
  assert.equal(statements.length, 11);
  assert.equal(statements.filter(statement => statement.provenance === 'byte_exact_source_statement').length, 9);
  for (const statement of statements.filter(value => value.provenance === 'byte_exact_source_statement')) {
    assert.ok(sources.find(source => source.path === statement.path).bytes.includes(statement.bytes));
  }
  for (const id of ['legacy_final_issuer', 'legacy_final_list']) {
    assert.equal(statements.find(statement => statement.id === id).path, sources[1].path);
  }
  const helperAcl = statements.find(statement => statement.id === 'legacy_admin_helper_acl');
  assert.equal(helperAcl.provenance, 'final_per_function_roles_acl_projection');
  assert.match(helperAcl.originalCombinedStatementSha256, /^[a-f0-9]{64}$/);
  assert.equal(helperAcl.bytes.toString(), 'revoke all on function dashboard_private.agent_require_admin_v1() from public,anon,authenticated,service_role;');
  const tableAcl = statements.find(statement => statement.id === 'legacy_credential_table_acl');
  assert.equal(tableAcl.provenance, 'final_per_table_roles_acl_projection');
  assert.match(tableAcl.originalCombinedStatementSha256, /^[a-f0-9]{64}$/);
  assert.equal(tableAcl.bytes.toString(), 'revoke all on dashboard_private.agent_credentials from public,anon,authenticated,service_role;');
});

test('legacy extraction rejects ambiguous function definitions and invalid UTF-8', async () => {
  const [initial, final] = await legacySources();
  assert.throws(() => extractPersonalOwnerLegacyCatalog(initial, {
    ...final, bytes: Buffer.concat([final.bytes, Buffer.from('\ncreate or replace function public.create_agent_credential_v1(')]),
  }), /legacy_catalog_statement_ambiguous/);
  assert.throws(() => extractPersonalOwnerLegacyCatalog({
    ...initial, bytes: Buffer.concat([initial.bytes, Buffer.from([0xff])]),
  }, final), /legacy_catalog_encoding_invalid/);
});

test('helper ACL projection rejects changed canonical role denial', async () => {
  const [initial, final] = await legacySources();
  const old = 'revoke all on function dashboard_private.agent_require_admin_v1(),';
  assert.throws(() => extractPersonalOwnerLegacyCatalog({
    ...initial, bytes: Buffer.from(initial.bytes.toString().replace(old, 'revoke all on function dashboard_private.agent_require_admin_v1(), ')),
  }, final), /legacy_helper_acl_projection_drift/);
});

test('local owner QA requires explicit execution identity and accepts no external targets', () => {
  assert.deepEqual(parsePersonalOwnerQaArguments([]), { execute: false });
  assert.deepEqual(parsePersonalOwnerQaArguments(['--plan']), { execute: false });
  assert.deepEqual(parsePersonalOwnerQaArguments(['--execute', '--request-id', 'ai-agent-personal-local-owner-test']),
    { execute: true, requestId: 'ai-agent-personal-local-owner-test' });
  for (const args of [
    ['--execute'], ['--execute', '--request-id', 'production'],
    ['--execute', '--request-id', 'ai-agent-personal-local-a', '--database-url', 'postgres://outside.invalid/db'],
    ['--execute', '--request-id', 'ai-agent-personal-local-a', '--project-id', 'outside'],
    ['--execute', '--request-id', 'ai-agent-personal-local-a\n'],
    ['--plan', '--execute'], ['--execute', '--request-id', 'ai-agent-personal-local-a', '--request-id', 'ai-agent-personal-local-b'],
  ]) assert.throws(() => parsePersonalOwnerQaArguments(args), /arguments_invalid/);
});

test('complete sequential pgTAP pass has a durable output hash', () => {
  const result = parsePersonalOwnerTap('ok 1 - first\nok 2 - second\n1..2\n');
  assert.equal(result.tests, 2);
  assert.equal(result.pass, 2);
  assert.equal(result.fail, 0);
  assert.match(result.outputSha256, /^[a-f0-9]{64}$/);
});

for (const [reason, output] of [
  ['failed assertion', 'ok 1\nnot ok 2 - denial failed\n1..2\n'],
  ['missing plan', 'ok 1\n'],
  ['missing result', 'ok 1\n1..2\n'],
  ['duplicate result', 'ok 1\nok 1\n1..2\n'],
  ['nonsequential result', 'ok 2\n1..1\n'],
  ['multiple plans', 'ok 1\n1..1\n1..1\n'],
  ['zero tests', '1..0\n'],
  ['skip', 'ok 1 # SKIP - no provider\n1..1\n'],
  ['todo', 'ok 1 # TODO - permission review\n1..1\n'],
  ['bailout', 'ok 1\n1..1\nBail out! database terminated\n'],
]) {
  test(`local owner evidence rejects ${reason}`, () => {
    assert.throws(() => parsePersonalOwnerTap(output), /tap_not_complete_pass/);
  });
}
