import { mkdir, writeFile, symlink, copyFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd(), out = resolve(process.env.PREMIUM_GALLERY_DIR || '/tmp/tips-premium-dashboard-20260915/gallery-app');
await mkdir(out + '/app', { recursive: true });
await mkdir(out + '/public', { recursive: true });
for (const [target, path] of [[root + '/node_modules', out + '/node_modules'], [root + '/public/fonts', out + '/public/fonts']]) {
  await symlink(target, path).catch(async error => {
    if (error.code !== 'EEXIST') throw error;
    if (await realpath(path) !== await realpath(target)) {
      throw new Error(`Stale gallery dependency at ${path}; choose a fresh PREMIUM_GALLERY_DIR.`);
    }
  });
}
await writeFile(out + '/package.json', JSON.stringify({ private: true, type: 'module', dependencies: { next: '16.1.1', react: '19.2.3', 'react-dom': '19.2.3' } }));
await writeFile(out + '/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom','esnext'], strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, jsx: 'preserve', skipLibCheck: true, paths: { '@/*': [root + '/src/*'] } }, include: ['**/*.ts','**/*.tsx','.next/types/**/*.ts'] }));
await writeFile(out + '/next.config.mjs', `export default { experimental: { externalDir: true }, devIndicators: false, webpack(config) { config.resolve.alias['@'] = ${JSON.stringify(root + '/src')}; return config; } };\n`);
await writeFile(out + '/postcss.config.mjs', 'export default {plugins:{"@tailwindcss/postcss":{}}};\n');
await writeFile(out + '/app/gallery.css', `@import "${root}/src/app/globals.css";\n@source "./page.tsx";\n`);
await writeFile(out + '/app/layout.tsx', 'import "./gallery.css";export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body className="font-sans">{children}</body></html>};\n');
await copyFile(root + '/tests/fixtures/premium-ui-gallery.tsx', out + '/app/page.tsx');
console.log(out);
