import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const helperUrl = new URL("../src/features/tasks/registration-director-default.js", import.meta.url);

async function loadHelper() {
  assert.equal(existsSync(helperUrl), true, "registration director default helper must exist");
  return import(helperUrl.href);
}

const principalProfiles = [
  { id: "profile-kang-b", label: "강부희", role: "admin" },
  { id: "profile-jung", label: "정보영", role: "admin" },
  { id: "profile-kim", label: "김민경", role: "admin" },
  { id: "profile-kang-j", label: "강정은", role: "admin" },
  { id: "profile-yang", label: "양소윤", role: "admin" },
];

const principalTeachers = [
  { id: "teacher-kang-b", label: "강부희", profileId: "profile-kang-b" },
  { id: "teacher-jung", label: "정보영", profileId: "profile-jung" },
  { id: "teacher-kim", label: "김민경", profileId: "profile-kim" },
  { id: "teacher-kang-j", label: "강정은", profileId: "profile-kang-j" },
  { id: "teacher-yang", label: "양소윤", profileId: "profile-yang" },
];

const scienceCapability = {
  subject: "과학",
  isActive: true,
  registrationCreateEnabled: true,
  gradeLevels: ["고1", "고2", "고3"],
  sortOrder: 30,
  defaultDirectorProfileId: "profile-science",
};
const scienceProfile = { id: "profile-science", label: "과학원장", role: "teacher" };
const scienceTeacher = {
  id: "teacher-science",
  label: "과학원장",
  profileId: "profile-science",
  subjects: ["과학", "과학팀"],
};

function selection(result) {
  return {
    status: result.status,
    profileId: result.profileId,
    counselor: result.counselor,
    effectiveYear: result.effectiveYear,
  };
}

test("registration inquiry years respect the Seoul boundary and local form-year semantics", async () => {
  const { getRegistrationInquiryEffectiveYear } = await loadHelper();

  assert.equal(getRegistrationInquiryEffectiveYear("2026-12-31T14:59:59.999Z"), 2026);
  assert.equal(getRegistrationInquiryEffectiveYear("2026-12-31T15:00:00.000Z"), 2027);
  assert.equal(getRegistrationInquiryEffectiveYear("2026-12-31T23:50"), 2026);
  assert.equal(getRegistrationInquiryEffectiveYear(""), 0);
});

test("automatic saving releases when a common edit replaces an in-flight batch with no actions", async () => {
  const {
    advanceRegistrationAutomaticSavingGeneration,
    shouldSettleRegistrationAutomaticSavingGeneration,
  } = await loadHelper();

  const inFlight = advanceRegistrationAutomaticSavingGeneration(0, true);
  assert.deepEqual(inFlight, { generation: 1, saving: true });

  const afterCommonEdit = advanceRegistrationAutomaticSavingGeneration(inFlight.generation, false);
  assert.deepEqual(afterCommonEdit, { generation: 2, saving: false });
  assert.equal(
    shouldSettleRegistrationAutomaticSavingGeneration(inFlight.generation, afterCommonEdit.generation),
    false,
    "the canceled older request cannot alter its successor's saving state",
  );
  assert.equal(
    shouldSettleRegistrationAutomaticSavingGeneration(afterCommonEdit.generation, afterCommonEdit.generation),
    true,
  );
});

test("registration resolves year-aware English and school-division math defaults to stable profile pairs", async () => {
  const { resolveRegistrationDirectorDefault } = await loadHelper();
  const common = { profiles: principalProfiles, teachers: principalTeachers };

  assert.deepEqual(selection(resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["영어"],
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
  })), {
    status: "resolved",
    profileId: "profile-jung",
    counselor: "정보영",
    effectiveYear: 2026,
  });
  assert.deepEqual(selection(resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["영어"],
    grade: "고2",
    inquiryAt: "2026-12-31T15:00:00.000Z",
  })), {
    status: "resolved",
    profileId: "profile-kang-b",
    counselor: "강부희",
    effectiveYear: 2027,
  });

  for (const grade of ["초4", "중2"]) {
    assert.equal(resolveRegistrationDirectorDefault({
      ...common,
      subjects: ["수학"],
      grade,
      inquiryAt: "2026-07-11T10:00",
    }).profileId, "profile-kang-j");
  }
  assert.equal(resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["수학"],
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
  }).profileId, "profile-yang");
});

test("ambiguous unsupported and unlinked principal rules leave the registration selection empty", async () => {
  const { resolveRegistrationDirectorDefault } = await loadHelper();
  const common = { profiles: principalProfiles, teachers: principalTeachers, inquiryAt: "2026-07-11T10:00" };

  for (const input of [
    { ...common, subjects: ["영어", "수학"], grade: "고2" },
    { ...common, subjects: ["영어"], grade: "초2" },
    { ...common, subjects: ["영어"], grade: "" },
    { ...common, subjects: ["과학"], grade: "고2" },
  ]) {
    const result = resolveRegistrationDirectorDefault(input);
    assert.equal(result.profileId, "");
    assert.equal(result.counselor, "");
    assert.notEqual(result.status, "resolved");
  }

  const missingLinkedAccount = resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["영어"],
    grade: "고2",
    teachers: principalTeachers.filter((teacher) => teacher.label !== "정보영"),
  });
  assert.equal(missingLinkedAccount.status, "unavailable");
  assert.equal(missingLinkedAccount.profileId, "");

  const nonPrincipalAccount = resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["영어"],
    grade: "고2",
    profiles: principalProfiles.map((profile) => profile.id === "profile-jung" ? { ...profile, role: "teacher" } : profile),
  });
  assert.equal(nonPrincipalAccount.status, "unavailable");
  assert.equal(nonPrincipalAccount.profileId, "");
});

test("science resolves only the configured active profile-linked science-team candidate", async () => {
  const { buildRegistrationDirectorRuleKey, resolveRegistrationDirectorDefault } = await loadHelper();
  const common = {
    subjects: ["과학"],
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
    capabilities: [scienceCapability],
    profiles: [...principalProfiles, scienceProfile],
    teachers: [...principalTeachers, scienceTeacher],
  };

  assert.deepEqual(selection(resolveRegistrationDirectorDefault(common)), {
    status: "resolved",
    profileId: "profile-science",
    counselor: "과학원장",
    effectiveYear: 2026,
  });
  assert.equal(buildRegistrationDirectorRuleKey({
    subject: "과학",
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
    profileId: "profile-science",
  }), "subject-director-v1:과학:profile-science");

  for (const override of [
    { capabilities: [{ ...scienceCapability, defaultDirectorProfileId: null }] },
    { capabilities: [{ ...scienceCapability, isActive: false }] },
    { profiles: principalProfiles },
    { teachers: principalTeachers },
    { teachers: [...principalTeachers, { ...scienceTeacher, subjects: ["과학"] }] },
    { teachers: [...principalTeachers, { ...scienceTeacher, subjects: ["영어"] }] },
  ]) {
    assert.equal(resolveRegistrationDirectorDefault({ ...common, ...override }).status, "unavailable");
  }
});

test("late principal options fill an eligible empty automatic default", async () => {
  const {
    createRegistrationDirectorDefaultState,
    getRegistrationDirectorDefaultTransition,
    resolveRegistrationDirectorDefault,
  } = await loadHelper();
  const baseInput = {
    subjects: ["영어"],
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
    profiles: principalProfiles,
  };
  const eligibleState = createRegistrationDirectorDefaultState();
  const unavailable = resolveRegistrationDirectorDefault({ ...baseInput, teachers: [] });
  const waiting = getRegistrationDirectorDefaultTransition({
    currentProfileId: "",
    currentCounselor: "",
    state: eligibleState,
    resolution: unavailable,
  });
  assert.equal(waiting.shouldUpdate, false);
  assert.equal(waiting.state.mode, "eligible");

  const resolved = resolveRegistrationDirectorDefault({ ...baseInput, teachers: principalTeachers });
  const hydrated = getRegistrationDirectorDefaultTransition({
    currentProfileId: "",
    currentCounselor: "",
    state: waiting.state,
    resolution: resolved,
  });
  assert.equal(hydrated.shouldUpdate, true);
  assert.equal(hydrated.profileId, "profile-jung");
  assert.equal(hydrated.counselor, "정보영");
  assert.deepEqual(hydrated.state, {
    mode: "automatic",
    automaticProfileId: "profile-jung",
    automaticCounselor: "정보영",
  });
});

test("an automatic default follows rule changes and clears when the new rule is unresolved", async () => {
  const {
    createRegistrationDirectorDefaultState,
    getRegistrationDirectorDefaultTransition,
    resolveRegistrationDirectorDefault,
  } = await loadHelper();
  const common = { profiles: principalProfiles, teachers: principalTeachers, subjects: ["영어"], grade: "고2" };
  const firstResolution = resolveRegistrationDirectorDefault({ ...common, inquiryAt: "2026-07-11T10:00" });
  const initial = getRegistrationDirectorDefaultTransition({
    currentProfileId: "",
    currentCounselor: "",
    state: createRegistrationDirectorDefaultState(),
    resolution: firstResolution,
  });
  const nextResolution = resolveRegistrationDirectorDefault({ ...common, inquiryAt: "2026-12-31T15:00:00.000Z" });
  const changed = getRegistrationDirectorDefaultTransition({
    currentProfileId: initial.profileId,
    currentCounselor: initial.counselor,
    state: initial.state,
    resolution: nextResolution,
  });
  assert.equal(changed.shouldUpdate, true);
  assert.equal(changed.profileId, "profile-kang-b");
  assert.equal(changed.counselor, "강부희");

  const unresolved = resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["영어", "수학"],
    inquiryAt: "2026-12-31T15:00:00.000Z",
  });
  const cleared = getRegistrationDirectorDefaultTransition({
    currentProfileId: changed.profileId,
    currentCounselor: changed.counselor,
    state: changed.state,
    resolution: unresolved,
  });
  assert.equal(cleared.shouldUpdate, true);
  assert.equal(cleared.profileId, "");
  assert.equal(cleared.counselor, "");
  assert.equal(cleared.state.mode, "eligible");
});

test("StrictMode replay keeps non-empty automatic changes and clears deterministic", async () => {
  const {
    createRegistrationDirectorDefaultState,
    getRegistrationDirectorDefaultTransition,
    resolveRegistrationDirectorDefault,
  } = await loadHelper();
  const common = { profiles: principalProfiles, teachers: principalTeachers, subjects: ["영어"], grade: "고2" };
  const firstResolution = resolveRegistrationDirectorDefault({ ...common, inquiryAt: "2026-07-11T10:00" });
  const first = getRegistrationDirectorDefaultTransition({
    currentProfileId: "",
    currentCounselor: "",
    state: createRegistrationDirectorDefaultState(),
    resolution: firstResolution,
  });

  const initialReplay = getRegistrationDirectorDefaultTransition({
    currentProfileId: "",
    currentCounselor: "",
    state: first.state,
    resolution: firstResolution,
  });
  assert.equal(initialReplay.shouldUpdate, true);
  assert.equal(initialReplay.profileId, "profile-jung");
  assert.equal(initialReplay.state.mode, "automatic");

  const changedResolution = resolveRegistrationDirectorDefault({ ...common, inquiryAt: "2026-12-31T15:00:00.000Z" });
  const changed = getRegistrationDirectorDefaultTransition({
    currentProfileId: first.profileId,
    currentCounselor: first.counselor,
    state: first.state,
    resolution: changedResolution,
  });
  const changedReplay = getRegistrationDirectorDefaultTransition({
    currentProfileId: first.profileId,
    currentCounselor: first.counselor,
    state: first.state,
    resolution: changedResolution,
  });
  for (const transition of [changed, changedReplay]) {
    assert.equal(transition.shouldUpdate, true);
    assert.equal(transition.profileId, "profile-kang-b");
    assert.equal(transition.counselor, "강부희");
    assert.equal(transition.state.mode, "automatic");
  }

  const unresolved = resolveRegistrationDirectorDefault({
    ...common,
    subjects: ["영어", "수학"],
    inquiryAt: "2026-07-11T10:00",
  });
  const cleared = getRegistrationDirectorDefaultTransition({
    currentProfileId: first.profileId,
    currentCounselor: first.counselor,
    state: first.state,
    resolution: unresolved,
  });
  const clearedReplay = getRegistrationDirectorDefaultTransition({
    currentProfileId: first.profileId,
    currentCounselor: first.counselor,
    state: first.state,
    resolution: unresolved,
  });
  for (const transition of [cleared, clearedReplay]) {
    assert.equal(transition.shouldUpdate, true);
    assert.equal(transition.profileId, "");
    assert.equal(transition.counselor, "");
    assert.equal(transition.state.mode, "eligible");
  }
});

test("saved and explicit administrator selections are never overwritten by automatic rules", async () => {
  const {
    createRegistrationDirectorDefaultState,
    getRegistrationDirectorDefaultTransition,
    markRegistrationDirectorDefaultManual,
    resolveRegistrationDirectorDefault,
  } = await loadHelper();
  const resolution = resolveRegistrationDirectorDefault({
    profiles: principalProfiles,
    teachers: principalTeachers,
    subjects: ["영어"],
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
  });

  const savedState = createRegistrationDirectorDefaultState({ profileId: "saved-profile", counselor: "저장 원장" });
  const saved = getRegistrationDirectorDefaultTransition({
    currentProfileId: "saved-profile",
    currentCounselor: "저장 원장",
    state: savedState,
    resolution,
  });
  assert.equal(saved.shouldUpdate, false);
  assert.equal(saved.state.mode, "manual");

  const manualState = markRegistrationDirectorDefaultManual(createRegistrationDirectorDefaultState());
  const manual = getRegistrationDirectorDefaultTransition({
    currentProfileId: "manual-profile",
    currentCounselor: "수동 원장",
    state: manualState,
    resolution,
  });
  assert.equal(manual.shouldUpdate, false);
  assert.equal(manual.state.mode, "manual");

  const unexpectedExisting = getRegistrationDirectorDefaultTransition({
    currentProfileId: "unexpected-profile",
    currentCounselor: "기존 원장",
    state: createRegistrationDirectorDefaultState(),
    resolution,
  });
  assert.equal(unexpectedExisting.shouldUpdate, false);
  assert.equal(unexpectedExisting.state.mode, "manual");
});

test("per-track director defaults resolve English and math independently with stable rule keys", async () => {
  const { buildRegistrationDirectorRuleKey, resolveRegistrationTrackDirectorDefaults } = await loadHelper();
  const tracks = [
    { id: "eng", subject: "영어", status: "inquiry", directorProfileId: null, directorAssignmentSource: "", directorAssignmentRuleKey: "", migrationReviewRequired: false },
    { id: "math", subject: "수학", status: "inquiry", directorProfileId: null, directorAssignmentSource: "", directorAssignmentRuleKey: "", migrationReviewRequired: false },
  ];
  const results = resolveRegistrationTrackDirectorDefaults({
    tracks,
    grade: "고2",
    inquiryAt: "2026-07-11T10:00",
    teachers: principalTeachers,
    profiles: principalProfiles,
    catalogStatus: "authoritative",
  });

  assert.deepEqual(results.map((result) => ({
    trackId: result.trackId,
    profileId: result.profileId,
    shouldAssign: result.shouldAssign,
    ruleKey: result.ruleKey,
  })), [
    { trackId: "eng", profileId: "profile-jung", shouldAssign: true, ruleKey: "academic-director-v1:2026:영어:고2" },
    { trackId: "math", profileId: "profile-yang", shouldAssign: true, ruleKey: "academic-director-v1:2026:수학:고2" },
  ]);
  assert.equal(buildRegistrationDirectorRuleKey({ subject: " 영어 ", grade: " 고2 ", inquiryAt: "2026-07-11T10:00" }), "academic-director-v1:2026:영어:고2");
  assert.equal(buildRegistrationDirectorRuleKey({ subject: "영어", grade: "고 2", inquiryAt: "2026-07-11T10:00" }), "academic-director-v1:2026:영어:고2");
});

test("per-track defaults preserve manual migration review and terminal assignments", async () => {
  const { resolveRegistrationTrackDirectorDefaults } = await loadHelper();
  const common = {
    grade: "고2", inquiryAt: "2026-07-11T10:00",
    teachers: principalTeachers, profiles: principalProfiles, catalogStatus: "authoritative",
  };
  const results = resolveRegistrationTrackDirectorDefaults({
    ...common,
    tracks: [
      { id: "manual", subject: "영어", status: "inquiry", directorProfileId: "saved", directorAssignmentSource: "manual" },
      { id: "migration", subject: "영어", status: "inquiry", directorProfileId: "saved", directorAssignmentSource: "migration" },
      { id: "review", subject: "영어", status: "inquiry", directorProfileId: null, directorAssignmentSource: "", migrationReviewRequired: true },
      { id: "terminal", subject: "영어", status: "registered", directorProfileId: "old", directorAssignmentSource: "default" },
    ],
  });
  assert.deepEqual(results.map((result) => [result.trackId, result.status, result.shouldAssign, result.shouldClear]), [
    ["manual", "manual_preserved", false, false],
    ["migration", "migration_preserved", false, false],
    ["review", "review_required", false, false],
    ["terminal", "terminal_preserved", false, false],
  ]);
});

test("default assignments clear only for deterministic or authoritative missing rules", async () => {
  const { resolveRegistrationTrackDirectorDefaults } = await loadHelper();
  const unsupported = { id: "unsupported", subject: "영어", status: "inquiry", directorProfileId: "old", directorAssignmentSource: "default", directorAssignmentRuleKey: "old" };
  const unavailable = { ...unsupported, id: "unavailable", subject: "영어" };
  const common = { inquiryAt: "2026-07-11T10:00", profiles: principalProfiles };

  for (const catalogStatus of ["loading", "partial", "error", "authoritative"]) {
    const [result] = resolveRegistrationTrackDirectorDefaults({
      ...common, tracks: [unsupported], grade: "초2", teachers: principalTeachers, catalogStatus,
    });
    assert.equal(result.status, "unsupported");
    assert.equal(result.shouldClear, true, `unsupported must clear during ${catalogStatus}`);
  }

  for (const catalogStatus of ["loading", "partial", "error"]) {
    const [result] = resolveRegistrationTrackDirectorDefaults({
      ...common, tracks: [unavailable], grade: "고2", teachers: [], catalogStatus,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.shouldClear, false, `transient ${catalogStatus} catalog must preserve the saved default`);
  }
  const [authoritative] = resolveRegistrationTrackDirectorDefaults({
    ...common, tracks: [unavailable], grade: "고2", teachers: [], catalogStatus: "authoritative",
  });
  assert.equal(authoritative.shouldClear, true);
});

test("compatibility-disabled science preserves an existing default while active settings remain authoritative", async () => {
  const { resolveRegistrationTrackDirectorDefaults } = await loadHelper();
  const track = {
    id: "science",
    subject: "과학",
    status: "inquiry",
    directorProfileId: "saved-science",
    directorName: "기존 과학 담당",
    directorAssignmentSource: "default",
    directorAssignmentRuleKey: "subject-director-v1:과학:saved-science",
  };
  const common = {
    tracks: [track],
    grade: "고1",
    inquiryAt: "2026-07-11T10:00",
    teachers: principalTeachers,
    profiles: principalProfiles,
    catalogStatus: "authoritative",
  };

  const [compatibility] = resolveRegistrationTrackDirectorDefaults({
    ...common,
    capabilities: [{ ...scienceCapability, isActive: false, defaultDirectorProfileId: null }],
  });
  assert.equal(compatibility.status, "unavailable");
  assert.equal(compatibility.shouldClear, false);

  const [activeMissing] = resolveRegistrationTrackDirectorDefaults({
    ...common,
    capabilities: [{ ...scienceCapability, defaultDirectorProfileId: null }],
  });
  assert.equal(activeMissing.status, "unavailable");
  assert.equal(activeMissing.shouldClear, true);
});

test("a persisted default re-resolves but an already current default is a no-op", async () => {
  const { resolveRegistrationTrackDirectorDefaults } = await loadHelper();
  const base = {
    subject: "영어", status: "inquiry", directorAssignmentSource: "default", migrationReviewRequired: false,
  };
  const input = {
    grade: "고2", inquiryAt: "2026-07-11T10:00", teachers: principalTeachers,
    profiles: principalProfiles, catalogStatus: "authoritative",
  };
  const [stale] = resolveRegistrationTrackDirectorDefaults({
    ...input, tracks: [{ ...base, id: "stale", directorProfileId: "old", directorAssignmentRuleKey: "old" }],
  });
  assert.equal(stale.shouldAssign, true);
  const [current] = resolveRegistrationTrackDirectorDefaults({
    ...input, tracks: [{ ...base, id: "current", directorProfileId: "profile-jung", directorAssignmentRuleKey: "academic-director-v1:2026:영어:고2" }],
  });
  assert.equal(current.shouldAssign, false);
  assert.equal(current.shouldClear, false);
});

test("registration helper consumes the shared resolver without copying its assignment matrix", async () => {
  await loadHelper();
  const source = await readFile(helperUrl, "utf8");

  assert.match(source, /resolveAcademicDirector/);
  assert.doesNotMatch(source, /ENGLISH_DIRECTORS|ENGLISH_PHASE_BY_GRADE|강부희|정보영|김민경|강정은|양소윤/);
});
