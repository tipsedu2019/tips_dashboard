import assert from "node:assert/strict"

// Supabase builders execute when awaited; configuring a deadline/retry policy
// must not itself start a second transport request.
export function fluentRpcClient(client, trace = []) {
  return {
    rpc(name, args) {
      const call = { name, args, signals: [], retryValues: [], executions: 0 }
      trace.push(call)
      let pending
      const builder = {
        abortSignal(signal) { call.signals.push(signal); return builder },
        retry(value) { call.retryValues.push(value); return builder },
        then(resolve, reject) {
          if (!pending) {
            call.executions += 1
            pending = Promise.resolve().then(() => client.rpc(name, args))
          }
          return pending.then(resolve, reject)
        },
      }
      return builder
    },
  }
}

export function assertSingleNonRetryingRpc(call) {
  assert.equal(call.signals.length, 1, "exactly one deadline signal is attached")
  assert.ok(call.signals[0] instanceof AbortSignal)
  assert.deepEqual(call.retryValues, [false], "SDK transport retries are explicitly disabled")
  assert.equal(call.executions, 1, "the fluent builder is executed once")
}
