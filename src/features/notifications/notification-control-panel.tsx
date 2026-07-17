"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { AlertTriangle, Check, Loader2, MessageSquareText, PlugZap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"

import {
  buildNotificationPatch,
  createNotificationDraft,
  isNotificationDraftDirty,
  rebaseNotificationDraft,
  validateNotificationDraft,
  type NotificationDraft,
  type NotificationRulePatch,
} from "./notification-control-plane-model"
import { isNotificationAsyncGenerationCurrent } from "./notification-control-plane-async-state"
import { resolveNotificationControlPlaneAvailability } from "./notification-control-plane-availability"
import {
  createNotificationControlPlaneService,
  NotificationControlPlaneHttpError,
} from "./notification-control-plane-service"
import {
  NOTIFICATION_CONNECTION_KEYS,
  NOTIFICATION_WORKFLOW_OPTIONS,
  type NotificationConnectionDto,
  type NotificationConnectionKey,
  type NotificationControlPlaneSnapshot,
  type NotificationRevisionMap,
  type NotificationRuleDto,
  type NotificationWorkflowKey,
} from "./notification-control-plane-types"
import { useNotificationNavigationGuard } from "./use-notification-navigation-guard"

export type NotificationControlPlaneAvailability = {
  status: "loading" | "enabled" | "disabled" | "unavailable"
}

type NotificationControlPanelSection = "rules" | "deliveries" | "connections"

export type NotificationControlPanelProps = {
  workflowKey: NotificationWorkflowKey
  presentation: "page" | "dialog"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialSection?: NotificationControlPanelSection
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readSettingsFlag(input: unknown): boolean | null {
  if (!isRecord(input) || !isRecord(input.flags)) return null
  const flag = input.flags.notification_control_plane_settings_ui_enabled
  if (!isRecord(flag) || typeof flag.enabled !== "boolean") return null
  return flag.enabled
}

const CONNECTION_LABELS: Record<NotificationConnectionKey, string> = {
  "google_chat.management": "관리팀 Google Chat",
  "google_chat.executive": "경영진 Google Chat",
  "google_chat.math": "수학팀 Google Chat",
  "google_chat.english": "영어팀 Google Chat",
}

const RECONCILIATION_POLL_MAX_ATTEMPTS = 8
const RECONCILIATION_POLL_INTERVAL_MS = 750

type ReconciliationJobState = {
  jobKind: string
  jobId: string
  status: string
  attemptCount: number
  lastErrorCode: string | null
}

type SavePhase =
  | "idle"
  | "saving"
  | "saved"
  | "reconciling"
  | "reconciled"
  | "reconciliation_failed"

type ConflictState = {
  remoteSnapshot: NotificationControlPlaneSnapshot
  conflictingFields: string[]
  overwriteConfirmationRequired: boolean
}

type ConflictOverrideState = {
  requestId: string
  conflictingFields: string[]
}

type EventRuleGroup = {
  eventKey: string
  eventLabel: string
  groupLabel: string | null
  triggerDescription: string | null
  sortOrder: number
  rules: NotificationRuleDto[]
}

function getWorkflowLabel(workflowKey: NotificationWorkflowKey) {
  return NOTIFICATION_WORKFLOW_OPTIONS.find(({ key }) => key === workflowKey)?.label
    ?? workflowKey
}

function groupServerRules(rules: ReadonlyArray<NotificationRuleDto>): EventRuleGroup[] {
  const groups = new Map<string, EventRuleGroup>()
  for (const rule of rules) {
    const current = groups.get(rule.eventKey)
    if (current) {
      current.rules.push(rule)
      current.sortOrder = Math.min(current.sortOrder, rule.sortOrder ?? Number.MAX_SAFE_INTEGER)
      continue
    }
    groups.set(rule.eventKey, {
      eventKey: rule.eventKey,
      eventLabel: rule.eventLabel ?? rule.eventKey,
      groupLabel: rule.groupLabel,
      triggerDescription: rule.triggerDescription,
      sortOrder: rule.sortOrder ?? Number.MAX_SAFE_INTEGER,
      rules: [rule],
    })
  }
  return Array.from(groups.values()).sort((left, right) => (
    left.sortOrder - right.sortOrder || left.eventKey.localeCompare(right.eventKey)
  ))
}

async function getAccessToken() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}

function createBrowserControlPlaneService() {
  return createNotificationControlPlaneService({
    baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
    getAccessToken,
  })
}

function formatTimestamp(value: string | null) {
  if (!value) return "기록 없음"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "기록 없음"
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function errorMessage(error: unknown) {
  if (error instanceof NotificationControlPlaneHttpError) {
    if (error.code === "notification_unauthorized") return "로그인 정보를 다시 확인해 주세요."
    if (error.code === "notification_settings_ui_disabled") {
      return "공통 알림 설정이 아직 활성화되지 않았습니다."
    }
    if (error.code === "notification_google_chat_connection_required") {
      return "먼저 필요한 Google Chat 연결을 복구해 주세요."
    }
  }
  return "알림 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
}

function revisionsForPatch(
  snapshot: NotificationControlPlaneSnapshot,
  patch: { rules: Record<string, NotificationRulePatch> },
): NotificationRevisionMap {
  const changedRuleIds = new Set(Object.keys(patch.rules))
  const revisions: Record<string, string> = {}
  for (const rule of snapshot.rules) {
    if (changedRuleIds.has(rule.id)) revisions[rule.id] = rule.revision
  }
  return revisions
}

function connectionFromWire(input: unknown): NotificationConnectionDto | null {
  if (!isRecord(input)) return null
  const connectionKey = input.connection_key
  if (
    typeof connectionKey !== "string" ||
    !NOTIFICATION_CONNECTION_KEYS.includes(connectionKey as NotificationConnectionKey) ||
    (input.connection_state !== "legacy_active" &&
      input.connection_state !== "encrypted_active" &&
      input.connection_state !== "disconnected") ||
    typeof input.revision !== "string" ||
    typeof input.editable !== "boolean" ||
    (input.webhook_url_mask !== null && typeof input.webhook_url_mask !== "string") ||
    (input.last_verified_at !== null && typeof input.last_verified_at !== "string") ||
    (input.last_error_code !== null && typeof input.last_error_code !== "string")
  ) return null
  return {
    connectionKey: connectionKey as NotificationConnectionKey,
    connectionState: input.connection_state,
    revision: input.revision,
    configured: input.connection_state !== "disconnected",
    webhookUrlMask: input.webhook_url_mask,
    lastVerifiedAt: input.last_verified_at,
    lastErrorCode: input.last_error_code,
    editable: input.editable,
  }
}

function reconciliationJobFromWire(input: unknown): ReconciliationJobState | null {
  if (
    !isRecord(input) ||
    typeof input.job_kind !== "string" ||
    typeof input.job_id !== "string" ||
    typeof input.status !== "string" ||
    !Number.isSafeInteger(input.attempt_count) ||
    (input.attempt_count as number) < 0 ||
    (input.last_error_code !== undefined &&
      input.last_error_code !== null &&
      typeof input.last_error_code !== "string")
  ) return null
  return {
    jobKind: input.job_kind,
    jobId: input.job_id,
    status: input.status,
    attemptCount: input.attempt_count as number,
    lastErrorCode: typeof input.last_error_code === "string" ? input.last_error_code : null,
  }
}

async function getReconciliationJobStatus(
  job: Pick<ReconciliationJobState, "jobKind" | "jobId">,
) {
  if (!supabase) throw new Error("notification_reconciliation_unavailable")
  const { data, error } = await supabase.rpc(
    "get_notification_orchestration_job_status_v1",
    { p_job_kind: job.jobKind, p_job_id: job.jobId },
  )
  if (error) throw error
  const parsed = reconciliationJobFromWire(data)
  if (!parsed) throw new Error("notification_reconciliation_unsafe_response")
  return parsed
}

async function retryReconciliationJob(job: ReconciliationJobState) {
  if (!supabase) throw new Error("notification_reconciliation_unavailable")
  const { data, error } = await supabase.rpc(
    "retry_notification_orchestration_job_v1",
    {
      p_job_kind: job.jobKind,
      p_job_id: job.jobId,
      p_expected_attempt_count: job.attemptCount,
      p_request_id: crypto.randomUUID(),
    },
  )
  if (error) throw error
  const parsed = reconciliationJobFromWire(data)
  if (!parsed) throw new Error("notification_reconciliation_unsafe_response")
  return parsed
}

function waitForReconciliationPoll() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, RECONCILIATION_POLL_INTERVAL_MS)
  })
}

function connectionStatusLabel(connection: NotificationConnectionDto) {
  if (connection.connectionState === "disconnected") return "연결 안 됨"
  if (connection.lastErrorCode) return "연결 오류"
  return "연결됨"
}

function saveStatusLabel(savePhase: SavePhase, savedAt: string | null) {
  if (savePhase === "saving") return "저장 중"
  if (savePhase === "reconciling") return "저장됨 · 알림 재계산 중"
  if (savePhase === "reconciled") return "저장됨 · 알림 재계산 완료"
  if (savePhase === "reconciliation_failed") {
    return "저장됨 · 알림 재계산 실패"
  }
  if (savePhase === "saved") return `저장됨 · ${formatTimestamp(savedAt)}`
  return ""
}

type RuleToggleProps = {
  rule: NotificationRuleDto
  draft: NotificationDraft
  connections: ReadonlyArray<NotificationConnectionDto>
  saving: boolean
  compact?: boolean
  onChange: (ruleId: string, patch: NotificationRulePatch) => void
  onEditTemplate: (ruleId: string) => void
}

function RuleToggle({
  rule,
  draft,
  connections,
  saving,
  compact = false,
  onChange,
  onEditTemplate,
}: RuleToggleProps) {
  const value = draft.rules[rule.id]
  if (!value) return null
  const requiredConnectionKeys: NotificationConnectionKey[] = rule.connectionKey
    ? [rule.connectionKey]
    : rule.audienceKey === "management_team"
      ? ["google_chat.management"]
      : rule.audienceKey === "executive_team"
        ? ["google_chat.executive"]
        : rule.audienceKey === "subject_team"
          ? ["google_chat.math", "google_chat.english"]
          : []
  const connectionMissing = value.enabled && rule.channelKey === "google_chat" && (
    requiredConnectionKeys.length === 0 ||
    requiredConnectionKeys.some((connectionKey) => {
      const connection = connections.find((item) => item.connectionKey === connectionKey)
      return !connection ||
        connection.connectionState === "disconnected" ||
        connection.lastErrorCode !== null
    })
  )
  const preservesExistingRule = rule.enabled && connectionMissing

  return (
    <div className={cn(
      "rounded-lg border bg-background p-3",
      compact ? "space-y-2" : "flex min-w-52 items-center justify-between gap-3",
    )}>
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">
          {rule.audienceLabel ?? rule.audienceKey}
        </p>
        <p className="text-xs text-muted-foreground">
          {rule.channelLabel ?? rule.channelKey}
          {rule.ruleVariantKey === "immediate" ? "" : ` · ${rule.ruleVariantKey}`}
        </p>
        {connectionMissing ? (
          <p className="text-xs font-medium text-amber-700">
            {preservesExistingRule
              ? "연결 필요 · 기존 설정과 이력은 유지됩니다."
              : "연결 필요 · 저장 전에 연결해 주세요."}
          </p>
        ) : null}
      </div>
      <div className={cn("flex items-center gap-2", compact && "justify-between")}>
        <SwitchPrimitive.Root
          aria-label={`${rule.audienceLabel ?? rule.audienceKey} ${rule.channelLabel ?? rule.channelKey}`}
          checked={value.enabled}
          disabled={saving}
          onCheckedChange={(enabled) => onChange(rule.id, { enabled })}
          className="data-[state=checked]:bg-primary relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors disabled:opacity-50"
        >
          <SwitchPrimitive.Thumb className="data-[state=checked]:translate-x-4 block size-4 translate-x-0.5 rounded-full bg-background shadow transition-transform" />
        </SwitchPrimitive.Root>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => onEditTemplate(rule.id)}
        >
          내용 수정
        </Button>
      </div>
    </div>
  )
}

type RulesViewProps = {
  rules: ReadonlyArray<NotificationRuleDto>
  draft: NotificationDraft
  connections: ReadonlyArray<NotificationConnectionDto>
  saving: boolean
  onChange: RuleToggleProps["onChange"]
  onEditTemplate: RuleToggleProps["onEditTemplate"]
}

function RulesView({
  rules,
  draft,
  connections,
  saving,
  onChange,
  onEditTemplate,
}: RulesViewProps) {
  const groups = React.useMemo(() => groupServerRules(rules), [rules])
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        이 업무에 설정할 수 있는 알림 규칙이 없습니다.
      </div>
    )
  }

  return (
    <div data-notification-draft-source="shared">
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th scope="col" className="w-[24%] px-4 py-3 font-medium">이벤트</th>
              <th scope="col" className="w-[16%] px-3 py-3 font-medium">대상</th>
              <th scope="col" className="w-[15%] px-3 py-3 font-medium">채널</th>
              <th scope="col" className="w-[13%] px-3 py-3 font-medium">시점</th>
              <th scope="col" className="px-3 py-3 font-medium">설정</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => group.rules.map((rule, ruleIndex) => (
              <tr key={rule.id} className="border-b last:border-b-0 align-top">
                {ruleIndex === 0 ? (
                  <th
                    scope="rowgroup"
                    rowSpan={group.rules.length}
                    className="border-r bg-muted/15 px-4 py-4 font-normal"
                  >
                    {group.groupLabel ? (
                      <p className="text-xs font-medium text-muted-foreground">{group.groupLabel}</p>
                    ) : null}
                    <p className="mt-0.5 font-semibold text-foreground">{group.eventLabel}</p>
                    {group.triggerDescription ? (
                      <p className="mt-1 text-xs text-muted-foreground">{group.triggerDescription}</p>
                    ) : null}
                  </th>
                ) : null}
                <td className="px-3 py-4 font-medium">
                  {rule.audienceLabel ?? rule.audienceKey}
                </td>
                <td className="px-3 py-4 text-muted-foreground">
                  {rule.channelLabel ?? rule.channelKey}
                </td>
                <td className="px-3 py-4 text-muted-foreground">
                  {rule.ruleVariantKey === "immediate" ? "즉시" : rule.ruleVariantKey}
                </td>
                <td className="px-3 py-2">
                  <RuleToggle
                    rule={rule}
                    draft={draft}
                    connections={connections}
                    saving={saving}
                    onChange={onChange}
                    onEditTemplate={onEditTemplate}
                  />
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {groups.map((group) => (
          <Card key={group.eventKey}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{group.eventLabel}</CardTitle>
              {group.triggerDescription ? (
                <CardDescription>{group.triggerDescription}</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              {group.rules.map((rule) => (
                <RuleToggle
                  key={rule.id}
                  rule={rule}
                  draft={draft}
                  connections={connections}
                  saving={saving}
                  compact
                  onChange={onChange}
                  onEditTemplate={onEditTemplate}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

type TemplateEditorProps = {
  rule: NotificationRuleDto | null
  draft: NotificationDraft | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onChange: (ruleId: string, patch: NotificationRulePatch) => void
}

function TemplateEditor({ rule, draft, saving, onOpenChange, onChange }: TemplateEditorProps) {
  if (!rule || !draft) return null
  const value = draft.rules[rule.id]
  if (!value) return null
  const schedule = value.scheduleConfig

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule.eventLabel ?? rule.eventKey} · 내용 수정</DialogTitle>
          <DialogDescription>
            {rule.audienceLabel ?? rule.audienceKey}에게 보내는 {rule.channelLabel ?? rule.channelKey} 내용입니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`notification-title-${rule.id}`}>제목</Label>
            <Input
              id={`notification-title-${rule.id}`}
              value={value.titleTemplate}
              disabled={saving}
              onChange={(event) => onChange(rule.id, { titleTemplate: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`notification-body-${rule.id}`}>본문</Label>
            <Textarea
              id={`notification-body-${rule.id}`}
              value={value.bodyTemplate}
              disabled={saving}
              rows={7}
              onChange={(event) => onChange(rule.id, { bodyTemplate: event.target.value })}
            />
          </div>
          {schedule && "leadMinutes" in schedule ? (
            <div className="space-y-2">
              <Label htmlFor={`notification-lead-${rule.id}`}>기준 시각 전 알림(분)</Label>
              <Input
                id={`notification-lead-${rule.id}`}
                type="number"
                min={0}
                value={schedule.leadMinutes}
                disabled={saving}
                onChange={(event) => onChange(rule.id, {
                  scheduleConfig: {
                    ...schedule,
                    leadMinutes: Math.max(0, Number.parseInt(event.target.value || "0", 10)),
                  },
                })}
              />
            </div>
          ) : null}
          {schedule && "localTime" in schedule ? (
            <div className="space-y-2">
              <Label htmlFor={`notification-time-${rule.id}`}>발송 시각</Label>
              <Input
                id={`notification-time-${rule.id}`}
                type="time"
                value={schedule.localTime}
                disabled={saving}
                onChange={(event) => onChange(rule.id, {
                  scheduleConfig: { ...schedule, localTime: event.target.value },
                })}
              />
            </div>
          ) : null}
          {rule.template.allowedVariables.length > 0 ? (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium">사용 가능한 변수</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {rule.template.allowedVariables.map((variable) => (
                  <Badge key={variable.key} variant="secondary">{`{${variable.token}}`}</Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>편집 완료</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ConnectionsViewProps = {
  connections: ReadonlyArray<NotificationConnectionDto>
  busyKey: NotificationConnectionKey | null
  error: string | null
  onMutate: (
    connection: NotificationConnectionDto,
    action: "replace" | "verify" | "disconnect",
    webhookUrl?: string,
  ) => Promise<boolean>
  onRequestConfirmation: (
    connection: NotificationConnectionDto,
    action: "verify" | "disconnect",
  ) => void
}

function ConnectionsView({
  connections,
  busyKey,
  error,
  onMutate,
  onRequestConfirmation,
}: ConnectionsViewProps) {
  const [webhookInputs, setWebhookInputs] = React.useState<Record<string, string>>({})

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">연결 (Connections)</h2>
        <p className="text-sm text-muted-foreground">
          저장된 주소는 마스킹해서 표시합니다. 주소 저장만으로 테스트 메시지를 보내지 않습니다.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {connections.map((connection) => {
        const busy = busyKey === connection.connectionKey
        return (
          <Card key={connection.connectionKey}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{CONNECTION_LABELS[connection.connectionKey]}</CardTitle>
                <Badge variant={connection.lastErrorCode ? "destructive" : "outline"}>
                  {connectionStatusLabel(connection)}
                </Badge>
              </div>
              <CardDescription>
                {connection.webhookUrlMask ?? "저장된 연결 없음"} · 마지막 검증 {formatTimestamp(connection.lastVerifiedAt)}
              </CardDescription>
            </CardHeader>
            {connection.editable ? (
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`connection-${connection.connectionKey}`}>새 Webhook URL</Label>
                  <Input
                    id={`connection-${connection.connectionKey}`}
                    type="password"
                    autoComplete="off"
                    value={webhookInputs[connection.connectionKey] ?? ""}
                    disabled={busy}
                    placeholder="https://chat.googleapis.com/..."
                    onChange={(event) => {
                      const value = event.target.value
                      setWebhookInputs((current) => ({
                        ...current,
                        [connection.connectionKey]: value,
                      }))
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !(webhookInputs[connection.connectionKey] ?? "").trim()}
                    onClick={async () => {
                      const replaced = await onMutate(
                        connection,
                        "replace",
                        webhookInputs[connection.connectionKey]?.trim(),
                      )
                      if (replaced) {
                        setWebhookInputs((current) => ({ ...current, [connection.connectionKey]: "" }))
                      }
                    }}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <PlugZap />}
                    연결 교체
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !connection.configured}
                    onClick={() => onRequestConfirmation(connection, "verify")}
                  >
                    테스트 메시지 보내기
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !connection.configured}
                    onClick={() => onRequestConfirmation(connection, "disconnect")}
                  >
                    연결 해제
                  </Button>
                </div>
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm text-muted-foreground">관리자만 연결을 변경하거나 검증할 수 있습니다.</p>
              </CardContent>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function DeliverySummary({ snapshot }: { snapshot: NotificationControlPlaneSnapshot }) {
  const summary = snapshot.deliverySummary
  const items = [
    ["대기", summary.pendingCount],
    ["완료", summary.sentCount],
    ["실패", summary.failedCount],
    ["결과 확인 필요", summary.unknownCount],
  ] as const
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">최근 전달 요약</h2>
        <p className="text-sm text-muted-foreground">
          마지막 전달 {formatTimestamp(summary.latestDeliveryAt)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {items.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function useNotificationControlPlaneAvailability(): NotificationControlPlaneAvailability {
  const [status, setStatus] = React.useState<NotificationControlPlaneAvailability["status"]>(
    "loading",
  )

  React.useEffect(() => {
    let active = true
    if (!supabase) {
      setStatus("unavailable")
      return () => {
        active = false
      }
    }

    void (async () => {
      const sessionResult = await supabase.auth.getSession()
      if (!active) return
      if (sessionResult.error || !sessionResult.data.session) {
        setStatus("unavailable")
        return
      }
      const [flagsResult, runtimeResult] = await Promise.all([
        supabase.rpc("get_notification_runtime_flags_v1"),
        supabase.rpc("common_notification_control_plane_runtime_version"),
      ])
      if (!active) return
      const settingsFlag = flagsResult.error === null
        ? readSettingsFlag(flagsResult.data)
        : null
      const runtimeVersion = runtimeResult.error === null ? runtimeResult.data : null
      setStatus(resolveNotificationControlPlaneAvailability({
        hasSession: true,
        settingsFlag,
        runtimeVersion,
        capabilityError: flagsResult.error !== null || runtimeResult.error !== null,
      }))
    })().catch(() => {
      if (active) setStatus("unavailable")
    })

    return () => {
      active = false
    }
  }, [])

  return { status }
}

export function NotificationControlPanel({
  workflowKey,
  presentation,
  open,
  onOpenChange,
  initialSection = "rules",
}: NotificationControlPanelProps) {
  const service = React.useMemo(createBrowserControlPlaneService, [])
  const [pageWorkflow, setPageWorkflow] = React.useState<NotificationWorkflowKey>(workflowKey)
  const activeWorkflow = presentation === "dialog" ? workflowKey : pageWorkflow
  const visible = presentation === "page" || open === true
  const [snapshot, setSnapshot] = React.useState<NotificationControlPlaneSnapshot | null>(null)
  const [baseDraft, setBaseDraft] = React.useState<NotificationDraft | null>(null)
  const [draft, setDraft] = React.useState<NotificationDraft | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadAttempt, setLoadAttempt] = React.useState(0)
  const [message, setMessage] = React.useState<string | null>(null)
  const [savePhase, setSavePhase] = React.useState<SavePhase>("idle")
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null)
  const [activeSection, setActiveSection] = React.useState<NotificationControlPanelSection>(
    presentation === "page" ? initialSection : "rules",
  )
  const [conflict, setConflict] = React.useState<ConflictState | null>(null)
  const [conflictOverride, setConflictOverride] = React.useState<ConflictOverrideState | null>(null)
  const [latestSnapshotConfirmationOpen, setLatestSnapshotConfirmationOpen] = React.useState(false)
  const [connectionBusyKey, setConnectionBusyKey] = React.useState<NotificationConnectionKey | null>(null)
  const [connectionError, setConnectionError] = React.useState<string | null>(null)
  const [pendingConnectionAction, setPendingConnectionAction] = React.useState<{
    connection: NotificationConnectionDto
    action: "verify" | "disconnect"
  } | null>(null)
  const [reconciliationJob, setReconciliationJob] = React.useState<ReconciliationJobState | null>(null)
  const [reconciliationRetrying, setReconciliationRetrying] = React.useState(false)
  const reconciliationPollGenerationRef = React.useRef(0)
  const saveRequestRef = React.useRef<{ signature: string; requestId: string } | null>(null)

  React.useEffect(() => {
    if (!visible) return
    reconciliationPollGenerationRef.current += 1
    let active = true
    setLoading(true)
    setMessage(null)
    setConflict(null)
    setConflictOverride(null)
    setLatestSnapshotConfirmationOpen(false)
    setEditingRuleId(null)
    saveRequestRef.current = null
    void service.getControlPlane({ workflowKey: activeWorkflow }).then((nextSnapshot) => {
      if (!active) return
      const nextDraft = createNotificationDraft(nextSnapshot)
      setSnapshot(nextSnapshot)
      setBaseDraft(nextDraft)
      setDraft(nextDraft)
      setSavePhase("idle")
      setReconciliationJob(null)
    }).catch((error: unknown) => {
      if (!active) return
      setSnapshot(null)
      setBaseDraft(null)
      setDraft(null)
      setMessage(errorMessage(error))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [activeWorkflow, loadAttempt, service, visible])

  const dirty = React.useMemo(() => (
    baseDraft !== null && draft !== null && isNotificationDraftDirty(baseDraft, draft)
  ), [baseDraft, draft])
  const saving = savePhase === "saving"

  const updateRule = React.useCallback((ruleId: string, patch: NotificationRulePatch) => {
    reconciliationPollGenerationRef.current += 1
    setReconciliationJob(null)
    saveRequestRef.current = null
    if (conflictOverride && snapshot) {
      setConflict({
        remoteSnapshot: snapshot,
        conflictingFields: [...conflictOverride.conflictingFields],
        overwriteConfirmationRequired: true,
      })
    }
    setConflictOverride(null)
    setDraft((current) => {
      const currentRule = current?.rules[ruleId]
      if (!current || !currentRule) return current
      return {
        ...current,
        rules: {
          ...current.rules,
          [ruleId]: { ...currentRule, ...patch },
        },
      }
    })
    setMessage(null)
    setSavePhase("idle")
  }, [conflictOverride, snapshot])

  const pollReconciliation = React.useCallback(async (initialJob: ReconciliationJobState) => {
    const generation = reconciliationPollGenerationRef.current + 1
    reconciliationPollGenerationRef.current = generation
    let currentJob = initialJob
    setReconciliationJob(currentJob)
    setSavePhase("reconciling")

    for (let attempt = 0; attempt < RECONCILIATION_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (reconciliationPollGenerationRef.current !== generation) return
      if (currentJob.status === "succeeded" || currentJob.status === "superseded") {
        setSavePhase("reconciled")
        return
      }
      if (currentJob.status === "failed") {
        setSavePhase("reconciliation_failed")
        return
      }
      await waitForReconciliationPoll()
      if (reconciliationPollGenerationRef.current !== generation) return
      try {
        const nextJob = await getReconciliationJobStatus(currentJob)
        if (reconciliationPollGenerationRef.current !== generation) return
        currentJob = nextJob
        setReconciliationJob(currentJob)
      } catch {
        if (reconciliationPollGenerationRef.current !== generation) return
        setSavePhase("reconciliation_failed")
        setMessage("저장된 설정의 알림 재계산 상태를 확인하지 못했습니다.")
        return
      }
    }
    if (reconciliationPollGenerationRef.current !== generation) return
    setSavePhase("reconciliation_failed")
    setMessage("알림 재계산 상태 확인이 지연되고 있습니다. 다시 시도해 주세요.")
  }, [])

  React.useEffect(() => () => {
    reconciliationPollGenerationRef.current += 1
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!snapshot || !baseDraft || !draft) return false
    if (!isNotificationDraftDirty(baseDraft, draft)) return true
    if (conflict) {
      setMessage("먼저 설정 충돌을 해결해 주세요.")
      return false
    }
    const validation = validateNotificationDraft(snapshot, draft)
    if (!validation.ok) {
      const connectionIssue = validation.issues.some(
        ({ code }) => code === "google_chat_connection_required",
      )
      setMessage(connectionIssue
        ? "새 Google Chat 알림을 켜려면 먼저 해당 연결을 복구해 주세요."
        : "입력한 템플릿과 예약 시각을 확인해 주세요.")
      return false
    }
    const patch = buildNotificationPatch(baseDraft, validation.value)
    if (Object.keys(patch.rules).length === 0) return true
    const expectedRevisions = revisionsForPatch(snapshot, patch)
    const saveSignature = JSON.stringify({
      workflowKey: activeWorkflow,
      expectedRevisions,
      patch,
      conflictOverride,
    })
    const requestId = saveRequestRef.current?.signature === saveSignature
      ? saveRequestRef.current.requestId
      : crypto.randomUUID()
    saveRequestRef.current = { signature: saveSignature, requestId }

    setSavePhase("saving")
    setMessage(null)
    try {
      const result = await service.saveControlPlane({
        workflowKey: activeWorkflow,
        expectedRevisions,
        patch,
        requestId,
        ...(conflictOverride ? { conflictOverride } : {}),
      })
      const nextDraft = createNotificationDraft(result)
      setSnapshot(result)
      setBaseDraft(nextDraft)
      setDraft(nextDraft)
      setSavedAt(new Date().toISOString())
      setConflict(null)
      setConflictOverride(null)
      saveRequestRef.current = null
      if (result.reconciliationJob) {
        const nextJob: ReconciliationJobState = {
          jobKind: result.reconciliationJob.jobKind,
          jobId: result.reconciliationJob.jobId,
          status: result.reconciliationJob.status,
          attemptCount: result.reconciliationJob.attemptCount,
          lastErrorCode: null,
        }
        void pollReconciliation(nextJob)
      } else {
        setReconciliationJob(null)
        setSavePhase("saved")
      }
      return true
    } catch (error) {
      if (
        error instanceof NotificationControlPlaneHttpError &&
        error.code === "notification_revision_conflict" &&
        error.currentSnapshot
      ) {
        saveRequestRef.current = null
        setConflictOverride(null)
        setConflict({
          remoteSnapshot: error.currentSnapshot,
          conflictingFields: [],
          overwriteConfirmationRequired: false,
        })
        setMessage("다른 사용자가 같은 설정을 먼저 저장했습니다. 내 초안은 그대로 유지했습니다.")
      } else {
        setMessage(errorMessage(error))
      }
      setSavePhase("idle")
      return false
    }
  }, [activeWorkflow, baseDraft, conflict, conflictOverride, draft, pollReconciliation, service, snapshot])

  const handleRetryReconciliation = React.useCallback(async () => {
    if (!reconciliationJob || reconciliationRetrying) return
    const generation = reconciliationPollGenerationRef.current + 1
    reconciliationPollGenerationRef.current = generation
    setReconciliationRetrying(true)
    setMessage(null)
    try {
      let retriedJob = reconciliationJob
      if (reconciliationJob.status === "failed") {
        retriedJob = await retryReconciliationJob(reconciliationJob)
        if (!isNotificationAsyncGenerationCurrent(generation, reconciliationPollGenerationRef.current)) return
      }
      if (!isNotificationAsyncGenerationCurrent(generation, reconciliationPollGenerationRef.current)) return
      void pollReconciliation(retriedJob)
    } catch {
      if (!isNotificationAsyncGenerationCurrent(generation, reconciliationPollGenerationRef.current)) return
      setSavePhase("reconciliation_failed")
      setMessage("알림 재계산 작업을 다시 시작하지 못했습니다. 최신 상태를 확인해 주세요.")
    } finally {
      setReconciliationRetrying(false)
    }
  }, [pollReconciliation, reconciliationJob, reconciliationRetrying])

  const navigationGuard = useNotificationNavigationGuard({
    dirty,
    saving,
    onSave: handleSave,
  })

  const requestClose = React.useCallback(() => {
    navigationGuard.requestNavigation(() => onOpenChange?.(false))
  }, [navigationGuard, onOpenChange])

  const acceptLatestSnapshot = React.useCallback(() => {
    if (!conflict) return
    const nextDraft = createNotificationDraft(conflict.remoteSnapshot)
    setSnapshot(conflict.remoteSnapshot)
    setBaseDraft(nextDraft)
    setDraft(nextDraft)
    setConflict(null)
    setConflictOverride(null)
    setLatestSnapshotConfirmationOpen(false)
    saveRequestRef.current = null
    reconciliationPollGenerationRef.current += 1
    setReconciliationJob(null)
    setSavePhase("idle")
    setMessage("최신 설정을 불러왔습니다.")
  }, [conflict])

  const keepLocalChanges = React.useCallback(() => {
    if (!conflict || !baseDraft || !draft) return
    const remoteDraft = createNotificationDraft(conflict.remoteSnapshot)
    const rebased = rebaseNotificationDraft(baseDraft, draft, remoteDraft)
    setSnapshot(conflict.remoteSnapshot)
    setBaseDraft(remoteDraft)
    setDraft(rebased.draft)
    setConflictOverride(null)
    saveRequestRef.current = null
    if (rebased.ok) {
      setConflict(null)
      setMessage("최신 설정 위에 내 변경을 다시 적용했습니다. 내용을 확인하고 저장해 주세요.")
      return
    }
    setConflict({
      remoteSnapshot: conflict.remoteSnapshot,
      conflictingFields: [...rebased.conflictingFields],
      overwriteConfirmationRequired: rebased.overwriteConfirmationRequired,
    })
    setMessage("같은 항목이 함께 변경되었습니다. 덮어쓸 항목을 확인해 주세요.")
  }, [baseDraft, conflict, draft])

  const confirmOverwrite = React.useCallback(() => {
    if (!conflict?.overwriteConfirmationRequired) return
    setConflictOverride({
      requestId: crypto.randomUUID(),
      conflictingFields: [...conflict.conflictingFields],
    })
    saveRequestRef.current = null
    setConflict(null)
    setMessage("같은 항목을 덮어쓰기로 확인했습니다. 변경사항 저장을 눌러 주세요.")
  }, [conflict])

  const mutateConnection = React.useCallback(async (
    connection: NotificationConnectionDto,
    action: "replace" | "verify" | "disconnect",
    webhookUrl?: string,
  ) => {
    const token = await getAccessToken()
    if (!token) {
      setConnectionError("로그인 정보를 다시 확인해 주세요.")
      return false
    }
    setConnectionBusyKey(connection.connectionKey)
    setConnectionError(null)
    const body: Record<string, unknown> = {
      action,
      connection_key: connection.connectionKey,
      expected_revision: connection.revision,
      request_id: crypto.randomUUID(),
    }
    if (action === "replace") body.webhook_url = webhookUrl
    if (action === "verify") body.confirmed = true
    try {
      const response = await fetch("/api/notifications/connections", {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRecord(payload)) throw new Error("connection_mutation_failed")
      const updated = connectionFromWire(payload.connection)
      if (!updated) throw new Error("connection_unsafe_response")
      setSnapshot((current) => current ? {
        ...current,
        connections: current.connections.map((item) => (
          item.connectionKey === updated.connectionKey ? updated : item
        )),
      } : current)
      return true
    } catch {
      setConnectionError("연결 작업을 완료하지 못했습니다. 저장된 주소나 연결 상태를 확인해 주세요.")
      return false
    } finally {
      setConnectionBusyKey(null)
    }
  }, [])

  const editingRule = snapshot?.rules.find(({ id }) => id === editingRuleId) ?? null
  const statusText = saveStatusLabel(savePhase, savedAt)
  const connectionsEditable = snapshot
    ? snapshot.connections.some((connection) => connection.editable)
    : false

  const panelBody = loading ? (
    <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="animate-spin" /> 알림 설정을 불러오는 중입니다.
    </div>
  ) : !snapshot || !draft ? (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
      <AlertTriangle className="text-amber-600" />
      <p className="text-sm">{message ?? "알림 설정을 불러오지 못했습니다."}</p>
      <Button type="button" variant="outline" onClick={() => setLoadAttempt((value) => value + 1)}>
        다시 불러오기
      </Button>
    </div>
  ) : (
    <div className="space-y-4">
      {presentation === "page" ? (
        <nav aria-label="알림 업무 선택" className="flex gap-2 overflow-x-auto pb-1">
          {NOTIFICATION_WORKFLOW_OPTIONS.map((option) => (
            <Button
              key={option.key}
              type="button"
              size="sm"
              variant={activeWorkflow === option.key ? "default" : "outline"}
              aria-pressed={activeWorkflow === option.key}
              onClick={() => {
                if (activeWorkflow === option.key) return
                navigationGuard.requestNavigation(() => setPageWorkflow(option.key))
              }}
            >
              {option.label}
            </Button>
          ))}
        </nav>
      ) : null}

      {message ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      {conflict ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold">저장 충돌을 확인해 주세요.</p>
              <p className="text-sm text-amber-900">최신 설정을 적용하거나 내 변경만 최신 설정 위에 다시 올릴 수 있습니다.</p>
            </div>
          </div>
          {conflict.conflictingFields.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">
              {conflict.conflictingFields.map((field) => <li key={field}>{field}</li>)}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setLatestSnapshotConfirmationOpen(true)}
            >
              최신 설정 불러오기
            </Button>
            {!conflict.overwriteConfirmationRequired ? (
              <Button type="button" size="sm" onClick={keepLocalChanges}>내 변경 유지</Button>
            ) : (
              <Button type="button" size="sm" onClick={confirmOverwrite}>
                같은 항목을 덮어쓰기
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <Tabs
        value={activeSection}
        onValueChange={(value) => setActiveSection(value as NotificationControlPanelSection)}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="rules">규칙 및 템플릿</TabsTrigger>
          <TabsTrigger value="deliveries">최근 전달</TabsTrigger>
          {presentation === "page" ? (
            <TabsTrigger value="connections">연결 (Connections)</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="rules" className="mt-3">
          <RulesView
            rules={snapshot.rules}
            draft={draft}
            connections={snapshot.connections}
            saving={saving}
            onChange={updateRule}
            onEditTemplate={setEditingRuleId}
          />
        </TabsContent>
        <TabsContent value="deliveries" className="mt-3">
          <DeliverySummary snapshot={snapshot} />
        </TabsContent>
        {presentation === "page" ? (
          <TabsContent value="connections" className="mt-3">
            <ConnectionsView
              connections={snapshot.connections}
              busyKey={connectionBusyKey}
              error={connectionError}
              onMutate={mutateConnection}
              onRequestConfirmation={(connection, action) => {
                setPendingConnectionAction({ connection, action })
              }}
            />
          </TabsContent>
        ) : null}
      </Tabs>

      {presentation === "dialog" && snapshot.connections.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex min-w-0 items-start gap-2">
            <MessageSquareText className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              {snapshot.connections.map((connection) => (
                <p key={connection.connectionKey} className="text-xs sm:text-sm">
                  <span className="font-medium">
                    {CONNECTION_LABELS[connection.connectionKey]} {connectionStatusLabel(connection)}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    마지막 검증 {formatTimestamp(connection.lastVerifiedAt)}
                  </span>
                </p>
              ))}
            </div>
          </div>
          <a className="font-medium text-primary underline-offset-4 hover:underline" href="/admin/settings/notifications?section=connections">
            {connectionsEditable ? "연결 관리" : "연결 상태 보기"}
          </a>
        </div>
      ) : null}

      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <div className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {statusText ? (
            <span className="inline-flex items-center gap-1.5">
              {savePhase === "saving" || savePhase === "reconciling"
                ? <Loader2 className="size-4 animate-spin" />
                : <Check className="size-4 text-emerald-600" />}
              {statusText}
            </span>
          ) : dirty ? "저장하지 않은 변경사항이 있습니다." : "변경사항이 없습니다."}
          {savePhase === "reconciliation_failed" && reconciliationJob ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-2"
              aria-label="저장됨 · 알림 재계산 실패 · 다시 시도"
              disabled={reconciliationRetrying}
              onClick={() => void handleRetryReconciliation()}
            >
              {reconciliationRetrying ? <Loader2 className="animate-spin" /> : null}
              다시 시도
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          disabled={!dirty || saving || conflict !== null}
          onClick={() => void handleSave()}
        >
          {saving ? "저장 중" : "변경사항 저장"}
        </Button>
      </div>
    </div>
  )

  const auxiliaryDialogs = (
    <>
      <TemplateEditor
        rule={editingRule}
        draft={draft}
        saving={saving}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditingRuleId(null)
        }}
        onChange={updateRule}
      />
      <Dialog
        open={navigationGuard.confirmationOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !saving) navigationGuard.continueEditing()
        }}
      >
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>저장하지 않은 변경사항이 있습니다</DialogTitle>
            <DialogDescription>
              이동하기 전에 저장하거나 변경을 버릴지 선택해 주세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={navigationGuard.continueEditing}
            >
              계속 편집
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={navigationGuard.discardAndContinue}
            >
              저장하지 않고 이동
            </Button>
            <Button type="button" disabled={saving} onClick={() => void navigationGuard.saveAndContinue()}>
              저장하고 이동
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={latestSnapshotConfirmationOpen}
        onOpenChange={(nextOpen) => {
          if (!saving) setLatestSnapshotConfirmationOpen(nextOpen)
        }}
      >
        <DialogContent
          showCloseButton={!saving}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (saving) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>최신 설정으로 바꿀까요?</DialogTitle>
            <DialogDescription>
              현재 편집 중인 변경사항은 사라집니다. 서버에 저장된 최신 설정으로 다시 시작합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setLatestSnapshotConfirmationOpen(false)}
            >
              계속 편집
            </Button>
            <Button type="button" disabled={saving} onClick={acceptLatestSnapshot}>
              최신 설정 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingConnectionAction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && connectionBusyKey === null) setPendingConnectionAction(null)
        }}
      >
        <DialogContent
          showCloseButton={connectionBusyKey === null}
          onEscapeKeyDown={(event) => {
            if (connectionBusyKey !== null) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (connectionBusyKey !== null) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pendingConnectionAction?.action === "verify"
                ? "테스트 메시지 한 건을 보낼까요?"
                : "Google Chat 연결을 해제할까요?"}
            </DialogTitle>
            <DialogDescription>
              {pendingConnectionAction?.action === "verify"
                ? "사용자가 확인한 이 동작에서만 현재 연결로 테스트 메시지를 보냅니다."
                : "알림 규칙과 전달 이력은 유지되며, 새 Google Chat 전달만 연결 복구 전까지 중단됩니다."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={connectionBusyKey !== null}
              onClick={() => setPendingConnectionAction(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant={pendingConnectionAction?.action === "disconnect" ? "destructive" : "default"}
              disabled={!pendingConnectionAction || connectionBusyKey !== null}
              onClick={async () => {
                if (!pendingConnectionAction) return
                const { connection, action } = pendingConnectionAction
                const succeeded = await mutateConnection(connection, action)
                if (succeeded) setPendingConnectionAction(null)
              }}
            >
              {connectionBusyKey !== null ? <Loader2 className="animate-spin" /> : null}
              {pendingConnectionAction?.action === "verify" ? "테스트 메시지 보내기" : "연결 해제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  if (presentation === "dialog") {
    return (
      <>
        <Dialog
          open={open ?? false}
          onOpenChange={(nextOpen) => {
            if (nextOpen) onOpenChange?.(true)
            else requestClose()
          }}
        >
          <DialogContent
            className="max-h-[92vh] overflow-y-auto sm:max-w-5xl"
            closeButtonLabel="알림 설정 닫기"
            onCloseButtonClick={requestClose}
            onEscapeKeyDown={(event) => {
              if (dirty) {
                event.preventDefault()
                requestClose()
              }
            }}
            onPointerDownOutside={(event) => {
              if (dirty) {
                event.preventDefault()
                requestClose()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{getWorkflowLabel(activeWorkflow)} 알림 설정</DialogTitle>
              <DialogDescription>
                이 업무에서 사용하는 알림 규칙과 문구를 저장합니다.
              </DialogDescription>
            </DialogHeader>
            {panelBody}
          </DialogContent>
        </Dialog>
        {auxiliaryDialogs}
      </>
    )
  }

  return (
    <section data-notification-workflow={activeWorkflow} className="space-y-4">
      {panelBody}
      {auxiliaryDialogs}
    </section>
  )
}
