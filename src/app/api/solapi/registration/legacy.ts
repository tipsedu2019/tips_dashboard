const PREVIEW_REQUIRED_CODE = "REGISTRATION_CUSTOMER_MESSAGE_PREVIEW_REQUIRED"
const PREVIEW_REQUIRED_MESSAGE = "알림톡 미리보기에서 내용을 확인한 뒤 발송해 주세요."

function text(value: unknown) {
  return String(value || "").trim()
}

export function handleLegacyRegistrationGet(
  request: Request,
  listAdmissionMessages: (request: Request) => Promise<Response>,
) {
  const sourceUrl = new URL(request.url)
  const taskId = text(sourceUrl.searchParams.get("taskId"))
  if (!taskId) {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }
  const projectionUrl = new URL("/api/solapi/registration/messages", sourceUrl)
  projectionUrl.search = new URLSearchParams({
    messageKind: "admission_application",
    sourceId: taskId,
  }).toString()
  return listAdmissionMessages(new Request(projectionUrl, {
    method: "GET",
    headers: request.headers,
  }))
}

export function handleLegacyRegistrationPost() {
  return Response.json({
    ok: false,
    code: PREVIEW_REQUIRED_CODE,
    error: PREVIEW_REQUIRED_MESSAGE,
  }, { status: 409 })
}

export { PREVIEW_REQUIRED_CODE }
