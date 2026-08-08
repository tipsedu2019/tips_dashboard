export class OperationTimeoutError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OperationTimeoutError"
    this.code = code
  }
}

export async function withPromiseTimeout<T>(
  operation: PromiseLike<T>,
  options: { timeoutMs: number; code: string; message: string },
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new OperationTimeoutError(options.code, options.message)),
      options.timeoutMs,
    )
  })

  try {
    return await Promise.race([Promise.resolve(operation), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
