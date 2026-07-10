import { createHmac, randomBytes } from "node:crypto"

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { canSendRegistrationAdmissionMessage } from "@/features/tasks/registration-workflow"

export const runtime = "nodejs"

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail"
const ADMISSION_TEMPLATE_KEY = "admission_application"
const ADMISSION_SENT_PIPELINE_STATUS = "5-1. 입학신청서 발송 완료"

type Row = Record<string, unknown>

function text(value: unknown) {
  return String(value || "").trim()
}

function getSupabaseUrl() {
  return text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
}

function getAuthenticatedClient(token: string) {
  const supabaseUrl = getSupabaseUrl()
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  if (!supabaseUrl || !supabaseAnonKey || !token) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function getServiceClient() {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>

async function getAuthenticatedContext(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const client = getAuthenticatedClient(token)
  const serviceClient = getServiceClient()

  if (!client || !token) return { user: null, role: "", client, serviceClient }
  const { data, error } = await client.auth.getUser(token)
  const user = data.user || null
  if (!user?.id || error) return { user: null, role: "", client, serviceClient }

  let role = ""
  if (serviceClient) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    role = text((profile as Row | null)?.role)
  }

  return { user, role, client, serviceClient }
}

function canManageRegistration(role: string) {
  return role === "admin" || role === "staff"
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, "")
}

function lastFour(value: string) {
  return value.length >= 4 ? value.slice(-4) : ""
}

function getSolapiConfiguration() {
  const apiKey = text(process.env.SOLAPI_API_KEY)
  const apiSecret = text(process.env.SOLAPI_API_SECRET)
  const pfId = text(process.env.SOLAPI_KAKAO_PF_ID)
  const templateId = text(process.env.SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID)
  const missing = [
    !apiKey ? "API 키" : "",
    !apiSecret ? "API 시크릿" : "",
    !pfId ? "카카오 채널 ID" : "",
    !templateId ? "승인 템플릿 ID" : "",
  ].filter(Boolean)

  return {
    apiKey,
    apiSecret,
    pfId,
    templateId,
    configured: missing.length === 0,
    missing,
  }
}

function createSolapiAuthorization(apiKey: string, apiSecret: string) {
  const date = new Date().toISOString()
  const salt = randomBytes(16).toString("hex")
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex")
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

async function loadRegistrationTask(serviceClient: ServiceClient, taskId: string) {
  const [taskResult, detailResult] = await Promise.all([
    serviceClient
      .from("ops_tasks")
      .select("id,type,status,student_name,requested_by,assignee_id,secondary_assignee_id")
      .eq("id", taskId)
      .maybeSingle(),
    serviceClient
      .from("ops_registration_details")
      .select("task_id,pipeline_status,parent_phone,admission_notice_sent")
      .eq("task_id", taskId)
      .maybeSingle(),
  ])
  if (taskResult.error) throw taskResult.error
  if (detailResult.error) throw detailResult.error
  return {
    task: taskResult.data as Row | null,
    detail: detailResult.data as Row | null,
  }
}

function getProviderResult(payload: Row) {
  const groupInfo = (payload.groupInfo || {}) as Row
  const acceptedMessages = Array.isArray(payload.messageList) ? payload.messageList as Row[] : []
  const failedMessages = Array.isArray(payload.failedMessageList) ? payload.failedMessageList as Row[] : []
  const accepted = acceptedMessages[0] || null
  const failed = failedMessages[0] || null
  return {
    accepted,
    failed,
    groupId: text(groupInfo.groupId),
    messageId: text(accepted?.messageId || failed?.messageId),
    statusCode: text(accepted?.statusCode || failed?.statusCode),
    statusMessage: text(accepted?.statusMessage || failed?.statusMessage),
  }
}

function isUniqueViolation(error: unknown) {
  return text((error as Row | null)?.code) === "23505"
}

async function loadMessageRequest(serviceClient: ServiceClient, requestKey: string) {
  const { data, error } = await serviceClient
    .from("ops_registration_messages")
    .select("status,provider_message_id,provider_group_id,provider_status_code,provider_status_message")
    .eq("request_key", requestKey)
    .maybeSingle()
  if (error) throw error
  return data as Row | null
}

function existingRequestResponse(existingRequest: Row) {
  const status = text(existingRequest.status)
  if (status === "accepted") {
    return NextResponse.json({ ok: true, idempotent: true, message: existingRequest })
  }
  return NextResponse.json({
    ok: false,
    idempotent: true,
    code: status === "pending" ? "SOLAPI_REQUEST_PENDING" : "SOLAPI_REQUEST_FAILED",
    error: status === "pending" ? "같은 발송 요청을 처리하고 있습니다." : "이 발송 요청은 실패했습니다. 다시 발송해 주세요.",
  }, { status: 409 })
}

async function claimMessageRecord(
  serviceClient: ServiceClient,
  values: {
    taskId: string
    requestKey: string
    recipientLast4: string
    userId: string
  },
) {
  const { error } = await serviceClient.from("ops_registration_messages").insert({
    task_id: values.taskId,
    template_key: ADMISSION_TEMPLATE_KEY,
    request_key: values.requestKey,
    status: "pending",
    recipient_last4: values.recipientLast4 || null,
    sent_by: values.userId,
  })
  if (error) throw error
}

async function updateMessageRecord(
  serviceClient: ServiceClient,
  requestKey: string,
  values: {
    status: "pending" | "accepted" | "failed" | "unknown"
    messageId?: string
    groupId?: string
    statusCode?: string
    statusMessage?: string
    errorMessage?: string
  },
) {
  const { error } = await serviceClient
    .from("ops_registration_messages")
    .update({
      status: values.status,
      provider_message_id: values.messageId || null,
      provider_group_id: values.groupId || null,
      provider_status_code: values.statusCode || null,
      provider_status_message: values.statusMessage || null,
      error_message: values.errorMessage?.slice(0, 1000) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("request_key", requestKey)
  if (error) throw error
}

export async function GET(request: Request) {
  const { user, client } = await getAuthenticatedContext(request)
  if (!user?.id || !client) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const taskId = text(new URL(request.url).searchParams.get("taskId"))
  if (!taskId) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const { data: task, error: taskError } = await client
    .from("ops_tasks")
    .select("id,type,student_name")
    .eq("id", taskId)
    .maybeSingle()
  if (taskError || !task || text((task as Row).type) !== "registration") {
    return NextResponse.json({ ok: false, error: "Registration not found" }, { status: 404 })
  }

  let detail: unknown = null
  let history: unknown[] = []
  try {
    const [detailResult, historyResult] = await Promise.all([
      client
        .from("ops_registration_details")
        .select("parent_phone,admission_notice_sent,pipeline_status")
        .eq("task_id", taskId)
        .maybeSingle(),
      client
        .from("ops_registration_messages")
        .select("id,status,recipient_last4,provider_status_code,provider_status_message,created_at")
        .eq("task_id", taskId)
        .eq("template_key", ADMISSION_TEMPLATE_KEY)
        .order("created_at", { ascending: false })
        .limit(5),
    ])
    const { data: detailData, error: detailError } = detailResult
    const { data: historyData, error: historyError } = historyResult
    if (detailError) throw detailError
    if (historyError) throw historyError
    detail = detailData
    history = historyData || []
  } catch {
    return NextResponse.json({ ok: false, error: "메시지 연결 상태를 불러오지 못했습니다." }, { status: 500 })
  }
  const configuration = getSolapiConfiguration()
  const recipient = digits((detail as Row | null)?.parent_phone)

  return NextResponse.json({
    ok: true,
    configured: configuration.configured,
    missing: configuration.missing,
    studentName: text((task as Row).student_name),
    recipientLast4: lastFour(recipient),
    admissionNoticeSent: Boolean((detail as Row | null)?.admission_notice_sent),
    pipelineStatus: text((detail as Row | null)?.pipeline_status),
    history,
  })
}

export async function POST(request: Request) {
  const { user, role, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  if (!serviceClient) {
    return NextResponse.json({ ok: false, error: "Missing service role" }, { status: 500 })
  }
  if (!canManageRegistration(role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as Row
  const taskId = text(body.taskId)
  const requestKey = text(body.requestKey)
  if (!taskId || requestKey.length < 12 || requestKey.length > 120) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const existingRequest = await loadMessageRequest(serviceClient, requestKey)
  if (existingRequest) return existingRequestResponse(existingRequest)

  const { task, detail } = await loadRegistrationTask(serviceClient, taskId)
  if (!task || !detail || text(task.type) !== "registration") {
    return NextResponse.json({ ok: false, error: "Registration not found" }, { status: 404 })
  }

  const pipelineStatus = text(detail.pipeline_status)
  if (!canSendRegistrationAdmissionMessage(pipelineStatus)) {
    return NextResponse.json({ ok: false, error: "입학 등록 결정 이후에 발송할 수 있습니다." }, { status: 409 })
  }

  const recipient = digits(detail.parent_phone)
  const studentName = text(task.student_name)
  if (recipient.length < 10 || !studentName) {
    return NextResponse.json({ ok: false, error: "학생명과 학부모 전화번호를 확인하세요." }, { status: 400 })
  }

  const configuration = getSolapiConfiguration()
  if (!configuration.configured) {
    return NextResponse.json({
      ok: false,
      code: "SOLAPI_NOT_CONFIGURED",
      error: "SOLAPI 승인 템플릿 연결이 필요합니다.",
      missing: configuration.missing,
    }, { status: 503 })
  }

  try {
    await claimMessageRecord(serviceClient, {
      taskId,
      requestKey,
      recipientLast4: lastFour(recipient),
      userId: user.id,
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const claimedRequest = await loadMessageRequest(serviceClient, requestKey)
    if (claimedRequest) return existingRequestResponse(claimedRequest)
    throw error
  }

  let solapiResponse: Response
  try {
    solapiResponse = await fetch(SOLAPI_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: createSolapiAuthorization(configuration.apiKey, configuration.apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{
          to: recipient,
          type: "ATA",
          kakaoOptions: {
            pfId: configuration.pfId,
            templateId: configuration.templateId,
            disableSms: true,
            variables: {
              "#{학생명}": studentName,
            },
          },
          customFields: {
            taskId,
            templateKey: ADMISSION_TEMPLATE_KEY,
            requestKey,
          },
        }],
        strict: true,
        allowDuplicates: false,
        showMessageList: true,
      }),
    })
  } catch (error) {
    await updateMessageRecord(serviceClient, requestKey, {
      status: "unknown",
      errorMessage: error instanceof Error ? error.message : "SOLAPI request failed before a response",
    }).catch(() => undefined)
    return NextResponse.json({
      ok: false,
      code: "SOLAPI_DELIVERY_UNKNOWN",
      error: "발송 결과를 확인하지 못했습니다. 발송 내역을 확인한 뒤 다시 시도해 주세요.",
    }, { status: 502 })
  }

  const providerPayload = await solapiResponse.json().catch(async () => ({ errorMessage: await solapiResponse.text().catch(() => "") })) as Row
  const providerResult = getProviderResult(providerPayload)
  const providerError = text(providerPayload.errorMessage || providerPayload.error || providerResult.failed?.statusMessage)

  if (!solapiResponse.ok || !providerResult.accepted) {
    await updateMessageRecord(serviceClient, requestKey, {
      status: "failed",
      messageId: providerResult.messageId,
      groupId: providerResult.groupId,
      statusCode: providerResult.statusCode,
      statusMessage: providerResult.statusMessage,
      errorMessage: providerError || "SOLAPI message was not accepted",
    }).catch(() => undefined)
    return NextResponse.json({
      ok: false,
      error: providerError || providerResult.statusMessage || "알림톡을 접수하지 못했습니다.",
    }, { status: 502 })
  }

  const syncWarnings: string[] = []
  await updateMessageRecord(serviceClient, requestKey, {
    status: "accepted",
    messageId: providerResult.messageId,
    groupId: providerResult.groupId,
    statusCode: providerResult.statusCode,
    statusMessage: providerResult.statusMessage,
  }).catch(() => syncWarnings.push("발송 내역"))

  const detailPatch: Row = { admission_notice_sent: true }
  if (pipelineStatus.startsWith("5.")) detailPatch.pipeline_status = ADMISSION_SENT_PIPELINE_STATUS
  const { error: detailError } = await serviceClient
    .from("ops_registration_details")
    .update(detailPatch)
    .eq("task_id", taskId)
  if (detailError) syncWarnings.push("등록 단계")

  const { error: eventError } = await serviceClient.from("ops_task_events").insert({
    task_id: taskId,
    actor_id: user.id,
    event_type: "customer_message_sent",
    field_name: "입학신청서 안내",
    before_value: "",
    after_value: `accepted:${providerResult.messageId || providerResult.groupId}`,
  })
  if (eventError) syncWarnings.push("업무 이력")

  return NextResponse.json({
    ok: true,
    status: "accepted",
    messageId: providerResult.messageId,
    groupId: providerResult.groupId,
    statusCode: providerResult.statusCode,
    statusMessage: providerResult.statusMessage,
    syncWarning: syncWarnings.length > 0
      ? `알림톡은 접수됐지만 ${syncWarnings.join(", ")} 동기화를 확인해 주세요.`
      : undefined,
  })
}
