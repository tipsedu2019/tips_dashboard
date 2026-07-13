import type { OpsRegistrationCaseDetail, RegistrationSubject } from "./registration-track-service";

export type RegistrationSubjectHistoryItem = {
  id: string;
  kind: "event" | "appointment" | "level_test" | "consultation" | "enrollment" | "batch";
  occurredAt: string;
  subjects: RegistrationSubject[];
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  actorId: string | null;
};

export function buildRegistrationSubjectHistory(
  detail?: Partial<OpsRegistrationCaseDetail>,
): RegistrationSubjectHistoryItem[];
