export const agentResponseHeaders = {
  'X-Request-Id': { description: 'Server-generated correlation UUID; never an idempotency key or caller-supplied value.', schema: { type: 'string', format: 'uuid' } },
  'X-Agent-Retryable': { description: 'True only when repeating this exact GET is appropriate after a transient failure or unknown receipt. Never authorizes retrying a mutation or changing its key.', schema: { type: 'boolean' } },
  'X-Agent-Recovery': { description: 'Suggested next step. Unknown receipts never prove failure. A state read is not a durable execution receipt.', schema: { type: 'string', enum: ['none', 'retry-read', 'lookup-receipt', 'inspect-state', 'stop'] } },
  'X-Agent-Result-Path': { description: 'Optional relative path to an existing result read. Uses the same credential and existing permissions; 401/403 means stop. Never implies completion or permission to execute.', schema: { type: 'string' } },
  'X-Agent-Result-Kind': { description: 'Receipt is a durable operation lookup; state is current request/action state only.', schema: { type: 'string', enum: ['receipt', 'state'] } },
  'X-Agent-Credential-Kind': { description: 'Present only after a successful authenticated gateway response. ai_request does not distinguish central/personal keys; their stored policy remains authoritative.', schema: { type: 'string', enum: ['business_connection', 'personal_dashboard_read', 'ai_request', 'employee_session'] } },
  'X-Agent-Owner-Binding': { description: 'Ownership rule, not a profile identity or new grant. No issuer/owner UUID, name, token, or token hash is added.', schema: { type: 'string', enum: ['issuing_admin', 'stored_teacher_owner', 'stored_credential_policy', 'authenticated_user'] } },
  'X-Agent-Authorization-State': { description: 'Acceptance for this request only. Recheck every request; not a permanent active status or proof of human approval.', schema: { const: 'accepted-for-request' } },
} as const;

export const agentCredentialContracts = {
  business_connection: {
    ownerBinding: 'issuing_admin', inspection: ['/api/v1/health', '/api/v2/health'],
    fields: ['credentialId', 'executor', 'scopes', 'classIds', 'classAccess', 'expiresAt'],
    limits: 'Health validates current credential/issuer. v2 health also requires class-details:read. Scopes describe features; selected/current-and-future/legacy_all_read class modes are distinct. Every target and write is rechecked. No school-specific grant exists for this family. Neither health endpoint discloses the issuer profile identity.',
  },
  personal_dashboard_read: {
    ownerBinding: 'stored_teacher_owner', methods: ['GET'],
    paths: ['/api/v2/classes/{classId}', '/api/v2/calendar/schools', '/api/v2/calendar/schools/{schoolId}'],
    scopes: ['class-details:read', 'calendar:read'],
    limits: 'The existing gateway checks current teacher identity and expiry for every read. Class reads additionally require reciprocal UUID assignment and an explicit class grant; school reads require an explicit school grant. Only the safe current target is returned. No health, class discovery, writes, receipt access or issuance endpoint. Owner UUID, full grants and expiresAt are not exposed; do not infer them from a successful read. Fetch this public OpenAPI without a personal Authorization header.',
  },
  ai_request: {
    ownerBinding: 'stored_credential_policy', paths: ['/api/ai-agent/requests'],
    scopes: ['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update'],
    limits: 'Central and personal AI request keys share a prefix but use a different store from business connections. Personal keys only address their stored teacher owner\'s requests; central keys use stored queue/action grants. The HTTP output does not certify which subtype, full scopes or expiry; no introspection endpoint is added. State/action journal reads retain existing read grants. No business authority follows from an AI request key.',
  },
} as const;
