import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { defaultFilter } from "cmdk";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const modelUrl = new URL("textbook-reference-model.ts", feature);
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("./") && context.parentURL?.startsWith(feature.href)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });
const originalSource = "const statusOptions = [\n  { value: \"active\", label: \"사용중\" },\n  { value: \"inactive\", label: \"미사용\" },\n];\n\nfunction compactUniqueLabels(parts: Array<unknown>) {\n  const seen = new Set<string>();\n  return parts\n    .map(text)\n    .filter(Boolean)\n    .filter((part) => {\n      if (part === \"-\") return false;\n      const key = part.toLowerCase();\n      if (seen.has(key)) return false;\n      seen.add(key);\n      return true;\n    });\n}\n\nfunction buildTextbookCleanupPreviewRows(rows: Row[]) {\n  return rows.map((row) => {\n    const title = getTextbookTitle(row) || \"교재명 없음\";\n    const detail = [\n      getPublisherLabel(row),\n      getCategoryLabel(row),\n      normalizeStatusValue(row.status) === \"inactive\" ? \"미사용\" : \"사용중\",\n    ].filter(Boolean).join(\" · \");\n\n    return {\n      id: getRecordId(row) || title,\n      title,\n      detail,\n    };\n  });\n}\n\nfunction getTeacherName(row: Row) {\n  return text(row.name || row.teacher_name || row.teacherName || row.title || row.id);\n}\n\nfunction splitTeacherNames(value: unknown) {\n  return text(value)\n    .split(/[,/·|]/)\n    .map((item) => item.trim())\n    .filter(Boolean);\n}\n\nfunction getDefaultTeacherForClass(classRecord: Row | undefined, teacherCatalogs: Row[]) {\n  if (!classRecord) return \"\";\n\n  const teacherIds = listIds(\n    classRecord.teacher_id ||\n    classRecord.teacherId ||\n    classRecord.teacher_ids ||\n    classRecord.teacherIds ||\n    classRecord.teacher_catalog_id ||\n    classRecord.teacherCatalogId,\n  );\n\n  for (const teacherId of teacherIds) {\n    const teacher = teacherCatalogs.find((item) => getRecordId(item) === teacherId);\n    const teacherName = getTeacherName(teacher || {});\n    if (teacherName) return teacherName;\n  }\n\n  return splitTeacherNames(\n    classRecord.teacher ||\n    classRecord.teacher_name ||\n    classRecord.teacherName ||\n    classRecord.teacher_names ||\n    classRecord.teacherNames,\n  )[0] || \"\";\n}\n\nfunction findLocationByCode(locations: Row[], code: string) {\n  return locations.find((location) => text(location.code).toLowerCase() === code || getRecordId(location) === code);\n}\n\nfunction inferClassLocationId(classRecord: Row | undefined, locations: Row[]) {\n  if (!classRecord) return \"\";\n  const classroom = text(\n    classRecord.classroom ||\n      classRecord.classroom_name ||\n      classRecord.classroomName ||\n      classRecord.room ||\n      classRecord.location,\n  );\n  if (!classroom) return \"\";\n\n  if (/(별관|별\\s*\\d|별\\d)/.test(classroom)) {\n    return text(getRecordId(findLocationByCode(locations, \"annex\") || {}) || findLocationByCode(locations, \"annex\")?.id);\n  }\n\n  if (/(본관|본\\s*\\d|본\\d)/.test(classroom)) {\n    return text(getRecordId(findLocationByCode(locations, \"main\") || {}) || findLocationByCode(locations, \"main\")?.id);\n  }\n\n  return \"\";\n}\n\nfunction doesSearchOptionMatchFilters(\n  option: SearchSelectOption,\n  filterGroups: SearchSelectFilterGroup[],\n  selectedFilterValues: Record<string, string[]>,\n) {\n  for (const group of filterGroups) {\n    const selectedValues = selectedFilterValues[group.key] || [];\n    if (selectedValues.length === 0) continue;\n    const optionValues = new Set((option.filterValues?.[group.key] || []).map((item) => item.value));\n    if (!selectedValues.some((value) => optionValues.has(value))) return false;\n  }\n  return true;\n}\n\nfunction buildSearchSelectCommandValue(option: SearchSelectOption) {\n  return [\n    option.label,\n    option.description,\n    option.searchText,\n    option.value,\n    ...(option.metaRows || []).flatMap((row) => [row.label, row.value]),\n    ...Object.values(option.filterValues || {}).flatMap((values) => values.flatMap((row) => [row.label, row.value])),\n  ].map(text).join(\" \");\n}\n\nfunction buildSearchSelectMetaRows(rows: Array<SearchSelectMetaRow | null | undefined>) {\n  return rows.filter((row): row is SearchSelectMetaRow => Boolean(row && text(row.value)));\n}\n\nfunction buildSearchSelectFilterValue(value: unknown, label = value): SearchSelectFilterValue | null {\n  const normalizedValue = text(value);\n  const normalizedLabel = text(label) || normalizedValue;\n  return normalizedValue ? { value: normalizedValue, label: normalizedLabel } : null;\n}\n\nfunction isSearchSelectFilterValue(value: unknown): value is SearchSelectFilterValue {\n  return Boolean(value && typeof value === \"object\" && \"value\" in value && \"label\" in value);\n}\n\nfunction buildSearchSelectFilterValues(values: Array<unknown | SearchSelectFilterValue | null | undefined>) {\n  const valuesByKey = new Map<string, SearchSelectFilterValue>();\n  for (const value of values) {\n    const filterValue = isSearchSelectFilterValue(value)\n      ? buildSearchSelectFilterValue(value.value, value.label)\n      : buildSearchSelectFilterValue(value);\n    if (!filterValue || valuesByKey.has(filterValue.value)) continue;\n    valuesByKey.set(filterValue.value, filterValue);\n  }\n  return [...valuesByKey.values()];\n}\n\nfunction collectSearchSelectFilterOptions(options: SearchSelectOption[], groupKey: string) {\n  const optionCounts = new Map<string, SearchSelectFilterOption>();\n  for (const option of options) {\n    const countedOptionValues = new Set<string>();\n    for (const filterValue of option.filterValues?.[groupKey] || []) {\n      if (countedOptionValues.has(filterValue.value)) continue;\n      countedOptionValues.add(filterValue.value);\n      const existing = optionCounts.get(filterValue.value);\n      optionCounts.set(filterValue.value, {\n        value: filterValue.value,\n        label: existing?.label || filterValue.label,\n        count: (existing?.count || 0) + 1,\n      });\n    }\n  }\n  return [...optionCounts.values()];\n}\n\nfunction sortSearchSelectFilterOptions(options: SearchSelectFilterOption[], optionOrder: string[] = []) {\n  return [...options].sort((left, right) => {\n    const leftOrder = optionOrder.indexOf(left.label);\n    const rightOrder = optionOrder.indexOf(right.label);\n    if (leftOrder !== -1 || rightOrder !== -1) {\n      if (leftOrder === -1) return 1;\n      if (rightOrder === -1) return -1;\n      return leftOrder - rightOrder;\n    }\n    return left.label.localeCompare(right.label, \"ko\", { numeric: true });\n  });\n}\n\nfunction buildSearchSelectFilterGroups(\n  options: SearchSelectOption[],\n  groups: SearchSelectFilterGroupConfig[],\n): SearchSelectFilterGroup[] {\n  return groups.map((group) => {\n    return {\n      key: group.key,\n      label: group.label,\n      optionOrder: group.optionOrder,\n      options: sortSearchSelectFilterOptions(collectSearchSelectFilterOptions(options, group.key), group.optionOrder),\n    };\n  }).filter((group) => group.options.length > 0);\n}\n\nfunction buildVisibleSearchSelectFilterGroups(\n  options: SearchSelectOption[],\n  filterGroups: SearchSelectFilterGroup[],\n  selectedFilterValues: Record<string, string[]>,\n) {\n  return filterGroups.map((group) => {\n    const selectedPeerFilterValues = { ...selectedFilterValues };\n    delete selectedPeerFilterValues[group.key];\n    const scopedOptions = options.filter((option) => (\n      doesSearchOptionMatchFilters(option, filterGroups, selectedPeerFilterValues)\n    ));\n    return {\n      ...group,\n      options: sortSearchSelectFilterOptions(collectSearchSelectFilterOptions(scopedOptions, group.key), group.optionOrder),\n    };\n  }).filter((group) => group.options.length > 0);\n}\n\nconst textbookNonSubSubjectFilterLabels = new Set([\n  ...TEXTBOOK_GRADE_OPTIONS.map((option) => option.label),\n  ...TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => option.label),\n]);\n\nfunction getTextbookSelectSubSubject(textbook: Row) {\n  const subSubject = getTextbookSubSubject(textbook);\n  return textbookNonSubSubjectFilterLabels.has(subSubject) ? \"\" : subSubject;\n}\n\nfunction buildTextbookSelectMetaRows(textbook: Row) {\n  const schoolLevel = getTextbookSchoolLevelSummary(textbook);\n  const grade = getTextbookGradeSummary(textbook);\n  const subSubject = getTextbookSelectSubSubject(textbook);\n  const categoryDetail = compactUniqueLabels([schoolLevel, grade, subSubject]).join(\" · \");\n\n  return buildSearchSelectMetaRows([\n    { label: \"출판사\", value: getPublisherLabel(textbook) },\n    { label: \"구분\", value: categoryDetail || getTaxonomyCategoryLabel(textbook) },\n    { label: \"ISBN\", value: text(textbook.isbn13) },\n    { label: \"바코드\", value: text(textbook.barcode) },\n  ]);\n}\n\nfunction getClassTeacherLabel(classItem: Row) {\n  return splitTeacherNames(\n    classItem.teacher ||\n      classItem.teacher_name ||\n      classItem.teacherName ||\n      classItem.teacher_names ||\n      classItem.teacherNames,\n  ).join(\", \");\n}\n\nfunction getClassClassroomSelectLabel(classItem: Row) {\n  return text(\n    classItem.classroom ||\n      classItem.classroom_name ||\n      classItem.classroomName ||\n      classItem.room ||\n      classItem.location ||\n      classItem.location_name ||\n      classItem.locationName,\n  );\n}\n\nfunction getClassSubjectLabel(classItem: Row) {\n  const subject = text(classItem.subject || classItem.subject_name || classItem.subjectName || classItem.course || classItem.courseName);\n  const normalized = subjectAliases[subject] || subjectAliases[subject.toLowerCase()];\n  return normalized ? subjectOptions.find((option) => option.value === normalized)?.label || subject : subject;\n}\n\nfunction getClassGradeSelectLabel(classItem: Row) {\n  return text(classItem.grade || classItem.grade_label || classItem.gradeLabel || classItem.school_grade || classItem.schoolGrade);\n}\n\nfunction getClassStudentCountSelectValue(classItem: Row) {\n  const studentIds = listIds(classItem.student_ids || classItem.studentIds);\n  return studentIds.length || numberValue(classItem.student_count || classItem.studentCount || classItem.enrollment_count || classItem.enrollmentCount);\n}\n\nfunction getClassStatusLabel(classItem: Row) {\n  const status = text(classItem.status || classItem.class_status || classItem.classStatus);\n  if (!status) return \"\";\n  const normalized = statusAliases[status] || statusAliases[status.toLowerCase()];\n  return statusOptions.find((option) => option.value === normalized)?.label || status;\n}\n\nfunction getClassScheduleLabel(classItem: Row) {\n  return text(\n    classItem.schedule ||\n      classItem.schedule_summary ||\n      classItem.scheduleSummary ||\n      classItem.class_time ||\n      classItem.classTime ||\n      classItem.time,\n  );\n}\n\nfunction buildClassSelectMetaRows(classItem: Row) {\n  const studentCount = getClassStudentCountSelectValue(classItem);\n  return buildSearchSelectMetaRows([\n    { label: \"선생님\", value: getClassTeacherLabel(classItem) },\n    { label: \"강의실\", value: getClassClassroomSelectLabel(classItem) },\n    { label: \"학생\", value: studentCount > 0 ? `${formatQuantity(studentCount)}명` : \"\" },\n    { label: \"시간\", value: getClassScheduleLabel(classItem) },\n  ]);\n}\n\nfunction buildTextbookReferenceOptions(textbooks: Row[]){return textbooks.map((textbook) => ({\n    value: getRecordId(textbook),\n    label: getTextbookTitle(textbook),\n    description: getSubjectLabel(textbook.subject),\n    metaRows: buildTextbookSelectMetaRows(textbook),\n    filterValues: {\n      subject: buildSearchSelectFilterValues([getSubjectLabel(textbook.subject)]),\n      grade: buildSearchSelectFilterValues(\n        getTextbookTaxonomySelection(textbook).gradeLevels.map((gradeLevel) => ({\n          value: gradeLevel,\n          label: getTextbookGradeLabel(gradeLevel),\n        })),\n      ),\n      subSubject: buildSearchSelectFilterValues([getTextbookSelectSubSubject(textbook)]),\n    },\n    searchText: [\n      normalizeTextbookLookupValue(getTextbookTitle(textbook), { compact: true }),\n      textbook.publisher,\n      textbook.category,\n      getTaxonomyCategoryLabel(textbook),\n      getTextbookSchoolLevelSummary(textbook),\n      getTextbookGradeSummary(textbook),\n      getTextbookSelectSubSubject(textbook),\n      textbook.isbn13,\n      textbook.barcode,\n    ].map(text).join(\" \"),\n  }));}\n\nfunction buildTextbookClassReferenceOptions(classes: Row[]){return classes.map((classItem) => ({\n    value: getRecordId(classItem),\n    label: getClassName(classItem),\n    description: compactUniqueLabels([getClassSubjectLabel(classItem), getClassGradeSelectLabel(classItem)]).join(\" · \"),\n    metaRows: buildClassSelectMetaRows(classItem),\n    filterValues: {\n      subject: buildSearchSelectFilterValues([getClassSubjectLabel(classItem)]),\n      grade: buildSearchSelectFilterValues([getClassGradeSelectLabel(classItem)]),\n      teacher: buildSearchSelectFilterValues(splitTeacherNames(getClassTeacherLabel(classItem))),\n    },\n    searchText: [\n      classItem.teacher,\n      classItem.teacher_name,\n      classItem.teacherName,\n      getClassSubjectLabel(classItem),\n      getClassGradeSelectLabel(classItem),\n      getClassStatusLabel(classItem),\n      getClassScheduleLabel(classItem),\n    ].map(text).join(\" \"),\n  }));}";
const originalNames = ["compactUniqueLabels","buildTextbookCleanupPreviewRows","getTeacherName","splitTeacherNames","getDefaultTeacherForClass","findLocationByCode","inferClassLocationId","doesSearchOptionMatchFilters","buildSearchSelectCommandValue","buildSearchSelectMetaRows","buildSearchSelectFilterValue","isSearchSelectFilterValue","buildSearchSelectFilterValues","collectSearchSelectFilterOptions","sortSearchSelectFilterOptions","buildSearchSelectFilterGroups","buildVisibleSearchSelectFilterGroups","getTextbookSelectSubSubject","buildTextbookSelectMetaRows","getClassTeacherLabel","getClassClassroomSelectLabel","getClassSubjectLabel","getClassGradeSelectLabel","getClassStudentCountSelectValue","getClassStatusLabel","getClassScheduleLabel","buildClassSelectMetaRows","buildTextbookReferenceOptions","buildTextbookClassReferenceOptions"];
const ledger = await import(new URL("textbook-ledger.js", feature));
const readModel = await import(new URL("textbook-read-model.ts", feature));
const taxonomy = await import(new URL("textbook-taxonomy.ts", feature));
const dependencies = { ...ledger, ...readModel, ...taxonomy, getCategoryLabel: taxonomy.getTextbookCategoryLabel };
const original = new Function(...Object.keys(dependencies),
  stripTypeScriptTypes(originalSource, { mode: "strip" }) + "\nreturn {" + originalNames.join(",") + "};")(...Object.values(dependencies));
async function model() {
  assert.ok(existsSync(modelUrl), "independent reference projection must exist without importing the React workspace");
  return import(modelUrl.href);
}
const id = (n) => `4d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const books = Array.from({ length: 121 }, (_, n) => ({ id: id(n + 1), title: `교재 ${n + 1}`, subject: n % 2 ? "science" : "math", status: "active",
  publisher: "출판사", category: "독해", school_levels: ["middle"], grade_levels: ["m2"], sub_subject: "독해", isbn13: "978", barcode: "123" }));
books.push({ id: id(130), title: "수학의 정석 기본", subject: "math", school_levels: ["high"], grade_levels: ["h1"], sub_subject: "고1", publisher: "성지", isbn13: "978-10" });
const classes = [
  { id: id(201), name: "수업 10", subject: "math", grade: "중2", teacher: "김 / 이·박|최", classroom: "본 2", student_ids: ["a", "a", "b"], schedule: "월 수" },
  { id: id(202), name: "수업 2", subject_name: "English", grade_label: "고1", teacher_name: "교사", room: "별관", student_count: "1200", class_status: "미사용", time: "8:30" },
  { id: id(203), name: "미등록", subject: "로봇", teacher_ids: ["missing", id(301)], teacher: "대체,후순위", studentIds: '["a","a","b"]' },
];
const groups = [{ key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"] }, { key: "grade", label: "학년" }, { key: "subSubject", label: "세부과목" }];
test("original option projection oracle keeps taxonomy, aliases, duplicate rosters and metadata bytes", () => {
  const option = original.buildTextbookReferenceOptions([books.at(-1)])[0];
  assert.equal(option.label, "수학의 정석 기본");
  assert.deepEqual(option.filterValues.subSubject, []);
  assert.deepEqual(option.metaRows, [{ label: "출판사", value: "성지" }, { label: "구분", value: "고등 · 고1" }, { label: "ISBN", value: "978-10" }]);
  assert.deepEqual(original.buildTextbookClassReferenceOptions(classes)[0].metaRows,
    [{ label: "선생님", value: "김, 이, 박, 최" }, { label: "강의실", value: "본 2" }, { label: "학생", value: "3명" }, { label: "시간", value: "월 수" }]);
});
test("extracted book and class projections equal the frozen original for complete 100+ sources", async () => {
  const api = await model();
  for (const [method, rows] of [["buildTextbookReferenceOptions", books], ["buildTextbookClassReferenceOptions", classes]]) {
    const expected = original[method](rows);
    assert.deepEqual(api[method](rows), expected);
    for (const option of expected) assert.equal(api.buildSearchSelectCommandValue(option), original.buildSearchSelectCommandValue(option));
  }
});
test("complete peer facets ignore search and preserve raw unknown selections versus valid active count", async () => {
  const api = await model(); const options = original.buildTextbookReferenceOptions(books);
  const base = original.buildSearchSelectFilterGroups(options, groups);
  assert.deepEqual(api.buildSearchSelectFilterGroups(options, groups), base);
  for (const selected of [{}, { subject: ["수학", "과학"] }, { grade: ["m2"], subSubject: ["독해"] }, { subject: ["unknown"] }, { absent: ["unknown"] }]) {
    assert.deepEqual(api.buildVisibleSearchSelectFilterGroups(options, base, selected), original.buildVisibleSearchSelectFilterGroups(options, base, selected));
    assert.deepEqual(options.filter(option => api.doesSearchOptionMatchFilters(option, base, selected)),
      options.filter(option => original.doesSearchOptionMatchFilters(option, base, selected)));
  }
  assert.equal(options.filter(option => api.doesSearchOptionMatchFilters(option, base, { subject: ["unknown"] })).length, 0);
  assert.equal(options.filter(option => api.doesSearchOptionMatchFilters(option, base, { absent: ["unknown"] })).length, 122);
});
test("selected class defaults retain teacher alias order and independent case-insensitive location inference", async () => {
  const api = await model(); const teachers = [{ id: id(301), name: "등록 교사" }];
  const locations = [{ id: id(401), code: "MAIN", name: "본관" }, { id: id(402), code: "Annex", name: "별관" }];
  for (const row of [...classes, undefined]) {
    assert.equal(api.getDefaultTeacherForClass(row, teachers), original.getDefaultTeacherForClass(row, teachers));
    assert.equal(api.inferClassLocationId(row, locations), original.inferClassLocationId(row, locations));
  }
  assert.equal(api.getDefaultTeacherForClass(classes[2], teachers), "등록 교사");
  assert.equal(api.inferClassLocationId(classes[0], locations), id(401));
  assert.equal(api.inferClassLocationId(classes[1], []), "");
});
test("whole inactive preview projects all supplied targets without hiding the remaining count", async () => {
  const api = await model(); const rows = books.map(row => ({ ...row, status: "inactive" }));
  assert.deepEqual(api.buildTextbookCleanupPreviewRows(rows), original.buildTextbookCleanupPreviewRows(rows));
  assert.equal(api.buildTextbookCleanupPreviewRows(rows).length, 122);
  assert.equal(api.buildTextbookCleanupPreviewRows(rows)[121].id, id(130));
});
test("installed cmdk oracle distinguishes fuzzy search from substring, including UTF-16 and transpositions", () => {
  for (const [value, search, expected] of [
    ["수학의 정석 기본", "수정", 0.891], ["Basic Grammar", "BGr", 0.891], ["Basic Grammar", "Grammar", 0.9],
    ["A-B Grammar", "a b", 0.98970302969901], ["없는책", "수정", 0],
  ]) assert.equal(defaultFilter(value, search), expected);
  const cases = [["😀A", "😀"], ["A😀B", "😀B"], ["Basic Grammar", "Garmmar"], ["letter", "leter"], ["AA letter", "a letter"], ["x\tY-z", " y "], ["İx", "i"], ["𐐀A", "𐐨"]];
  for (const [value, search] of cases) assert.ok(Number.isFinite(defaultFilter(value, search)));
});
test("original Korean locale ties use stable real IDs and first-source facet labels", async () => {
  const api = await model();
  for (const [left, right] of [["Book 2", "Book 02"], ["가", "가"]]) {
    assert.equal(left.localeCompare(right, "ko", { numeric: true }), 0);
    const rows = [{ id: id(702), title: right }, { id: id(701), title: left }];
    rows.sort((a, b) => a.title.localeCompare(b.title, "ko", { numeric: true }) || a.id.localeCompare(b.id));
    assert.deepEqual(rows.map(row => row.id), [id(701), id(702)]);
    const options = [left, right].map((label, index) => ({ value: id(index), label, filterValues: { subSubject: [{ value: String(index), label }] } }));
    const expected = original.buildSearchSelectFilterGroups(options, [{ key: "subSubject", label: "세부과목" }]);
    assert.deepEqual(expected[0].options.map(option => option.label), [left, right]);
    assert.deepEqual(api.buildSearchSelectFilterGroups(options, [{ key: "subSubject", label: "세부과목" }]), expected);
  }
});
test("original metadata label and default-overlay helpers preserve source order for locale ties", () => {
  const source = readFileSync(new URL("textbook-operations-workspace.tsx", feature), "utf8");
  const start = source.indexOf("function uniqueSortedLabels(");
  const helper = source.slice(start, source.indexOf("\n}", start) + 2);
  const uniqueLabels = new Function("text", stripTypeScriptTypes(helper, { mode: "strip" }) + ";return uniqueSortedLabels;")(readModel.text);
  assert.deepEqual(uniqueLabels(["Press 2", "Press 02", "가", "가", "press 2"]), ["가", "가", "Press 2", "Press 02"]);
  const stored = [
    { id: id(6101), subject: "other", name: "분류 2", sort_order: 1, is_visible: true },
    { id: id(6102), subject: "other", name: "분류 02", sort_order: 2, is_visible: true },
    { id: id(6103), subject: "other", name: "가", sort_order: 3, is_visible: true },
    { id: id(6104), subject: "other", name: "가", sort_order: 4, is_visible: true },
  ];
  const settings = taxonomy.mergeTextbookSubSubjectSettings(stored);
  const subs = taxonomy.getSubSubjectOptionsForSubject(settings, "other");
  assert.deepEqual(subs, ["가", "가", "기타", "분류 2", "분류 02"]);
  const categories = [...new Set([...subs])].sort((a, b) => a.localeCompare(b, "ko"));
  assert.deepEqual(categories, ["가", "가", "기타", "분류 02", "분류 2"]);
  const bulk = [...new Set([...subs, ...categories])].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  assert.deepEqual(bulk, ["가", "가", "기타", "분류 2", "분류 02"]);
});
test("original physical class projection keeps blank-name UUID fallback and case-insensitive status labels", async () => {
  const api = await model();
  const row = { id: id(1801), name: "", subject: "English", grade: "중2", teacher: " 김 , 김 / 이 ", room: " 본 1 ", status: " ACTIVE ", student_ids: ["a", "a"], schedule: " 월 " };
  const expected = original.buildTextbookClassReferenceOptions([row])[0];
  assert.equal(expected.label, id(1801));
  assert.equal(expected.searchText, "김 , 김 / 이   영어 중2 사용중 월");
  assert.deepEqual(expected.metaRows, [{ label: "선생님", value: "김, 김, 이" }, { label: "강의실", value: "본 1" }, { label: "학생", value: "2명" }, { label: "시간", value: "월" }]);
  assert.deepEqual(expected.filterValues.teacher, [{ value: "김", label: "김" }, { value: "이", label: "이" }]);
  assert.deepEqual(api.buildTextbookClassReferenceOptions([row]), [expected]);
});
test("SQL whole-source book and class picker projections exclude unused large payload columns", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260831184952_textbook_reference_numbered_reads.sql", import.meta.url), "utf8");
  for (const [name, table, alias, fields] of [
    ["list_textbook_reference_page_v1", "textbooks", "b", ["id", "title", "name", "subject", "publisher", "category", "school_level", "grade_level", "school_levels", "grade_levels", "sub_subject", "isbn13", "barcode"]],
    ["list_textbook_class_reference_page_v1", "classes", "c", ["id", "name", "subject", "grade", "teacher", "room", "status", "student_ids", "schedule"]],
  ]) {
    const start = sql.indexOf(`create function public.${name}(`);
    const body = sql.slice(start, sql.indexOf("end $$;", start));
    assert.match(body, /with source as materialized\(/, "picker source must explicitly project its helper inputs before JSON construction");
    const projection = body.match(new RegExp(`with source as materialized\\(\\s*select ([\\s\\S]*?) from public\\.${table} ${alias}`))?.[1];
    assert.deepEqual(projection?.split(",").map(field => field.trim()), fields.map(field => `${alias}.${field}`));
    assert.doesNotMatch(body, /to_jsonb\([bc]\)|select\s+[bc]\.\*/i);
    assert.match(body, /to_jsonb\(source\)/);
  }
});
test("original same-option teacher facet locale ties preserve filterValues array order", async () => {
  const api = await model();
  for (const labels of [["Teacher 2", "Teacher 02"], ["가", "가"]]) {
    const options = [{ value: id(1), label: "class", filterValues: { teacher: labels.map(label => ({ value: label, label })) } }];
    const config = [{ key: "teacher", label: "선생님" }];
    const expected = original.buildSearchSelectFilterGroups(options, config);
    assert.deepEqual(expected[0].options.map(option => option.value), labels);
    assert.deepEqual(api.buildSearchSelectFilterGroups(options, config), expected);
  }
});
test("SQL facet ordering retains both option and within-option value ordinals", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260831184952_textbook_reference_numbered_reads.sql", import.meta.url), "utf8");
  const start = sql.indexOf("create function dashboard_private.textbook_reference_groups_v1(");
  const body = sql.slice(start, sql.indexOf("end $$;", start));
  assert.match(body, /jsonb_array_elements\(o\.option->'filterValues'->k\)with ordinality/, "same-option facet entries need their own ordinal");
  assert.match(body, /array_agg\(label order by option_ord,value_ord\)/);
  assert.match(body, /label collate dashboard_private\.textbook_reference_ko_numeric,first,first_value/);
});
