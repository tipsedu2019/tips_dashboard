import {
  getGradeBadgeLabels,
  parseGradeSelection,
  serializeGradeSelection,
} from "../../app/admin/calendar/utils/calendar-grid.js"
import { normalizeAcademicEventType } from "./academic-event-utils.js";

function text(value) {
  return String(value || "").trim();
}

function extractEmbeddedNoteMeta(note) {
  const marker = "[[TIPS_META]]";
  const raw = String(note || "");
  const markerIndex = raw.indexOf(marker);

  if (markerIndex < 0) {
    return {};
  }

  const encoded = raw.slice(markerIndex + marker.length).trim();
  try {
    return JSON.parse(encoded);
  } catch {
    return {};
  }
}

function stripEmbeddedNoteMeta(note) {
  const marker = "[[TIPS_META]]";
  const raw = String(note || "");
  const markerIndex = raw.indexOf(marker);
  return (markerIndex < 0 ? raw : raw.slice(0, markerIndex)).trim();
}

function parseDate(value) {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function enumerateDates(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue || startValue);

  if (!start) {
    return [];
  }

  const safeEnd = end && end.getTime() >= start.getTime() ? end : new Date(start.getTime());
  const dates = [];
  const cursor = new Date(start.getTime());

  while (cursor.getTime() <= safeEnd.getTime()) {
    dates.push(new Date(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function findSchool(schoolId, academicSchools = []) {
  const targetId = text(schoolId);
  if (!targetId) {
    return null;
  }

  return academicSchools.find((school) => text(school.id) === targetId) || null;
}

function normalizeEventType(value) {
  return normalizeAcademicEventType(value);
}

function deriveExamTerm(title, start) {
  const normalizedTitle = text(title)
  if (!normalizedTitle) {
    return ""
  }

  if (normalizedTitle.includes("중간")) {
    return text(start).slice(5, 7) >= "08" ? "2학기 중간" : "1학기 중간"
  }

  if (normalizedTitle.includes("기말")) {
    return text(start).slice(5, 7) >= "08" ? "2학기 기말" : "1학기 기말"
  }

  return ""
}

function normalizeAcademicEvent(row = {}, academicSchools = []) {
  const school = findSchool(row.school_id || row.schoolId, academicSchools);
  const meta = extractEmbeddedNoteMeta(row.note);
  const start = text(row.start || row.start_date || row.date);
  const end = text(row.end || row.end_date || meta.rangeEnd || start);
  const grade = serializeGradeSelection(text(row.grade) || "all")
  const examTerm = text(meta.examTerm) || deriveExamTerm(row.title, start)
  const textbookScope = text(meta.textbookScope)
  const subtextbookScope = text(meta.subtextbookScope)
  const textbookScopes = Array.isArray(meta.textbookScopes)
    ? meta.textbookScopes.map((item) => ({
        name: text(item?.name),
        publisher: text(item?.publisher),
        scope: text(item?.scope),
      }))
    : []
  const subtextbookScopes = Array.isArray(meta.subtextbookScopes)
    ? meta.subtextbookScopes.map((item) => ({
        name: text(item?.name),
        publisher: text(item?.publisher),
        scope: text(item?.scope),
      }))
    : []
  const hasExamScopeDetails = Boolean(examTerm || textbookScope || subtextbookScope || textbookScopes.length || subtextbookScopes.length)
  const inferredType = text(row.type)
    ? normalizeEventType(row.type)
    : hasExamScopeDetails
      ? "시험기간"
      : normalizeEventType(row.type)
  const schoolName = text(row.school || row.schoolName || school?.name)
  const title = text(row.title) || (inferredType === "시험기간" && examTerm ? `${schoolName || "학교 미지정"} ${examTerm}` : "제목 없는 일정")
  const academicYear = text(row.academic_year || row.academicYear || meta.academicYear || start.slice(0, 4))

  return {
    id: text(row.id),
    title,
    schoolId: text(row.school_id || row.schoolId || school?.id),
    schoolName,
    category: text(row.category || school?.category) || "all",
    type: inferredType,
    start,
    end,
    academicYear,
    grade,
    gradeBadges: getGradeBadgeLabels(grade),
    gradeValues: parseGradeSelection(grade),
    examTerm,
    textbookScope,
    subtextbookScope,
    textbookScopes,
    subtextbookScopes,
    scopeSummary: [
      ...(textbookScopes.length > 0 ? textbookScopes.map((item) => [item.name, item.scope].filter(Boolean).join(" ")) : []),
      ...(subtextbookScopes.length > 0 ? subtextbookScopes.map((item) => [item.name, item.scope].filter(Boolean).join(" ")) : []),
      textbookScope,
      subtextbookScope,
    ].filter(Boolean)[0] || "",
    note: stripEmbeddedNoteMeta(row.note || row.content),
  };
}

function getTemplateEventStyle(type) {
  const normalized = normalizeAcademicEventType(type);

  if (["시험기간", "영어시험일", "수학시험일"].includes(normalized)) {
    return { type: "task", color: "bg-rose-500" };
  }

  if (normalized === "체험학습") {
    return { type: "event", color: "bg-emerald-500" };
  }

  if (normalized === "방학·휴일·기타") {
    return { type: "reminder", color: "bg-amber-500" };
  }

  if (normalized === "팁스") {
    return { type: "meeting", color: "bg-blue-500" };
  }

  return { type: "personal", color: "bg-violet-500" };
}

export function getAcademicEventColor(type) {
  return getTemplateEventStyle(type).color;
}

function buildTemplateCalendarEntries(event) {
  const style = getTemplateEventStyle(event.type);

  return [
    {
      id: event.id,
      sourceId: event.id,
      title: event.title,
      date: parseDate(event.start),
      endDate: parseDate(event.end),
      time: event.schoolName || "학교 미지정",
      duration:
        event.start && event.end && event.start !== event.end
          ? `${event.start} ~ ${event.end}`
          : "하루 일정",
      type: style.type,
      typeLabel: event.type,
      attendees: Array.isArray(event.gradeBadges) && event.gradeBadges[0] !== "전체" ? event.gradeBadges : [],
      location: event.schoolName || "학교 미지정",
      color: style.color,
      description: event.note || event.type,
      note: event.note,
      schoolId: event.schoolId,
      schoolName: event.schoolName,
      category: event.category,
      grade: event.grade,
      examTerm: event.examTerm,
      scopeSummary: event.scopeSummary,
      textbookScope: event.textbookScope,
      subtextbookScope: event.subtextbookScope,
      textbookScopes: event.textbookScopes,
      subtextbookScopes: event.subtextbookScopes,
    },
  ];
}

export function buildAcademicCalendarTemplateModel({
  academicEvents = [],
  academicSchools = [],
} = {}) {
  const normalizedEvents = academicEvents
    .map((row) => normalizeAcademicEvent(row, academicSchools))
    .filter((event) => event.id && event.start);

  const events = normalizedEvents.flatMap(buildTemplateCalendarEntries);
  const eventDateCounts = new Map();
  normalizedEvents.forEach((event) => {
    enumerateDates(event.start, event.end).forEach((date) => {
      const key = formatDateKey(date);
      eventDateCounts.set(key, (eventDateCounts.get(key) || 0) + 1);
    });
  });
  const eventDates = [...eventDateCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, count]) => ({
      date: new Date(`${dateKey}T00:00:00`),
      count,
    }));

  return {
    events,
    eventDates,
  };
}

function createEmptyMonthBucket() {
  return {
    count: 0,
    highlights: [],
    typeLabels: [],
  };
}

function buildMonthBuckets() {
  return {
    "01": createEmptyMonthBucket(),
    "02": createEmptyMonthBucket(),
    "03": createEmptyMonthBucket(),
    "04": createEmptyMonthBucket(),
    "05": createEmptyMonthBucket(),
    "06": createEmptyMonthBucket(),
    "07": createEmptyMonthBucket(),
    "08": createEmptyMonthBucket(),
    "09": createEmptyMonthBucket(),
    "10": createEmptyMonthBucket(),
    "11": createEmptyMonthBucket(),
    "12": createEmptyMonthBucket(),
  };
}

function buildScopeSummary(event) {
  const scopeLabels = [
    ...(Array.isArray(event.textbookScopes) ? event.textbookScopes : [])
      .map((item) => [text(item?.name), text(item?.scope)].filter(Boolean).join(" ")),
    ...(Array.isArray(event.subtextbookScopes) ? event.subtextbookScopes : [])
      .map((item) => [text(item?.name), text(item?.scope)].filter(Boolean).join(" ")),
    text(event.textbookScope),
    text(event.subtextbookScope),
  ].filter(Boolean);

  return scopeLabels[0] || "";
}

function buildBoardMetaBadges(event) {
  return [text(event.examTerm), buildScopeSummary(event)].filter(Boolean).slice(0, 2);
}

function buildScheduleRangeLabel(start, end) {
  const startText = text(start)
  const endText = text(end)
  if (!startText && !endText) {
    return ""
  }
  if (!endText || endText === startText) {
    return startText
  }
  return `${startText} ~ ${endText}`
}

function buildDisplaySectionsForSubjectEntry(materialSections = []) {
  return (Array.isArray(materialSections) ? materialSections : []).map((section) => ({
    ...section,
    label: text(section?.label) === "범위/메모" ? "시험범위" : text(section?.label),
    items: Array.isArray(section?.items) ? section.items : [],
  }))
}

function getSemesterLabel(value) {
  const raw = text(value)
  if (raw === "1학기" || raw === "2학기" || raw === "전체") {
    return raw
  }
  return "전체"
}

function inferSemesterFromEntry(entry = {}) {
  const examTerm = text(entry?.examTerm)
  if (examTerm.startsWith("1학기")) return "1학기"
  if (examTerm.startsWith("2학기")) return "2학기"
  const start = text(entry?.start)
  const month = start.slice(5, 7)
  if (["01", "02", "03", "04", "05", "06", "07"].includes(month)) return "1학기"
  if (["08", "09", "10", "11", "12"].includes(month)) return "2학기"
  return ""
}

function findTextbook(textbookId, textbooks = []) {
  const targetId = text(textbookId)
  if (!targetId) {
    return null
  }

  return textbooks.find((book) => text(book?.id) === targetId) || null
}

function formatMaterialLabel(title, publisher) {
  return [text(title), text(publisher)].filter(Boolean).join(" · ")
}

function getSubjectExamBoardType(subject) {
  const normalized = text(subject)
  if (normalized.includes("영어")) {
    return "영어시험일"
  }
  if (normalized.includes("수학")) {
    return "수학시험일"
  }
  return ""
}

function getSubjectLabelForBoardType(boardType) {
  if (boardType === "영어시험일") return "영어"
  if (boardType === "수학시험일") return "수학"
  return ""
}

function getBoardTypeDisplayLabel(type) {
  if (type === "영어시험일") {
    return "영어 시험일 및 시험범위"
  }
  if (type === "수학시험일") {
    return "수학 시험일 및 시험범위"
  }
  return type || "시험기간"
}

function resolveCurriculumMaterialLabel(material = {}, textbooks = []) {
  const textbook = findTextbook(material?.textbook_id || material?.textbookId, textbooks)
  return formatMaterialLabel(
    material?.title || material?.name || textbook?.title || textbook?.name,
    material?.publisher || textbook?.publisher,
  )
}

function buildScopeItem(title, publisher, scope) {
  return {
    name: text(title),
    publisher: text(publisher),
    scope: text(scope),
  }
}

function pushUniqueScopeItem(bucket, item) {
  const normalized = buildScopeItem(item?.name, item?.publisher, item?.scope)
  if (!normalized.name && !normalized.publisher && !normalized.scope) {
    return
  }
  const key = `${normalized.name}__${normalized.publisher}__${normalized.scope}`
  if (bucket.some((existing) => `${text(existing?.name)}__${text(existing?.publisher)}__${text(existing?.scope)}` === key)) {
    return
  }
  bucket.push(normalized)
}

function buildStructuredScopeBucketsForDetails(details = [], event = {}, gradeKey = "", academyCurriculumPlans = [], academyCurriculumMaterials = [], textbooks = [], academicCurriculumProfiles = [], academicSupplementMaterials = [], academicExamMaterialPlans = [], academicExamMaterialItems = []) {
  const relevantDetails = details.filter((detail) => {
    const detailGrades = parseGradeSelection(text(detail?.grade) || "all")
    return detailGrades.includes("all") || detailGrades.includes(text(gradeKey))
  })

  const textbookScopes = []
  const subtextbookScopes = []

  relevantDetails.forEach((detail) => {
    const detailTextbookScope = text(detail?.textbook_scope || detail?.textbookScope)
    const detailSupplementScope = text(detail?.supplement_scope || detail?.supplementScope)
    const match = findMatchingCurriculumPlan(detail, event, gradeKey, academyCurriculumPlans, academicCurriculumProfiles)
    const plan = match?.source === "plan" ? match.record : null
    const profile = match?.source === "profile" ? match.record : null

    if (plan) {
      const textbook = findTextbook(plan.main_textbook_id || plan.mainTextbookId, textbooks)
      pushUniqueScopeItem(
        textbookScopes,
        buildScopeItem(textbook?.title || textbook?.name || plan?.subject, textbook?.publisher, detailTextbookScope),
      )

      academyCurriculumMaterials
        .filter((material) => text(material?.plan_id || material?.planId) === text(plan?.id))
        .forEach((material) => {
          const textbook = findTextbook(material?.textbook_id || material?.textbookId, textbooks)
          pushUniqueScopeItem(
            subtextbookScopes,
            buildScopeItem(
              material?.title || material?.name || textbook?.title || textbook?.name,
              material?.publisher || textbook?.publisher,
              material?.scope_detail || material?.scopeDetail || material?.scope || detailSupplementScope,
            ),
          )
        })
    }

    if (profile) {
      pushUniqueScopeItem(
        textbookScopes,
        buildScopeItem(
          profile?.main_textbook_title || profile?.mainTextbookTitle,
          profile?.main_textbook_publisher || profile?.mainTextbookPublisher,
          detailTextbookScope,
        ),
      )

      academicSupplementMaterials
        .filter((material) => text(material?.profile_id || material?.profileId) === text(profile?.id))
        .forEach((material) => {
          const textbook = findTextbook(material?.textbook_id || material?.textbookId, textbooks)
          pushUniqueScopeItem(
            subtextbookScopes,
            buildScopeItem(
              material?.title || material?.name || textbook?.title || textbook?.name,
              material?.publisher || textbook?.publisher,
              material?.scope_detail || material?.scopeDetail || material?.scope || detailSupplementScope,
            ),
          )
        })
    }

    const examMaterialPlan = academicExamMaterialPlans.find((plan) => {
      const sameSchool = !text(event.schoolId) || text(plan?.school_id || plan?.schoolId) === text(event.schoolId)
      const sameGrade = !gradeKey || text(plan?.grade) === text(gradeKey)
      const sameSubject = !text(detail?.subject) || text(plan?.subject) === text(detail?.subject)
      const sameYear = !text(event.academicYear || event.academic_year) || text(plan?.academic_year || plan?.academicYear) === text(event.academicYear || event.academic_year)
      const samePeriod = !text(event.examTerm) || normalizeExamPeriodKey(plan?.exam_period_code || plan?.examPeriodCode) === normalizeExamPeriodKey(event.examTerm)
      return sameSchool && sameGrade && sameSubject && sameYear && samePeriod
    })

    if (examMaterialPlan) {
      academicExamMaterialItems
        .filter((item) => text(item?.plan_id || item?.planId) === text(examMaterialPlan?.id))
        .forEach((item) => {
          const category = text(item?.material_category || item?.materialCategory).toLowerCase()
          const textbook = findTextbook(item?.textbook_id || item?.textbookId, textbooks)
          const scopeItem = buildScopeItem(
            item?.title || item?.name || textbook?.title || textbook?.name,
            item?.publisher || textbook?.publisher,
            item?.scope_detail || item?.scopeDetail || (category.includes("supplement") || category.includes("sub") || category.includes("부교재") ? detailSupplementScope : detailTextbookScope),
          )
          if (category.includes("textbook") || category.includes("main") || category.includes("교과서")) {
            pushUniqueScopeItem(textbookScopes, scopeItem)
          } else if (category.includes("supplement") || category.includes("sub") || category.includes("부교재")) {
            pushUniqueScopeItem(subtextbookScopes, scopeItem)
          }
        })
    }
  })

  return { textbookScopes, subtextbookScopes }
}

function normalizeExamPeriodKey(value) {
  const raw = text(value).toLowerCase().replace(/\s+/g, "")
  if (!raw) {
    return ""
  }
  const compact = raw.replace(/[_-]/g, "")
  if (compact.includes("1학기") && compact.includes("중간")) return "1mid"
  if (compact.includes("1학기") && compact.includes("기말")) return "1final"
  if (compact.includes("2학기") && compact.includes("중간")) return "2mid"
  if (compact.includes("2학기") && compact.includes("기말")) return "2final"
  if (compact.includes("1") && compact.includes("mid")) return "1mid"
  if (compact.includes("1") && compact.includes("middle")) return "1mid"
  if (compact.includes("1") && compact.includes("final")) return "1final"
  if (compact.includes("2") && compact.includes("mid")) return "2mid"
  if (compact.includes("2") && compact.includes("middle")) return "2mid"
  if (compact.includes("2") && compact.includes("final")) return "2final"
  return compact
}

function findMatchingCurriculumPlan(detail = {}, event = {}, gradeKey = "", academyCurriculumPlans = [], academicCurriculumProfiles = []) {
  const directPlanId = text(detail.academy_curriculum_plan_id)
  if (directPlanId) {
    const matchedPlan = academyCurriculumPlans.find((plan) => text(plan?.id) === directPlanId)
    if (matchedPlan) {
      return { source: "plan", record: matchedPlan }
    }
  }

  const directProfileId = text(detail.curriculum_profile_id || detail.curriculumProfileId)
  if (directProfileId) {
    const matchedProfile = academicCurriculumProfiles.find((profile) => text(profile?.id) === directProfileId)
    if (matchedProfile) {
      return { source: "profile", record: matchedProfile }
    }
  }

  const targetYear = text(event.academicYear || event.academic_year)
  const targetSubject = text(detail.subject)

  const matchedPlan = academyCurriculumPlans.find((plan) => {
    const sameYear = !targetYear || text(plan?.academic_year || plan?.academicYear) === targetYear
    const sameGrade = !gradeKey || text(plan?.academy_grade || plan?.academyGrade) === text(gradeKey)
    const sameSubject = !targetSubject || text(plan?.subject) === targetSubject
    return sameYear && sameGrade && sameSubject
  })
  if (matchedPlan) {
    return { source: "plan", record: matchedPlan }
  }

  const matchedProfile = academicCurriculumProfiles.find((profile) => {
    const sameYear = !targetYear || text(profile?.academic_year || profile?.academicYear) === targetYear
    const sameGrade = !gradeKey || text(profile?.grade) === text(gradeKey)
    const sameSubject = !targetSubject || text(profile?.subject) === targetSubject
    const sameSchool = !text(event.schoolId) || text(profile?.school_id || profile?.schoolId) === text(event.schoolId)
    return sameYear && sameGrade && sameSubject && sameSchool
  })

  return matchedProfile ? { source: "profile", record: matchedProfile } : null
}

function buildMaterialSectionsForEvent(event, gradeKey, academicEventExamDetails = [], academyCurriculumPlans = [], academyCurriculumMaterials = [], textbooks = [], academicCurriculumProfiles = [], academicSupplementMaterials = [], academicExamMaterialPlans = [], academicExamMaterialItems = []) {
  const relevantDetails = academicEventExamDetails.filter((detail) => {
    const sameEvent = text(detail?.academic_event_id || detail?.academicEventId) === text(event?.id)
    if (!sameEvent) {
      return false
    }

    const detailGrades = parseGradeSelection(text(detail?.grade) || "all")
    return detailGrades.includes("all") || detailGrades.includes(text(gradeKey))
  })

  return buildMaterialSectionsForDetails(
    relevantDetails,
    event,
    gradeKey,
    academyCurriculumPlans,
    academyCurriculumMaterials,
    textbooks,
    academicCurriculumProfiles,
    academicSupplementMaterials,
    academicExamMaterialPlans,
    academicExamMaterialItems,
  )
}

function buildMaterialSectionsForDetails(details = [], event = {}, gradeKey = "", academyCurriculumPlans = [], academyCurriculumMaterials = [], textbooks = [], academicCurriculumProfiles = [], academicSupplementMaterials = [], academicExamMaterialPlans = [], academicExamMaterialItems = []) {
  const relevantDetails = details.filter((detail) => {
    const detailGrades = parseGradeSelection(text(detail?.grade) || "all")
    return detailGrades.includes("all") || detailGrades.includes(text(gradeKey))
  })

  if (relevantDetails.length === 0) {
    return []
  }

  const textbookItems = []
  const supplementItems = []
  const noteItems = []

  const pushUnique = (bucket, value) => {
    const normalized = text(value)
    if (!normalized || bucket.includes(normalized)) {
      return
    }
    bucket.push(normalized)
  }

  relevantDetails.forEach((detail) => {
    const match = findMatchingCurriculumPlan(detail, event, gradeKey, academyCurriculumPlans, academicCurriculumProfiles)
    const plan = match?.source === "plan" ? match.record : null
    const profile = match?.source === "profile" ? match.record : null

    if (plan) {
      const textbook = findTextbook(plan.main_textbook_id || plan.mainTextbookId, textbooks)
      pushUnique(
        textbookItems,
        formatMaterialLabel(textbook?.title || textbook?.name || plan?.subject, textbook?.publisher),
      )

      academyCurriculumMaterials
        .filter((material) => text(material?.plan_id || material?.planId) === text(plan?.id))
        .forEach((material) => {
          pushUnique(supplementItems, resolveCurriculumMaterialLabel(material, textbooks))
          pushUnique(noteItems, text(material?.note) ? `부교재 메모 · ${text(material.note)}` : "")
        })

      pushUnique(noteItems, text(plan?.note) ? `계획 메모 · ${text(plan.note)}` : "")
    }

    if (profile) {
      pushUnique(
        textbookItems,
        formatMaterialLabel(profile?.main_textbook_title || profile?.mainTextbookTitle, profile?.main_textbook_publisher || profile?.mainTextbookPublisher),
      )

      academicSupplementMaterials
        .filter((material) => text(material?.profile_id || material?.profileId) === text(profile?.id))
        .forEach((material) => {
          pushUnique(supplementItems, resolveCurriculumMaterialLabel(material, textbooks))
          pushUnique(noteItems, text(material?.note) ? `부교재 메모 · ${text(material.note)}` : "")
        })

      pushUnique(noteItems, text(profile?.note) ? `계획 메모 · ${text(profile.note)}` : "")
    }

    const examMaterialPlan = academicExamMaterialPlans.find((plan) => {
      const sameSchool = !text(event.schoolId) || text(plan?.school_id || plan?.schoolId) === text(event.schoolId)
      const sameGrade = !gradeKey || text(plan?.grade) === text(gradeKey)
      const sameSubject = !text(detail?.subject) || text(plan?.subject) === text(detail?.subject)
      const sameYear = !text(event.academicYear || event.academic_year) || text(plan?.academic_year || plan?.academicYear) === text(event.academicYear || event.academic_year)
      const samePeriod = !text(event.examTerm) || normalizeExamPeriodKey(plan?.exam_period_code || plan?.examPeriodCode) === normalizeExamPeriodKey(event.examTerm)
      return sameSchool && sameGrade && sameSubject && sameYear && samePeriod
    })

    if (examMaterialPlan) {
      pushUnique(noteItems, text(examMaterialPlan?.note) ? `계획 메모 · ${text(examMaterialPlan.note)}` : "")

      academicExamMaterialItems
        .filter((item) => text(item?.plan_id || item?.planId) === text(examMaterialPlan?.id))
        .forEach((item) => {
          const category = text(item?.material_category || item?.materialCategory).toLowerCase()
          const label = resolveCurriculumMaterialLabel(item, textbooks)
          if (category.includes("textbook") || category.includes("main") || category.includes("교과서")) {
            pushUnique(textbookItems, label)
          } else if (category.includes("supplement") || category.includes("sub") || category.includes("부교재")) {
            pushUnique(supplementItems, label)
          } else {
            pushUnique(noteItems, label)
          }
          pushUnique(noteItems, text(item?.scope_detail || item?.scopeDetail) ? `${category.includes("supplement") || category.includes("sub") || category.includes("부교재") ? "부교재" : category.includes("textbook") || category.includes("main") || category.includes("교과서") ? "교과서" : "자료"} 범위 · ${text(item?.scope_detail || item?.scopeDetail)}` : "")
          pushUnique(noteItems, text(item?.note) ? `메모 · ${text(item.note)}` : "")
        })
    }

    pushUnique(noteItems, text(detail?.textbook_scope) ? `교과서 범위 · ${text(detail.textbook_scope)}` : "")
    pushUnique(noteItems, text(detail?.supplement_scope) ? `부교재 범위 · ${text(detail.supplement_scope)}` : "")
    pushUnique(noteItems, text(detail?.other_scope) ? `기타 범위 · ${text(detail.other_scope)}` : "")
    pushUnique(noteItems, text(detail?.note) ? `메모 · ${text(detail.note)}` : "")
  })

  return [
    textbookItems.length > 0 ? { label: "교과서", items: textbookItems } : null,
    supplementItems.length > 0 ? { label: "부교재", items: supplementItems } : null,
    noteItems.length > 0 ? { label: "범위/메모", items: noteItems } : null,
  ].filter(Boolean)
}

function buildDerivedSubjectExamEntries(event, gradeKey, academicEventExamDetails = [], academyCurriculumPlans = [], academyCurriculumMaterials = [], textbooks = [], academicCurriculumProfiles = [], academicSupplementMaterials = [], academicExamMaterialPlans = [], academicExamMaterialItems = []) {
  const detailsByType = new Map()

  academicEventExamDetails.forEach((detail) => {
    const sameEvent = text(detail?.academic_event_id || detail?.academicEventId) === text(event?.id)
    if (!sameEvent) {
      return
    }

    const detailGrades = parseGradeSelection(text(detail?.grade) || "all")
    if (!(detailGrades.includes("all") || detailGrades.includes(text(gradeKey)))) {
      return
    }

    const boardType = getSubjectExamBoardType(detail?.subject)
    if (!boardType) {
      return
    }

    const current = detailsByType.get(boardType) || []
    current.push(detail)
    detailsByType.set(boardType, current)
  })

  return [...detailsByType.entries()].map(([boardType, details]) => {
    const sortedDetails = [...details].sort((left, right) => {
      return text(left?.exam_date || left?.examDate).localeCompare(text(right?.exam_date || right?.examDate))
    })
    const primaryDetail = sortedDetails[0] || {}
    const examDate = text(primaryDetail?.exam_date || primaryDetail?.examDate)
    const dateLabel = examDate || (text(primaryDetail?.exam_date_status || primaryDetail?.examDateStatus) === "tbd" ? "시험일 미정" : (event.examTerm || "일정 미정"))
    const materialSections = buildMaterialSectionsForDetails(sortedDetails, event, gradeKey, academyCurriculumPlans, academyCurriculumMaterials, textbooks, academicCurriculumProfiles, academicSupplementMaterials, academicExamMaterialPlans, academicExamMaterialItems)
    const structuredScopeBuckets = buildStructuredScopeBucketsForDetails(sortedDetails, event, gradeKey, academyCurriculumPlans, academyCurriculumMaterials, textbooks, academicCurriculumProfiles, academicSupplementMaterials, academicExamMaterialPlans, academicExamMaterialItems)
    const linkedScheduleLabel = [event.title, buildScheduleRangeLabel(event.start, event.end)].filter(Boolean).join(" · ")

    return {
      id: `${text(event.id)}:${boardType}`,
      title: getBoardTypeDisplayLabel(boardType),
      type: boardType,
      dateLabel,
      start: examDate || event.start,
      end: examDate || event.end,
      schoolId: event.schoolId,
      schoolName: event.schoolName,
      grade: event.grade,
      gradeBadges: Array.isArray(event.gradeBadges) ? event.gradeBadges : getGradeBadgeLabels(event.grade),
      examTerm: event.examTerm,
      examDateLabel: dateLabel,
      linkedScheduleLabel,
      subjectSummary: true,
      scopeSummary: buildScopeSummary(event),
      textbookScope: text(primaryDetail?.textbook_scope || primaryDetail?.textbookScope),
      subtextbookScope: text(primaryDetail?.supplement_scope || primaryDetail?.supplementScope),
      textbookScopes: structuredScopeBuckets.textbookScopes,
      subtextbookScopes: structuredScopeBuckets.subtextbookScopes,
      metaBadges: buildBoardMetaBadges(event),
      materialSections,
      displaySections: buildDisplaySectionsForSubjectEntry(materialSections),
      color: getAcademicEventColor(boardType),
      note: text(primaryDetail?.note) || event.note,
    }
  })
}

function buildFallbackSubjectExamEntries(event, gradeKey, academyCurriculumPlans = [], academyCurriculumMaterials = [], textbooks = [], academicCurriculumProfiles = [], academicSupplementMaterials = [], academicExamMaterialPlans = [], academicExamMaterialItems = [], existingTypes = new Set()) {
  if (!text(event.examTerm) || normalizeAcademicEventType(event.type) !== "시험기간") {
    return []
  }

  return ["영어시험일", "수학시험일"].flatMap((boardType) => {
    if (existingTypes.has(boardType)) {
      return []
    }

    const subject = getSubjectLabelForBoardType(boardType)
    const syntheticDetail = {
      subject,
      grade: gradeKey,
    }
    const materialSections = buildMaterialSectionsForDetails(
      [syntheticDetail],
      event,
      gradeKey,
      academyCurriculumPlans,
      academyCurriculumMaterials,
      textbooks,
      academicCurriculumProfiles,
      academicSupplementMaterials,
      academicExamMaterialPlans,
      academicExamMaterialItems,
    )

    if (materialSections.length === 0) {
      return []
    }

    const structuredScopeBuckets = buildStructuredScopeBucketsForDetails(
      [syntheticDetail],
      event,
      gradeKey,
      academyCurriculumPlans,
      academyCurriculumMaterials,
      textbooks,
      academicCurriculumProfiles,
      academicSupplementMaterials,
      academicExamMaterialPlans,
      academicExamMaterialItems,
    )

    return [{
      id: `${text(event.id)}:${boardType}:fallback`,
      title: getBoardTypeDisplayLabel(boardType),
      type: boardType,
      dateLabel: text(event.examTerm) || "일정 미정",
      start: event.start,
      end: event.end,
      schoolId: event.schoolId,
      schoolName: event.schoolName,
      grade: event.grade,
      gradeBadges: Array.isArray(event.gradeBadges) ? event.gradeBadges : getGradeBadgeLabels(event.grade),
      examTerm: event.examTerm,
      examDateLabel: "시험일 미입력",
      linkedScheduleLabel: [event.title, buildScheduleRangeLabel(event.start, event.end)].filter(Boolean).join(" · "),
      subjectSummary: true,
      scopeSummary: buildScopeSummary(event),
      textbookScope: "",
      subtextbookScope: "",
      textbookScopes: structuredScopeBuckets.textbookScopes,
      subtextbookScopes: structuredScopeBuckets.subtextbookScopes,
      metaBadges: buildBoardMetaBadges(event),
      materialSections,
      displaySections: buildDisplaySectionsForSubjectEntry(materialSections),
      color: getAcademicEventColor(boardType),
      note: event.note,
    }]
  })
}

function buildSchoolRow(event, school, grade) {
  return {
    id: `${school?.id || event.schoolId || event.schoolName || event.id}:${grade || "all"}`,
    schoolId: school?.id || event.schoolId,
    schoolName: school?.name || event.schoolName || "학교 미지정",
    category: school?.category || event.category || "all",
    grade: grade || "all",
    gradeLabel: grade && grade !== "all" ? grade : "전체",
    gradeValues: parseGradeSelection(grade || "all"),
    gradeBadges: getGradeBadgeLabels(grade || "all"),
    totalEvents: 0,
    typeBuckets: {
      "시험기간": [],
      "영어시험일": [],
      "수학시험일": [],
      "체험학습": [],
      "방학·휴일·기타": [],
      "팁스": [],
    },
    searchText: "",
  };
}

function compareBoardEntries(left, right) {
  return (
    text(left?.start).localeCompare(text(right?.start)) ||
    text(left?.end).localeCompare(text(right?.end)) ||
    text(left?.title).localeCompare(text(right?.title), "ko")
  );
}

export function buildAcademicAnnualBoardModel({
  academicEvents = [],
  academicSchools = [],
  academicEventExamDetails = [],
  academyCurriculumPlans = [],
  academyCurriculumMaterials = [],
  academicCurriculumProfiles = [],
  academicSupplementMaterials = [],
  academicExamMaterialPlans = [],
  academicExamMaterialItems = [],
  textbooks = [],
  selectedYear = "",
  selectedSemester = "전체",
} = {}) {
  const normalizedEvents = academicEvents
    .map((row) => normalizeAcademicEvent(row, academicSchools))
    .filter((event) => event.start || event.examTerm || event.scopeSummary || event.textbookScope || event.subtextbookScope || (Array.isArray(event.textbookScopes) && event.textbookScopes.length > 0) || (Array.isArray(event.subtextbookScopes) && event.subtextbookScopes.length > 0));

  const yearOptions = [
    ...new Set(normalizedEvents.map((event) => text(event.academicYear || event.start.slice(0, 4))).filter(Boolean)),
  ].sort();
  const activeYear = text(selectedYear) || yearOptions[0] || new Date().getFullYear().toString();
  const activeSemester = getSemesterLabel(selectedSemester)
  const semesterOptions = ["전체", "1학기", "2학기"]
  const rowsBySchoolId = new Map();
  const boardTypes = ["시험기간", "영어시험일", "수학시험일", "체험학습", "방학·휴일·기타", "팁스"];

  normalizedEvents
    .filter(
      (event) =>
        text(event.academicYear || event.start.slice(0, 4)) === activeYear &&
        boardTypes.includes(event.type),
    )
    .forEach((event) => {
      const school = findSchool(event.schoolId, academicSchools);
      const eventGrades = parseGradeSelection(event.grade)
      eventGrades.forEach((gradeKey) => {
        const rowKey = `${text(school?.id || event.schoolId || event.schoolName || `unassigned-${event.id}`)}:${gradeKey}`;
        const row = rowsBySchoolId.get(rowKey) || buildSchoolRow(event, school, gradeKey);
        const dateLabel = event.start
          ? (event.start === event.end ? event.start : `${event.start} ~ ${event.end}`)
          : (event.examTerm || event.scopeSummary || event.textbookScope || event.subtextbookScope || "일정 미정");
        const materialSections = buildMaterialSectionsForEvent(
          event,
          gradeKey,
          academicEventExamDetails,
          academyCurriculumPlans,
          academyCurriculumMaterials,
          textbooks,
          academicCurriculumProfiles,
          academicSupplementMaterials,
          academicExamMaterialPlans,
          academicExamMaterialItems,
        )

        const primaryEntry = {
          id: event.id,
          title: event.type === "시험기간" && text(event.examTerm) ? `${event.examTerm}고사` : event.title,
          type: event.type,
          dateLabel,
          start: event.start,
          end: event.end,
          schoolId: event.schoolId,
          schoolName: event.schoolName,
          grade: event.grade,
          gradeBadges: Array.isArray(event.gradeBadges) ? event.gradeBadges : getGradeBadgeLabels(event.grade),
          examTerm: event.examTerm,
          scopeSummary: buildScopeSummary(event),
          textbookScope: text(event.textbookScope),
          subtextbookScope: text(event.subtextbookScope),
          textbookScopes: Array.isArray(event.textbookScopes) ? event.textbookScopes : [],
          subtextbookScopes: Array.isArray(event.subtextbookScopes) ? event.subtextbookScopes : [],
          metaBadges: buildBoardMetaBadges(event),
          materialSections,
          color: getAcademicEventColor(event.type),
          note: event.note,
        }
        if (activeSemester === "전체" || inferSemesterFromEntry(primaryEntry) === activeSemester) {
          row.typeBuckets[event.type].push(primaryEntry);
          row.totalEvents += 1;
        }
        const derivedSubjectEntries = buildDerivedSubjectExamEntries(
          event,
          gradeKey,
          academicEventExamDetails,
          academyCurriculumPlans,
          academyCurriculumMaterials,
          textbooks,
          academicCurriculumProfiles,
          academicSupplementMaterials,
          academicExamMaterialPlans,
          academicExamMaterialItems,
        )
        const existingSubjectTypes = new Set(derivedSubjectEntries.map((entry) => entry.type))
        const fallbackSubjectEntries = buildFallbackSubjectExamEntries(
          event,
          gradeKey,
          academyCurriculumPlans,
          academyCurriculumMaterials,
          textbooks,
          academicCurriculumProfiles,
          academicSupplementMaterials,
          academicExamMaterialPlans,
          academicExamMaterialItems,
          existingSubjectTypes,
        )
        ;[...derivedSubjectEntries, ...fallbackSubjectEntries].forEach((derivedEntry) => {
          if (activeSemester !== "전체" && inferSemesterFromEntry(derivedEntry) !== activeSemester) {
            return
          }
          row.typeBuckets[derivedEntry.type].push(derivedEntry)
          row.totalEvents += 1
        })
        row.searchText = [
          row.schoolName,
          row.schoolId,
          row.category,
          row.grade,
          ...row.gradeBadges,
          ...boardTypes.flatMap((type) =>
            row.typeBuckets[type].flatMap((item) => [
              item.title,
              item.dateLabel,
              item.type,
              item.examTerm,
              item.scopeSummary,
              ...(Array.isArray(item.materialSections) ? item.materialSections.flatMap((section) => [section.label, ...(Array.isArray(section.items) ? section.items : [])]) : []),
              ...(Array.isArray(item.metaBadges) ? item.metaBadges : []),
              ...(Array.isArray(item.gradeBadges) ? item.gradeBadges : []),
            ]),
          ),
        ].join(" ");

        rowsBySchoolId.set(rowKey, row);
      })
    });

  const rows = [...rowsBySchoolId.values()]
    .map((row) => ({
      ...row,
      typeBuckets: Object.fromEntries(
        boardTypes.map((type) => [type, [...(row.typeBuckets[type] || [])].sort(compareBoardEntries)]),
      ),
      gradeLabel: row.grade && row.grade !== "all" ? row.grade : "전체",
    }))
    .sort(
      (left, right) =>
        left.schoolName.localeCompare(right.schoolName, "ko") ||
        left.gradeLabel.localeCompare(right.gradeLabel, "ko"),
    );

  return {
    selectedYear: activeYear,
    selectedSemester: activeSemester,
    yearOptions,
    semesterOptions,
    boardTypes,
    rows,
    summary: {
      schoolCount: rows.length,
      eventCount: rows.reduce((sum, row) => sum + row.totalEvents, 0),
      activeTypeCount: boardTypes.filter((type) =>
        rows.some((row) => row.typeBuckets[type]?.length > 0),
      ).length,
    },
  };
}
