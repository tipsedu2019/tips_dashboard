import {
  ACTIVE_CLASS_STATUS,
  PREPARING_CLASS_STATUS,
  computeClassStatus,
  normalizeClassStatus,
} from "../../lib/class-status.js";
import {
  ACTIVE_STUDENT_STATUS,
  WITHDRAWN_STUDENT_STATUS,
  normalizeStudentStatus,
} from "../../lib/student-status.js";

const DEFAULT_CLASS_TYPE = "정규";

function text(value) {
  return String(value || "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "가격 미정";
  }

  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function buildMetaSummary(parts) {
  return parts.map(text).filter(Boolean).join(" · ");
}

function getStudentRecentIssue(row = {}) {
  return text(
    row.recent_issue ||
      row.recentIssue ||
      row.latest_issue ||
      row.latestIssue ||
      row.special_note ||
      row.specialNote ||
      row.important_note ||
      row.importantNote,
  );
}

function getClassTypeValue(row = {}) {
  return (
    text(
      row.class_type ||
        row.classType ||
        row.type ||
        row.lesson_type ||
        row.lessonType ||
        row.course_type ||
        row.courseType,
    ) || DEFAULT_CLASS_TYPE
  );
}

function formatDurationLabel(totalMinutes) {
  const safeMinutes = Number(totalMinutes || 0);
  if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) {
    return "시간 미정";
  }
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours <= 0) return `${minutes}분`;
  return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

function normalizeScheduleLines(value) {
  return text(value)
    .split(/\s*\/\s*|\n+/)
    .map((item) => text(item))
    .filter(Boolean);
}

function normalizeClassGroups(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((group) => {
      if (group && typeof group === "object") {
        return {
          id: text(group.id),
          name: text(group.name),
          subject: text(group.subject),
          sortOrder: group.sort_order ?? group.sortOrder ?? 0,
        };
      }

      const name = text(group);
      return name ? { id: name, name, subject: "", sortOrder: 0 } : null;
    })
    .filter(Boolean);
}

function computeWeeklyClassMinutes(schedule) {
  const pattern = /([월화수목금토일]+)?\s*([0-9]{1,2}:\d{2})\s*-\s*([0-9]{1,2}:\d{2})/g;
  let match = pattern.exec(text(schedule));
  let totalMinutes = 0;

  while (match) {
    const [, days, start, end] = match;
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    if (
      Number.isFinite(startHour) &&
      Number.isFinite(startMinute) &&
      Number.isFinite(endHour) &&
      Number.isFinite(endMinute)
    ) {
      const dayCount = Math.max(1, [...new Set(text(days).split(""))].filter(Boolean).length);
      totalMinutes += Math.max(0, endHour * 60 + endMinute - (startHour * 60 + startMinute)) * dayCount;
    }
    match = pattern.exec(text(schedule));
  }

  return totalMinutes;
}

export function normalizeStudentManagementRecord(row = {}) {
  const classIds = toArray(row.class_ids || row.classIds);
  const waitlistClassIds = toArray(
    row.waitlist_class_ids || row.waitlistClassIds,
  );
  const school = text(row.school) || "학교 미정";
  const grade = text(row.grade) || "학년 미정";
  const title = text(row.name) || "이름 미정";
  const status = normalizeStudentStatus(row.status);
  const recentIssue = getStudentRecentIssue(row);
  const classStatus = classIds.length
    ? `수강 ${classIds.length}개`
    : waitlistClassIds.length
      ? `대기 ${waitlistClassIds.length}개`
      : "미배정";

  return {
    kind: "students",
    id: text(row.id) || title,
    title,
    subtitle: `${school} · ${grade}`,
    badge: grade,
    badgeValue: grade,
    status,
    statusValue: status,
    metaSummary: buildMetaSummary([
      classStatus,
      row.uid ? `UID ${row.uid}` : "",
      row.contact ? `연락처 ${row.contact}` : "",
      row.parent_contact || row.parentContact
        ? `학부모 ${row.parent_contact || row.parentContact}`
        : "",
      row.enroll_date || row.enrollDate
        ? `등록 ${row.enroll_date || row.enrollDate}`
        : "",
      recentIssue ? `특이사항 ${recentIssue}` : "",
    ]),
    searchText: [
      title,
      school,
      grade,
      status,
      classStatus,
      text(row.uid),
      text(row.contact),
      text(row.parent_contact || row.parentContact),
      recentIssue,
    ]
      .filter(Boolean)
      .join(" "),
    raw: {
      ...row,
      status,
      recent_issue: recentIssue,
      recentIssue,
      class_status: classStatus,
      classStatus,
    },
    metrics: {
      status,
      classStatus,
      classCount: classIds.length,
      waitlistCount: waitlistClassIds.length,
      school,
      recentIssue,
    },
  };
}

export function normalizeClassManagementRecord(row = {}) {
  const studentIds = toArray(row.student_ids || row.studentIds);
  const waitlistStudentIds = toArray(
    row.waitlist_student_ids || row.waitlistStudentIds || row.waitlist_ids || row.waitlistIds,
  );
  const textbookIds = toArray(row.textbook_ids || row.textbookIds);
  const textbookCount = textbookIds.length || Number(row.textbook_count || row.textbookCount || 0);
  const capacity = Number(row.capacity || 0);
  const normalizedStatus =
    normalizeClassStatus(row.status) || computeClassStatus(row);
  const title = text(row.name || row.className) || "이름 없는 수업";
  const subject = text(row.subject) || "과목 미정";
  const classType = getClassTypeValue(row);
  const schedule = text(row.schedule);
  const scheduleLines = normalizeScheduleLines(schedule);
  const teacher = text(row.teacher || row.teacher_name || row.teacherName) || "담당 미정";
  const classroom = text(row.classroom || row.room) || "강의실 미정";
  const registeredCount = studentIds.length;
  const waitlistCount = waitlistStudentIds.length || Number(row.waitlist_count || row.waitlistCount || 0);
  const weeklyMinutes = computeWeeklyClassMinutes(schedule);
  const weeklyHoursLabel = formatDurationLabel(weeklyMinutes);
  const tuitionLabel = formatCurrency(row.fee || row.tuition);
  const classGroups = normalizeClassGroups(row.class_groups || row.classGroups);
  const classGroupNames = classGroups.map((group) => group.name).filter(Boolean);
  const classGroupIds =
    toArray(row.class_group_ids || row.classGroupIds).map(text).filter(Boolean) ||
    classGroups.map((group) => group.id).filter(Boolean);

  return {
    kind: "classes",
    id: text(row.id) || title,
    title,
    subtitle: buildMetaSummary([teacher, schedule || "시간표 미정"]),
    badge: subject,
    badgeValue: subject,
    status: normalizedStatus,
    statusValue: normalizedStatus,
    metaSummary: buildMetaSummary([
      classType,
      classGroupNames.join(", "),
      text(row.grade),
      classroom,
      capacity > 0
        ? `정원 ${registeredCount}/${capacity}`
        : `수강 ${registeredCount}명`,
      `교재 ${textbookCount}권`,
      tuitionLabel,
    ]),
    searchText: [
      title,
      subject,
      classType,
      teacher,
      schedule,
      text(row.grade),
      classroom,
      ...classGroupNames,
    ]
      .filter(Boolean)
      .join(" "),
    raw: {
      ...row,
      teacher,
      classroom,
      class_type: classType,
      classType,
      class_name: title,
      className: title,
      schedule_lines: scheduleLines,
      scheduleLines,
      weekly_hours_label: weeklyHoursLabel,
      weeklyHoursLabel,
      class_groups: classGroups,
      classGroups,
      class_group_ids: classGroupIds.length > 0 ? classGroupIds : classGroups.map((group) => group.id).filter(Boolean),
      classGroupIds: classGroupIds.length > 0 ? classGroupIds : classGroups.map((group) => group.id).filter(Boolean),
      class_group_names: classGroupNames,
      classGroupNames,
      registered_count: registeredCount,
      registeredCount,
      waitlist_count: waitlistCount,
      waitlistCount,
      capacity_status: capacity > 0 ? `${registeredCount}/${capacity}` : `${registeredCount}`,
      capacityStatus: capacity > 0 ? `${registeredCount}/${capacity}` : `${registeredCount}`,
      tuition_label: tuitionLabel,
      tuitionLabel,
    },
    metrics: {
      studentCount: registeredCount,
      waitlistCount,
      textbookCount,
      capacity,
      weeklyMinutes,
      weeklyHoursLabel,
      tuitionLabel,
      classType,
      teacher,
      classroom,
      scheduleLines,
      status: normalizedStatus,
      classGroupIds: classGroupIds.length > 0 ? classGroupIds : classGroups.map((group) => group.id).filter(Boolean),
      classGroupNames,
    },
  };
}

export function normalizeTextbookManagementRecord(row = {}) {
  const lessons = toArray(row.lessons);
  const tags = toArray(row.tags);
  const title = text(row.title || row.name) || "제목 없는 교재";
  const publisher = text(row.publisher) || "출판사 미정";

  return {
    kind: "textbooks",
    id: text(row.id) || title,
    title,
    subtitle: publisher,
    badge: publisher,
    badgeValue: publisher,
    status: `단원 ${lessons.length}개`,
    statusValue: lessons.length > 0 ? "has-lessons" : "no-lessons",
    metaSummary: buildMetaSummary([
      formatCurrency(row.price),
      tags.length ? tags.join(", ") : "태그 없음",
      row.updated_at || row.updatedAt ? `업데이트 ${row.updated_at || row.updatedAt}` : "",
    ]),
    searchText: [title, publisher, ...tags, ...lessons.map((lesson) => text(lesson?.title || lesson?.name || lesson?.id))]
      .filter(Boolean)
      .join(" "),
    raw: row,
    metrics: {
      lessonCount: lessons.length,
      tagCount: tags.length,
      publisher,
    },
  };
}

export function buildStudentManagementStats(records = []) {
  const total = records.length;
  const active = records.filter((record) => record.metrics.status === ACTIVE_STUDENT_STATUS).length;
  const withdrawn = records.filter((record) => record.metrics.status === WITHDRAWN_STUDENT_STATUS).length;
  const assigned = records.filter((record) => record.metrics.classCount > 0).length;

  return [
    { label: "전체 학생", value: String(total), hint: "등록된 학생" },
    { label: "재원", value: String(active), hint: "현재 재원 상태" },
    { label: "퇴원", value: String(withdrawn), hint: "삭제하지 않고 보관" },
    { label: "수업 연결", value: String(assigned), hint: "수강 중인 수업 연결" },
  ];
}

export function buildClassManagementStats(records = []) {
  const total = records.length;
  const active = records.filter(
    (record) => record.metrics.status === ACTIVE_CLASS_STATUS,
  ).length;
  const preparing = records.filter(
    (record) => record.metrics.status === PREPARING_CLASS_STATUS,
  ).length;
  const seats = records.reduce(
    (sum, record) => sum + Number(record.metrics.capacity || 0),
    0,
  );

  return [
    { label: "총 수업", value: String(total), hint: "현재 관리 중인 수업" },
    { label: "수강", value: String(active), hint: "수강 상태 수업" },
    { label: "개강 준비", value: String(preparing), hint: "개강 준비 상태 수업" },
    { label: "총 정원", value: String(seats), hint: "설정된 전체 정원" },
  ];
}

export function buildTextbookManagementStats(records = []) {
  const total = records.length;
  const publishers = new Set(
    records.map((record) => record.metrics.publisher).filter(Boolean),
  ).size;
  const tagged = records.filter((record) => record.metrics.tagCount > 0).length;
  const lessons = records.reduce(
    (sum, record) => sum + Number(record.metrics.lessonCount || 0),
    0,
  );

  return [
    { label: "총 교재", value: String(total), hint: "현재 등록 교재 수" },
    { label: "출판사 수", value: String(publishers), hint: "연결된 출판사 수" },
    { label: "태그 사용", value: String(tagged), hint: "태그가 지정된 교재" },
    { label: "총 단원", value: String(lessons), hint: "등록된 전체 단원 수" },
  ];
}
