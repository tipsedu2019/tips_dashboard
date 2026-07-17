import { NotificationSettingsWorkspace } from "@/features/notifications/notification-settings-workspace"

type NotificationSettingsPageProps = {
  searchParams: Promise<{ section?: string | string[] }>
}

export default async function NotificationSettingsPage({
  searchParams,
}: NotificationSettingsPageProps) {
  const section = (await searchParams).section
  const initialSection = section === "connections" ? "connections" : "rules"
  return <NotificationSettingsWorkspace initialSection={initialSection} />
}
