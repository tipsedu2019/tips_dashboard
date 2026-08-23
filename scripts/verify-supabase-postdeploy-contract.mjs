import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const VERSION_PATTERN = /^\d{14}$/

function fail(code) {
  throw new Error(code)
}

function ledgerRows(ledger) {
  const rows = []
  for (const line of String(ledger).split(/\r?\n/)) {
    const columns = line.split("|")
    if (columns.length < 2) {
      if (/\d{14}/.test(line)) fail("postdeploy_ledger_malformed")
      continue
    }
    const [local = "", remote = ""] = columns.map((column) => column.trim())
    const localIsVersion = VERSION_PATTERN.test(local)
    const remoteIsVersion = VERSION_PATTERN.test(remote)
    const hasVersion = localIsVersion || remoteIsVersion
    if (!hasVersion) {
      if (/\d{14}/.test(`${local}|${remote}`)) fail("postdeploy_ledger_malformed")
      continue
    }
    if ((local && !localIsVersion) || (remote && !remoteIsVersion)) {
      fail("postdeploy_ledger_malformed")
    }
    rows.push({ local: local || null, remote: remote || null })
  }
  return rows
}

export function validateLinkedMigrationLedger(ledger) {
  const rows = ledgerRows(ledger)
  if (rows.length === 0) fail("postdeploy_ledger_no_versions")

  const localVersions = new Set()
  const remoteVersions = new Set()
  for (const { local, remote } of rows) {
    if (local && remote && local !== remote) fail("postdeploy_ledger_version_mismatch")
    if (local && !remote) fail("postdeploy_ledger_pending_migration")
    if (remote && !local) fail("postdeploy_ledger_remote_only")
    if (localVersions.has(local) || remoteVersions.has(remote)) {
      fail("postdeploy_ledger_duplicate_version")
    }
    localVersions.add(local)
    remoteVersions.add(remote)
  }
  return [...localVersions].sort()
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function validateContractReceipt(source) {
  let receipt
  try {
    receipt = JSON.parse(String(source))
  } catch {
    fail("postdeploy_contract_receipt_json_invalid")
  }
  const rows = Array.isArray(receipt)
    ? receipt
    : isPlainRecord(receipt) && Array.isArray(receipt.rows)
      ? receipt.rows
      : null
  if (!rows || rows.length !== 1) fail("postdeploy_contract_receipt_row_count_invalid")
  const [row] = rows
  if (
    !isPlainRecord(row) ||
    JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(["contract_ok"]) ||
    row.contract_ok !== true
  ) {
    fail("postdeploy_contract_receipt_contract_invalid")
  }
  return true
}

function parseCliArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--migration-ledger" || argv[2] !== "--query-receipt") {
    fail("postdeploy_cli_arguments_invalid")
  }
  return { migrationLedgerPath: argv[1], queryReceiptPath: argv[3] }
}

async function main() {
  const { migrationLedgerPath, queryReceiptPath } = parseCliArguments(process.argv.slice(2))
  const [ledger, receipt] = await Promise.all([
    readFile(resolve(migrationLedgerPath), "utf8"),
    readFile(resolve(queryReceiptPath), "utf8"),
  ])
  validateLinkedMigrationLedger(ledger)
  validateContractReceipt(receipt)
  console.log("Supabase postdeploy contract verified.")
}

const isDirectCli = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isDirectCli) {
  await main()
}
