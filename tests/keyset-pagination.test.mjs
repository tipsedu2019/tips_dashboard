import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import {
  canonicalScopeHash,
  createCursorScope,
  decodeKeysetCursor,
  decodeManagementRelationCursor,
  encodeKeysetCursor,
  encodeManagementRelationCursor,
} from "../src/lib/keyset-pagination.ts"

const ID = "c4f692b2-87e9-4a92-94d3-bb993580bfab"

test("public keyset cursor round-trips only the validated sort tuple and UUID", () => {
  const scope = createCursorScope({
    surface: "public",
    role: "teacher",
    filters: { status: "active", grade: "중1" },
    sort: { direction: "asc", by: "name" },
  })
  const expectedScope = createHash("sha256")
    .update('{"filters":{"grade":"중1","status":"active"},"role":"teacher","sort":{"by":"name","direction":"asc"},"surface":"public"}')
    .digest("hex")
  const cursor = encodeKeysetCursor({ sortValues: ["수학 2", 2, null], id: ID, scope })

  assert.equal(scope, expectedScope)
  assert.deepEqual(
    decodeKeysetCursor(cursor, {
      scope,
      sortTypes: ["string", "number", "nullable-string"],
    }),
    { sortValues: ["수학 2", 2, null], id: ID },
  )
})

test("public keyset cursor rejects malformed, non-base64url, unknown-version, and wrong-scope inputs before query parameters exist", () => {
  const scope = "e".repeat(64)
  for (const cursor of ["not json", "%%%", Buffer.from(JSON.stringify({ v: 2, s: [], id: ID, scope })).toString("base64url")]) {
    assert.throws(
      () => decodeKeysetCursor(cursor, { scope, sortTypes: [] }),
      /cursor_(?:malformed|base64url_invalid|version_unknown)/u,
    )
  }
  const mismatched = encodeKeysetCursor({ sortValues: [], id: ID, scope: "a".repeat(64) })
  assert.throws(
    () => decodeKeysetCursor(mismatched, { scope, sortTypes: [] }),
    { code: "cursor_scope_mismatch" },
  )
  const malformedScope = Buffer.from(JSON.stringify({ v: 1, s: [], id: ID, scope: "not-a-sha256" })).toString("base64url")
  assert.throws(
    () => decodeKeysetCursor(malformedScope, { scope: "not-a-sha256", sortTypes: [] }),
    { code: "cursor_scope_invalid" },
  )
})

test("public keyset cursor has a 1024-character transport ceiling and validates sort tuple arity and types", () => {
  assert.throws(
    () => encodeKeysetCursor({ sortValues: ["x".repeat(1_100)], id: ID, scope: "a".repeat(64) }),
    { code: "cursor_too_long" },
  )
  const cursor = encodeKeysetCursor({ sortValues: ["수학", 1], id: ID, scope: "a".repeat(64) })
  assert.throws(
    () => decodeKeysetCursor(cursor, { scope: "a".repeat(64), sortTypes: ["string"] }),
    { code: "cursor_sort_arity_invalid" },
  )
  assert.throws(
    () => decodeKeysetCursor(cursor, { scope: "a".repeat(64), sortTypes: ["number", "number"] }),
    { code: "cursor_sort_type_invalid" },
  )
})

test("canonical cursor scope rejects undefined, non-finite, sparse, and non-plain values", () => {
  const invalid = [
    undefined,
    { count: Number.NaN },
    { count: Number.POSITIVE_INFINITY },
    { values: [, "middle"] },
    { when: new Date("2026-08-14T00:00:00.000Z") },
    new Map([["status", "active"]]),
  ]
  for (const value of invalid) {
    assert.throws(() => canonicalScopeHash(value), { code: "cursor_scope_canonical_invalid" })
  }
  assert.throws(
    () => createCursorScope({ surface: "public", role: "teacher", filters: undefined, sort: { by: "name" } }),
    { code: "cursor_scope_canonical_invalid" },
  )
})

test("management relation cursor binds cursor data to its exact entity and relation", () => {
  const cursor = encodeManagementRelationCursor({
    kind: "students",
    entityId: ID,
    relationKind: "enrollments",
    sortValue: "2026-08-14T00:00:00.000Z",
    id: "fc31d256-eec4-4d11-a481-f509c7a687c8",
  })

  assert.deepEqual(
    decodeManagementRelationCursor(cursor, {
      kind: "students",
      entityId: ID,
      relationKind: "enrollments",
    }),
    {
      sortValue: "2026-08-14T00:00:00.000Z",
      id: "fc31d256-eec4-4d11-a481-f509c7a687c8",
    },
  )
  assert.throws(
    () => decodeManagementRelationCursor(cursor, {
      kind: "students",
      entityId: ID,
      relationKind: "lifecycle_history",
    }),
    { code: "management_cursor_scope_mismatch" },
  )
})
