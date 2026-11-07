import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowNames = ["free-tier-guardrails", "supabase-sql-review"];

for (const name of workflowNames) {
  test(`${name} cancels superseded runs within its own PR only`, async () => {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    assert.match(workflow, /^concurrency:\n  group: \$\{\{ github\.workflow \}\}-pr-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true\n/m);
    assert.match(workflow, /^on:\n  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n/m);
    assert.doesNotMatch(workflow, /^\s+(?:if|continue-on-error|paths|paths-ignore):/m);
    assert.match(workflow, /^permissions:\n  contents: read\n/m);
  });
}
