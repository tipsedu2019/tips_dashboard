import { runAuditConcurrencyProbe } from "../scripts/probe-dashboard-audit-chain-concurrency.mjs";

runAuditConcurrencyProbe()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
