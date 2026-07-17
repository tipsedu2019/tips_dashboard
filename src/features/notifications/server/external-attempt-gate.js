const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function registeredAttempt(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.allowed === true
    && typeof value.attempt_id === "string"
    && UUID.test(value.attempt_id.trim())
}

export async function requireRegisteredNotificationExternalAttempt({
  register,
  finalizeUnknown,
}) {
  let registration
  let reason = "external_attempt_registration_denied"
  try {
    registration = await register()
  } catch {
    reason = "external_attempt_registration_failed"
  }

  if (registeredAttempt(registration)) {
    return {
      allowed: true,
      attemptId: registration.attempt_id.trim(),
    }
  }

  const finalization = await finalizeUnknown(reason)
  return {
    allowed: false,
    reason,
    finalization,
  }
}
