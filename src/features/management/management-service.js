import { supabase as sharedSupabase, supabaseConfigError } from "../../lib/supabase.ts";
import { normalizeStudentStatus } from "../../lib/student-status.js";

const DEFAULT_CLASS_STATUS = "수강";
const DASHBOARD_ROLES = ["admin", "staff", "teacher", "viewer"];
const CLASSROOM_ALIAS_MAP = new Map([
  ["별3", "별관 3강"],
  ["별3강", "별관 3강"],
  ["별5", "별관 5강"],
  ["별5강", "별관 5강"],
  ["별7", "별관 5강"],
  ["별7강", "별관 5강"],
  ["본2", "본관 2강"],
  ["본2강", "본관 2강"],
  ["본3", "본관 3강"],
  ["본3강", "본관 3강"],
  ["본5", "본관 5강"],
  ["본5강", "본관 5강"],
]);

function trimText(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

export function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `mgmt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeClassroomName(value) {
  const normalized = trimText(value).replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }
  return CLASSROOM_ALIAS_MAP.get(normalized) || trimText(value);
}

function normalizeSubjectList(subjects) {
  return [...new Set((Array.isArray(subjects) ? subjects : []).map((subject) => trimText(subject)).filter(Boolean))];
}

function normalizeDashboardRole(value) {
  const role = trimText(value).toLowerCase();
  return DASHBOARD_ROLES.includes(role) ? role : "teacher";
}

function isMissingColumnError(error) {
  const message = trimText(error?.message).toLowerCase();
  return message.includes("column") &&
    (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

function isMissingRelationError(error) {
  const code = trimText(error?.code);
  const message = trimText(error?.message).toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

function resolveClient(client) {
  if (client) {
    return client;
  }
  return sharedSupabase;
}

function ensureClient(client) {
  const resolved = resolveClient(client);
  if (!resolved) {
    throw new Error("Supabase 연결 설정을 확인해 주세요.");
  }
  return resolved;
}

export function buildAcademicSchoolPayload(schools = []) {
  return (schools || []).map((school, index) => ({
    id: school?.id,
    name: trimText(school?.name),
    category: trimText(school?.category),
    color: school?.color ?? null,
    sort_order: school?.sortOrder ?? school?.sort_order ?? index,
  }));
}

export function buildResourceCatalogPayload(resources = [], options = {}) {
  const { kind = "teacher", generateId = createId } = options;

  return (resources || []).map((resource, index) => ({
    id: resource?.id || generateId(),
    name:
      kind === "classroom"
        ? normalizeClassroomName(resource?.name)
        : trimText(resource?.name),
    subjects: normalizeSubjectList(resource?.subjects),
    is_visible: resource?.isVisible !== false,
    sort_order: resource?.sortOrder ?? resource?.sort_order ?? index,
    ...(kind === "teacher"
      ? {
          profile_id: trimText(resource?.profileId || resource?.profile_id) || null,
          account_email: trimText(resource?.accountEmail || resource?.account_email).toLowerCase() || null,
          dashboard_role: normalizeDashboardRole(resource?.dashboardRole || resource?.dashboard_role),
        }
      : {}),
  }));
}

export function buildClassTermPayload(terms = [], options = {}) {
  const { generateId = createId, now = new Date() } = options;
  const defaultYear = Number(now.getFullYear());

  return (terms || []).map((term, index) => ({
    id: term?.id || generateId(),
    academic_year: Number(term?.academicYear || term?.academic_year || defaultYear),
    name: trimText(term?.name),
    status: trimText(term?.status) || DEFAULT_CLASS_STATUS,
    start_date: trimText(term?.startDate || term?.start_date) || null,
    end_date: trimText(term?.endDate || term?.end_date) || null,
    sort_order: term?.sortOrder ?? term?.sort_order ?? index,
  }));
}

export function buildClassGroupPayload(groups = [], options = {}) {
  const { generateId = createId } = options;

  return (groups || []).map((group, index) => ({
    id: group?.id || generateId(),
    name: trimText(group?.name),
    subject: trimText(group?.subject),
    term_id: trimText(group?.termId || group?.term_id) || null,
    sort_order: group?.sortOrder ?? group?.sort_order ?? index,
    is_default: group?.isDefault === true || group?.is_default === true,
  }));
}

async function upsertRows(client, table, payload, { onConflict = "id", select = true } = {}) {
  let query = client.from(table).upsert(payload, { onConflict });
  if (select) {
    query = query.select();
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

async function deleteRows(client, table, ids = []) {
  const targets = [...new Set((ids || []).filter(Boolean))];
  if (targets.length === 0) {
    return;
  }
  const { error } = await client.from(table).delete().in("id", targets);
  if (error) {
    throw error;
  }
}

function stripTeacherAccountFields(row) {
  const baseRow = { ...row };
  delete baseRow.profile_id;
  delete baseRow.account_email;
  delete baseRow.dashboard_role;
  return baseRow;
}

async function upsertTeacherCatalogRows(client, rows = []) {
  try {
    return await upsertRows(client, "teacher_catalogs", rows);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
    return upsertRows(client, "teacher_catalogs", rows.map(stripTeacherAccountFields));
  }
}

async function syncLinkedTeacherProfiles(client, rows = []) {
  const linkedRows = rows.filter((row) => trimText(row.profile_id));
  if (linkedRows.length === 0) {
    return [];
  }

  const updates = [];
  for (const row of linkedRows) {
    const profileId = trimText(row.profile_id);
    const role = normalizeDashboardRole(row.dashboard_role);
    const accountEmail = trimText(row.account_email).toLowerCase();
    const loginId = accountEmail.includes("@") ? accountEmail.split("@")[0] : accountEmail;
    const extendedPatch = {
      role,
      name: trimText(row.name),
      email: accountEmail || null,
      login_id: loginId || null,
      teacher_catalog_id: trimText(row.id) || null,
    };

    let result = await client.from("profiles").update(extendedPatch).eq("id", profileId).select();
    if (result.error && isMissingColumnError(result.error)) {
      result = await client.from("profiles").update({ role }).eq("id", profileId).select();
    }
    if (result.error) {
      throw result.error;
    }
    updates.push(...(result.data || []));
  }

  return updates;
}

async function selectTeacherCatalogsWithAccountFields(client) {
  const extendedSelect = "id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role";
  const baseSelect = "id, name, subjects, is_visible, sort_order";
  const extended = await client
    .from("teacher_catalogs")
    .select(extendedSelect)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!extended.error) {
    return { rows: extended.data || [], isAccountSchemaReady: true, schemaWarning: "" };
  }
  if (!isMissingColumnError(extended.error)) {
    throw extended.error;
  }

  const base = await client
    .from("teacher_catalogs")
    .select(baseSelect)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (base.error) {
    throw base.error;
  }

  return {
    rows: base.data || [],
    isAccountSchemaReady: false,
    schemaWarning: "선생님 계정 연동 DB 마이그레이션이 아직 적용되지 않았습니다.",
  };
}

async function selectAccountProfiles(client) {
  const extended = await client
    .from("profiles")
    .select("id, name, login_id, email, role, teacher_catalog_id, updated_at")
    .order("name", { ascending: true });

  if (!extended.error) {
    return extended.data || [];
  }
  if (!isMissingColumnError(extended.error)) {
    throw extended.error;
  }

  const base = await client
    .from("profiles")
    .select("id, role, updated_at")
    .order("updated_at", { ascending: false });
  if (base.error) {
    throw base.error;
  }
  return base.data || [];
}

async function selectRecentAuditLogs(client) {
  const { data, error } = await client
    .from("dashboard_audit_logs")
    .select("id, actor_profile_id, actor_email, actor_role, action, entity_table, entity_id, entity_label, changed_at")
    .in("entity_table", ["teacher_catalogs", "profiles"])
    .order("changed_at", { ascending: false })
    .limit(12);

  if (!error) {
    return data || [];
  }
  if (isMissingColumnError(error) || trimText(error.message).includes("dashboard_audit_logs")) {
    return [];
  }
  throw error;
}

function toNumberOrNull(value) {
  const trimmed = trimText(value);
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => trimText(item)).filter(Boolean);
  }
  return trimText(value)
    .split(/[,\n]/)
    .map((item) => trimText(item))
    .filter(Boolean);
}

function normalizeIdList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => trimText(item)).filter(Boolean))];
}

function addUnique(values, value) {
  const safeValue = trimText(value);
  const next = normalizeIdList(values);
  return safeValue && !next.includes(safeValue) ? [...next, safeValue] : next;
}

function removeId(values, value) {
  const safeValue = trimText(value);
  return normalizeIdList(values).filter((item) => item !== safeValue);
}

function getArrayField(record, snakeKey, camelKey) {
  return Array.isArray(record?.[snakeKey])
    ? record[snakeKey]
    : Array.isArray(record?.[camelKey])
      ? record[camelKey]
      : [];
}

async function selectRows(client, table) {
  const { data, error } = await client.from(table).select("*");
  if (error) throw error;
  return data || [];
}

function stripStudentLifecycleFields(row) {
  const nextRow = { ...row };
  delete nextRow.status;
  return nextRow;
}

async function upsertStudentRows(client, payload) {
  try {
    return await upsertRows(client, "students", payload);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
    return upsertRows(
      client,
      "students",
      Array.isArray(payload)
        ? payload.map(stripStudentLifecycleFields)
        : stripStudentLifecycleFields(payload),
    );
  }
}

function getStudentClassMode(student, classId) {
  const safeClassId = trimText(classId);
  if (!safeClassId) {
    return "";
  }
  if (normalizeIdList(student?.class_ids || student?.classIds).includes(safeClassId)) {
    return "enrolled";
  }
  if (normalizeIdList(student?.waitlist_class_ids || student?.waitlistClassIds).includes(safeClassId)) {
    return "waitlist";
  }
  return "";
}

function getClassWaitlistIds(classItem) {
  return [
    ...normalizeIdList(classItem?.waitlist_ids || classItem?.waitlistIds),
    ...normalizeIdList(classItem?.waitlist_student_ids || classItem?.waitlistStudentIds),
  ];
}

function getClassStudentMode(classItem, studentId) {
  const safeStudentId = trimText(studentId);
  if (!safeStudentId) {
    return "";
  }
  if (normalizeIdList(classItem?.student_ids || classItem?.studentIds).includes(safeStudentId)) {
    return "enrolled";
  }
  if (getClassWaitlistIds(classItem).includes(safeStudentId)) {
    return "waitlist";
  }
  return "";
}

async function insertStudentClassHistory(client, rows = []) {
  const payload = rows.filter((row) => row.student_id && row.class_id);
  if (payload.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from("student_class_enrollment_history")
    .insert(payload)
    .select();

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      return [];
    }
    throw error;
  }

  return data || [];
}

async function deleteClassGroupMembersByClass(client, classId) {
  const safeClassId = trimText(classId);
  if (!safeClassId) {
    return;
  }

  const { error } = await client
    .from("class_schedule_sync_group_members")
    .delete()
    .eq("class_id", safeClassId);

  if (error) {
    throw error;
  }
}

function findById(rows, id) {
  const safeId = trimText(id);
  return (rows || []).find((row) => trimText(row?.id) === safeId) || null;
}

function formatDateOnly(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return trimText(value);
}

export function buildStudentPayload(record = {}, options = {}) {
  const { generateId = createId } = options;
  const id = trimText(record.id) || generateId();
  return {
    id,
    name: trimText(record.name),
    uid: trimText(record.uid),
    school: trimText(record.school),
    grade: trimText(record.grade),
    contact: trimText(record.contact),
    parent_contact: trimText(record.parentContact || record.parent_contact),
    enroll_date: formatDateOnly(record.enrollDate || record.enroll_date || new Date()),
    status: normalizeStudentStatus(record.status),
    class_ids: getArrayField(record, "class_ids", "classIds"),
    waitlist_class_ids: getArrayField(record, "waitlist_class_ids", "waitlistClassIds"),
  };
}

export function buildClassPayload(record = {}, options = {}) {
  const { generateId = createId } = options;
  const id = trimText(record.id) || generateId();
  const name = trimText(record.name || record.className || record.class_name);
  const classroom = normalizeClassroomName(record.classroom || record.room);
  return {
    id,
    name,
    subject: trimText(record.subject),
    grade: trimText(record.grade),
    teacher: trimText(record.teacher || record.teacherName || record.teacher_name),
    schedule: trimText(record.schedule),
    room: classroom,
    capacity: toNumberOrNull(record.capacity) ?? 0,
    fee: toNumberOrNull(record.fee || record.tuition) ?? 0,
    status: trimText(record.status) || DEFAULT_CLASS_STATUS,
    student_ids: getArrayField(record, "student_ids", "studentIds"),
    waitlist_ids: getArrayField(record, "waitlist_ids", "waitlistIds").length
      ? getArrayField(record, "waitlist_ids", "waitlistIds")
      : getArrayField(record, "waitlist_student_ids", "waitlistStudentIds"),
    textbook_ids: getArrayField(record, "textbook_ids", "textbookIds"),
  };
}

export function buildTextbookPayload(record = {}, options = {}) {
  const { generateId = createId, now = new Date() } = options;
  const id = trimText(record.id) || generateId();
  const title = trimText(record.title || record.name);
  return {
    id,
    title,
    name: title,
    subject: trimText(record.subject),
    publisher: trimText(record.publisher),
    price: toNumberOrNull(record.price) ?? 0,
    tags: splitList(record.tags),
    lessons: Array.isArray(record.lessons) ? record.lessons : [],
    updated_at: formatDateOnly(record.updatedAt || record.updated_at || now),
  };
}

export function createManagementService(options = {}) {
  const { supabase = sharedSupabase, generateId = createId } = options;

  return {
    get configError() {
      return supabase ? null : supabaseConfigError || "Supabase 연결 설정을 확인해 주세요.";
    },

    async upsertAcademicSchools(schools = []) {
      const client = ensureClient(supabase);
      return upsertRows(client, "academic_schools", buildAcademicSchoolPayload(schools));
    },

    async deleteAcademicSchools(ids = []) {
      const client = ensureClient(supabase);
      return deleteRows(client, "academic_schools", ids);
    },

    async upsertTeacherCatalogs(resources = []) {
      const client = ensureClient(supabase);
      const payload = buildResourceCatalogPayload(resources, { kind: "teacher", generateId });
      const rows = await upsertTeacherCatalogRows(client, payload);
      await syncLinkedTeacherProfiles(client, payload);
      return rows;
    },

    async deleteTeacherCatalogs(ids = []) {
      const client = ensureClient(supabase);
      return deleteRows(client, "teacher_catalogs", ids);
    },

    async listTeacherAccountSettingsData() {
      const client = ensureClient(supabase);
      const teachersResult = await selectTeacherCatalogsWithAccountFields(client);
      const [profiles, auditLogs] = await Promise.all([
        selectAccountProfiles(client),
        selectRecentAuditLogs(client),
      ]);

      return {
        teachers: teachersResult.rows,
        profiles,
        auditLogs,
        isAccountSchemaReady: teachersResult.isAccountSchemaReady,
        schemaWarning: teachersResult.schemaWarning,
      };
    },

    async upsertClassroomCatalogs(resources = []) {
      const client = ensureClient(supabase);
      return upsertRows(
        client,
        "classroom_catalogs",
        buildResourceCatalogPayload(resources, { kind: "classroom", generateId }),
      );
    },

    async deleteClassroomCatalogs(ids = []) {
      const client = ensureClient(supabase);
      return deleteRows(client, "classroom_catalogs", ids);
    },

    async upsertClassTerms(terms = []) {
      const client = ensureClient(supabase);
      return upsertRows(client, "class_terms", buildClassTermPayload(terms, { generateId }));
    },

    async deleteClassTerm(id) {
      const client = ensureClient(supabase);
      return deleteRows(client, "class_terms", Array.isArray(id) ? id : id ? [id] : []);
    },

    async upsertClassGroups(groups = []) {
      const client = ensureClient(supabase);
      const payload = buildClassGroupPayload(groups, { generateId });
      try {
        return await upsertRows(
          client,
          "class_schedule_sync_groups",
          payload,
        );
      } catch (error) {
        const message = trimText(error?.message);
        if (!message.includes("sort_order") && !message.includes("is_default")) {
          throw error;
        }

        return upsertRows(
          client,
          "class_schedule_sync_groups",
          payload.map((group) => {
            const fallbackGroup = { ...group };
            delete fallbackGroup.sort_order;
            delete fallbackGroup.is_default;
            return fallbackGroup;
          }),
        );
      }
    },

    async setDefaultClassGroup(id) {
      const client = ensureClient(supabase);
      const safeId = trimText(id);
      if (!safeId) {
        throw new Error("기간 ID를 찾을 수 없습니다.");
      }

      try {
        const { error: resetError } = await client
          .from("class_schedule_sync_groups")
          .update({ is_default: false })
          .neq("id", safeId);
        if (resetError) {
          throw resetError;
        }

        const { data, error } = await client
          .from("class_schedule_sync_groups")
          .update({ is_default: true })
          .eq("id", safeId)
          .select();
        if (error) {
          throw error;
        }
        return data || [];
      } catch (error) {
        const message = trimText(error?.message);
        if (message.includes("is_default")) {
          return [];
        }
        throw error;
      }
    },

    async deleteClassGroup(id) {
      const client = ensureClient(supabase);
      return deleteRows(client, "class_schedule_sync_groups", Array.isArray(id) ? id : id ? [id] : []);
    },

    async createStudent(record = {}) {
      const client = ensureClient(supabase);
      const created = await upsertStudentRows(client, buildStudentPayload(record, { generateId }));
      return Array.isArray(created) ? created[0] || null : created || null;
    },

    async updateStudent(record = {}) {
      const client = ensureClient(supabase);
      const updated = await upsertStudentRows(client, buildStudentPayload(record, { generateId }));
      return Array.isArray(updated) ? updated[0] || null : updated || null;
    },

    async deleteStudent(id) {
      const client = ensureClient(supabase);
      return deleteRows(client, "students", id ? [id] : []);
    },

    async createClass(record = {}) {
      const client = ensureClient(supabase);
      const created = await upsertRows(client, "classes", buildClassPayload(record, { generateId }));
      return Array.isArray(created) ? created[0] || null : created || null;
    },

    async updateClass(record = {}) {
      const client = ensureClient(supabase);
      const updated = await upsertRows(client, "classes", buildClassPayload(record, { generateId }));
      return Array.isArray(updated) ? updated[0] || null : updated || null;
    },

    async replaceClassGroupMemberships({ classId, groupIds = [] } = {}) {
      const client = ensureClient(supabase);
      const safeClassId = trimText(classId);
      if (!safeClassId) {
        throw new Error("수업 ID를 찾을 수 없습니다.");
      }

      const nextGroupIds = normalizeIdList(groupIds);
      await deleteClassGroupMembersByClass(client, safeClassId);
      if (nextGroupIds.length === 0) {
        return [];
      }

      return upsertRows(
        client,
        "class_schedule_sync_group_members",
        nextGroupIds.map((groupId, index) => ({
          group_id: groupId,
          class_id: safeClassId,
          sort_order: index,
        })),
        { onConflict: "group_id,class_id" },
      );
    },

    async deleteClass(id) {
      const client = ensureClient(supabase);
      return deleteRows(client, "classes", id ? [id] : []);
    },

    async createTextbook(record = {}) {
      const client = ensureClient(supabase);
      const created = await upsertRows(client, "textbooks", buildTextbookPayload(record, { generateId }));
      return Array.isArray(created) ? created[0] || null : created || null;
    },

    async updateTextbook(record = {}) {
      const client = ensureClient(supabase);
      const updated = await upsertRows(client, "textbooks", buildTextbookPayload(record, { generateId }));
      return Array.isArray(updated) ? updated[0] || null : updated || null;
    },

    async deleteTextbook(id) {
      const client = ensureClient(supabase);
      return deleteRows(client, "textbooks", id ? [id] : []);
    },

    async listStudents() {
      const client = ensureClient(supabase);
      return selectRows(client, "students");
    },

    async listClasses() {
      const client = ensureClient(supabase);
      return selectRows(client, "classes");
    },

    async assignStudentToClass({ studentId, classId, mode = "enrolled" } = {}) {
      const client = ensureClient(supabase);
      const safeStudentId = trimText(studentId);
      const safeClassId = trimText(classId);
      const [students, classes] = await Promise.all([
        selectRows(client, "students"),
        selectRows(client, "classes"),
      ]);
      const student = findById(students, safeStudentId);
      const classItem = findById(classes, safeClassId);
      if (!student || !classItem) {
        throw new Error("학생 또는 수업 데이터를 찾을 수 없습니다.");
      }

      const enrolled = mode === "enrolled";
      const previousMode = getStudentClassMode(student, safeClassId);
      const nextMode = enrolled ? "enrolled" : "waitlist";
      const nextStudent = {
        ...student,
        class_ids: enrolled ? addUnique(student.class_ids, safeClassId) : removeId(student.class_ids, safeClassId),
        waitlist_class_ids: enrolled ? removeId(student.waitlist_class_ids, safeClassId) : addUnique(student.waitlist_class_ids, safeClassId),
      };
      const nextClass = {
        ...classItem,
        student_ids: enrolled ? addUnique(classItem.student_ids, safeStudentId) : removeId(classItem.student_ids, safeStudentId),
        waitlist_ids: enrolled ? removeId(classItem.waitlist_ids, safeStudentId) : addUnique(classItem.waitlist_ids, safeStudentId),
      };
      await upsertStudentRows(client, buildStudentPayload(nextStudent, { generateId }));
      await upsertRows(client, "classes", buildClassPayload(nextClass, { generateId }));
      if (previousMode !== nextMode) {
        await insertStudentClassHistory(client, [{
          student_id: safeStudentId,
          class_id: safeClassId,
          action: nextMode,
          previous_mode: previousMode || null,
          next_mode: nextMode,
        }]);
      }
      return { student: nextStudent, class: nextClass };
    },

    async removeStudentFromClass({ studentId, classId } = {}) {
      const client = ensureClient(supabase);
      const safeStudentId = trimText(studentId);
      const safeClassId = trimText(classId);
      const [students, classes] = await Promise.all([
        selectRows(client, "students"),
        selectRows(client, "classes"),
      ]);
      const student = findById(students, safeStudentId);
      const classItem = findById(classes, safeClassId);
      if (!student && !classItem) {
        throw new Error("학생 또는 수업 데이터를 찾을 수 없습니다.");
      }
      const previousMode = getStudentClassMode(student, safeClassId) || getClassStudentMode(classItem, safeStudentId);
      const nextStudent = student
        ? {
            ...student,
            class_ids: removeId(student.class_ids || student.classIds, safeClassId),
            classIds: removeId(student.class_ids || student.classIds, safeClassId),
            waitlist_class_ids: removeId(student.waitlist_class_ids || student.waitlistClassIds, safeClassId),
            waitlistClassIds: removeId(student.waitlist_class_ids || student.waitlistClassIds, safeClassId),
          }
        : null;
      const nextWaitlistIds = removeId(getClassWaitlistIds(classItem), safeStudentId);
      const nextClass = classItem
        ? {
            ...classItem,
            student_ids: removeId(classItem.student_ids || classItem.studentIds, safeStudentId),
            studentIds: removeId(classItem.student_ids || classItem.studentIds, safeStudentId),
            waitlist_ids: nextWaitlistIds,
            waitlistIds: nextWaitlistIds,
            waitlist_student_ids: nextWaitlistIds,
            waitlistStudentIds: nextWaitlistIds,
          }
        : null;
      if (nextStudent) {
        await upsertStudentRows(client, buildStudentPayload(nextStudent, { generateId }));
      }
      if (nextClass) {
        await upsertRows(client, "classes", buildClassPayload(nextClass, { generateId }));
      }
      if (previousMode && student && classItem) {
        await insertStudentClassHistory(client, [{
          student_id: safeStudentId,
          class_id: safeClassId,
          action: "removed",
          previous_mode: previousMode,
          next_mode: null,
        }]);
      }
      return { student: nextStudent, class: nextClass };
    },
  };
}

export const managementService = createManagementService({ supabase: sharedSupabase });
