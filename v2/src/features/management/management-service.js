import { supabase as sharedSupabase, supabaseConfigError } from "../../lib/supabase.ts";

const DEFAULT_CLASS_STATUS = "수강";
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
      return upsertRows(
        client,
        "teacher_catalogs",
        buildResourceCatalogPayload(resources, { kind: "teacher", generateId }),
      );
    },

    async deleteTeacherCatalogs(ids = []) {
      const client = ensureClient(supabase);
      return deleteRows(client, "teacher_catalogs", ids);
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
          payload.map(({ sort_order, is_default, ...group }) => group),
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
      const created = await upsertRows(client, "students", buildStudentPayload(record, { generateId }));
      return Array.isArray(created) ? created[0] || null : created || null;
    },

    async updateStudent(record = {}) {
      const client = ensureClient(supabase);
      const updated = await upsertRows(client, "students", buildStudentPayload(record, { generateId }));
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
      const [students, classes] = await Promise.all([
        selectRows(client, "students"),
        selectRows(client, "classes"),
      ]);
      const student = findById(students, studentId);
      const classItem = findById(classes, classId);
      if (!student || !classItem) {
        throw new Error("학생 또는 수업 데이터를 찾을 수 없습니다.");
      }

      const enrolled = mode === "enrolled";
      const nextStudent = {
        ...student,
        class_ids: enrolled ? addUnique(student.class_ids, classId) : removeId(student.class_ids, classId),
        waitlist_class_ids: enrolled ? removeId(student.waitlist_class_ids, classId) : addUnique(student.waitlist_class_ids, classId),
      };
      const nextClass = {
        ...classItem,
        student_ids: enrolled ? addUnique(classItem.student_ids, studentId) : removeId(classItem.student_ids, studentId),
        waitlist_ids: enrolled ? removeId(classItem.waitlist_ids, studentId) : addUnique(classItem.waitlist_ids, studentId),
      };
      await upsertRows(client, "students", buildStudentPayload(nextStudent, { generateId }));
      await upsertRows(client, "classes", buildClassPayload(nextClass, { generateId }));
      return { student: nextStudent, class: nextClass };
    },

    async removeStudentFromClass({ studentId, classId } = {}) {
      const client = ensureClient(supabase);
      const [students, classes] = await Promise.all([
        selectRows(client, "students"),
        selectRows(client, "classes"),
      ]);
      const student = findById(students, studentId);
      const classItem = findById(classes, classId);
      if (!student || !classItem) {
        throw new Error("학생 또는 수업 데이터를 찾을 수 없습니다.");
      }
      const nextStudent = {
        ...student,
        class_ids: removeId(student.class_ids, classId),
        waitlist_class_ids: removeId(student.waitlist_class_ids, classId),
      };
      const nextClass = {
        ...classItem,
        student_ids: removeId(classItem.student_ids, studentId),
        waitlist_ids: removeId(classItem.waitlist_ids, studentId),
      };
      await upsertRows(client, "students", buildStudentPayload(nextStudent, { generateId }));
      await upsertRows(client, "classes", buildClassPayload(nextClass, { generateId }));
      return { student: nextStudent, class: nextClass };
    },
  };
}

export const managementService = createManagementService({ supabase: sharedSupabase });
