import type { NotificationTemplateVariableDto } from "./notification-control-plane-types.ts"

const SAMPLE_BY_KEY: Readonly<Record<string, string>> = Object.freeze({
  student_name: "김민서 학생",
  subjects: "영어 · 수학",
  registered_subjects: "영어 · 수학",
  class_name: "중2 영어 A반",
  registered_classes: "중2 영어 A반 · 중2 수학 B반",
  grade: "중2",
  scheduled_at: "8월 7일(금) 17:00",
  inquiry_at: "8월 4일(화) 10:00",
  after_schedule: "8월 7일(금) 17:00",
  before_schedule: "8월 6일(목) 17:00",
  place: "본관 상담실",
  after_place: "본관 상담실",
  current_status: "접수됐어요.",
  completion_status: "처리가 완료됐어요.",
  progress_line: "[진행] 관리팀이 다음 절차를 확인하고 있어요.",
  reason_line: "[사유] 일정 변경 요청",
  memo_line: "[메모] 전달 내용을 확인했어요.",
  attachment_line: "[첨부] 파일 1개",
})

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sampleValue(variable: NotificationTemplateVariableDto) {
  const exact = SAMPLE_BY_KEY[variable.key]
  if (exact) return exact
  if (variable.key.endsWith("_line")) return `[안내] ${variable.token} 예시입니다.`
  if (variable.piiClass === "student_name") return "김민서 학생"
  if (variable.piiClass === "schedule") return "8월 7일(금) 17:00"
  if (variable.piiClass === "location") return "본관 상담실"
  if (/(subject|subjects)/u.test(variable.key)) return "영어 · 수학"
  if (/(person|actor|assignee|teacher|requester|approver)/u.test(variable.key)) return "김철수님"
  if (/(status|result)/u.test(variable.key)) return "처리됐어요."
  if (/(schedule|date|time|period)/u.test(variable.key)) return "8월 7일(금) 17:00"
  if (/(place|location|classroom)/u.test(variable.key)) return "본관 상담실"
  if (/(class|lesson)/u.test(variable.key)) return "중2 영어 A반"
  return `${variable.token} 예시`
}

function normalizePreviewBody(value: string) {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim()
}

export function toNotificationKoreanTemplate(
  template: string,
  availableVariables: ReadonlyArray<NotificationTemplateVariableDto>,
) {
  return availableVariables.reduce((result, variable) => (
    result.replace(
      new RegExp(`\\{${escapeRegex(variable.key)}\\}`, "gu"),
      `{${variable.token}}`,
    )
  ), template)
}

export function buildNotificationTemplatePreview(input: Readonly<{
  titleTemplate: string
  bodyTemplate: string
  availableVariables: ReadonlyArray<NotificationTemplateVariableDto>
}>) {
  const sampleByToken = new Map(
    input.availableVariables.map((variable) => [variable.token, sampleValue(variable)]),
  )
  const render = (template: string) => template.replace(/\{([^{}]+)\}/gu, (match, token: string) => (
    sampleByToken.get(token) ?? match
  ))

  return Object.freeze({
    title: render(input.titleTemplate).trim(),
    body: normalizePreviewBody(render(input.bodyTemplate)),
  })
}
