import { randomUUID } from 'node:crypto';

type CredentialKind = 'business_connection' | 'personal_dashboard_read' | 'ai_request' | 'employee_session';
type ResultKind = 'receipt' | 'state';
const ownerBindings: Record<CredentialKind, string> = {
  business_connection: 'issuing_admin', personal_dashboard_read: 'stored_teacher_owner',
  ai_request: 'stored_credential_policy', employee_session: 'authenticated_user',
};
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const receiptPath = new RegExp(`^/api/v[12]/(?:calendar/)?operations/${uuid}$`, 'i');
const statePath = new RegExp(`^/api/ai-agent/requests/${uuid}(?:/actions/${uuid})?$`, 'i');
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Additive headers only: never change a stored receipt, error, or data DTO. */
export function createAgentResponseContract(request: Request) {
  const requestId = randomUUID(); // Never trust/echo a caller's correlation header.
  let credential: CredentialKind | undefined;
  let result: { kind: ResultKind; path: string } | undefined;
  return {
    requestId,
    accepted(kind: CredentialKind) { credential = kind; },
    result(kind: ResultKind, path: string) {
      // Only fixed application routes plus UUIDs, never host/query/body content.
      if ((kind === 'receipt' ? receiptPath : statePath).test(path)) result = { kind, path };
    },
    finish(response: Response, body?: unknown): Response {
      const envelope = object(body), data = object(envelope?.data), error = object(envelope?.error);
      const state = data?.state;
      const transient = [429, 503].includes(response.status) && error?.code !== 'agent_api_disabled';
      const read = request.method === 'GET';
      const denied = [401, 403, 404].includes(response.status);
      const failedReceipt = result?.kind === 'receipt' && state === 'failed';
      const unresolved = Boolean(result) && state === 'unknown';
      const retryable = read && !failedReceipt && (transient || (unresolved && result?.kind === 'receipt'));
      const availableResult = !denied && (response.ok || transient || failedReceipt) ? result : undefined;
      const recovery = failedReceipt ? 'stop'
        : availableResult && (transient || unresolved) ? (availableResult.kind === 'receipt' ? 'lookup-receipt' : 'inspect-state')
        : retryable ? 'retry-read' : response.ok ? 'none' : 'stop';
      response.headers.set('X-Request-Id', requestId);
      response.headers.set('X-Agent-Retryable', String(retryable));
      response.headers.set('X-Agent-Recovery', recovery);
      if (availableResult) {
        response.headers.set('X-Agent-Result-Path', availableResult.path);
        response.headers.set('X-Agent-Result-Kind', availableResult.kind);
      }
      if (credential && response.ok) {
        response.headers.set('X-Agent-Credential-Kind', credential);
        response.headers.set('X-Agent-Owner-Binding', ownerBindings[credential]);
        response.headers.set('X-Agent-Authorization-State', 'accepted-for-request');
      }
      return response;
    },
  };
}
