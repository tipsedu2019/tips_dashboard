import type { SupabaseClient } from "@supabase/supabase-js"

type Row = Record<string, unknown>
const fields = {
  profiles: ["id", "name", "role"],
  students: ["id", "name", "school", "grade", "status", "class_ids", "waitlist_class_ids"],
  classes: ["id", "name", "subject", "grade", "teacher", "room", "student_ids", "waitlist_ids", "textbook_ids"],
  textbooks: ["id", "title", "name", "subject", "publisher", "status"],
  teachers: ["id", "name", "subjects", "is_visible", "sort_order", "profile_id"],
} as const

// This projection has no internal memo/contact/account fallbacks. The server
// separately enforces the actual role and retest-related reference scope.
export async function readWordRetestReferenceData(client: SupabaseClient, commonOperations = false) {
  const read = commonOperations
    ? client.rpc("read_operational_common_v1", { p_operation: "options", p_args: {} }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
    : client.rpc("get_word_retest_reference_data_v1").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  const { data, error } = await read
  if (error) throw error
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("재시험 선택 정보 형식을 확인할 수 없습니다.")
  const payload = data as Row
  const result: Record<keyof typeof fields, Row[]> = { profiles: [], students: [], classes: [], textbooks: [], teachers: [] }
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (!Array.isArray(payload[key])) throw new Error("재시험 선택 정보 형식을 확인할 수 없습니다.")
    result[key] = payload[key].map((row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof (row as Row).id !== "string") throw new Error("재시험 선택 정보 형식을 확인할 수 없습니다.")
      return Object.fromEntries(fields[key].filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, (row as Row)[field]]))
    })
  }
  return result
}

export async function validateWordRetestReferences(client: SupabaseClient, input: {
  studentId: string; classId: string; textbookId: string; teacherId: string
}) {
  const { data, error } = await client.rpc("validate_word_retest_references_v1", {
    p_student_id: input.studentId, p_class_id: input.classId,
    p_textbook_id: input.textbookId, p_teacher_id: input.teacherId,
  }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  if (error) throw error
  if (data !== true) throw new Error("단어 재시험 완료 전에 학생·수업·교재·선생님을 다시 선택하세요.")
}
