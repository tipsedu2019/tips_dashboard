export const REGISTRATION_LEVEL_TEST_PLACES = ["본관", "별관"] as const

export type RegistrationLevelTestPlace = typeof REGISTRATION_LEVEL_TEST_PLACES[number]

export function normalizeRegistrationLevelTestPlace(
  value: unknown,
): RegistrationLevelTestPlace | null {
  const normalized = String(value ?? "").trim()
  return REGISTRATION_LEVEL_TEST_PLACES.find((place) => place === normalized) ?? null
}
