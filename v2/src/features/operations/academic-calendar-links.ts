function text(value: unknown) {
  return String(value || "").trim()
}

function normalizeGradeForParams(value: unknown) {
  const tokens = text(value)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token !== "all")

  return tokens.length === 1 ? tokens[0] : ""
}

export function buildAcademicAnnualBoardHref({
  eventId,
  schoolName,
  schoolId,
  title,
  grade,
  category,
  date,
}: {
  eventId?: string | number | null
  schoolName?: string | null
  schoolId?: string | null
  title?: string | null
  grade?: string | null
  category?: string | null
  date?: string | null
}) {
  const params = new URLSearchParams()
  const year = text(date).slice(0, 4)

  if (year) {
    params.set("year", year)
  }

  if (eventId) {
    params.set("eventId", String(eventId))
  }

  const normalizedGrade = normalizeGradeForParams(grade)
  if (normalizedGrade) {
    params.set("grade", normalizedGrade)
  }

  const normalizedCategory = text(category)
  if (normalizedCategory && normalizedCategory !== "all") {
    params.set("category", normalizedCategory)
  }

  const normalizedSchoolId = text(schoolId)
  if (normalizedSchoolId) {
    params.set("schoolId", normalizedSchoolId)
  }

  const searchTokens = [text(schoolName), normalizedGrade, text(title)].filter(Boolean)
  const searchText = searchTokens.length > 0 ? searchTokens.join(" ") : text(schoolId)
  if (searchText) {
    params.set("q", searchText)
  }

  const query = params.toString()
  return `/admin/academic-calendar/annual-board${query ? `?${query}` : ""}`
}

export function buildAcademicCalendarHref({
  eventId,
  date,
  query,
}: {
  eventId?: string | number | null
  date?: string | null
  query?: string | null
}) {
  const params = new URLSearchParams()

  if (text(date)) {
    params.set("date", text(date))
  }

  if (eventId) {
    params.set("eventId", String(eventId))
  }

  if (text(query)) {
    params.set("q", text(query))
  }

  const queryString = params.toString()
  return `/admin/academic-calendar${queryString ? `?${queryString}` : ""}`
}
