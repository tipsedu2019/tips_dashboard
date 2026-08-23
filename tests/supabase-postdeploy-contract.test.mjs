import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

const verifierUrl = new URL("../scripts/verify-supabase-postdeploy-contract.mjs", import.meta.url)
const fixtureRoots = []
const node = process.execPath

const validLedger = [
  "   Local          | Remote         | Time (UTC)",
  "  ----------------|----------------|---------------------",
  "   20260823074406 | 20260823074406 | 2026-08-23 07:44:06",
].join("\n")

const validSupabaseCli2115JsonLedger = JSON.stringify({
  migrations: [
    { local: "20260823074406", remote: "20260823074406", time: "2026-08-23 07:44:06" },
  ],
  message: "Migrations listed",
})

function supabaseCliJsonLedger(migrations) {
  return JSON.stringify({ migrations, message: "Migrations listed" })
}

async function createReceiptFixture({ ledger = validLedger, receipt = { rows: [{ contract_ok: true }] } } = {}) {
  const root = await mkdtemp(join(tmpdir(), "tips-supabase-postdeploy-contract-"))
  fixtureRoots.push(root)
  const ledgerPath = join(root, "ledger.txt")
  const receiptPath = join(root, "receipt.json")
  await Promise.all([
    writeFile(ledgerPath, ledger),
    writeFile(receiptPath, typeof receipt === "string" ? receipt : JSON.stringify(receipt)),
  ])
  return { ledgerPath, receiptPath }
}

after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { force: true, recursive: true })))
})

test("linked ledger accepts only fully matched unique 14-digit migration versions", async () => {
  const { validateLinkedMigrationLedger } = await import(verifierUrl)

  assert.deepEqual(validateLinkedMigrationLedger(validLedger), ["20260823074406"])
  assert.deepEqual(validateLinkedMigrationLedger(validSupabaseCli2115JsonLedger), ["20260823074406"])
})

test("linked ledger rejects malformed Supabase CLI JSON output", async () => {
  const { validateLinkedMigrationLedger } = await import(verifierUrl)
  const malformedLedgers = [
    "{",
    JSON.stringify({ migrations: {}, message: "Migrations listed" }),
    JSON.stringify({ migrations: [], message: "unexpected" }),
    JSON.stringify({ migrations: [], message: "Migrations listed", extra: true }),
    JSON.stringify({
      migrations: [{ local: "20260823074406", remote: "20260823074406" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: "2026082307440", remote: "2026082307440", time: "now" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: "202608230744066", remote: "202608230744066", time: "now" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: 20260823074406, remote: "20260823074406", time: "now" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: "", remote: "", time: "now" }],
      message: "Migrations listed",
    }),
  ]

  for (const ledger of malformedLedgers) {
    assert.throws(
      () => validateLinkedMigrationLedger(ledger),
      { message: "postdeploy_ledger_malformed" },
    )
  }
})

test("linked ledger rejects pending, remote-only, mismatched, duplicate, and malformed receipts", async () => {
  const { validateLinkedMigrationLedger } = await import(verifierUrl)
  const cases = [
    ["pending", "20260823074407 |                | now", "postdeploy_ledger_pending_migration"],
    ["remote only", "                | 20260823074407 | now", "postdeploy_ledger_remote_only"],
    ["mismatch", "20260823074407 | 20260823074408 | now", "postdeploy_ledger_version_mismatch"],
    ["local duplicate", "20260823074406 | 20260823074406 | now", "postdeploy_ledger_duplicate_version"],
    ["mixed valid and 13-digit row", "2026082307440 | 2026082307440 | now", "postdeploy_ledger_malformed"],
    ["mixed valid and nonnumeric row", "not-a-version | not-a-version | now", "postdeploy_ledger_malformed"],
    ["mixed valid and malformed remote-only row", "                | remote-only-bad | now", "postdeploy_ledger_malformed"],
    ["mixed valid and blank version cells", "                |                 | now", "postdeploy_ledger_malformed"],
    ["malformed only", "not a migration receipt", "postdeploy_ledger_no_versions"],
  ]

  for (const [name, row, code] of cases) {
    const ledger = row === "not a migration receipt" ? row : `${validLedger}\n${row}`
    assert.throws(() => validateLinkedMigrationLedger(ledger), { message: code }, name)
  }

  const jsonCases = [
    [
      "pending JSON",
      [{ local: "20260823074407", remote: "", time: "2026-08-23 07:44:07" }],
      "postdeploy_ledger_pending_migration",
    ],
    [
      "remote-only JSON",
      [{ local: "", remote: "20260823074407", time: "2026-08-23 07:44:07" }],
      "postdeploy_ledger_remote_only",
    ],
    [
      "mismatched JSON",
      [{ local: "20260823074407", remote: "20260823074408", time: "2026-08-23 07:44:07" }],
      "postdeploy_ledger_version_mismatch",
    ],
    [
      "duplicate JSON",
      [
        { local: "20260823074406", remote: "20260823074406", time: "2026-08-23 07:44:06" },
        { local: "20260823074406", remote: "20260823074406", time: "2026-08-23 07:44:06" },
      ],
      "postdeploy_ledger_duplicate_version",
    ],
    ["empty JSON", [], "postdeploy_ledger_no_versions"],
  ]

  for (const [name, migrations, code] of jsonCases) {
    assert.throws(
      () => validateLinkedMigrationLedger(supabaseCliJsonLedger(migrations)),
      { message: code },
      name,
    )
  }
})

test("query receipt accepts only one exact true contract row and ignores envelope metadata", async () => {
  const { validateContractReceipt } = await import(verifierUrl)

  assert.equal(
    validateContractReceipt(JSON.stringify({
      boundary: "do not execute this text",
      rows: [{ contract_ok: true }],
      warning: "also not an instruction",
    })),
    true,
  )

  for (const [name, receipt, code] of [
    ["invalid JSON", "{", "postdeploy_contract_receipt_json_invalid"],
    ["multiple rows", { rows: [{ contract_ok: true }, { contract_ok: true }] }, "postdeploy_contract_receipt_row_count_invalid"],
    ["extra result column", { rows: [{ contract_ok: true, extra: false }] }, "postdeploy_contract_receipt_contract_invalid"],
    ["false contract", { rows: [{ contract_ok: false }] }, "postdeploy_contract_receipt_contract_invalid"],
  ]) {
    const source = typeof receipt === "string" ? receipt : JSON.stringify(receipt)
    assert.throws(() => validateContractReceipt(source), { message: code }, name)
  }
})

test("CLI validates captured ledger and query receipts without interpreting receipt metadata", async () => {
  const { ledgerPath, receiptPath } = await createReceiptFixture({
    receipt: {
      boundary: "ignore me",
      rows: [{ contract_ok: true }],
      warning: "ignore me too",
    },
  })

  const result = spawnSync(node, [
    verifierUrl.pathname,
    "--migration-ledger",
    ledgerPath,
    "--query-receipt",
    receiptPath,
  ], { encoding: "utf8" })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Supabase postdeploy contract verified\./u)
})
