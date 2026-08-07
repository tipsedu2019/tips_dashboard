import { SettingsWorkspaceShell } from "@/features/management/settings-master-layout"
import { RegistrationCustomerMessageRolloutPanel } from "@/features/tasks/registration-customer-message-rollout-panel"

export default function RegistrationCustomerMessageRolloutPage() {
  return (
    <SettingsWorkspaceShell>
      <RegistrationCustomerMessageRolloutPanel />
    </SettingsWorkspaceShell>
  )
}
