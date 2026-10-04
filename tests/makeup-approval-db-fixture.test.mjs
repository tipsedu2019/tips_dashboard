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

test('isolated inheritance fixture restores the exact existing makeup payload writer omitted by baseline', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260803150000_notification_makeup_content_single_writer.sql', import.meta.url), 'utf8');
  const start = migration.indexOf('create or replace function dashboard_private.notification_makeup_payload_v1(');
  const expected = migration.slice(start, migration.indexOf('\n$$;', start) + 4);
  const sql = await readFile(new URL('../supabase/tests/makeup_legacy_approval_occupancy_test.sql', import.meta.url), 'utf8');
  const embedded = sql.split('-- BEGIN CURRENT MAKEUP PAYLOAD WRITER\n')[1].split('\n-- END CURRENT MAKEUP PAYLOAD WRITER')[0];
  assert.equal(embedded, expected);
});
