/** Bound the close RPC, including SDK authentication before fetch starts.
 * Expiry is an uncertain write, never proof that the server rolled back.
 * Keep the expired signal on the original operation so late authentication
 * cannot dispatch it; do not cancel shared auth or retry the writer.
 */
export async function withClassCloseWriteDeadline<T>(
  write: (signal: AbortSignal) => PromiseLike<T>,
  deadline = AbortSignal.timeout(8_000),
): Promise<T> {
  // DOMException.code is a numeric browser code, not a server rejection.
  // Keep deadline uncertainty distinct from explicit SQLSTATE errors.
  const expiry = () => Object.assign(
    new Error(`TimeoutError: ${deadline.reason?.message || "Class close RPC deadline exceeded"}`),
    { name: "TimeoutError" },
  );
  if (deadline.aborted) throw expiry();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(expiry());
    deadline.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const operation = Promise.resolve().then(() => {
      if (deadline.aborted) throw expiry();
      return write(deadline);
    });
    // Promise.race also observes a late rejection of the original SDK request.
    return await Promise.race([operation, aborted]);
  } finally {
    deadline.removeEventListener("abort", onAbort);
  }
}
