export function resolveAiAgentRequestAccess({ role, isFallbackRole, loading }: {
  role: string | null | undefined; isFallbackRole: boolean | undefined; loading: boolean;
}) {
  const canUseRequests = !loading && isFallbackRole === false && ['admin', 'staff', 'teacher', 'assistant'].includes(role ?? '');
  return { canUseRequests, canViewAll: canUseRequests && role === 'admin' };
}
export type AiRequestActor = { userId: string; role: string };
export const sameAiRequestActor = (a: AiRequestActor | null, b: AiRequestActor | null) => Boolean(a && b && a.userId === b.userId && a.role === b.role);
