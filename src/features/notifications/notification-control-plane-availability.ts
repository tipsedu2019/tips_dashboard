export type NotificationControlPlaneResolvedAvailability =
  | "enabled"
  | "disabled"
  | "unavailable"

export type NotificationControlPlaneCapabilityCheck = Readonly<{
  hasSession: boolean
  settingsFlag: boolean | null
  runtimeVersion: unknown
  capabilityError: boolean
}>

export function resolveNotificationControlPlaneAvailability({
  hasSession,
  settingsFlag,
  runtimeVersion,
  capabilityError,
}: NotificationControlPlaneCapabilityCheck): NotificationControlPlaneResolvedAvailability {
  if (
    !hasSession ||
    capabilityError ||
    runtimeVersion !== 1 ||
    (settingsFlag !== true && settingsFlag !== false)
  ) {
    return "unavailable"
  }
  return settingsFlag ? "enabled" : "disabled"
}
