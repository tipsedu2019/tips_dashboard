import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  normalizeClassManagementRecord,
  normalizeStudentManagementRecord,
  normalizeTextbookManagementRecord,
} from "../src/features/management/records.js";
import {
  getAssignedClassTextbookIds,
  normalizeClassRelationRecord,
} from "../src/features/management/management-service.js";

const root = new URL("../", import.meta.url);

test("selected class detail preserves assigned textbook IDs before an ordinary save", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const assignedIds = getAssignedClassTextbookIds({
    record: { textbookIds: ["existing-row", "legacy-without-row"] },
    textbooks: [{ id: "existing-row", title: "현재 교재" }],
  });

  assert.deepEqual(assignedIds, ["existing-row", "legacy-without-row"]);
  assert.deepEqual(
    getAssignedClassTextbookIds({ record: { textbookIds: [] }, textbooks: [{ id: "stale-row" }] }),
    [],
  );
  assert.match(hookSource, /const assignedTextbookIds = getAssignedClassTextbookIds\(source\)/);
  assert.match(hookSource, /textbook_ids: assignedTextbookIds/);
  assert.match(hookSource, /textbookIds: assignedTextbookIds/);
});

test("management invoker RPCs inline exact filter validation and authenticated pgTAP executes them", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260814011752_management_page_reads.sql", root), "utf8");
  const pgTap = await readFile(new URL("supabase/tests/management_page_reads_test.sql", root), "utf8");
  assert.doesNotMatch(migration, /dashboard_private\.management_filters_valid/);
  assert.match(migration, /pg_catalog\.jsonb_object_keys\(p_filters\)/);
  assert.match(pgTap, /set local role authenticated;/i);
  assert.match(pgTap, /select lives_ok\([\s\S]*?public\.list_management_page_v1/i);
  assert.match(pgTap, /reset role;/i);
});

test("student enrollment pages merge direct roster arrays with registration enrollments", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260814011752_management_page_reads.sql", root), "utf8");
  const relation = migration.slice(
    migration.indexOf("create function public.list_management_detail_relation_page_v1"),
    migration.indexOf("create function public.get_management_detail_v1"),
  );
  assert.match(relation, /ops_registration_enrollments/);
  assert.match(relation, /jsonb_array_elements_text[\s\S]*?class_ids/);
  assert.match(relation, /jsonb_array_elements_text[\s\S]*?waitlist_class_ids/);
  assert.match(relation, /jsonb_array_elements_text[\s\S]*?student_ids/);
  assert.match(relation, /jsonb_array_elements_text[\s\S]*?waitlist_ids/);
  assert.match(relation, /className/);
});

test("the configured default class period becomes the canonical URL and server request", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  assert.match(tableSource, /setClassListQueryParam\(params, CLASS_LIST_QUERY_PARAM_KEYS\.period, state\.period\)/);
  assert.doesNotMatch(tableSource, /CLASS_LIST_QUERY_PARAM_KEYS\.period, state\.period, defaultPeriodFilter/);
  assert.match(tableSource, /!requestedClassListQueryState\.period && defaultPeriodFilter[\s\S]*?syncClassListQueryState\(\{ period: defaultPeriodFilter \}\)/);
});

test("bounded list rows preserve every currently rendered scalar field", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260814011752_management_page_reads.sql", root), "utf8");
  assert.match(migration, /'contact'.*?'parentContact'/s);
  assert.match(migration, /'grade'.*?'schedule'.*?'classroom'.*?'capacity'.*?'weeklyMinutes'.*?'fee'/s);
  assert.match(migration, /'price'/);

  const student = normalizeStudentManagementRecord({ id: "s1", name: "학생", school: "학교", grade: "중2", contact: "010-1", parentContact: "010-2", status: "재원" });
  assert.match(student.metaSummary, /010-1/);
  assert.match(student.metaSummary, /010-2/);

  const classRow = normalizeClassManagementRecord({
    id: "c1", name: "수학 10", subject: "수학", status: "수강", grade: "중2", schedule: "월 18:00-20:00",
    teacherName: "교사", classroom: "본관 2강", capacity: 12, fee: 320000, studentCount: 7,
  });
  assert.equal(classRow.metrics.studentCount, 7);
  assert.equal(classRow.metrics.capacity, 12);
  assert.ok(classRow.metrics.weeklyMinutes > 0);
  assert.match(classRow.metaSummary, /320,000/);

  const textbook = normalizeTextbookManagementRecord({ id: "t1", title: "교재", publisher: "출판사", price: 9500, status: "active" });
  assert.equal(textbook.raw.price, 9500);
  assert.equal(textbook.statusValue, "active");
});

test("membership and ordering mutations reconcile page one stats and options", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  assert.match(pageSource, /const reconcileManagementPage = useCallback\(async/);
  assert.match(pageSource, /await reconcileManagementPage\(selectedRow\.id\)/);
  assert.match(pageSource, /await reconcileManagementPage\(createdId/);
  assert.match(pageSource, /await reconcileManagementPage\(\)/);
});

test("detail relation continuation is exposed by the hook and appended by the UI", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  assert.match(hookSource, /const loadRelationPage = useCallback/);
  assert.match(hookSource, /readService\.loadRelationPage/);
  assert.match(hookSource, /loadRelationPage,/);
  assert.match(pageSource, /relationPageState/);
  assert.match(pageSource, /handleRelationLoadMore/);
  assert.match(pageSource, /다음 30건/);
  assert.match(pageSource, /nextCursor/);
});

test("search query state is debounced before URL and RPC scope changes", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  assert.match(tableSource, /function useDebouncedValue/);
  assert.match(tableSource, /useDebouncedValue\(globalFilter, 300\)/);
  assert.match(tableSource, /syncClassListQueryState\(\{ q: debouncedGlobalFilter \}\)/);
  assert.doesNotMatch(tableSource, /syncClassListQueryState\(\{ q: value \}\)/);
});

test("bounded textbook reads never inspect the lessons JSONB payload", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260814011752_management_page_reads.sql", root), "utf8");
  const boundedAndRelations = migration.slice(0, migration.indexOf("create function public.get_management_detail_v1"));
  assert.doesNotMatch(boundedAndRelations, /->\s*'lessons'|jsonb_array_length\([^)]*lessons/i);
  assert.doesNotMatch(boundedAndRelations, /to_jsonb\((?:student|enrollment|class|textbook)\)/i);
  assert.doesNotMatch(boundedAndRelations, /\bschedule_plan\b|\blessons\b/i);
  assert.match(boundedAndRelations, /textbook\.status|raw\s*->>\s*'status'/);
});

test("class textbook picker keeps one controlled query for input results and cursor scope", async () => {
  const pickerSource = await readFile(new URL("src/features/management/class-textbook-picker.tsx", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  assert.match(pickerSource, /query: string/);
  assert.doesNotMatch(pickerSource, /const \[query, setQuery\] = useState/);
  assert.match(pageSource, /query=\{textbookCandidateQuery\}/);
  assert.match(pageSource, /search: requestedScope\.search,[\s\S]*?filters: requestedScope\.filters,[\s\S]*?cursor: null/);
  assert.match(pageSource, /const textbookCandidateScopeMatches = textbookCandidateCommittedScope\?\.key === textbookCandidateScopeKey/);
  assert.match(pageSource, /const textbookCandidateScopeKey = JSON\.stringify\(\[[\s\S]*?form\.subject,[\s\S]*?form\.grade,[\s\S]*?textbookCandidateQuery/);
  assert.match(pageSource, /textbooks=\{textbookCandidateScopeMatches \? textbookCandidateRows : \[\]\}/);
  assert.match(pageSource, /hasMore=\{textbookCandidateScopeMatches && textbookCandidatesHaveMore\}/);
  assert.match(pageSource, /if \(!committedScope[\s\S]*?committedScope\.key !== textbookCandidateScopeKey[\s\S]*?return/);
  assert.match(pageSource, /search: committedScope\.search,[\s\S]*?filters: committedScope\.filters,[\s\S]*?cursor: textbookCandidateCursor/);
});

test("relation payloads match roster contacts and student history renderer labels", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260814011752_management_page_reads.sql", root), "utf8");
  assert.match(migration, /'contact',student\.contact/);
  assert.match(migration, /'parentContact',student\.parent_contact/);
  assert.match(migration, /'className',class\.name/);
  assert.match(migration, /'label'.*?'changedAt'/s);
});

test("relation paging preserves legacy waitlists and canonical class display aliases", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260814011752_management_page_reads.sql", root), "utf8");
  const relation = migration.slice(
    migration.indexOf("create function public.list_management_detail_relation_page_v1"),
    migration.indexOf("create function public.get_management_detail_v1"),
  );
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(relation, /coalesce\(class\.waitlist_ids,'\[\]'::jsonb\)\s*\|\|\s*pg_catalog\.coalesce\(class\.waitlist_student_ids,'\[\]'::jsonb\)/i);
  assert.ok((relation.match(/class\.waitlist_student_ids/g) || []).length >= 2);
  assert.match(relation, /coalesce\(pg_catalog\.nullif\(pg_catalog\.btrim\(class\.teacher_name\),''\),class\.teacher\)/i);
  assert.match(relation, /coalesce\(pg_catalog\.nullif\(pg_catalog\.btrim\(class\.classroom\),''\),class\.room\)/i);
  assert.match(relation, /p_relation_kind\s*=\s*'class_picker'[\s\S]*?'teacher'[\s\S]*?'classroom'/i);
  assert.doesNotMatch(relation, /to_jsonb\(class\)/i);

  assert.deepEqual(normalizeClassRelationRecord({
    id: "class-legacy",
    teacher: "fallback teacher",
    teacher_name: "legacy teacher",
    room: "fallback room",
    classroom: "legacy room",
  }), {
    id: "class-legacy",
    teacher: "legacy teacher",
    teacher_name: "legacy teacher",
    room: "fallback room",
    classroom: "legacy room",
  });
  assert.match(serviceSource, /\.select\("id,name,subject,grade,status,schedule,teacher_name,teacher,classroom,room"\)/);
  assert.match(serviceSource, /return \(data \|\| \[\]\)\.map\(normalizeClassRelationRecord\)/);
  assert.match(pageSource, /record\.teacher \|\| record\.teacher_name \|\| record\.teacherName/);
  assert.match(pageSource, /record\.classroom \|\| record\.room \|\| record\.class_room/);
});

test("roster mutations read exact targeted projections and never full collections", async () => {
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const assignStart = serviceSource.indexOf("async assignStudentToClass");
  const removeStart = serviceSource.indexOf("async removeStudentFromClass", assignStart);
  const end = serviceSource.indexOf("\n  };\n}", removeStart);
  const mutationSource = serviceSource.slice(assignStart, end);
  assert.doesNotMatch(mutationSource, /selectRows\(client, "students"\)|selectRows\(client, "classes"\)|select\("\*"\)/);
  assert.match(mutationSource, /selectStudentRosterRecord\(client, safeStudentId\)/);
  assert.match(mutationSource, /selectClassRosterRecord\(client, safeClassId\)/);
  assert.match(serviceSource, /\.select\("id,name,status,class_ids,waitlist_class_ids"\)[\s\S]*?\.eq\("id", studentId\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(serviceSource, /\.select\("id,name,status,student_ids,waitlist_ids,waitlist_student_ids"\)[\s\S]*?\.eq\("id", classId\)[\s\S]*?\.maybeSingle\(\)/);
});
