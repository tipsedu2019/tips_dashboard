import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { actionServicePath } from '../tests/helpers/makeup-action-fixture.mjs';
import { measureResubmit } from '../tests/helpers/makeup-resubmit-fixture.mjs';

const base = process.argv[2];
if (!/^[a-f0-9]{7,40}$/.test(base ?? '')) throw Error('Pass the pinned baseline Git SHA.');
const root = path.resolve(import.meta.dirname, '..');
const variants = [{
  name: 'baseline',
  source: execFileSync('git', ['show', base + ':' + actionServicePath], { cwd: root, encoding: 'utf8' }),
}];
if (process.argv.includes('--compare')) variants.push({
  name: 'candidate', source: readFileSync(path.join(root, actionServicePath), 'utf8'),
});
const output = {
  evidence: 'synthetic actual-service transport; not production latency or real business writes',
  base, results: [],
};
for (const variant of variants) {
  const measured = await measureResubmit(variant.source);
  for (const run of measured.runs) {
    assert.equal(run.mutations, 1);
    assert.equal(run.notifications, 1);
    assert.equal(run.result.status, 'approval_pending');
  }
  output.results.push({
    variant: variant.name,
    sourceSha256: createHash('sha256').update(variant.source).digest('hex'),
    ...measured,
  });
}
if (output.results.length === 2) {
  const [before, after] = output.results;
  assert.equal(after.runs[0].mutationPayloadSha256, before.runs[0].mutationPayloadSha256);
  assert.equal(after.runs[0].resultSha256, before.runs[0].resultSha256);
  assert.ok(after.runs.every(run => run.reads < before.runs[0].reads));
  assert.ok(after.runs.every(run => run.readResponseBytes < before.runs[0].readResponseBytes));
}
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
