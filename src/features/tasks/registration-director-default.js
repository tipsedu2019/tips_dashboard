import { resolveAcademicDirector } from "../../lib/academic-director-assignment.js";

function text(value) {
  return String(value ?? "").trim();
}

function automaticState(profileId = "", counselor = "") {
  return {
    mode: "automatic",
    automaticProfileId: text(profileId),
    automaticCounselor: text(counselor),
  };
}

function eligibleState() {
  return { mode: "eligible", automaticProfileId: "", automaticCounselor: "" };
}

function manualState() {
  return { mode: "manual", automaticProfileId: "", automaticCounselor: "" };
}

export function advanceRegistrationAutomaticSavingGeneration(currentGeneration, hasActions) {
  return {
    generation: Math.max(0, Number(currentGeneration) || 0) + 1,
    saving: Boolean(hasActions),
  };
}

export function shouldSettleRegistrationAutomaticSavingGeneration(generation, latestGeneration) {
  return Number(generation) === Number(latestGeneration);
}

export function getRegistrationInquiryEffectiveYear(value) {
  const rawValue = text(value);
  if (!rawValue) return 0;

  const localDateMatch = rawValue.match(/^(\d{4})-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/);
  if (localDateMatch) return Number(localDateMatch[1]);

  const date = value instanceof Date ? value : new Date(rawValue);
  if (!Number.isFinite(date.getTime())) return 0;
  return Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(date));
}

export function resolveRegistrationDirectorDefault({
  subjects = [],
  grade = "",
  inquiryAt = "",
  teachers = [],
  profiles = [],
} = {}) {
  const effectiveYear = getRegistrationInquiryEffectiveYear(inquiryAt);
  const assignment = resolveAcademicDirector({ subjects, grade, effectiveYear: effectiveYear || undefined });
  if (assignment.status !== "resolved") {
    return {
      status: assignment.status,
      profileId: "",
      counselor: "",
      directorName: assignment.directorName,
      effectiveYear,
      reason: assignment.reason,
    };
  }

  const principalProfileIds = new Set(
    profiles
      .filter((profile) => text(profile.role).toLowerCase() === "admin")
      .map((profile) => text(profile.id))
      .filter(Boolean),
  );
  const profileIds = [...new Set(
    teachers
      .filter((teacher) => text(teacher.label ?? teacher.name) === assignment.directorName)
      .map((teacher) => text(teacher.profileId))
      .filter((profileId) => profileId && principalProfileIds.has(profileId)),
  )];

  if (profileIds.length !== 1) {
    return {
      status: "unavailable",
      profileId: "",
      counselor: "",
      directorName: assignment.directorName,
      effectiveYear,
      reason: profileIds.length > 1 ? "ambiguous_principal_profile" : "missing_principal_profile",
    };
  }

  return {
    status: "resolved",
    profileId: profileIds[0],
    counselor: assignment.directorName,
    directorName: assignment.directorName,
    effectiveYear,
    reason: assignment.reason,
  };
}

export function buildRegistrationDirectorRuleKey({ subject = "", grade = "", inquiryAt = "" } = {}) {
  const effectiveYear = getRegistrationInquiryEffectiveYear(inquiryAt);
  const normalizedSubject = text(subject);
  const normalizedGrade = text(grade).replace(/\s+/g, "");
  if (!effectiveYear || !normalizedSubject || !normalizedGrade) return "";
  return `academic-director-v1:${effectiveYear}:${normalizedSubject}:${normalizedGrade}`;
}

const TERMINAL_TRACK_STATUSES = new Set(["registered", "not_registered", "inquiry_closed"]);

export function resolveRegistrationTrackDirectorDefaults({
  tracks = [],
  grade = "",
  inquiryAt = "",
  teachers = [],
  profiles = [],
  catalogStatus = "loading",
} = {}) {
  return tracks.map((track) => {
    const trackId = text(track?.id);
    const subject = text(track?.subject);
    const currentProfileId = text(track?.directorProfileId);
    const currentSource = text(track?.directorAssignmentSource);
    const currentRuleKey = text(track?.directorAssignmentRuleKey);
    const preserved = (status) => ({
      trackId,
      subject,
      status,
      profileId: currentProfileId,
      counselor: text(track?.directorName),
      ruleKey: currentRuleKey,
      reason: status,
      shouldAssign: false,
      shouldClear: false,
    });

    if (track?.migrationReviewRequired) return preserved("review_required");
    if (TERMINAL_TRACK_STATUSES.has(text(track?.status))) return preserved("terminal_preserved");
    if (currentSource === "manual") return preserved("manual_preserved");
    if (currentSource === "migration") return preserved("migration_preserved");

    const resolution = resolveRegistrationDirectorDefault({
      subjects: subject ? [subject] : [],
      grade,
      inquiryAt,
      teachers,
      profiles,
    });
    const ruleKey = buildRegistrationDirectorRuleKey({ subject, grade, inquiryAt });
    const isSavedDefault = currentSource === "default";
    const shouldAssign = resolution.status === "resolved"
      && Boolean(resolution.profileId)
      && (
        !isSavedDefault
        || currentProfileId !== resolution.profileId
        || currentRuleKey !== ruleKey
      );
    const shouldClear = isSavedDefault && (
      resolution.status === "unsupported"
      || (resolution.status === "unavailable" && catalogStatus === "authoritative")
    ) && Boolean(currentProfileId || currentRuleKey);

    return {
      trackId,
      subject,
      status: resolution.status,
      profileId: resolution.profileId,
      counselor: resolution.counselor,
      ruleKey: resolution.status === "resolved" ? ruleKey : null,
      reason: resolution.reason,
      shouldAssign,
      shouldClear,
    };
  });
}

export function createRegistrationDirectorDefaultState({ profileId = "", counselor = "" } = {}) {
  return text(profileId) || text(counselor) ? manualState() : eligibleState();
}

export function markRegistrationDirectorDefaultManual() {
  return manualState();
}

export function getRegistrationDirectorDefaultTransition({
  currentProfileId = "",
  currentCounselor = "",
  state = eligibleState(),
  resolution = {},
} = {}) {
  const profileId = text(currentProfileId);
  const counselor = text(currentCounselor);
  const mode = state?.mode === "automatic" || state?.mode === "manual" ? state.mode : "eligible";

  if (mode === "manual") {
    return { shouldUpdate: false, profileId, counselor, state: manualState() };
  }

  if (
    mode === "automatic" &&
    (profileId !== text(state.automaticProfileId) || counselor !== text(state.automaticCounselor))
  ) {
    if (profileId || counselor) {
      return { shouldUpdate: false, profileId, counselor, state: manualState() };
    }
  }

  if (mode === "eligible" && (profileId || counselor)) {
    return { shouldUpdate: false, profileId, counselor, state: manualState() };
  }

  if (resolution.status === "resolved" && text(resolution.profileId) && text(resolution.counselor)) {
    const nextProfileId = text(resolution.profileId);
    const nextCounselor = text(resolution.counselor);
    const nextState = automaticState(nextProfileId, nextCounselor);
    return {
      shouldUpdate: profileId !== nextProfileId || counselor !== nextCounselor,
      profileId: nextProfileId,
      counselor: nextCounselor,
      state: nextState,
    };
  }

  if (mode === "automatic" && (profileId || counselor)) {
    return { shouldUpdate: true, profileId: "", counselor: "", state: eligibleState() };
  }

  return { shouldUpdate: false, profileId, counselor, state: eligibleState() };
}
