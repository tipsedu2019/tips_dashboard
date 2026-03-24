import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('C:/Antigravity/tips_dashboard');
const dataServicePath = path.join(root, 'src/services/dataService.js');
const managerActionsPath = path.join(root, 'src/hooks/useManagerActions.js');
const migrationsDir = path.join(root, 'supabase/migrations');
const monolithicMigrationPath = path.join(root, 'SUPABASE_MIGRATION.sql');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('textbook persistence no longer depends on browser-local fallback code paths', () => {
  const dataServiceSource = read(dataServicePath);
  const managerActionsSource = read(managerActionsPath);

  assert.equal(
    dataServiceSource.includes('usedLocalFallback: true'),
    false,
    'dataService textbook writes should not fall back to browser-local drafts'
  );
  assert.equal(
    dataServiceSource.includes('localOnly: true'),
    false,
    'dataService textbook writes should not mark saved textbooks as local-only'
  );
  assert.equal(
    managerActionsSource.includes('임시 저장'),
    false,
    'manager actions should not message browser temporary textbook saves'
  );
});

test('supabase migrations enable textbook RLS and authenticated write policies', () => {
  const migrationContents = fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => read(path.join(migrationsDir, fileName)))
    .join('\n\n');

  assert.match(migrationContents, /alter table public\.textbooks enable row level security;/i);
  assert.match(migrationContents, /create policy textbooks_authenticated_select/i);
  assert.match(migrationContents, /create policy textbooks_teacher_write/i);
  assert.match(migrationContents, /current_dashboard_role\(\) in \('admin', 'staff', 'teacher'\)/i);
});

test('bootstrap migration includes textbook policies for fresh setups', () => {
  const source = read(monolithicMigrationPath);

  assert.match(source, /alter table public\.textbooks enable row level security;/i);
  assert.match(source, /create policy textbooks_authenticated_select/i);
  assert.match(source, /create policy textbooks_teacher_write/i);
});
