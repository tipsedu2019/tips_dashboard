// Adapt database/Promise fixtures to the PostgREST query-builder transport contract.
export function withRpcQueryControls(client) {
  return { ...client, rpc(...args) {
    const query = client.rpc(...args);
    if (!query.abortSignal) query.abortSignal = () => query;
    if (!query.retry) query.retry = () => query;
    return query;
  } };
}
