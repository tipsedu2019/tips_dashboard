import assert from "node:assert/strict"
import test from "node:test"
import { createRegistrationContactTransport } from "../src/features/tasks/registration-contact-transport.ts"

const command = { command: "save_inquiry", taskId: "00000000-0000-4000-8000-000000000001", requestKey: "00000000-0000-4000-8000-000000000002", expectedGeneration: "2", expectedRevision: "9007199254740993", payload: { parentPhone: "01000000000", subjects: ["영어"] } }
const receipt = { version: 1, taskId: command.taskId, requestKey: command.requestKey, command: command.command, replayed: false, result: { contactState: { parentPhone: null } } }
const ok = (body = receipt) => ({ ok: true, json: async () => body })

test("actual contact transport uses a bearer session and exact envelope without client digest", async () => {
  const calls = []
  const mutate = createRegistrationContactTransport({ getAccessToken: async () => "SYNTHETIC_SESSION", fetch: async (...args) => { calls.push(args); return ok() } })
  assert.deepEqual(await mutate(command), receipt)
  assert.equal(calls.length, 1)
  const [path, request] = calls[0]
  assert.equal(path, "/api/registration/contact")
  assert.equal(request.method, "POST")
  assert.equal(request.cache, "no-store")
  assert.equal(request.headers.Authorization, "Bearer SYNTHETIC_SESSION")
  assert.ok(request.signal instanceof AbortSignal)
  assert.deepEqual(JSON.parse(request.body), command)
  assert.doesNotMatch(request.body, /digest|hmac|pepper|service_role/)
})

test("missing auth performs no HTTP request", async () => {
  let requests = 0
  const mutate = createRegistrationContactTransport({ getAccessToken: async () => null, fetch: async () => { requests++; return ok() } })
  await assert.rejects(mutate(command), /registration_contact_auth_required/)
  assert.equal(requests, 0)
})

test("a lost response never retries automatically and explicit retry preserves the same request identity", async () => {
  const requests = []
  const mutate = createRegistrationContactTransport({ getAccessToken: async () => "SYNTHETIC_SESSION", fetch: async (_path, request) => { requests.push(JSON.parse(request.body)); if (requests.length === 1) throw new TypeError("synthetic response lost"); return ok({ ...receipt, replayed: true }) } })
  await assert.rejects(mutate(command), /registration_contact_mutation_unavailable/)
  assert.equal(requests.length, 1)
  assert.equal((await mutate(command)).replayed, true)
  assert.deepEqual(requests, [command, command])
})

test("safe conflict errors survive while arbitrary response bodies never become UI error text", async () => {
  for (const [error, expected] of [["registration_contact_conflict", "registration_contact_conflict"], ["PRIVATE_SYNTHETIC_PHONE 01000000000", "registration_contact_mutation_failed"], [{ phone: "01000000000" }, "registration_contact_mutation_failed"]]) {
    const mutate = createRegistrationContactTransport({ getAccessToken: async () => "SYNTHETIC_SESSION", fetch: async () => ({ ok: false, json: async () => ({ error }) }) })
    await assert.rejects(mutate(command), (failure) => failure.message === expected)
  }
})

test("timeout covers token acquisition and prevents a late token from starting HTTP", async () => {
  let resolveToken, requests = 0
  const token = new Promise((resolve) => { resolveToken = resolve })
  const mutate = createRegistrationContactTransport({ timeoutMs: 5, getAccessToken: () => token, fetch: async () => { requests++; return ok() } })
  await assert.rejects(mutate(command), /registration_contact_mutation_timeout/)
  resolveToken("SYNTHETIC_SESSION")
  await new Promise(setImmediate)
  assert.equal(requests, 0)
})

test("timeout aborts the one in-flight HTTP request", async () => {
  let signal, requests = 0
  const mutate = createRegistrationContactTransport({ timeoutMs: 5, getAccessToken: async () => "SYNTHETIC_SESSION", fetch: async (_path, request) => { signal = request.signal; requests++; return new Promise(() => {}) } })
  await assert.rejects(mutate(command), /registration_contact_mutation_timeout/)
  assert.equal(requests, 1)
  assert.equal(signal.aborted, true)
})

test("successful responses must be JSON objects", async () => {
  for (const body of [null, [], "PRIVATE_SYNTHETIC_PHONE"]) {
    const mutate = createRegistrationContactTransport({ getAccessToken: async () => "SYNTHETIC_SESSION", fetch: async () => ok(body) })
    await assert.rejects(mutate(command), /registration_contact_response_invalid/)
  }
})
