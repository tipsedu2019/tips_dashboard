import type { OpsRegistrationCaseDetail, RegistrationSubject } from "./registration-track-service";

export type RegistrationHistoryStage =
  | "inquiry"
  | "responsibility"
  | "level_test"
  | "consultation"
  | "waiting"
  | "admission"
  | "registration"
  | "closure"
  | "reopening"
  | "migration";

export type RegistrationSubjectHistoryItem = {
  id: string;
  kind: "event" | "appointment" | "level_test" | "consultation" | "enrollment" | "batch";
  stage: RegistrationHistoryStage;
  occurredAt: string | null;
  subjects: RegistrationSubject[];
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  actorId: string | null;
  actorKind: "user" | "system" | "migration" | null;
  systemSource: string | null;
  timeKind: "exact" | "unavailable";
  origin: "canonical" | "migration";
};

export function buildRegistrationSubjectHistory(
  detail?: Partial<OpsRegistrationCaseDetail>,
): RegistrationSubjectHistoryItem[];
