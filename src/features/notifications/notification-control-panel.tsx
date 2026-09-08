"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { AlertTriangle, Check, Loader2, LockKeyhole, MessageSquareText, PlugZap } from "lucide-react"

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
  evaluateNotificationDraft,
  isNotificationDraftDirty,
  rebaseNotificationDraft,
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
  createNotificationMentionSettingsService,
  NotificationMentionSettingsHttpError,
} from "./notification-mention-settings-service"
import { NotificationMentionToggle } from "./notification-mention-settings"
import type { NotificationMentionSettingDto } from "./notification-mention-settings-types"
import {
  NOTIFICATION_CONNECTION_KEYS,
  NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS,
  NOTIFICATION_WORKFLOW_OPTIONS,
  type NotificationConnectionDto,
  type NotificationConnectionKey,
  type NotificationControlPlaneSnapshot,
  type NotificationRevisionMap,
  type NotificationRuleDto,
  type NotificationWorkflowKey,
} from "./notification-control-plane-types"
import { GOOGLE_CHAT_CONNECTION_LABELS } from "./notification-google-chat-catalog"
import { selectEditableGoogleChatRules } from "./notification-google-chat-settings"
import { buildNotificationTemplatePreview } from "./notification-template-preview"
import { useNotificationNavigationGuard } from "./use-notification-navigation-guard"
import {
  buildMentionDraftPatch,
  createMentionDraft,
  createTemplateEditorDraft,
  notificationSettingsLocationUrl,
  registrationNotificationDisplayRule,
  readNotificationSettingsLocation,
  rebaseMentionDraft,
  type NotificationSettingsSection,
  type RegistrationSettingsGroup,
} from "./notification-settings-editor-state"
import { RegistrationNotificationSettingsGroups } from "./registration-notification-settings-groups"
import { getRegistrationNotificationRulePolicy } from "./notification-registration-settings-policy"

export type NotificationControlPlaneAvailability = {
  status: "loading" | "enabled" | "disabled" | "unavailable"
}

type NotificationControlPanelSection = NotificationSettingsSection

export type NotificationControlPanelProps = {
  workflowKey: NotificationWorkflowKey
  presentation: "page" | "dialog"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialSection?: NotificationControlPanelSection
  initialGroup?: RegistrationSettingsGroup | null
  customerGuidance?: React.ReactNode
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

function createBrowserMentionSettingsService() {
  return createNotificationMentionSettingsService({
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

function contractVersionsForPatch(
  snapshot: NotificationControlPlaneSnapshot,
  patch: { rules: Record<string, NotificationRulePatch> },
): NotificationRevisionMap {
  const changedRuleIds = new Set(Object.keys(patch.rules))
  const versions: Record<string, string> = {}
  for (const rule of snapshot.rules) {
    if (changedRuleIds.has(rule.id)) {
      versions[rule.id] = rule.contentContract.contractVersion
    }
  }
  return versions
}

function connectionFromWire(input: unknown): NotificationConnectionDto | null {
  if (!isRecord(input)) return null
  if ("webhook_url" in input || "webhook_url_ciphertext" in input) return null
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
  mentionSetting: NotificationMentionSettingDto | undefined
  mentionSaving: boolean
  mentionError: string | null
  saving: boolean
  surfaceKey: "desktop" | "mobile"
  compact?: boolean
  showRecipient?: boolean
  onChange: (ruleId: string, patch: NotificationRulePatch) => void
  onMentionChange: (setting: NotificationMentionSettingDto, mentionEnabled: boolean) => void
  onEditTemplate: (ruleId: string) => void
}

function RuleToggle({
  rule,
  draft,
  connections,
  mentionSetting,
  mentionSaving,
  mentionError,
  saving,
  surfaceKey,
  compact = false,
  showRecipient = true,
  onChange,
  onMentionChange,
  onEditTemplate,
}: RuleToggleProps) {
  const value = draft.rules[rule.id]
  if (!value) return null
  const fixedPolicy = rule.configurationKind === "fixed_policy_editable_template"
  const requiredConnectionKeys: NotificationConnectionKey[] = rule.connectionKey
    ? [rule.connectionKey]
    : rule.audienceKey === "management_team"
      ? ["google_chat.management"]
      : rule.audienceKey === "executive_team"
        ? ["google_chat.executive"]
        : rule.audienceKey === "subject_team"
          ? ["google_chat.english", "google_chat.math", "google_chat.science"]
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
  const connectionMessage = connectionMissing
    ? preservesExistingRule
      ? "연결 필요 · 기존 설정과 이력은 유지됩니다."
      : "연결 필요 · 저장 전에 연결해 주세요."
    : null

  return (
    <div className={cn(
      compact ? "space-y-2 rounded-lg border bg-background p-3" :
        "flex min-w-[11rem] items-center justify-end gap-2",
    )}>
      {compact && showRecipient ? (
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium">
            {rule.audienceLabel ?? rule.audienceKey}
          </p>
          {connectionMessage ? (
            <p className="text-xs font-medium text-amber-700">{connectionMessage}</p>
          ) : null}
        </div>
      ) : connectionMessage ? (
        <p className="mr-auto text-xs font-medium text-amber-700">{connectionMessage}</p>
      ) : null}
      <div className={cn("flex items-center gap-2", compact && "justify-between")}>
        {fixedPolicy ? (
          <div
            data-notification-rule-lock={rule.id}
            className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground"
          >
            <Badge variant="outline" className="gap-1">
              <LockKeyhole aria-hidden="true" className="size-3" />
              고정
            </Badge>
            <span>전달 정책 고정</span>
          </div>
        ) : (
          <SwitchPrimitive.Root
            id={`notification-rule-switch-${surfaceKey}-${rule.id}`}
            data-notification-rule-switch={rule.id}
            aria-label={`${rule.eventLabel ?? rule.eventKey} · ${rule.audienceLabel ?? rule.audienceKey} ${rule.channelLabel ?? rule.channelKey}`}
            checked={value.enabled}
            disabled={saving}
            onCheckedChange={(enabled) => onChange(rule.id, { enabled })}
            className="data-[state=checked]:bg-primary relative h-6 w-11 shrink-0 rounded-full bg-input transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50"
          >
            <SwitchPrimitive.Thumb className="data-[state=checked]:translate-x-5 block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform" />
          </SwitchPrimitive.Root>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={saving}
          aria-label={`${rule.eventLabel ?? rule.eventKey} · 내용 수정`}
          onClick={() => onEditTemplate(rule.id)}
        >
          내용 수정
        </Button>
      </div>
      <NotificationMentionToggle
        setting={mentionSetting}
        contextLabel={rule.eventLabel ?? rule.eventKey}
        saving={mentionSaving}
        surfaceKey={surfaceKey}
        error={mentionError}
        onChange={onMentionChange}
      />
    </div>
  )
}

type RulesViewProps = {
  rules: ReadonlyArray<NotificationRuleDto>
  draft: NotificationDraft
  connections: ReadonlyArray<NotificationConnectionDto>
  mentionSettings: ReadonlyMap<string, NotificationMentionSettingDto>
  mentionSavingRuleIds: ReadonlySet<string>
  mentionErrors: Readonly<Record<string, string>>
  saving: boolean
  onChange: RuleToggleProps["onChange"]
  onMentionChange: RuleToggleProps["onMentionChange"]
  onEditTemplate: RuleToggleProps["onEditTemplate"]
}

function RulesView({
  rules,
  draft,
  connections,
  mentionSettings,
  mentionSavingRuleIds,
  mentionErrors,
  saving,
  onChange,
  onMentionChange,
  onEditTemplate,
}: RulesViewProps) {
  const visibleRules = React.useMemo(
    () => rules.filter((rule) => rule.eventKey !== "registration.appointment_reminder_due"),
    [rules],
  )
  const groups = React.useMemo(() => groupServerRules(visibleRules), [visibleRules])
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        이 업무에 설정할 수 있는 알림 규칙이 없습니다.
      </div>
    )
  }

  return (
    <div data-notification-draft-source="shared">
      <div className="hidden overflow-x-auto rounded-lg border border-border/70 bg-background md:block">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="h-9 border-b bg-muted/40 text-xs text-muted-foreground">
              <th scope="col" className="w-[32%] px-4 py-2 font-medium">상황</th>
              <th scope="col" className="w-[20%] px-3 py-2 font-medium">받는 곳</th>
              <th scope="col" className="px-3 py-2 font-medium">설정</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => group.rules.map((rule, ruleIndex) => (
              <tr key={rule.id} className="border-b last:border-b-0 align-top">
                {ruleIndex === 0 ? (
                  <th
                    scope="rowgroup"
                    rowSpan={group.rules.length}
                    className="border-r bg-muted/15 px-4 py-3 font-normal"
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
                <td className="px-3 py-3 font-medium">
                  {rule.audienceLabel ?? rule.audienceKey}
                </td>
                <td className="px-3 py-2">
                  <RuleToggle
                    rule={rule}
                    draft={draft}
                    connections={connections}
                    mentionSetting={mentionSettings.get(rule.id)}
                    mentionSaving={mentionSavingRuleIds.has(rule.id)}
                    mentionError={mentionErrors[rule.id] ?? null}
                    saving={saving}
                    surfaceKey="desktop"
                    onChange={onChange}
                    onMentionChange={onMentionChange}
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
                  mentionSetting={mentionSettings.get(rule.id)}
                  mentionSaving={mentionSavingRuleIds.has(rule.id)}
                  mentionError={mentionErrors[rule.id] ?? null}
                  saving={saving}
                  surfaceKey="mobile"
                  compact
                  onChange={onChange}
                  onMentionChange={onMentionChange}
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
  snapshot: NotificationControlPlaneSnapshot | null
  rule: NotificationRuleDto | null
  draft: NotificationDraft | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onChange: (ruleId: string, patch: NotificationRulePatch) => void
}

function TemplateEditor({ snapshot, rule, draft, ...props }: TemplateEditorProps) {
  if (!snapshot || !rule || !draft || !draft.rules[rule.id]) return null
  return <TemplateEditorFields key={rule.id} snapshot={snapshot} rule={rule} draft={draft} {...props} />
}

function TemplateEditorFields({ snapshot, rule, draft, saving, onOpenChange, onChange }: Omit<TemplateEditorProps, "snapshot" | "rule" | "draft"> & {
  snapshot: NotificationControlPlaneSnapshot
  rule: NotificationRuleDto
  draft: NotificationDraft
}) {
  const [value, setValue] = React.useState(() => createTemplateEditorDraft(draft.rules[rule.id]))
  const updateEditor = (patch: NotificationRulePatch) => setValue((current) => ({ ...current, ...patch }))
  const schedule = value.scheduleConfig
  const evaluation = evaluateNotificationDraft(snapshot, { ...draft, rules: { ...draft.rules, [rule.id]: value } })
  const blockingIssues = evaluation.validation.ok
    ? []
    : evaluation.validation.issues.filter(({ path }) => path.startsWith(`rules.${rule.id}.`))
  const templateWarnings = evaluation.warnings.filter(
    ({ path }) => path.startsWith(`rules.${rule.id}.`),
  )
  const requiredTokens = new Set(rule.contentContract.requiredTokens)
  const optionalLineTokens = new Set(rule.contentContract.optionalLineTokens)
  const preview = buildNotificationTemplatePreview({
    titleTemplate: value.titleTemplate,
    bodyTemplate: value.bodyTemplate,
    availableVariables: rule.contentContract.availableVariables,
  })

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
              onChange={(event) => updateEditor({ titleTemplate: event.target.value })}
            />
          </div>
          {blockingIssues.length > 0 ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">저장 전에 확인해 주세요</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-destructive">
                {blockingIssues.map((issue) => (
                  <li key={`${issue.code}-${issue.path}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {templateWarnings.length > 0 ? (
            <div aria-live="polite" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="text-sm font-medium">더 읽기 편하게 다듬을 수 있어요</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                {templateWarnings.map((warning) => (
                  <li key={`${warning.code}-${warning.path}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor={`notification-body-${rule.id}`}>본문</Label>
            <Textarea
              id={`notification-body-${rule.id}`}
              value={value.bodyTemplate}
              disabled={saving}
              rows={7}
              onChange={(event) => updateEditor({ bodyTemplate: event.target.value })}
            />
          </div>
          <div aria-label="알림 내용 미리보기" className="space-y-2">
            <p className="text-sm font-medium">미리보기</p>
            <div className="rounded-lg border bg-background p-4 shadow-sm">
              <p className="font-semibold leading-6">
                {preview.title || "제목을 입력해 주세요."}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {preview.body || "본문을 입력해 주세요."}
              </p>
            </div>
          </div>
          {schedule && "leadMinutes" in schedule ? (
            <div className="space-y-2">
              <Label htmlFor={`notification-lead-${rule.id}`}>기준 시각 전 알림(분)</Label>
              <Input
                id={`notification-lead-${rule.id}`}
                type="number"
                min={1}
                max={10080}
                value={schedule.leadMinutes}
                disabled={saving}
                onChange={(event) => updateEditor({
                  scheduleConfig: {
                    ...schedule,
                    leadMinutes: Number.parseInt(event.target.value || "0", 10),
                  },
                })}
              />
              <p className="text-xs text-muted-foreground">
                1분부터 7일 전까지 설정할 수 있습니다.
              </p>
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
                onChange={(event) => updateEditor({
                  scheduleConfig: { ...schedule, localTime: event.target.value },
                })}
              />
              <p className="text-xs text-muted-foreground">
                한국 시간(KST) 기준이며, 계산 시각이 예약 시각보다 늦으면 발송하지 않습니다.
              </p>
            </div>
          ) : null}
          {rule.contentContract.availableVariables.length > 0 ? (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium">사용 가능한 변수</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {rule.contentContract.availableVariables.map((variable) => {
                  const required = requiredTokens.has(variable.token)
                  const optionalLine = optionalLineTokens.has(variable.token)
                  return (
                    <Badge
                      key={variable.key}
                      variant={required ? "default" : "secondary"}
                      className="gap-1.5"
                    >
                      <code>{`{${variable.token}}`}</code>
                      <span className="opacity-70">
                        {required ? "필수" : optionalLine ? "선택 행" : "선택"}
                      </span>
                    </Badge>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="button" disabled={saving || blockingIssues.length > 0} onClick={() => {
            onChange(rule.id, { titleTemplate: value.titleTemplate, bodyTemplate: value.bodyTemplate, scheduleConfig: value.scheduleConfig })
            onOpenChange(false)
          }}>변경사항에 반영</Button>
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
        <p className="text-sm text-muted-foreground">
          주소 변경은 모든 관련 업무에 즉시 적용됩니다. 저장된 주소는 마스킹해서 표시합니다.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {connections.map((connection) => {
        const busy = busyKey === connection.connectionKey
        return (
          <Card key={connection.connectionKey}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{GOOGLE_CHAT_CONNECTION_LABELS[connection.connectionKey]}</CardTitle>
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
  initialGroup = null,
  customerGuidance,
}: NotificationControlPanelProps) {
  const service = React.useMemo(createBrowserControlPlaneService, [])
  const mentionService = React.useMemo(createBrowserMentionSettingsService, [])
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
  const [activeGroup, setActiveGroup] = React.useState<RegistrationSettingsGroup | null>(initialGroup)
  const [conflict, setConflict] = React.useState<ConflictState | null>(null)
  const [conflictOverride, setConflictOverride] = React.useState<ConflictOverrideState | null>(null)
  const [latestSnapshotConfirmationOpen, setLatestSnapshotConfirmationOpen] = React.useState(false)
  const [connectionBusyKey, setConnectionBusyKey] = React.useState<NotificationConnectionKey | null>(null)
  const [connectionError, setConnectionError] = React.useState<string | null>(null)
  const [mentionSettings, setMentionSettings] = React.useState<ReadonlyMap<string, NotificationMentionSettingDto>>(
    () => new Map(),
  )
  const [mentionDraft, setMentionDraft] = React.useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [mentionConflict, setMentionConflict] = React.useState<ReadonlyMap<string, NotificationMentionSettingDto> | null>(null)
  const [mentionLoading, setMentionLoading] = React.useState(true)
  const [mentionErrors, setMentionErrors] = React.useState<Readonly<Record<string, string>>>({})
  const [pendingConnectionAction, setPendingConnectionAction] = React.useState<{
    connection: NotificationConnectionDto
    action: "verify" | "disconnect"
  } | null>(null)
  const [reconciliationJob, setReconciliationJob] = React.useState<ReconciliationJobState | null>(null)
  const [reconciliationRetrying, setReconciliationRetrying] = React.useState(false)
  const reconciliationPollGenerationRef = React.useRef(0)
  const saveRequestRef = React.useRef<{ signature: string; requestId: string } | null>(null)
  const mentionLoadGenerationRef = React.useRef(0)

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
    const mentionController = new AbortController()
    const mentionLoadGeneration = mentionLoadGenerationRef.current + 1
    mentionLoadGenerationRef.current = mentionLoadGeneration
    setMentionSettings(new Map())
    setMentionDraft(new Map())
    setMentionConflict(null)
    setMentionLoading(true)
    setMentionErrors({})
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
    void mentionService.getMentionSettings({
      workflowKey: activeWorkflow,
      signal: mentionController.signal,
    }).then((settings) => {
      if (!active || mentionLoadGenerationRef.current !== mentionLoadGeneration) return
      const nextSettings = new Map(settings.map((setting) => [setting.ruleId, setting]))
      setMentionSettings(nextSettings)
      setMentionDraft(createMentionDraft(nextSettings))
    }).catch((error: unknown) => {
      if (!active || mentionController.signal.aborted || mentionLoadGenerationRef.current !== mentionLoadGeneration) return
      setMentionErrors({
        _load: error instanceof NotificationMentionSettingsHttpError && error.code === "notification_forbidden"
          ? "담당자 멘션 설정 권한이 없습니다."
          : "담당자 멘션 설정을 불러오지 못했습니다.",
      })
    }).finally(() => {
      if (active && mentionLoadGenerationRef.current === mentionLoadGeneration) setMentionLoading(false)
    })
    return () => {
      active = false
      mentionController.abort()
    }
  }, [activeWorkflow, loadAttempt, mentionService, service, visible])

  const mentionChanges = React.useMemo(() => buildMentionDraftPatch(mentionSettings, mentionDraft), [mentionSettings, mentionDraft])
  const dirty = React.useMemo(() => (
    (baseDraft !== null && draft !== null && isNotificationDraftDirty(baseDraft, draft)) || Object.keys(mentionChanges.mentionPatch).length > 0
  ), [baseDraft, draft, mentionChanges])
  const saving = savePhase === "saving"
  const displayedMentionSettings = React.useMemo(() => new Map(Array.from(mentionSettings, ([ruleId, setting]) => [ruleId, { ...setting, mentionEnabled: mentionDraft.get(ruleId) ?? setting.mentionEnabled }])), [mentionSettings, mentionDraft])
  const mentionSavingRuleIds = React.useMemo(() => saving ? new Set(mentionSettings.keys()) : new Set<string>(), [saving, mentionSettings])

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

  const updateMentionSetting = React.useCallback((setting: NotificationMentionSettingDto, mentionEnabled: boolean) => {
    if (!setting.editable || saving) return
    saveRequestRef.current = null
    setMentionDraft((current) => new Map(current).set(setting.ruleId, mentionEnabled))
    setMessage(null)
    setSavePhase("idle")
  }, [saving])

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
    if (saving || mentionLoading) return false
    if (!dirty) return true
    if (conflict || mentionConflict) {
      setMessage("먼저 설정 충돌을 해결해 주세요.")
      return false
    }
    const { validation } = evaluateNotificationDraft(snapshot, draft)
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
    if (Object.keys(patch.rules).length === 0 && Object.keys(mentionChanges.mentionPatch).length === 0) return true
    const expectedRuleRevisions = revisionsForPatch(snapshot, patch)
    const expectedContractVersions = contractVersionsForPatch(snapshot, patch)
    const saveSignature = JSON.stringify({
      workflowKey: activeWorkflow,
      expectedRuleRevisions,
      expectedContractVersions,
      patch,
      ...mentionChanges,
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
        expectedRuleRevisions,
        expectedContractVersions,
        patch,
        ...mentionChanges,
        requestId,
        ...(conflictOverride ? { conflictOverride } : {}),
      })
      const nextDraft = createNotificationDraft(result)
      setSnapshot(result)
      setBaseDraft(nextDraft)
      setDraft(nextDraft)
      if (result.mentionSettings) {
        const nextMentions = new Map(result.mentionSettings.map((setting) => [setting.ruleId, setting]))
        setMentionSettings(nextMentions)
        setMentionDraft(createMentionDraft(nextMentions))
      }
      setMentionConflict(null)
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
      if (error instanceof NotificationControlPlaneHttpError && error.currentMentionSettings) {
        const remoteMentions = new Map(error.currentMentionSettings.map((setting) => [setting.ruleId, setting]))
        const hasMentionConflict = Object.keys(mentionChanges.mentionPatch).some((ruleId) => mentionSettings.get(ruleId)?.revision !== remoteMentions.get(ruleId)?.revision)
        if (hasMentionConflict) setMentionConflict(remoteMentions)
        else {
          setMentionDraft(rebaseMentionDraft(mentionSettings, mentionDraft, remoteMentions))
          setMentionSettings(remoteMentions)
        }
      }
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
      } else if (error instanceof NotificationControlPlaneHttpError && error.code === "notification_mention_setting_revision_conflict") {
        saveRequestRef.current = null
        setMessage("다른 사용자가 담당자 멘션을 먼저 변경했습니다. 내 초안은 그대로 유지했습니다.")
      } else {
        setMessage("설정을 저장하지 못했습니다. 입력한 내용은 유지했습니다. 다시 시도해 주세요.")
      }
      setSavePhase("idle")
      return false
    }
  }, [activeWorkflow, baseDraft, conflict, conflictOverride, dirty, draft, mentionChanges, mentionConflict, mentionDraft, mentionLoading, mentionSettings, pollReconciliation, saving, service, snapshot])

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

  const changeSection = (section: NotificationSettingsSection) => {
    if (section === activeSection) return
    navigationGuard.requestNavigation(() => {
      setActiveSection(section)
      setActiveGroup(null)
    })
  }

  const discardDraftAndContinue = () => {
    if (saving) return
    setDraft(baseDraft)
    setMentionDraft(createMentionDraft(mentionSettings))
    setMentionConflict(null)
    setConflict(null)
    setConflictOverride(null)
    navigationGuard.discardAndContinue()
  }

  React.useEffect(() => {
    if (presentation !== "page") return
    const nextUrl = notificationSettingsLocationUrl(window.location.href, { workflow: activeWorkflow, section: activeSection, group: activeGroup })
    window.history.replaceState(window.history.state, "", nextUrl)
  }, [activeGroup, activeSection, activeWorkflow, presentation])

  React.useEffect(() => {
    if (presentation !== "page") return
    const onPopState = () => {
      if (dirty) return
      queueMicrotask(() => {
        const location = readNotificationSettingsLocation(new URLSearchParams(window.location.search))
        setPageWorkflow(location.workflow)
        setActiveSection(location.section)
        setActiveGroup(location.group)
      })
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [dirty, presentation])

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

  const editableRules = React.useMemo(
    () => selectEditableGoogleChatRules(snapshot?.rules ?? []).map(registrationNotificationDisplayRule),
    [snapshot?.rules],
  )
  const editingRule = editableRules.find((rule) => rule.id === editingRuleId && getRegistrationNotificationRulePolicy(rule)?.editable !== false) ?? null
  const statusText = saveStatusLabel(savePhase, savedAt)
  const connectionsEditable = snapshot
    ? snapshot.connections.some((connection) => connection.editable)
    : false

  const pageNavigation = presentation === "page" ? (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{activeSection === "customer" ? "등록 고객 안내" : `${getWorkflowLabel(activeWorkflow)} 알림`}</h1>
        {activeSection !== "customer" ? <Button type="button" variant="outline" className="min-h-10" disabled={saving} onClick={() => changeSection("connections")}><MessageSquareText aria-hidden="true" />수신 채팅방</Button> : null}
      </div>
      <TabsList className="h-auto w-full justify-start gap-2 rounded-none border-b bg-transparent p-0" aria-label="알림 채널">
        <TabsTrigger value="rules" className="min-h-11 rounded-none border-0 border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:shadow-none">직원 알림 · Google Chat</TabsTrigger>
        {customerGuidance ? <TabsTrigger value="customer" className="min-h-11 rounded-none border-0 border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:shadow-none">고객 안내 · 알림톡</TabsTrigger> : null}
      </TabsList>
      {presentation === "page" && activeSection !== "customer" ? (
        <nav
          aria-label="알림 업무 선택"
          className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/35 p-1 sm:grid-cols-3 xl:grid-cols-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS.map((option) => (
            <Button
              key={option.key}
              type="button"
              size="sm"
              variant={activeWorkflow === option.key ? "default" : "ghost"}
              className="h-10 w-full px-3"
              disabled={saving}
              aria-pressed={activeWorkflow === option.key}
              onClick={() => {
                if (activeWorkflow === option.key) return
                navigationGuard.requestNavigation(() => { setPageWorkflow(option.key); setActiveGroup(null) })
              }}
            >
              {option.label}
            </Button>
          ))}
        </nav>
      ) : null}

    </div>
  ) : null

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

      {message ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {message}
        </div>
      ) : null}
      {mentionErrors._load ? (
        <div role="alert" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          {mentionErrors._load}
        </div>
      ) : null}

      {mentionConflict ? (
        <div role="alert" className="space-y-3 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-semibold">담당자 멘션 변경을 확인해 주세요.</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {Object.keys(mentionChanges.mentionPatch).map((ruleId) => <li key={ruleId}>{editableRules.find((rule) => rule.id === ruleId)?.eventLabel ?? "알림"} · 최신 {mentionConflict.get(ruleId)?.mentionEnabled ? "켜짐" : "꺼짐"} / 내 변경 {mentionDraft.get(ruleId) ? "켜짐" : "꺼짐"}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => {
              setMentionSettings(mentionConflict)
              setMentionDraft(createMentionDraft(mentionConflict))
              setMentionConflict(null)
              saveRequestRef.current = null
            }}>최신 멘션 적용</Button>
            <Button type="button" size="sm" onClick={() => {
              setMentionDraft(rebaseMentionDraft(mentionSettings, mentionDraft, mentionConflict))
              setMentionSettings(mentionConflict)
              setMentionConflict(null)
              saveRequestRef.current = null
              setMessage("내 멘션 변경을 최신 설정에 다시 적용했습니다. 확인 후 저장해 주세요.")
            }}>내 멘션 변경 유지</Button>
          </div>
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

      {activeWorkflow === "registration" ? (
        <RegistrationNotificationSettingsGroups
          rules={editableRules}
          draft={draft}
          group={activeGroup}
          onGroupChange={setActiveGroup}
          renderControl={(rule) => <RuleToggle rule={rule} draft={draft} connections={snapshot.connections} mentionSetting={displayedMentionSettings.get(rule.id)} mentionSaving={saving || mentionLoading} mentionError={mentionErrors[rule.id] ?? null} saving={saving} surfaceKey="mobile" compact showRecipient={false} onChange={updateRule} onMentionChange={updateMentionSetting} onEditTemplate={setEditingRuleId} />}
        />
      ) : (
        <RulesView
          rules={editableRules}
          draft={draft}
          connections={snapshot.connections}
          mentionSettings={displayedMentionSettings}
          mentionSavingRuleIds={mentionSavingRuleIds}
          mentionErrors={mentionErrors}
          saving={saving}
          onChange={updateRule}
          onMentionChange={updateMentionSetting}
          onEditTemplate={setEditingRuleId}
        />
      )}

      {presentation === "dialog" && snapshot.connections.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex min-w-0 items-start gap-2">
            <MessageSquareText className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              {snapshot.connections.map((connection) => (
                <p key={connection.connectionKey} className="text-xs sm:text-sm">
                  <span className="font-medium">
                    {GOOGLE_CHAT_CONNECTION_LABELS[connection.connectionKey]} {connectionStatusLabel(connection)}
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

      <div
        className="sticky bottom-3 z-20 -mx-1 flex flex-col gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between"
        role="region"
        aria-label="알림 설정 저장"
      >
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
          className="h-9 w-full sm:w-auto"
          disabled={!dirty || saving || mentionLoading || conflict !== null || mentionConflict !== null}
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
        snapshot={snapshot}
        rule={editingRule}
        draft={draft}
        saving={saving}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditingRuleId(null)
        }}
        onChange={updateRule}
      />
      <Dialog open={presentation === "page" && activeSection === "connections"} onOpenChange={(nextOpen) => { if (!nextOpen && connectionBusyKey === null) setActiveSection("rules") }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" closeButtonLabel="수신 채팅방 닫기" showCloseButton={connectionBusyKey === null} onEscapeKeyDown={(event) => { if (connectionBusyKey !== null) event.preventDefault() }} onPointerDownOutside={(event) => { if (connectionBusyKey !== null) event.preventDefault() }}>
          <DialogHeader><DialogTitle>수신 채팅방</DialogTitle><DialogDescription>여러 업무에서 함께 사용하는 Google Chat 연결입니다.</DialogDescription></DialogHeader>
          {snapshot ? <ConnectionsView connections={snapshot.connections} busyKey={connectionBusyKey} error={connectionError} onMutate={mutateConnection} onRequestConfirmation={(connection, action) => setPendingConnectionAction({ connection, action })} /> : <p role="status" className="py-8 text-center text-sm text-muted-foreground">{loading ? "수신 채팅방을 불러오는 중입니다." : "수신 채팅방을 불러오지 못했습니다."}</p>}
        </DialogContent>
      </Dialog>
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
              onClick={discardDraftAndContinue}
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
      <Tabs value={activeSection === "customer" ? "customer" : "rules"} activationMode="manual" onValueChange={(value) => changeSection(value as NotificationSettingsSection)}>
        {pageNavigation}
        <TabsContent value="rules" className="mt-2">{panelBody}</TabsContent>
        {customerGuidance ? <TabsContent value="customer" className="mt-2">{customerGuidance}</TabsContent> : null}
      </Tabs>
      {auxiliaryDialogs}
    </section>
  )
}
