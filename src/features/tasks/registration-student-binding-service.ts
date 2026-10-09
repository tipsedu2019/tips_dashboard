import type { SupabaseClient } from "@supabase/supabase-js"
import { createManagementNumberedReadService } from "../management/management-numbered-service.ts"
import type { RegistrationCaseContactState } from "./registration-contact-client.ts"

export type RegistrationStudentCandidate = {
  id: string
  name: string
  school: string | null
  grade: string | null
  uid: string | null
}

export type RegistrationStudentCandidateRequest = {
  search: string
  page?: number
  signal?: AbortSignal
}

export type RegistrationStudentCandidatePage = {
  rows: RegistrationStudentCandidate[]
  page: number
  pageSize: 20
  totalCount: number
}

export type RegistrationStudentBindingInput = {
  taskId: string
  studentId: string
  contactState: RegistrationCaseContactState
  requestKey: string
}

export type RegistrationStudentBindingResult = {
  taskId: string
  studentId: string
  changed: boolean
  contactState: RegistrationCaseContactState
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A bounded existing reader; display numbers never become student identity. */
export function createRegistrationStudentCandidateService({ supabase }: {
  supabase: Pick<SupabaseClient, "rpc"> | null
}) {
  const reader = supabase ? createManagementNumberedReadService({ supabase }) : null
  return {
    async searchRegistrationStudentCandidates(request: RegistrationStudentCandidateRequest): Promise<RegistrationStudentCandidatePage> {
      if (!request || typeof request.search !== "string" || request.search.length > 200
        || /[\u0000-\u001f\u007f]/.test(request.search)) throw new Error("registration_student_lookup_request_invalid")
      if (!reader) throw new Error("registration_student_lookup_unavailable")
      try {
        const result = await reader.readPage({
          kind: "students", page: request.page ?? 1, pageSize: 20,
          filters: { kind: "students", search: request.search, status: null, schoolCategory: null, school: null, grade: null },
          sort: [{ id: "title", desc: false }], signal: request.signal,
        })
        if (result.rows.some((row) => row.id.length !== 36 || !UUID.test(row.id))
          || new Set(result.rows.map((row) => row.id.toLowerCase())).size !== result.rows.length) {
          throw new Error("registration_student_lookup_response_invalid")
        }
        return {
          rows: result.rows.map((row) => ({ id: row.id, name: row.name, school: row.school, grade: row.grade, uid: row.uid })),
          page: result.page, pageSize: 20, totalCount: result.totalCount,
        }
      } catch (error) {
        if (request.signal?.aborted) throw new DOMException("registration_student_lookup_aborted", "AbortError")
        const code = error && typeof error === "object" && "code" in error ? error.code : null
        if (code === "read_operation_timeout") throw new Error("registration_student_lookup_timeout")
        if (error instanceof Error && error.message === "registration_student_lookup_response_invalid") throw error
        if (code === "management_numbered_request_invalid") throw new Error("registration_student_lookup_request_invalid")
        if (code === "management_numbered_response_invalid") throw new Error("registration_student_lookup_response_invalid")
        throw new Error("registration_student_lookup_unavailable")
      }
    },
  }
}
