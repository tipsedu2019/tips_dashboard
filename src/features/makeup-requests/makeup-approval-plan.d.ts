export function buildLegacyMakeupApprovalPlan(
  rawPlan: Record<string, unknown>, request: Record<string, unknown>,
  resources?: { teacher?: Record<string, unknown> | null; classrooms?: Array<Record<string, unknown>> },
): Record<string, unknown>;
