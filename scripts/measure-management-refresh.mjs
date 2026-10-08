import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

export const managementPagePath = 'src/features/management/management-page.tsx';
const root = path.resolve(import.meta.dirname, '..');
const hash = value => createHash('sha256').update(value).digest('hex');

// Execute the actual callback node; never reproduce its body in the fixture.
export function extractManagementReconcile(source = readFileSync(path.join(root, managementPagePath), 'utf8')) {
  const parsed = ts.createSourceFile(managementPagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'reconcileManagementPage') {
      assert.ok(ts.isCallExpression(node.initializer) && node.initializer.expression.getText(parsed) === 'useCallback');
      const callback = node.initializer.arguments[0];
      assert.ok(ts.isArrowFunction(callback));
      matches.push(callback.getText(parsed));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, 'exactly one production reconciliation callback');
  const callbackSource = matches[0];
  const compiled = ts.transpileModule(`module.exports = ${callbackSource};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    sourceSha256: hash(source), callbackSha256: hash(callbackSource), callbackSource,
    bind(dependencies) {
      const runtime = { exports: null };
      vm.runInNewContext(compiled, { ...dependencies, module: runtime, Promise }, { filename: managementPagePath });
      return runtime.exports;
    },
  };
}

async function measure(base, compare) {
  assert.match(base ?? '', /^[a-f0-9]{7,40}$/, 'pass a pinned baseline Git SHA');
  const variants = [{ name: 'baseline', source: execFileSync('git', ['show', `${base}:${managementPagePath}`], { cwd: root, encoding: 'utf8' }) }];
  if (compare) variants.push({ name: 'candidate', source: readFileSync(path.join(root, managementPagePath), 'utf8') });
  const delayMs = 80, samples = 5, results = [];
  const fixtureRow = { id: 'synthetic-class-1', kind: 'classes', title: '합성 영어 수업',
    raw: { name: '합성 영어 수업', student_ids: ['synthetic-student-1'], teacher: '합성 선생님', schedule: '목 15:00-16:00' } };
  for (const variant of variants) {
    const extracted = extractManagementReconcile(variant.source);
    for (const { kind, selectedId } of [
      { kind: 'classes', selectedId: fixtureRow.id }, { kind: 'students', selectedId: fixtureRow.id },
      { kind: 'textbooks', selectedId: fixtureRow.id }, { kind: 'classes', selectedId: undefined },
    ]) {
      const runs = [];
      for (let index = 0; index < samples; index++) {
        const reads = [];
        const wait = () => new Promise(resolve => setTimeout(resolve, delayMs));
        const read = async (operation, result) => {
          const entry = { operation, startMs: performance.now() - start }; reads.push(entry);
          await wait(); entry.endMs = performance.now() - start;
          return result;
        };
        const callback = extracted.bind({ kind, refresh: () => read('list', undefined), loadDetail: id => { assert.equal(id, fixtureRow.id); return read('detail', fixtureRow); } });
        const start = performance.now(), payload = await callback(selectedId), durationMs = performance.now() - start;
        assert.deepEqual(payload, selectedId ? fixtureRow : null);
        assert.equal(reads.length, selectedId ? 2 : 1);
        const payloadJson = JSON.stringify(payload);
        runs.push({ durationMs: Number(durationMs.toFixed(2)), readCount: reads.length, payloadSha256: hash(payloadJson),
          payloadBytes: Buffer.byteLength(payloadJson), reads: reads.map(({ operation, startMs, endMs }) => ({ operation, startMs: Number(startMs.toFixed(2)), endMs: Number(endMs.toFixed(2)) })) });
      }
      const sorted = runs.map(run => run.durationMs).sort((a, b) => a - b);
      results.push({ variant: variant.name, kind, selectedId: selectedId ?? null, sourceSha256: extracted.sourceSha256,
        callbackSha256: extracted.callbackSha256, medianMs: sorted[Math.floor(samples / 2)], runs });
    }
  }
  return { evidence: 'synthetic execution of the TS-AST-extracted production callback; not production or browser latency', base, delayMs, samples, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(JSON.stringify(await measure(process.argv[2], process.argv.includes('--compare')), null, 2) + '\n');
}
