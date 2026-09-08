import { NotificationSettingsWorkspace } from "@/features/notifications/notification-settings-workspace"
import { SettingsWorkspaceShell } from "@/features/management/settings-master-layout"
import { RegistrationCustomerMessageSettingsHub } from "@/features/tasks/registration-customer-message-settings-hub"
import { readNotificationSettingsLocation } from "@/features/notifications/notification-settings-editor-state"

type NotificationSettingsPageProps = {
  searchParams: Promise<{ section?: string | string[]; workflow?: string | string[]; group?: string | string[] }>
}

export default async function NotificationSettingsPage({
  searchParams,
}: NotificationSettingsPageProps) {
  const values = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") params.set(key, value)
  }
  const location = readNotificationSettingsLocation(params)
  return (
    <SettingsWorkspaceShell>
      <NotificationSettingsWorkspace initialSection={location.section} initialWorkflow={location.workflow} initialGroup={location.group} customerGuidance={<RegistrationCustomerMessageSettingsHub />} />
    </SettingsWorkspaceShell>
  )
}
