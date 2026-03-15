import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const localEnvPath = path.join(root, '.env.supabase.local');
const defaultProjectRef = 'dqpccpblshdnqzbjvkxd';
const localNpmCachePath = path.join(root, '.codex-temp', 'npm-cache');

function importEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    process.env[name] = value;
  }
}

function maskArgument(value) {
  if (!value) {
    return value;
  }
  if (value.startsWith('postgresql://')) {
    return value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }
  if (value.startsWith('sbp_')) {
    return 'sbp_***';
  }
  return value;
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const printable = [command, ...args.map(maskArgument)].join(' ');
    console.log(`> ${printable}`);

    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        npm_config_cache: localNpmCachePath,
        npm_config_update_notifier: 'false',
        ...extraEnv,
      },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

async function runSupabase(args) {
  const localCli = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');

  if (fs.existsSync(localCli)) {
    await run(localCli, args);
    return;
  }

  try {
    await run('supabase', args);
    return;
  } catch {
    await run('npx', ['--yes', 'supabase@latest', ...args]);
  }
}

async function main() {
  fs.mkdirSync(localNpmCachePath, { recursive: true });
  importEnvFile(localEnvPath);

  const projectRef = process.env.SUPABASE_PROJECT_REF || defaultProjectRef;
  const dbUrl = process.env.SUPABASE_DB_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (dbUrl) {
    await runSupabase(['db', 'push', '--db-url', dbUrl, '--include-all']);
    return;
  }

  if (!accessToken || !dbPassword) {
    throw new Error(
      [
        'Set one of the following before running db:push:',
        '- SUPABASE_DB_URL',
        '- SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD',
        '',
        'Recommended:',
        '1. Copy .env.supabase.example to .env.supabase.local',
        '2. Fill in the values once',
        '3. Run npm run db:push',
      ].join('\n'),
    );
  }

  await runSupabase(['login', '--token', accessToken]);
  await runSupabase(['link', '--project-ref', projectRef, '--password', dbPassword]);
  await runSupabase(['db', 'push', '--linked', '--include-all']);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
