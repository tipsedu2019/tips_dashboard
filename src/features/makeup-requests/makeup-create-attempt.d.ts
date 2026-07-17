type MakeupCreateStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type MakeupCreateRuntime = {
  crypto: Crypto
  randomUUID(): string
  now(): number
}

export function runIdempotentMakeupCreate<Result>(input: {
  actorId: string
  payload: unknown
  invoke(requestId: string): Promise<Result>
  storage?: MakeupCreateStorage | null
  runtime?: MakeupCreateRuntime
}): Promise<Result>

export function clearMakeupCreateAttemptMemoryForTest(): void
