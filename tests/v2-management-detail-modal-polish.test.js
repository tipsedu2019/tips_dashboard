import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const managementPageFile = path.join(
  root,
  "v2",
  "src",
  "features",
  "management",
  "management-page.tsx",
);

function readSource() {
  return fs.readFileSync(managementPageFile, "utf8");
}

test("management detail dialogs render as operational hubs instead of raw record viewers", () => {
  const source = readSource();

  for (const marker of [
    "DETAIL_FIELD_LABELS",
    "DETAIL_FIELD_ORDER",
    "DETAIL_FIELD_VISIBLE_KEYS",
    "function getVisibleDetailKeys(kind: ManagementKind)",
    "const [detailRowQuery, setDetailRowQuery] = useState(\"\")",
    "const [relationQuery, setRelationQuery] = useState(\"\")",
    "const filteredAvailableRelatedRows = useMemo(",
    "const detailSearchLabel = kind === \"classes\" ? \"수업명 검색\" : kind === \"students\" ? \"학생명 검색\" : \"교재명 검색\"",
    "const detailSearchMatches = useMemo(",
    "const renderEditableFields = (scope: \"detail\" | \"form\")",
    "const handleDetailSave = async () =>",
    "function getClassDetailItems(row: ManagementRow)",
    "formatSchoolGradeLabel(record.school, record.grade)",
    "const relatedRecordsById = useMemo(",
    "const availableRelatedRows = useMemo(",
    "const handleRelationModeChange = async (id: string, mode: \"enrolled\" | \"waitlist\")",
    "const CLASS_STATUS_OPTIONS = [\"수강\", \"종강\", \"개강 준비\"] as const;",
    "const CLASS_SELECT_FIELD_NAMES = new Set([",
    "const classSelectOptions = useMemo(() =>",
    "const getEditableFieldOptions = (fieldName: string, value: string) =>",
    "SelectTrigger id={id}",
    "renderEditableFields(\"detail\")",
    "handleDetailSave",
    "수업명 검색",
    "학생명 검색",
    "${relationLabel} 이름 검색",
    "{relationLabel} 관리",
    "{relationLabel} 추가",
    "등록 추가",
    "대기 추가",
    "수강 수업",
    "대기 수업",
    "수강 학생",
    "대기 학생",
    "대기로",
    ": \"등록\"",
    "해제",
    "수업 설계 열기",
    "수업 상세에서 수업설계로 이동",
    "/admin/curriculum/lesson-design?classId=",
    "function getStudentEnrolledClassIds(row: ManagementRow)",
    "function getStudentWaitlistClassIds(row: ManagementRow)",
    "function getClassEnrolledStudentIds(row: ManagementRow)",
    "function getClassWaitlistStudentIds(row: ManagementRow)",
    "idList(raw.waitlist_student_ids || raw.waitlistStudentIds || raw.waitlist_ids || raw.waitlistIds)",
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const staleMarker of [
    "onClick={() => setDialogMode(\"edit\")}>수정",
    "DialogDescription",
    "운영 요약",
    "학생 운영 허브",
    "수업 운영 허브",
    "교재 운영 허브",
    "상세 정보 확인, 수정, 삭제, 수강·대기 등록 작업을 처리합니다.",
    "필수 운영 필드를 입력하고 실제 DB에 저장합니다.",
    "수강/대기 연결",
  ]) {
    assert.equal(source.includes(staleMarker), false, `unexpected helper copy ${staleMarker}`);
  }
});

test("management detail field grid uses per-resource visible fields and avoids arbitrary raw-key overflow", () => {
  const source = readSource();

  for (const marker of [
    "students: [\"name\", \"uid\", \"school\", \"grade\", \"contact\", \"parent_contact\", \"parentContact\", \"enroll_date\", \"enrollDate\", \"status\"]",
    "classes: [\"class_name\", \"className\", \"name\", \"academic_year\", \"academicYear\", \"year\", \"term\", \"term_name\", \"termName\", \"semester\", \"academic_term\", \"academicTerm\", \"period\", \"status\", \"subject\", \"grade\", \"teacher\", \"teacher_name\", \"teacherName\", \"schedule\", \"classroom\", \"room\", \"capacity\", \"fee\", \"tuition\"]",
    "textbooks: [\"title\", \"name\", \"subject\", \"publisher\", \"price\", \"tags\", \"lessons\", \"updated_at\", \"updatedAt\"]",
    "const visibleKeys = getVisibleDetailKeys(kind);",
    "DETAIL_FIELD_ORDER[kind].filter((key) => visibleKeys.has(key) && Object.prototype.hasOwnProperty.call(raw, key))",
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  assert.equal(source.includes("...Object.keys(raw).filter((key) => !DETAIL_FIELD_ORDER[kind].includes(key))"), false);
  assert.equal(source.includes(".slice(0, 18)"), false);
});
