import { ACADEMIC_SUBJECT_VALUES, type AcademicSubjectValue } from "../../lib/academic-subject-registry.ts"
import type { RegistrationCustomerMessagePreviewResponse, RegistrationCustomerMessageTarget } from "./registration-customer-message-contract.ts"

export type RegistrationPreviewCaseSubjects = Readonly<{
  taskId: string
  target: RegistrationCustomerMessageTarget
  tracks: ReadonlyArray<Readonly<{ id: string; taskId: string; subject: string }>>
}>

type SubjectSnapshot = Readonly<{ key: string; subjects: ReadonlyArray<AcademicSubjectValue> }>
export type RegistrationPreviewSubjectRequest = Readonly<{ targetKey: string; snapshot: SubjectSnapshot | null }>

const BOOKING_KINDS = new Set(["level_test_booking", "visit_consultation_booking", "observation_booking"])

function targetKey(target: RegistrationCustomerMessageTarget) {
  return JSON.stringify([target.messageKind, target.sourceId])
}

function isSubject(value: string): value is AcademicSubjectValue {
  return (ACADEMIC_SUBJECT_VALUES as readonly string[]).includes(value)
}

function subjectSnapshot(context: RegistrationPreviewCaseSubjects | undefined, target: RegistrationCustomerMessageTarget): SubjectSnapshot | null {
  if (!context?.taskId || !context.target || targetKey(context.target) !== targetKey(target)
    || !Array.isArray(context.tracks) || !context.tracks.length || context.tracks.length > ACADEMIC_SUBJECT_VALUES.length) return null
  const ids = new Set<string>()
  const subjects = new Set<AcademicSubjectValue>()
  for (const track of context.tracks) {
    if (!track?.id || track.taskId !== context.taskId || !isSubject(track.subject)
      || ids.has(track.id) || subjects.has(track.subject)) return null
    ids.add(track.id)
    subjects.add(track.subject)
  }
  const ordered = ACADEMIC_SUBJECT_VALUES.filter((subject) => subjects.has(subject))
  return {
    key: JSON.stringify([context.taskId, targetKey(target), ordered.map((subject) => [subject, context.tracks.find((track) => track.subject === subject)!.id])]),
    subjects: ordered,
  }
}

export function captureRegistrationPreviewSubjects(context: RegistrationPreviewCaseSubjects | undefined, target: RegistrationCustomerMessageTarget): RegistrationPreviewSubjectRequest {
  return { targetKey: targetKey(target), snapshot: subjectSnapshot(context, target) }
}

export function getRegistrationPreviewSubjectScope({ preview, target, request, context, expired }: {
  preview: RegistrationCustomerMessagePreviewResponse | null
  target: RegistrationCustomerMessageTarget | null
  request: RegistrationPreviewSubjectRequest | null
  context: RegistrationPreviewCaseSubjects | undefined
  expired: boolean
}): Readonly<{ label: string; omitted: ReadonlyArray<AcademicSubjectValue> | null }> | null {
  if (!target || !BOOKING_KINDS.has(target.messageKind) || !preview) return null
  if (request?.targetKey !== targetKey(target) || preview.messageKind !== target.messageKind) {
    return { label: "확인할 수 없음", omitted: null }
  }
  const label = typeof preview.facts.subjectLabel === "string" && preview.facts.subjectLabel
    ? preview.facts.subjectLabel : "확인할 수 없음"
  // Single-source booking producers render canonical subjects with this exact
  // separator. Do not infer subjects from message text or bundle label formats.
  const included = label.split(" · ")
  const current = subjectSnapshot(context, target)
  if (expired || !current || !request.snapshot || current.key !== request.snapshot.key
    || !included.every(isSubject) || new Set(included).size !== included.length
    || included.some((subject) => !current.subjects.includes(subject))) return { label, omitted: null }
  return { label, omitted: current.subjects.filter((subject) => !included.includes(subject)) }
}
