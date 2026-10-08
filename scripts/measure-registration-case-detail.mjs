import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Execute the actual service factory through the existing isolated test client.
// This intentionally measures synthetic transport delay, not browser or production latency.
const require = createRequire(import.meta.url);
const testUrl = new URL("../tests/registration-track-service.test.mjs", import.meta.url);
const sourcePath = process.argv[2] || fileURLToPath(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url));
const serviceUrl = pathToFileURL(sourcePath);
const source = await readFile(serviceUrl, "utf8");
const testSource = await readFile(testUrl, "utf8");
const syntax = ts.createSourceFile("contract.mjs", testSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const helpers = new Set(["readServiceSource", "loadFactory", "createClient", "readyOptions", "detailRows"]);
const declarations = [];
for (const statement of syntax.statements) {
  if (ts.isImportDeclaration(statement)) {
    const specifier = statement.moduleSpecifier.text;
    const resolved = specifier.startsWith(".")
      ? new URL(specifier, testUrl).href
      : specifier.startsWith("node:") ? specifier : pathToFileURL(require.resolve(specifier)).href;
    declarations.push(statement.getText(syntax).replace(JSON.stringify(specifier), JSON.stringify(resolved)));
  } else if (ts.isFunctionDeclaration(statement) && helpers.has(statement.name?.text)) {
    declarations.push(statement.getText(syntax));
  } else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(syntax) === "inertObservationSummaryRow")) {
    declarations.push(statement.getText(syntax));
  }
}
declarations.push(`const serviceUrl = new URL(${JSON.stringify(serviceUrl.href)});`);
declarations.push("export { loadFactory, createClient, readyOptions, detailRows, inertObservationSummaryRow };");
const harness = await import(`data:text/javascript;base64,${Buffer.from(declarations.join("\n")).toString("base64")}`);
const { createRegistrationTrackService } = await harness.loadFactory();
const delayMs = 80;
const samples = [];
for (let sample = 0; sample < 5; sample += 1) {
  const trace = [];
  const started = performance.now();
  const client = harness.createClient({
    async queryHandler(query) {
      trace.push({ table: query.table, startMs: performance.now() - started });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (query.table === "ops_registration_subject_track_summaries") {
        return { data: [{ ...harness.detailRows("ops_registration_subject_tracks").data[0], ...harness.inertObservationSummaryRow }], error: null };
      }
      return harness.detailRows(query.table);
    },
  });
  const measures = [];
  const service = createRegistrationTrackService(client.client, harness.readyOptions({ recordMeasure: (measure) => measures.push(measure) }));
  const detail = await service.loadCaseDetail("task-1", "viewer-1", { observationAware: true, force: true });
  const elapsedMs = performance.now() - started;
  assert.equal(detail.task.id, "task-1");
  assert.equal(detail.tracks[0].observationSummaryVisible, true);
  assert.equal(detail.enrollments.length, 1);
  assert.equal(client.queries.length, 11);
  assert.deepEqual(client.rpcCalls.map(([name]) => name), ["get_registration_customer_reminder_summaries_v1"]);
  samples.push({
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    enrollmentStartMs: Math.round(trace.find((entry) => entry.table === "ops_registration_enrollments").startMs * 10) / 10,
    summaryStartMs: Math.round(trace.find((entry) => entry.table === "ops_registration_subject_track_summaries").startMs * 10) / 10,
    queryCount: client.queries.length,
    rpcCount: client.rpcCalls.length,
    measures,
    resultHash: createHash("sha256").update(JSON.stringify(detail)).digest("hex"),
  });
}
const sorted = samples.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
console.log(JSON.stringify({
  kind: "isolated synthetic actual-service measurement",
  sourcePath,
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  delayMs,
  iterations: samples.length,
  medianMs: sorted[Math.floor(sorted.length / 2)],
  samples,
}, null, 2));
