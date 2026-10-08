import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { actionCases, actionFixture, actionServicePath, id, loadActionService } from '../tests/helpers/makeup-action-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const base = process.argv[2];
if (!/^[a-f0-9]{7,40}$/.test(base ?? '')) throw Error('Pass the pinned baseline Git SHA.');
const samples = 5, delayMs = 40;
const sources = [{ name: 'baseline', source: execFileSync('git', ['show', `${base}:${actionServicePath}`], { cwd: root, encoding: 'utf8' }) }];
if (process.argv.includes('--compare')) sources.push({ name: 'candidate', source: readFileSync(path.join(root, actionServicePath), 'utf8') });
const output = { evidence: 'synthetic actual-service transport fixture; not browser or production latency', base, delayMs, samples, results: [] };
const previousFetch = globalThis.fetch;
try {
  for (const { name, source } of sources) {
    for (const testCase of actionCases) {
      const runs = [];
      for (let i = 0; i < samples; i++) {
        const fixture = actionFixture(testCase, { delayMs });
        const service = loadActionService(fixture.client, source);
        globalThis.fetch = fixture.fetch;
        const start = performance.now();
        const result = await service[testCase.method](id(1), id(804), '합성 처리 메모');
        const durationMs = performance.now() - start;
        assert.equal(result.status, testCase.after);
        assert.equal(result.requesterLabel, '합성 신청자');
        assert.equal(result.approverLabel, '합성 결재자');
        assert.equal(result.notificationWarning, undefined);
        runs.push({ durationMs: Number(durationMs.toFixed(2)), reads: fixture.calls.filter(c => c.kind === 'table' || c.name === 'get_makeup_detail_v1').length,
          mutations: fixture.calls.filter(c => c.name === 'transition_makeup_request_v2').length,
          notifications: fixture.calls.filter(c => c.kind === 'notification').length,
          readResponseBytes: fixture.calls.filter(c => c.kind === 'table' || c.name === 'get_makeup_detail_v1').reduce((sum, c) => sum + c.responseBytes, 0),
          stages: fixture.calls.map(c => ({ operation: c.table ?? c.name ?? c.kind, startMs: Number((c.startedAt - start).toFixed(2)), endMs: Number((c.endedAt - start).toFixed(2)) })),
        });
      }
      const durations = runs.map(run => run.durationMs).sort((a, b) => a - b);
      output.results.push({ variant: name, method: testCase.method, sourceSha256: createHash('sha256').update(source).digest('hex'), medianMs: durations[Math.floor(samples / 2)], runs });
    }
  }
} finally { globalThis.fetch = previousFetch; }
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
