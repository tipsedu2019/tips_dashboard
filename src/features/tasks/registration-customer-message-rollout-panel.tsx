"use client"

import * as React from "react"
import { Loader2, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/providers/auth-provider"

import type {
  RegistrationCustomerMessageKind,
  RegistrationObservationSolapiReadiness,
} from "./registration-customer-message-contract"
import { createRegistrationCustomerMessageAdminClient } from "./registration-customer-message-service"
import { runRegistrationCustomerMessageRolloutAction } from "./registration-customer-message-rollout"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const MESSAGE_KIND_LABELS: Readonly<Record<RegistrationCustomerMessageKind, string>> = Object.freeze({
  level_test_booking: "레벨테스트 예약 안내",
  visit_consultation_booking: "방문상담 예약 안내",
  appointment_reminder: "예약 리마인드",
  waiting_notice: "대기 안내",
  admission_application: "입학신청서 안내",
  observation_booking: "청강 예약 안내",
  observation_reminder: "청강 리마인드",
})
const ROLLOUT_PANEL_MESSAGE_KINDS: ReadonlyArray<RegistrationCustomerMessageKind> = Object.freeze([
  "level_test_booking",
  "visit_consultation_booking",
  "appointment_reminder",
  "waiting_notice",
  "admission_application",
  "observation_booking",
  "observation_reminder",
])

type RolloutRowState = Readonly<{
  status: "off" | "verification" | "live" | "error"
  detail: string
}>

const INITIAL_ROW_STATE: RolloutRowState = Object.freeze({
  status: "off",
  detail: "운영 상태를 변경하지 않았습니다.",
})

async function getAccessToken() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}

function readableError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  if (code.includes("template_drift")) return "승인 템플릿과 서버 문구 또는 버튼이 다릅니다."
  if (code.includes("provider_unavailable")) return "SOLAPI 템플릿 상태를 확인할 수 없습니다."
  if (code.includes("auth_required") || code.includes("unauthorized")) return "관리자 로그인을 다시 확인해 주세요."
  if (code.includes("invalid")) return "테스트 등록 또는 메시지 식별값을 다시 확인해 주세요."
  return "운영 준비 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."
}

function statusLabel(status: RolloutRowState["status"]) {
  if (status === "verification") return "테스트 허용"
  if (status === "live") return "운영 중"
  if (status === "error") return "확인 필요"
  return "꺼짐"
}

function readinessFact(value: boolean) {
  return value ? "준비됨" : "미준비"
}

export function RegistrationCustomerMessageRolloutPanel() {
  const { isAdmin } = useAuth()
  const client = React.useMemo(() => createRegistrationCustomerMessageAdminClient({ getAccessToken }), [])
  const [verificationTaskId, setVerificationTaskId] = React.useState("")
  const [messageIds, setMessageIds] = React.useState<Partial<Record<RegistrationCustomerMessageKind, string>>>({})
  const [receiptConfirmed, setReceiptConfirmed] = React.useState<Partial<Record<RegistrationCustomerMessageKind, boolean>>>({})
  const [rowState, setRowState] = React.useState<Partial<Record<RegistrationCustomerMessageKind, RolloutRowState>>>({})
  const [workingKind, setWorkingKind] = React.useState<RegistrationCustomerMessageKind | null>(null)
  const [readiness, setReadiness] = React.useState<RegistrationObservationSolapiReadiness | null>(null)
  const [readinessError, setReadinessError] = React.useState("")
  const [refreshingReadiness, setRefreshingReadiness] = React.useState(false)

  const updateRow = React.useCallback((messageKind: RegistrationCustomerMessageKind, next: RolloutRowState) => {
    setRowState((current) => ({ ...current, [messageKind]: next }))
  }, [])

  const run = React.useCallback(async (
    messageKind: RegistrationCustomerMessageKind,
    action: "prepare_verification" | "set_off" | "record_receipt_and_live",
  ) => {
    if (workingKind) return
    if (action === "prepare_verification" && !UUID_PATTERN.test(verificationTaskId.trim())) {
      updateRow(messageKind, { status: "error", detail: "테스트 등록 ID를 먼저 확인해 주세요." })
      return
    }
    const messageId = messageIds[messageKind]?.trim() ?? ""
    if (action === "record_receipt_and_live" && (!UUID_PATTERN.test(messageId) || !receiptConfirmed[messageKind])) {
      updateRow(messageKind, { status: "error", detail: "실제 수신 확인과 메시지 ID가 모두 필요합니다." })
      return
    }

    setWorkingKind(messageKind)
    try {
      if (action === "prepare_verification") {
        await runRegistrationCustomerMessageRolloutAction(client, {
          action,
          messageKind,
          verificationTaskId: verificationTaskId.trim(),
        })
        updateRow(messageKind, {
          status: "verification",
          detail: "승인 템플릿이 일치하며 이 테스트 등록에만 발송할 수 있습니다.",
        })
      } else if (action === "record_receipt_and_live") {
        await runRegistrationCustomerMessageRolloutAction(client, {
          action,
          messageKind,
          messageId,
          receivedAt: new Date().toISOString(),
        })
        updateRow(messageKind, {
          status: "live",
          detail: "실제 수신 증거가 기록되어 운영 발송을 사용할 수 있습니다.",
        })
      } else {
        await runRegistrationCustomerMessageRolloutAction(client, { action, messageKind })
        updateRow(messageKind, {
          status: "off",
          detail: "이 종류의 고객 발송을 껐습니다.",
        })
      }
    } catch (error) {
      updateRow(messageKind, { status: "error", detail: readableError(error) })
    } finally {
      setWorkingKind(null)
    }
  }, [client, messageIds, receiptConfirmed, updateRow, verificationTaskId, workingKind])

  const refreshReadiness = React.useCallback(async () => {
    if (refreshingReadiness) return
    setRefreshingReadiness(true)
    setReadinessError("")
    try {
      setReadiness(await client.inspectObservationReadiness())
    } catch (error) {
      setReadinessError(readableError(error))
    } finally {
      setRefreshingReadiness(false)
    }
  }, [client, refreshingReadiness])

  if (!isAdmin) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>관리자 권한이 필요합니다</CardTitle>
          <CardDescription>솔라피 운영 상태는 관리자만 변경할 수 있습니다.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <CardTitle>솔라피 운영 준비</CardTitle>
              <CardDescription className="mt-1">
                이 화면은 템플릿 검증과 발송 범위만 관리합니다. 고객 발송은 등록 상세의 미리보기에서 따로 확인해야 합니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">청강 자동 발송 준비 상태</p>
              <p className="text-sm text-muted-foreground">상태 확인은 읽기 전용이며 발송·전환을 실행하지 않습니다.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void refreshReadiness()} disabled={refreshingReadiness}>
              {refreshingReadiness ? <Loader2 className="animate-spin" /> : null}
              상태 새로고침
            </Button>
          </div>
          {readiness ? (
            <dl className="grid gap-2 rounded-md bg-muted/45 p-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">스케줄 설치</dt><dd>{readinessFact(readiness.schedule.installed)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">스케줄 활성</dt><dd>{readinessFact(readiness.schedule.active)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">계약 준비</dt><dd>{readinessFact(readiness.schedule.contractReady)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Vault 준비</dt><dd>{readinessFact(readiness.schedule.vaultReady)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">최근 실행</dt><dd>{readiness.schedule.heartbeatCurrent ? readiness.schedule.lastSucceededAt || "확인 필요" : "확인 필요"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">청강 예약 수신 확인</dt><dd>{readinessFact(readiness.bookingReceipt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">청강 리마인드 수신 확인</dt><dd>{readinessFact(readiness.reminderReceipt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">대기 작업</dt><dd>{readiness.pending}</dd></div>
            </dl>
          ) : null}
          {readinessError ? <p role="alert" className="text-sm text-destructive">{readinessError}</p> : null}
          <Label htmlFor="verification-task-id">테스트 등록 ID</Label>
          <Input
            id="verification-task-id"
            value={verificationTaskId}
            onChange={(event) => setVerificationTaskId(event.target.value)}
            placeholder="등록 상세 URL의 taskId"
            autoComplete="off"
          />
        </CardContent>
      </Card>

      {ROLLOUT_PANEL_MESSAGE_KINDS.map((messageKind) => {
        const state = rowState[messageKind] ?? INITIAL_ROW_STATE
        const working = workingKind === messageKind
        return (
          <Card key={messageKind}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{MESSAGE_KIND_LABELS[messageKind]}</CardTitle>
                <Badge variant={state.status === "live" ? "default" : "secondary"}>{statusLabel(state.status)}</Badge>
              </div>
              <CardDescription>{state.detail}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void run(messageKind, "prepare_verification")}
                  disabled={Boolean(workingKind)}
                >
                  {working ? <Loader2 className="animate-spin" /> : null}
                  템플릿 검증·테스트 허용
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void run(messageKind, "set_off")}
                  disabled={Boolean(workingKind)}
                >
                  발송 끄기
                </Button>
              </div>

              <div className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-2">
                  <Label htmlFor={`message-id-${messageKind}`}>수신 확인할 메시지 ID</Label>
                  <Input
                    id={`message-id-${messageKind}`}
                    value={messageIds[messageKind] ?? ""}
                    onChange={(event) => setMessageIds((current) => ({ ...current, [messageKind]: event.target.value }))}
                    placeholder="발송 이력의 messageId"
                    autoComplete="off"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={Boolean(receiptConfirmed[messageKind])}
                      onCheckedChange={(checked) => setReceiptConfirmed((current) => ({
                        ...current,
                        [messageKind]: checked === true,
                      }))}
                    />
                    실제 휴대폰에서 이 알림톡을 확인했습니다
                  </label>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void run(messageKind, "record_receipt_and_live")}
                  disabled={Boolean(workingKind) || !receiptConfirmed[messageKind] || !messageIds[messageKind]}
                >
                  수신 확인·운영 전환
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
