import {
  ACTIVE_CLASS_STATUS,
  PREPARING_CLASS_STATUS,
  computeClassStatus,
  normalizeClassStatus,
} from "../../lib/class-status.js";

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

function formatDurationLabel(totalMinutes) {
  const safeMinutes = Number(totalMinutes || 0);
  if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) {
    return "시간 미정";
  }
  const hours = safeMinutes / 60;
  return Number.isInteger(hours) ? `${hours}시간` : `${hours.toFixed(1)}시간`;
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
  const pattern = /([0-9]{1,2}:\d{2})\s*-\s*([0-9]{1,2}:\d{2})/g;
  let match = pattern.exec(text(schedule));
  let totalMinutes = 0;

  while (match) {
    const [, start, end] = match;
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    if (
      Number.isFinite(startHour) &&
      Number.isFinite(startMinute) &&
      Number.isFinite(endHour) &&
      Number.isFinite(endMinute)
    ) {
      totalMinutes += Math.max(0, endHour * 60 + endMinute - (startHour * 60 + startMinute));
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
  const status = classIds.length
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
    statusValue: classIds.length
      ? "assigned"
      : waitlistClassIds.length
        ? "waitlist"
        : "unassigned",
    metaSummary: buildMetaSummary([
      row.uid ? `UID ${row.uid}` : "",
      row.contact ? `연락처 ${row.contact}` : "",
      row.parent_contact || row.parentContact
        ? `학부모 ${row.parent_contact || row.parentContact}`
        : "",
      row.enroll_date || row.enrollDate
        ? `등록 ${row.enroll_date || row.enrollDate}`
        : "",
    ]),
    searchText: [
      title,
      school,
      grade,
      text(row.uid),
      text(row.contact),
      text(row.parent_contact || row.parentContact),
    ]
      .filter(Boolean)
      .join(" "),
    raw: row,
    metrics: {
      classCount: classIds.length,
      waitlistCount: waitlistClassIds.length,
      school,
    },
  };
}

export function normalizeClassManagementRecord(row = {}) {
  const studentIds = toArray(row.student_ids || row.studentIds);
  const waitlistStudentIds = toArray(
    row.waitlist_student_ids || row.waitlistStudentIds || row.waitlist_ids || row.waitlistIds,
  );
  const textbookIds = toArray(row.textbook_ids || row.textbookIds);
  const capacity = Number(row.capacity || 0);
  const normalizedStatus =
    normalizeClassStatus(row.status) || computeClassStatus(row);
  const title = text(row.name || row.className) || "이름 없는 수업";
  const subject = text(row.subject) || "과목 미정";
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
      classGroupNames.join(", "),
      text(row.grade),
      classroom,
      capacity > 0
        ? `정원 ${registeredCount}/${capacity}`
        : `수강 ${registeredCount}명`,
      `교재 ${textbookIds.length}권`,
      tuitionLabel,
    ]),
    searchText: [
      title,
      subject,
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
      textbookCount: textbookIds.length,
      capacity,
      weeklyMinutes,
      weeklyHoursLabel,
      tuitionLabel,
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
  const assigned = records.filter((record) => record.metrics.classCount > 0).length;
  const waitlist = records.filter((record) => record.metrics.waitlistCount > 0).length;
  const schools = new Set(
    records.map((record) => record.metrics.school).filter(Boolean),
  ).size;

  return [
    { label: "총 학생", value: String(total), hint: "현재 등록 학생 수" },
    { label: "수강 배정", value: String(assigned), hint: "반이 연결된 학생" },
    { label: "대기 학생", value: String(waitlist), hint: "대기 목록 포함 학생" },
    { label: "학교 수", value: String(schools), hint: "연결된 학교 수" },
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
