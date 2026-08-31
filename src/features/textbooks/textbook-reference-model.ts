import { getRecordId, getTextbookTitle, listIds, normalizeTextbookLookupValue } from "./textbook-ledger.js";
import { text, numberValue, formatQuantity, getPublisherLabel, getTaxonomyCategoryLabel, normalizeStatusValue, getSubjectLabel, subjectAliases, subjectOptions, statusAliases, getClassName } from "./textbook-read-model";
import { getTextbookCategoryLabel as getCategoryLabel, TEXTBOOK_GRADE_OPTIONS, TEXTBOOK_SCHOOL_LEVEL_OPTIONS, getTextbookSubSubject, getTextbookSchoolLevelSummary, getTextbookGradeSummary, getTextbookTaxonomySelection, getTextbookGradeLabel } from "./textbook-taxonomy";
import type { Row, SearchSelectOption, SearchSelectMetaRow, SearchSelectFilterValue, SearchSelectFilterOption, SearchSelectFilterGroupConfig, SearchSelectFilterGroup } from "./textbook-read-types";

// The existing picker projection closure, shared with the synchronous workspace.
// Input order remains caller-owned; independent reads supply canonical full-source order.
const statusOptions = [
  { value: "active", label: "사용중" },
  { value: "inactive", label: "미사용" },
];

export function compactUniqueLabels(parts: Array<unknown>) {
  const seen = new Set<string>();
  return parts
    .map(text)
    .filter(Boolean)
    .filter((part) => {
      if (part === "-") return false;
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildTextbookCleanupPreviewRows(rows: Row[]) {
  return rows.map((row) => {
    const title = getTextbookTitle(row) || "교재명 없음";
    const detail = [
      getPublisherLabel(row),
      getCategoryLabel(row),
      normalizeStatusValue(row.status) === "inactive" ? "미사용" : "사용중",
    ].filter(Boolean).join(" · ");

    return {
      id: getRecordId(row) || title,
      title,
      detail,
    };
  });
}

export function getTeacherName(row: Row) {
  return text(row.name || row.teacher_name || row.teacherName || row.title || row.id);
}

export function splitTeacherNames(value: unknown) {
  return text(value)
    .split(/[,/·|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getDefaultTeacherForClass(classRecord: Row | undefined, teacherCatalogs: Row[]) {
  if (!classRecord) return "";

  const teacherIds = listIds(
    classRecord.teacher_id ||
    classRecord.teacherId ||
    classRecord.teacher_ids ||
    classRecord.teacherIds ||
    classRecord.teacher_catalog_id ||
    classRecord.teacherCatalogId,
  );

  for (const teacherId of teacherIds) {
    const teacher = teacherCatalogs.find((item) => getRecordId(item) === teacherId);
    const teacherName = getTeacherName(teacher || {});
    if (teacherName) return teacherName;
  }

  return splitTeacherNames(
    classRecord.teacher ||
    classRecord.teacher_name ||
    classRecord.teacherName ||
    classRecord.teacher_names ||
    classRecord.teacherNames,
  )[0] || "";
}

export function findLocationByCode(locations: Row[], code: string) {
  return locations.find((location) => text(location.code).toLowerCase() === code || getRecordId(location) === code);
}

export function inferClassLocationId(classRecord: Row | undefined, locations: Row[]) {
  if (!classRecord) return "";
  const classroom = text(
    classRecord.classroom ||
      classRecord.classroom_name ||
      classRecord.classroomName ||
      classRecord.room ||
      classRecord.location,
  );
  if (!classroom) return "";

  if (/(별관|별\s*\d|별\d)/.test(classroom)) {
    return text(getRecordId(findLocationByCode(locations, "annex") || {}) || findLocationByCode(locations, "annex")?.id);
  }

  if (/(본관|본\s*\d|본\d)/.test(classroom)) {
    return text(getRecordId(findLocationByCode(locations, "main") || {}) || findLocationByCode(locations, "main")?.id);
  }

  return "";
}

export function doesSearchOptionMatchFilters(
  option: SearchSelectOption,
  filterGroups: SearchSelectFilterGroup[],
  selectedFilterValues: Record<string, string[]>,
) {
  for (const group of filterGroups) {
    const selectedValues = selectedFilterValues[group.key] || [];
    if (selectedValues.length === 0) continue;
    const optionValues = new Set((option.filterValues?.[group.key] || []).map((item) => item.value));
    if (!selectedValues.some((value) => optionValues.has(value))) return false;
  }
  return true;
}

export function buildSearchSelectCommandValue(option: SearchSelectOption) {
  return [
    option.label,
    option.description,
    option.searchText,
    option.value,
    ...(option.metaRows || []).flatMap((row) => [row.label, row.value]),
    ...Object.values(option.filterValues || {}).flatMap((values) => values.flatMap((row) => [row.label, row.value])),
  ].map(text).join(" ");
}

export function buildSearchSelectMetaRows(rows: Array<SearchSelectMetaRow | null | undefined>) {
  return rows.filter((row): row is SearchSelectMetaRow => Boolean(row && text(row.value)));
}

export function buildSearchSelectFilterValue(value: unknown, label = value): SearchSelectFilterValue | null {
  const normalizedValue = text(value);
  const normalizedLabel = text(label) || normalizedValue;
  return normalizedValue ? { value: normalizedValue, label: normalizedLabel } : null;
}

export function isSearchSelectFilterValue(value: unknown): value is SearchSelectFilterValue {
  return Boolean(value && typeof value === "object" && "value" in value && "label" in value);
}

export function buildSearchSelectFilterValues(values: Array<unknown | SearchSelectFilterValue | null | undefined>) {
  const valuesByKey = new Map<string, SearchSelectFilterValue>();
  for (const value of values) {
    const filterValue = isSearchSelectFilterValue(value)
      ? buildSearchSelectFilterValue(value.value, value.label)
      : buildSearchSelectFilterValue(value);
    if (!filterValue || valuesByKey.has(filterValue.value)) continue;
    valuesByKey.set(filterValue.value, filterValue);
  }
  return [...valuesByKey.values()];
}

export function collectSearchSelectFilterOptions(options: SearchSelectOption[], groupKey: string) {
  const optionCounts = new Map<string, SearchSelectFilterOption>();
  for (const option of options) {
    const countedOptionValues = new Set<string>();
    for (const filterValue of option.filterValues?.[groupKey] || []) {
      if (countedOptionValues.has(filterValue.value)) continue;
      countedOptionValues.add(filterValue.value);
      const existing = optionCounts.get(filterValue.value);
      optionCounts.set(filterValue.value, {
        value: filterValue.value,
        label: existing?.label || filterValue.label,
        count: (existing?.count || 0) + 1,
      });
    }
  }
  return [...optionCounts.values()];
}

export function sortSearchSelectFilterOptions(options: SearchSelectFilterOption[], optionOrder: string[] = []) {
  return [...options].sort((left, right) => {
    const leftOrder = optionOrder.indexOf(left.label);
    const rightOrder = optionOrder.indexOf(right.label);
    if (leftOrder !== -1 || rightOrder !== -1) {
      if (leftOrder === -1) return 1;
      if (rightOrder === -1) return -1;
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label, "ko", { numeric: true });
  });
}

export function buildSearchSelectFilterGroups(
  options: SearchSelectOption[],
  groups: SearchSelectFilterGroupConfig[],
): SearchSelectFilterGroup[] {
  return groups.map((group) => {
    return {
      key: group.key,
      label: group.label,
      optionOrder: group.optionOrder,
      options: sortSearchSelectFilterOptions(collectSearchSelectFilterOptions(options, group.key), group.optionOrder),
    };
  }).filter((group) => group.options.length > 0);
}

export function buildVisibleSearchSelectFilterGroups(
  options: SearchSelectOption[],
  filterGroups: SearchSelectFilterGroup[],
  selectedFilterValues: Record<string, string[]>,
) {
  return filterGroups.map((group) => {
    const selectedPeerFilterValues = { ...selectedFilterValues };
    delete selectedPeerFilterValues[group.key];
    const scopedOptions = options.filter((option) => (
      doesSearchOptionMatchFilters(option, filterGroups, selectedPeerFilterValues)
    ));
    return {
      ...group,
      options: sortSearchSelectFilterOptions(collectSearchSelectFilterOptions(scopedOptions, group.key), group.optionOrder),
    };
  }).filter((group) => group.options.length > 0);
}

const textbookNonSubSubjectFilterLabels = new Set([
  ...TEXTBOOK_GRADE_OPTIONS.map((option) => option.label),
  ...TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => option.label),
]);

export function getTextbookSelectSubSubject(textbook: Row) {
  const subSubject = getTextbookSubSubject(textbook);
  return textbookNonSubSubjectFilterLabels.has(subSubject) ? "" : subSubject;
}

export function buildTextbookSelectMetaRows(textbook: Row) {
  const schoolLevel = getTextbookSchoolLevelSummary(textbook);
  const grade = getTextbookGradeSummary(textbook);
  const subSubject = getTextbookSelectSubSubject(textbook);
  const categoryDetail = compactUniqueLabels([schoolLevel, grade, subSubject]).join(" · ");

  return buildSearchSelectMetaRows([
    { label: "출판사", value: getPublisherLabel(textbook) },
    { label: "구분", value: categoryDetail || getTaxonomyCategoryLabel(textbook) },
    { label: "ISBN", value: text(textbook.isbn13) },
    { label: "바코드", value: text(textbook.barcode) },
  ]);
}

export function getClassTeacherLabel(classItem: Row) {
  return splitTeacherNames(
    classItem.teacher ||
      classItem.teacher_name ||
      classItem.teacherName ||
      classItem.teacher_names ||
      classItem.teacherNames,
  ).join(", ");
}

export function getClassClassroomSelectLabel(classItem: Row) {
  return text(
    classItem.classroom ||
      classItem.classroom_name ||
      classItem.classroomName ||
      classItem.room ||
      classItem.location ||
      classItem.location_name ||
      classItem.locationName,
  );
}

export function getClassSubjectLabel(classItem: Row) {
  const subject = text(classItem.subject || classItem.subject_name || classItem.subjectName || classItem.course || classItem.courseName);
  const normalized = subjectAliases[subject] || subjectAliases[subject.toLowerCase()];
  return normalized ? subjectOptions.find((option) => option.value === normalized)?.label || subject : subject;
}

export function getClassGradeSelectLabel(classItem: Row) {
  return text(classItem.grade || classItem.grade_label || classItem.gradeLabel || classItem.school_grade || classItem.schoolGrade);
}

export function getClassStudentCountSelectValue(classItem: Row) {
  const studentIds = listIds(classItem.student_ids || classItem.studentIds);
  return studentIds.length || numberValue(classItem.student_count || classItem.studentCount || classItem.enrollment_count || classItem.enrollmentCount);
}

export function getClassStatusLabel(classItem: Row) {
  const status = text(classItem.status || classItem.class_status || classItem.classStatus);
  if (!status) return "";
  const normalized = statusAliases[status] || statusAliases[status.toLowerCase()];
  return statusOptions.find((option) => option.value === normalized)?.label || status;
}

export function getClassScheduleLabel(classItem: Row) {
  return text(
    classItem.schedule ||
      classItem.schedule_summary ||
      classItem.scheduleSummary ||
      classItem.class_time ||
      classItem.classTime ||
      classItem.time,
  );
}

export function buildClassSelectMetaRows(classItem: Row) {
  const studentCount = getClassStudentCountSelectValue(classItem);
  return buildSearchSelectMetaRows([
    { label: "선생님", value: getClassTeacherLabel(classItem) },
    { label: "강의실", value: getClassClassroomSelectLabel(classItem) },
    { label: "학생", value: studentCount > 0 ? `${formatQuantity(studentCount)}명` : "" },
    { label: "시간", value: getClassScheduleLabel(classItem) },
  ]);
}

export function buildTextbookReferenceOptions(textbooks: Row[]){return textbooks.map((textbook) => ({
    value: getRecordId(textbook),
    label: getTextbookTitle(textbook),
    description: getSubjectLabel(textbook.subject),
    metaRows: buildTextbookSelectMetaRows(textbook),
    filterValues: {
      subject: buildSearchSelectFilterValues([getSubjectLabel(textbook.subject)]),
      grade: buildSearchSelectFilterValues(
        getTextbookTaxonomySelection(textbook).gradeLevels.map((gradeLevel) => ({
          value: gradeLevel,
          label: getTextbookGradeLabel(gradeLevel),
        })),
      ),
      subSubject: buildSearchSelectFilterValues([getTextbookSelectSubSubject(textbook)]),
    },
    searchText: [
      normalizeTextbookLookupValue(getTextbookTitle(textbook), { compact: true }),
      textbook.publisher,
      textbook.category,
      getTaxonomyCategoryLabel(textbook),
      getTextbookSchoolLevelSummary(textbook),
      getTextbookGradeSummary(textbook),
      getTextbookSelectSubSubject(textbook),
      textbook.isbn13,
      textbook.barcode,
    ].map(text).join(" "),
  }));}

export function buildTextbookClassReferenceOptions(classes: Row[]){return classes.map((classItem) => ({
    value: getRecordId(classItem),
    label: getClassName(classItem),
    description: compactUniqueLabels([getClassSubjectLabel(classItem), getClassGradeSelectLabel(classItem)]).join(" · "),
    metaRows: buildClassSelectMetaRows(classItem),
    filterValues: {
      subject: buildSearchSelectFilterValues([getClassSubjectLabel(classItem)]),
      grade: buildSearchSelectFilterValues([getClassGradeSelectLabel(classItem)]),
      teacher: buildSearchSelectFilterValues(splitTeacherNames(getClassTeacherLabel(classItem))),
    },
    searchText: [
      classItem.teacher,
      classItem.teacher_name,
      classItem.teacherName,
      getClassSubjectLabel(classItem),
      getClassGradeSelectLabel(classItem),
      getClassStatusLabel(classItem),
      getClassScheduleLabel(classItem),
    ].map(text).join(" "),
  }));}
