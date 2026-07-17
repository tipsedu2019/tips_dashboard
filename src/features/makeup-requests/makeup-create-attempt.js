const STORAGE_PREFIX = "tips.makeup.create-attempt.v1"
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/i

const memoryAttempts = new Map()

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalValue(value[key])
        return result
      }, {})
  }
  return value === undefined ? null : value
}

function defaultStorage() {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function defaultRuntime() {
  const runtimeCrypto = globalThis.crypto
  if (!runtimeCrypto?.subtle || typeof runtimeCrypto.randomUUID !== "function") {
    throw new Error("makeup_create_idempotency_unavailable")
  }
  return {
    crypto: runtimeCrypto,
    randomUUID: () => runtimeCrypto.randomUUID(),
    now: () => Date.now(),
  }
}

async function sha256(value, runtime) {
  const digest = await runtime.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("")
}

function parseAttempt(value) {
  if (!value) return null
  try {
    const attempt = JSON.parse(value)
    if (
      attempt?.version !== 1
      || !SHA256.test(attempt.fingerprint)
      || !UUID.test(attempt.requestId)
      || !Number.isFinite(attempt.createdAt)
      || attempt.createdAt <= 0
    ) return null
    return attempt
  } catch {
    return null
  }
}

function readPersistedAttempt(storage, storageKey) {
  if (!storage) return null
  try {
    return parseAttempt(storage.getItem(storageKey))
  } catch {
    return null
  }
}

function persistAttempt(storage, storageKey, attempt) {
  memoryAttempts.set(storageKey, attempt)
  if (!storage) return
  try {
    storage.setItem(storageKey, JSON.stringify(attempt))
  } catch {
    // sessionStorage가 막혀도 현재 탭 메모리에서 논리 재시도를 유지한다.
  }
}

function clearAttempt(storage, storageKey, requestId) {
  const memoryAttempt = memoryAttempts.get(storageKey)
  if (!memoryAttempt || memoryAttempt.requestId === requestId) {
    memoryAttempts.delete(storageKey)
  }
  if (!storage) return
  try {
    const persisted = parseAttempt(storage.getItem(storageKey))
    if (!persisted || persisted.requestId === requestId) {
      storage.removeItem(storageKey)
    }
  } catch {
    // 메모리 항목은 이미 정리했다.
  }
}

function isDefinitiveMutationError(error) {
  if (!error || typeof error !== "object") return false
  const code = String(error.code || "").trim()
  return code === "22023"
    || code === "40001"
    || code === "42501"
    || code === "P0002"
    || code.startsWith("23")
}

async function loadAttempt({ actorId, payload, storage, runtime }) {
  const fingerprint = await sha256(
    JSON.stringify(canonicalValue({ actorId, payload })),
    runtime,
  )
  const storageKey = `${STORAGE_PREFIX}:${fingerprint}`
  const attempt = memoryAttempts.get(storageKey)
    || readPersistedAttempt(storage, storageKey)
  const age = attempt ? runtime.now() - attempt.createdAt : Number.POSITIVE_INFINITY
  if (
    attempt
    && attempt.fingerprint === fingerprint
    && age >= 0
    && age <= ATTEMPT_TTL_MS
  ) {
    memoryAttempts.set(storageKey, attempt)
    return { ...attempt, storageKey }
  }

  if (attempt) clearAttempt(storage, storageKey, attempt.requestId)
  const next = {
    version: 1,
    fingerprint,
    requestId: runtime.randomUUID(),
    createdAt: runtime.now(),
  }
  persistAttempt(storage, storageKey, next)
  return { ...next, storageKey }
}

export async function runIdempotentMakeupCreate({
  actorId,
  payload,
  invoke,
  storage = defaultStorage(),
  runtime = defaultRuntime(),
}) {
  if (!UUID.test(String(actorId || "")) || typeof invoke !== "function") {
    throw new Error("makeup_create_idempotency_invalid")
  }
  const attempt = await loadAttempt({ actorId, payload, storage, runtime })
  try {
    const result = await invoke(attempt.requestId)
    clearAttempt(storage, attempt.storageKey, attempt.requestId)
    return result
  } catch (error) {
    if (isDefinitiveMutationError(error)) {
      clearAttempt(storage, attempt.storageKey, attempt.requestId)
    }
    throw error
  }
}

export function clearMakeupCreateAttemptMemoryForTest() {
  memoryAttempts.clear()
}
