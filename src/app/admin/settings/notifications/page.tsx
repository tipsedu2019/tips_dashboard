import { NotificationSettingsWorkspace } from "@/features/notifications/notification-settings-workspace"
import { SettingsWorkspaceShell } from "@/features/management/settings-master-layout"

type NotificationSettingsPageProps = {
  searchParams: Promise<{ section?: string | string[] }>
}

export default async function NotificationSettingsPage({
  searchParams,
}: NotificationSettingsPageProps) {
  const section = (await searchParams).section
  const initialSection = section === "connections" ? "connections" : "rules"
  return (
    <SettingsWorkspaceShell>
      <NotificationSettingsWorkspace initialSection={initialSection} />
    </SettingsWorkspaceShell>
  )
}
