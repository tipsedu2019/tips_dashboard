import {
  handleLegacyRegistrationGet,
  handleLegacyRegistrationPost,
} from "./legacy.ts"

export function createRegistrationAdmissionRouteHandlers(dependencies) {
  if (typeof dependencies?.listAdmissionMessages !== "function") {
    throw new TypeError("listAdmissionMessages is required")
  }
  return Object.freeze({
    get(request) {
      return handleLegacyRegistrationGet(request, dependencies.listAdmissionMessages)
    },
    post() {
      return handleLegacyRegistrationPost()
    },
  })
}
