import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { approvalDbFixtureSql } from './fixtures/makeup-approval-db-fixture.mjs';
import { effectiveApprovalFixtureSql } from './fixtures/legacy-effective-approval-db-fixture.mjs';

test('pgTAP payload is the exact current approval producer output', async () => {
  const sql = await readFile(new URL('../supabase/tests/makeup_legacy_approval_occupancy_test.sql', import.meta.url), 'utf8');
  assert.equal(sql.slice(sql.indexOf('-- Generated'), sql.indexOf('-- End generated fixture')), approvalDbFixtureSql());
});

test('inheritance integration payloads are the exact current approval and calendar producer output', async () => {
  const sql = await readFile(new URL('../supabase/tests/makeup_legacy_approval_occupancy_test.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes(effectiveApprovalFixtureSql()));
});
