import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
const serviceUrl = new URL('../../../src/features/textbooks/textbook-read-service.ts', import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('./') && context.parentURL?.includes('/src/features/textbooks/')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  if (context.parentURL === serviceUrl.href && specifier === '@/lib/supabase') {
    return { url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";', shortCircuit: true };
  }
  return next(specifier, context);
} });
const api = await import(serviceUrl.href);
const captures = readFileSync(process.argv[2], 'utf8').split('\n').filter(line => line.startsWith('# TB2_WIRE ')).map(line => JSON.parse(line.slice('# TB2_WIRE '.length)));
assert.equal(captures.length, 10);
for (const capture of captures) {
  let calls = 0;
  const client = { rpc() {
    calls += 1;
    return { abortSignal() { return this; }, retry(value) { assert.equal(value, false); return Promise.resolve({ data: capture.data, error: null }); } };
  } };
  const parsed = await api[capture.method](capture.input, { client });
  assert.ok(parsed);
  assert.equal(calls, 1);
}
console.log(JSON.stringify({ pass: captures.length, source: 'fresh final PostgreSQL RPC output', methods: [...new Set(captures.map(c => c.method))] }));
