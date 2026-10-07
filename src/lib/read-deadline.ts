import { OperationTimeoutError } from "./promise-timeout.ts";

const READ_TIMEOUT_MESSAGE = "서버 연결이 지연되어 불러오기를 중단했습니다. 잠시 후 다시 시도해 주세요.";

/** Bound the whole read, including SDK token acquisition before fetch starts.
 * Only use for reads: aborting a request does not roll back a server mutation.
 */
export async function withReadDeadline<T>(
  read: (signal: AbortSignal) => PromiseLike<T>,
  { signal, timeoutMs = 8_000, deadline = AbortSignal.timeout(timeoutMs) }: { signal?: AbortSignal; timeoutMs?: number; deadline?: AbortSignal } = {},
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([controller.signal, deadline, ...(signal ? [signal] : [])]);
  const abortReason = () => requestSignal.reason?.name === "TimeoutError"
    ? new OperationTimeoutError("read_operation_timeout", READ_TIMEOUT_MESSAGE)
    : requestSignal.reason;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason());
    requestSignal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Register cancellation before invoking a lazy SDK thenable. A fetch signal
    // alone cannot settle a read waiting for auth.getSession()/accessToken().
    const operation = new Promise<T>((resolve) => {
      if (requestSignal.aborted) throw abortReason();
      resolve(read(requestSignal));
    });
    const result = await Promise.race([operation, aborted]);
    if (requestSignal.aborted) throw abortReason();
    return result;
  } catch (error) {
    // Stop sibling/paged reads on failure and leave late token acquisition with
    // an aborted fetch signal. The SDK's shared auth refresh is not cancelled.
    controller.abort();
    throw error;
  } finally {
    requestSignal.removeEventListener("abort", onAbort);
  }
}
