function atNoon(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now())
  date.setHours(12, 0, 0, 0)
  return date
}

function startOfDay(value) {
  const date = atNoon(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function formatDateKey(value) {
  const date = startOfDay(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function endOfDay(value) {
  const date = atNoon(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function differenceInCalendarDays(left, right) {
  const milliseconds = startOfDay(left).getTime() - startOfDay(right).getTime()
  return Math.round(milliseconds / 86400000)
}

export function getEventRange(event) {
  const start = startOfDay(event?.date)
  const end = endOfDay(event?.endDate || event?.date)
  return end.getTime() < start.getTime() ? { start, end: endOfDay(start) } : { start, end }
}

export function eventSpansDay(event, day) {
  const { start, end } = getEventRange(event)
  const target = startOfDay(day)
  return target.getTime() >= start.getTime() && target.getTime() <= startOfDay(end).getTime()
}

export function isMultiDayEvent(event) {
  const { start, end } = getEventRange(event)
  return differenceInCalendarDays(end, start) > 0
}

export function getEventGradeOptions() {
  return [
    { value: "all", label: "전체" },
    { value: "초등", label: "초등" },
    { value: "중1", label: "중1" },
    { value: "중2", label: "중2" },
    { value: "중3", label: "중3" },
    { value: "고1", label: "고1" },
    { value: "고2", label: "고2" },
    { value: "고3", label: "고3" },
    { value: "N수", label: "N수" },
  ]
}

/** @param {string | string[] | null | undefined} value */
export function parseGradeSelection(value) {
  const tokens = (Array.isArray(value) ? value.join(",") : String(value || ""))
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)

  const unique = []
  tokens.forEach((token) => {
    if (token === "all") {
      return
    }
    if (!unique.includes(token)) {
      unique.push(token)
    }
  })

  return unique.length > 0 ? unique : ["all"]
}

/** @param {string | string[] | null | undefined} values */
export function serializeGradeSelection(values = []) {
  const normalized = parseGradeSelection(Array.isArray(values) ? values.join(",") : values)
  return normalized[0] === "all" ? "all" : normalized.join(", ")
}

/** @param {string | string[] | null | undefined} value */
export function getGradeBadgeLabels(value) {
  const normalized = parseGradeSelection(value)
  return normalized[0] === "all" ? ["전체"] : normalized
}

const GRADE_COMPATIBILITY = {
  elementary: ["all", "초등"],
  middle: ["all", "중1", "중2", "중3"],
  high: ["all", "고1", "고2", "고3", "N수"],
  all: ["all", "초등", "중1", "중2", "중3", "고1", "고2", "고3", "N수"],
}

export function getGradeOptionsForSchoolCategory(category) {
  const allowed = GRADE_COMPATIBILITY[String(category || "all")] || GRADE_COMPATIBILITY.all
  return getEventGradeOptions().filter((option) => allowed.includes(option.value))
}

export function getSchoolOptionsForGrade(grade, schoolOptions = []) {
  const targets = parseGradeSelection(grade)
  if (targets.includes("all")) {
    return schoolOptions
  }

  return schoolOptions.filter((school) => {
    const category = String(school?.category || "all")
    const allowed = GRADE_COMPATIBILITY[category] || GRADE_COMPATIBILITY.all
    return targets.some((target) => allowed.includes(target))
  })
}

export function createEmptyTextbookScopeItem() {
  return { name: "", publisher: "", scope: "" }
}

export function normalizeTextbookScopeItems(items = []) {
  const normalized = Array.isArray(items)
    ? items
        .map((item) => ({
          name: String(item?.name || "").trim(),
          publisher: String(item?.publisher || "").trim(),
          scope: String(item?.scope || "").trim(),
        }))
        .filter((item) => item.name || item.publisher || item.scope)
    : []

  return normalized.length > 0 ? normalized : [createEmptyTextbookScopeItem()]
}

export function buildDateSelectionRange(anchor, target) {
  const start = startOfDay(anchor)
  const end = startOfDay(target)
  return start.getTime() <= end.getTime()
    ? { start, end: endOfDay(end) }
    : { start: startOfDay(target), end: endOfDay(anchor) }
}

export function moveCalendarEventByAnchorDate(event, anchorDate, targetDate) {
  const { start, end } = getEventRange(event)
  const safeAnchor = startOfDay(anchorDate)
  const safeTarget = startOfDay(targetDate)
  const offsetDays = differenceInCalendarDays(safeTarget, safeAnchor)
  const durationDays = Math.max(0, differenceInCalendarDays(end, start))
  const nextStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offsetDays, 12)
  const nextEnd = endOfDay(new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() + durationDays, 12))

  return {
    ...event,
    date: startOfDay(nextStart),
    endDate: nextEnd,
    duration: durationDays > 0 ? `${formatDateKey(nextStart)} ~ ${formatDateKey(nextEnd)}` : "하루 일정",
  }
}

export function moveCalendarEventToDate(event, targetDate) {
  return moveCalendarEventByAnchorDate(event, event?.date || getEventRange(event).start, targetDate)
}

export function buildDragPreviewRange(event, targetDate, anchorDate) {
  return getEventRange(moveCalendarEventByAnchorDate(event, anchorDate || event?.date || getEventRange(event).start, targetDate))
}

export function sortEventsForCalendarDay(events = [], day) {
  const targetDay = startOfDay(day)

  return [...events].sort((left, right) => {
    const leftRange = getEventRange(left)
    const rightRange = getEventRange(right)
    const leftStartsToday = isSameCalendarDay(leftRange.start, targetDay)
    const rightStartsToday = isSameCalendarDay(rightRange.start, targetDay)

    if (leftStartsToday !== rightStartsToday) {
      return leftStartsToday ? -1 : 1
    }

    const leftSingleDay = differenceInCalendarDays(leftRange.end, leftRange.start) === 0
    const rightSingleDay = differenceInCalendarDays(rightRange.end, rightRange.start) === 0

    if (leftSingleDay !== rightSingleDay) {
      return leftSingleDay ? -1 : 1
    }

    const startDifference = leftRange.start.getTime() - rightRange.start.getTime()
    if (startDifference !== 0) {
      return startDifference
    }

    const endDifference = leftRange.end.getTime() - rightRange.end.getTime()
    if (endDifference !== 0) {
      return endDifference
    }

    return String(left?.title || "").localeCompare(String(right?.title || ""), "ko")
  })
}

export function buildMonthEventSegments(calendarDays, events = []) {
  const weeks = []
  for (let index = 0; index < calendarDays.length; index += 7) {
    weeks.push(calendarDays.slice(index, index + 7).map((day) => startOfDay(day)))
  }

  const segments = []

  weeks.forEach((weekDays, weekIndex) => {
    const weekStart = weekDays[0]
    const weekEnd = weekDays[weekDays.length - 1]
    const weekSegments = []
    const lanes = []

    const visibleEvents = events
      .filter((event) => {
        const { start, end } = getEventRange(event)
        return start.getTime() <= endOfDay(weekEnd).getTime() && end.getTime() >= weekStart.getTime()
      })
      .sort((left, right) => {
        const leftRange = getEventRange(left)
        const rightRange = getEventRange(right)
        const leftStart = Math.max(differenceInCalendarDays(leftRange.start, weekStart), 0)
        const rightStart = Math.max(differenceInCalendarDays(rightRange.start, weekStart), 0)
        if (leftStart !== rightStart) {
          return leftStart - rightStart
        }
        const leftSpan = Math.min(differenceInCalendarDays(leftRange.end, weekEnd), 6) - leftStart
        const rightSpan = Math.min(differenceInCalendarDays(rightRange.end, weekEnd), 6) - rightStart
        return rightSpan - leftSpan
      })

    visibleEvents.forEach((event) => {
      const { start, end } = getEventRange(event)
      const startIndex = Math.max(differenceInCalendarDays(start, weekStart), 0)
      const endIndex = Math.min(differenceInCalendarDays(end, weekStart), 6)
      if (endIndex < 0 || startIndex > 6) {
        return
      }

      let lane = 0
      while (lanes[lane]?.some((occupied) => occupied >= startIndex && occupied <= endIndex)) {
        lane += 1
      }
      lanes[lane] = lanes[lane] || []
      for (let dayIndex = startIndex; dayIndex <= endIndex; dayIndex += 1) {
        lanes[lane].push(dayIndex)
      }

      weekSegments.push({
        event,
        weekIndex,
        lane,
        startIndex,
        endIndex,
        span: endIndex - startIndex + 1,
        continuesBefore: start.getTime() < weekStart.getTime(),
        continuesAfter: end.getTime() > endOfDay(weekEnd).getTime(),
      })
    })

    segments.push(...weekSegments)
  })

  return segments
}

export function getSingleDayEventsForDay(events, day) {
  return sortEventsForCalendarDay(
    events.filter((event) => !isMultiDayEvent(event) && eventSpansDay(event, day)),
    day,
  )
}

export function getAllEventsForDay(events, day) {
  return sortEventsForCalendarDay(
    events.filter((event) => eventSpansDay(event, day)),
    day,
  )
}

function isSameCalendarDay(left, right) {
  return formatDateKey(left) === formatDateKey(right)
}
