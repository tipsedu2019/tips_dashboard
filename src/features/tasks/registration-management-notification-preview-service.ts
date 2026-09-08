export type RegistrationManagementPreview = Readonly<{
  trackId: string
  workflowRevision: number
  previewChecksum: string
  eventKey: string | null
  stepLabel: string | null
  canSend: boolean
  status: string
  reason: string
  targetLabel: string
  mentionLabel: string
  renderedTitle: string
  renderedBody: string
  recoveryAvailable: boolean
  recoverySourceEventId: string | null
  recoveredFromEventId?: string
  existingEventId?: string
  existingRequestedAt?: string
  existingRuleEnabled?: boolean
}>

export type RegistrationManagementConfirmation = Readonly<{
  sourceEventIds: string[]
  recovered: boolean
  previousSourceEventId?: string
  previousEventId?: string
}>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseRegistrationManagementPreview(value: unknown): RegistrationManagementPreview {
  if (!value || typeof value !== "object") throw new Error("관리팀 알림 미리보기를 확인할 수 없습니다.")
  const data = value as Record<string, unknown>
  const statuses = ["ready", "not_ready", "rule_disabled", "template_missing", "owner_changed", "connection_missing", "existing_source_changed", "already_sent", "delivery_unknown"]
  const events = ["registration.case_created", "registration.consultation_completed", "registration.waiting_transitioned", "registration.admission_started"]
  if (typeof data.trackId !== "string" || !uuid.test(data.trackId)
    || !Number.isSafeInteger(data.workflowRevision) || Number(data.workflowRevision) < 1
    || typeof data.previewChecksum !== "string" || !/^[a-f0-9]{64}$/.test(data.previewChecksum)
    || typeof data.canSend !== "boolean" || typeof data.status !== "string" || !statuses.includes(data.status)
    || data.canSend !== (data.status === "ready")
    || (data.eventKey !== null && (typeof data.eventKey !== "string" || !events.includes(data.eventKey)))
    || (data.stepLabel !== null && (typeof data.stepLabel !== "string" || data.stepLabel.length > 120))
    || (data.canSend && (!data.eventKey || !data.stepLabel || !data.renderedTitle || !data.renderedBody))
    || typeof data.recoveryAvailable !== "boolean"
    || (data.recoverySourceEventId !== null && (typeof data.recoverySourceEventId !== "string" || !uuid.test(data.recoverySourceEventId)))
    || data.recoveryAvailable !== (data.recoverySourceEventId !== null)
    || (data.recoveryAvailable && !data.canSend)
    || (data.recoveredFromEventId !== undefined && (typeof data.recoveredFromEventId !== "string" || !uuid.test(data.recoveredFromEventId) || data.recoveredFromEventId === data.existingEventId))
    || (data.existingEventId !== undefined && (typeof data.existingEventId !== "string" || !uuid.test(data.existingEventId)))
    || (data.existingRequestedAt !== undefined && (typeof data.existingRequestedAt !== "string" || !Number.isFinite(Date.parse(data.existingRequestedAt))))
    || (data.existingRuleEnabled !== undefined && typeof data.existingRuleEnabled !== "boolean")
    || ["reason", "targetLabel", "mentionLabel", "renderedTitle", "renderedBody"].some((key) => typeof data[key] !== "string")) {
    throw new Error("관리팀 알림 미리보기를 확인할 수 없습니다.")
  }
  return {
    trackId: data.trackId, workflowRevision: Number(data.workflowRevision), previewChecksum: data.previewChecksum,
    eventKey: data.eventKey as string | null, stepLabel: data.stepLabel as string | null,
    canSend: data.canSend, status: data.status, reason: data.reason as string,
    targetLabel: data.targetLabel as string, mentionLabel: data.mentionLabel as string,
    renderedTitle: data.renderedTitle as string, renderedBody: data.renderedBody as string,
    recoveryAvailable: data.recoveryAvailable, recoverySourceEventId: data.recoverySourceEventId as string | null,
    ...(typeof data.recoveredFromEventId === "string" ? { recoveredFromEventId: data.recoveredFromEventId } : {}),
    ...(typeof data.existingEventId === "string" ? { existingEventId: data.existingEventId } : {}),
    ...(typeof data.existingRequestedAt === "string" ? { existingRequestedAt: data.existingRequestedAt } : {}),
    ...(typeof data.existingRuleEnabled === "boolean" ? { existingRuleEnabled: data.existingRuleEnabled } : {}),
  }
}

export function managementPreviewErrorMessage(code: string) {
  if (code.includes("recovery_changed") || code.includes("recovery_not_allowed")) return "이전 안내의 처리 상태가 변경되었습니다. 발송 이력과 미리보기를 다시 확인해 주세요."
  if (code.includes("existing_source_changed")) return "기존 알림의 내용과 현재 설정이 다릅니다. 발송 이력을 확인해 주세요."
  if (code.includes("preview_changed") || code.includes("refresh_required")) return "등록 정보나 알림 설정이 변경되었습니다. 미리보기를 다시 확인해 주세요."
  if (code.includes("not_ready")) return "현재 알림을 보낼 수 없습니다. 입력 내용과 알림 설정을 확인해 주세요."
  return "관리팀 알림을 처리하지 못했습니다. 발송 상태를 확인한 뒤 다시 시도해 주세요."
}

type RpcResult = { data: unknown; error: { message?: string } | null }
type RpcRequest = PromiseLike<RpcResult> & { abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult> }
type RpcClient = { rpc(name: string, parameters: Record<string, unknown>): RpcRequest }

export function createRegistrationManagementPreviewService(client: RpcClient | null, timeoutMs = 15_000) {
  function request(name: string, parameters: Record<string, unknown>): Promise<RpcResult> {
    if (!client) return Promise.reject(new Error("알림 연결을 확인한 뒤 다시 시도해 주세요."))
    const controller = new AbortController()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort()
        reject(new Error("응답 시간이 초과되었습니다. 발송 상태와 미리보기를 다시 확인해 주세요."))
      }, timeoutMs)
      try {
        const operation = client.rpc(name, parameters)
        const pending = operation.abortSignal ? operation.abortSignal(controller.signal) : operation
        Promise.resolve(pending).then(resolve, reject).finally(() => clearTimeout(timer))
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
  }
  return {
    async preview(trackId: string, workflowRevision: number) {
      if (!client) throw new Error("알림 연결을 확인한 뒤 다시 시도해 주세요.")
      const result = await request("get_registration_management_notification_preview_v1", { p_track_id: trackId, p_workflow_revision: workflowRevision })
      if (result.error) throw new Error(managementPreviewErrorMessage(result.error.message || ""))
      const preview = parseRegistrationManagementPreview(result.data)
      if (preview.trackId !== trackId || preview.workflowRevision !== workflowRevision) throw new Error("현재 등록건의 미리보기가 아닙니다. 다시 확인해 주세요.")
      return preview
    },
    async confirm(preview: RegistrationManagementPreview, requestKey: string) {
      if (!client) throw new Error("알림 연결을 확인한 뒤 다시 시도해 주세요.")
      const checked = parseRegistrationManagementPreview(preview)
      if (!checked.canSend) throw new Error("현재 알림을 보낼 수 없습니다. 미리보기를 다시 확인해 주세요.")
      const result = await request("ensure_registration_workflow_notification_v4", {
        p_track_id: preview.trackId, p_workflow_revision: preview.workflowRevision,
        p_request_key: requestKey, p_intent: "send_registration_management_notification",
        p_expected_preview_checksum: preview.previewChecksum,
        p_expected_recovery_source_event_id: checked.recoverySourceEventId,
      })
      if (result.error) throw new Error(managementPreviewErrorMessage(result.error.message || ""))
      const data = result.data as Record<string, unknown> | null
      const ids = data?.sourceEventIds
      if (!data || !Array.isArray(ids) || ids.length !== 1 || ids.some((id) => typeof id !== "string" || !uuid.test(id))
        || typeof data.recovered !== "boolean" || data.recovered !== checked.recoveryAvailable
        || (data.previousSourceEventId !== undefined && (typeof data.previousSourceEventId !== "string" || !uuid.test(data.previousSourceEventId)))
        || (data.previousEventId !== undefined && (typeof data.previousEventId !== "string" || !uuid.test(data.previousEventId)))
        || (data.recovered && (data.previousSourceEventId !== checked.recoverySourceEventId || ids[0] === data.previousSourceEventId))
        || (!data.recovered && (data.previousSourceEventId !== undefined || data.previousEventId !== undefined))) {
        throw new Error("관리팀 알림 요청을 확인할 수 없습니다. 발송 이력을 확인해 주세요.")
      }
      return {
        sourceEventIds: ids as string[], recovered: data.recovered,
        ...(typeof data.previousSourceEventId === "string" ? { previousSourceEventId: data.previousSourceEventId } : {}),
        ...(typeof data.previousEventId === "string" ? { previousEventId: data.previousEventId } : {}),
      } satisfies RegistrationManagementConfirmation
    },
  }
}
