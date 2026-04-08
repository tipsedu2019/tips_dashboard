import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const embeddedApps = [
  {
    id: 'home',
    rootDir: path.join(projectRoot, 'embedded-apps', 'home'),
    configFile: path.join(projectRoot, 'embedded-apps', 'home', 'vite.config.ts'),
    base: '/embedded/home/',
    outDir: path.join(projectRoot, 'public', 'embedded', 'home'),
  },
  {
    id: 'reviews',
    rootDir: path.join(projectRoot, 'embedded-apps', 'reviews'),
    configFile: path.join(projectRoot, 'embedded-apps', 'reviews', 'vite.config.ts'),
    base: '/embedded/reviews/',
    outDir: path.join(projectRoot, 'public', 'embedded', 'reviews'),
  },
  {
    id: 'scores',
    rootDir: path.join(projectRoot, 'embedded-apps', 'scores'),
    configFile: path.join(projectRoot, 'embedded-apps', 'scores', 'vite.config.ts'),
    base: '/embedded/scores/',
    outDir: path.join(projectRoot, 'public', 'embedded', 'scores'),
  },
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function buildEmbeddedApp({ id, rootDir, configFile, base, outDir }) {
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\n[embedded] building ${id} -> ${base}`);

  await run(process.execPath, [
    viteBin,
    'build',
    '--config',
    configFile,
    '--base',
    base,
    '--outDir',
    outDir,
    '--emptyOutDir',
  ], {
    cwd: rootDir,
  });
}

for (const app of embeddedApps) {
  await buildEmbeddedApp(app);
}
