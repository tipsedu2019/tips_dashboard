export type RegistrationDirectorDefaultMode = "eligible" | "automatic" | "manual";

export function advanceRegistrationAutomaticSavingGeneration(
  currentGeneration: number,
  hasActions: boolean,
): { generation: number; saving: boolean };

export function shouldSettleRegistrationAutomaticSavingGeneration(
  generation: number,
  latestGeneration: number,
): boolean;

export type RegistrationDirectorDefaultState = {
  mode: RegistrationDirectorDefaultMode;
  automaticProfileId: string;
  automaticCounselor: string;
};

export type RegistrationDirectorDefaultResolution = {
  status: "resolved" | "ambiguous" | "unsupported" | "unavailable";
  profileId: string;
  counselor: string;
  directorName: string;
  effectiveYear: number;
  reason: string;
};

export function getRegistrationInquiryEffectiveYear(value?: string | number | Date): number;

export function resolveRegistrationDirectorDefault(input?: {
  subjects?: string | string[];
  grade?: string;
  inquiryAt?: string | number | Date;
  teachers?: Array<{ label?: string; name?: string; profileId?: string }>;
  profiles?: Array<{ id?: string; role?: string }>;
}): RegistrationDirectorDefaultResolution;

export type RegistrationDirectorCatalogStatus = "authoritative" | "loading" | "partial" | "error";

export type RegistrationTrackDirectorDefaultResolution = {
  trackId: string;
  subject: string;
  status:
    | RegistrationDirectorDefaultResolution["status"]
    | "manual_preserved"
    | "migration_preserved"
    | "terminal_preserved"
    | "review_required";
  profileId: string;
  counselor: string;
  ruleKey: string | null;
  reason: string;
  shouldAssign: boolean;
  shouldClear: boolean;
};

export function buildRegistrationDirectorRuleKey(input?: {
  subject?: string;
  grade?: string;
  inquiryAt?: string | number | Date;
}): string;

export function resolveRegistrationTrackDirectorDefaults(input?: {
  tracks?: Array<{
    id?: string;
    subject?: string;
    status?: string;
    directorProfileId?: string | null;
    directorName?: string;
    directorAssignmentSource?: string;
    directorAssignmentRuleKey?: string;
    migrationReviewRequired?: boolean;
  }>;
  grade?: string;
  inquiryAt?: string | number | Date;
  teachers?: Array<{ label?: string; name?: string; profileId?: string }>;
  profiles?: Array<{ id?: string; role?: string }>;
  catalogStatus?: RegistrationDirectorCatalogStatus;
}): RegistrationTrackDirectorDefaultResolution[];

export function createRegistrationDirectorDefaultState(selection?: {
  profileId?: string;
  counselor?: string;
}): RegistrationDirectorDefaultState;

export function markRegistrationDirectorDefaultManual(
  state?: RegistrationDirectorDefaultState,
): RegistrationDirectorDefaultState;

export function getRegistrationDirectorDefaultTransition(input?: {
  currentProfileId?: string;
  currentCounselor?: string;
  state?: RegistrationDirectorDefaultState;
  resolution?: Partial<RegistrationDirectorDefaultResolution>;
}): {
  shouldUpdate: boolean;
  profileId: string;
  counselor: string;
  state: RegistrationDirectorDefaultState;
};
