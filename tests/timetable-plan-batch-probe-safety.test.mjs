import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const repository = new URL('../', import.meta.url);
for (const [name, overrides] of [
  ['non-loopback database', { url: 'postgresql://192.0.2.1:6543/postgres' }],
  ['non-database URL', { url: 'https://127.0.0.1:6543/postgres' }],
  ['different database path', { url: 'postgresql://127.0.0.1:6543/production' }],
  ['missing isolated nonce', { nonce: '' }],
  ['ordinary project name', { project: 'tips_dashboard' }],
  ['mismatched isolated port', { port: 6544 }],
]) test(`batch DTO probe rejects ${name} before executing SQL`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'timetable-batch-probe-'));
  try {
    const paths = ['tests/probe-timetable-batch-save-dto.mjs', 'src/features/academic/timetable-plan-service.ts', 'src/features/academic/timetable-plan-contract.ts'];
    for (const path of paths) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await copyFile(new URL(path, repository), join(root, path));
    }
    await mkdir(join(root, 'supabase'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'supabase/config.toml'), `project_id = "${overrides.project ?? 'tips_supabase_db_qa_0123456789ab'}"\n[db]\nport = ${overrides.port ?? 6543}\n`);
    await mkdir(join(root, 'bin'));
    const marker = join(root, 'sql-executed');
    await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nprintf invoked > "$BATCH_PROBE_MARKER"\nexit 99\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, [join(root, paths[0])], { cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { PATH: `${join(root, 'bin')}:/usr/bin:/bin`, TASK_LOCAL_DB_URL: overrides.url ?? 'postgresql://127.0.0.1:6543/postgres', TASK_LOCAL_DB_NONCE: overrides.nonce ?? '0'.repeat(32), BATCH_PROBE_MARKER: marker },
    });
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AssertionError/);
    await assert.rejects(access(marker));
  } finally { await rm(root, { recursive: true, force: true }); }
});
