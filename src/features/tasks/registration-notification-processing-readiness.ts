export function createRegistrationNotificationProcessingReadinessLoader<Result>(
  load: (accessToken: string) => Promise<Result>,
) {
  let inFlight: Readonly<{
    accessToken: string
    promise: Promise<Result>
  }> | null = null

  return function loadSharedRegistrationNotificationProcessingReadiness(
    accessToken: string,
  ) {
    const token = String(accessToken || "").trim()
    if (!token) {
      return Promise.reject(new Error("registration_notification_processing_auth_required"))
    }
    if (inFlight?.accessToken === token) return inFlight.promise

    const promise = Promise.resolve().then(() => load(token))
    const request = { accessToken: token, promise }
    inFlight = request
    const clear = () => {
      if (inFlight === request) inFlight = null
    }
    void promise.then(clear, clear)
    return promise
  }
}
