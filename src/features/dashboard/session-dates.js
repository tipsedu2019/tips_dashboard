const DAY_MS = 24 * 60 * 60 * 1000

function dateKey(value) {
  return value.toISOString().slice(0, 10)
}

function text(value) {
  return String(value || "").trim()
}

export function buildDashboardSessionDateWindow(now = new Date()) {
  const current = new Date(now)
  if (Number.isNaN(current.getTime())) {
    throw new Error("dashboard_session_date_invalid")
  }

  const currentDay = new Date(`${dateKey(current)}T00:00:00.000Z`)
  return {
    dateFrom: dateKey(new Date(currentDay.getTime() - (30 * DAY_MS))),
    dateTo: dateKey(new Date(currentDay.getTime() + (365 * DAY_MS))),
  }
}

export function attachDashboardClassSessionDates(classes = [], rows = []) {
  const sessionsByClassId = new Map()

  for (const row of rows || []) {
    const classId = text(row?.class_id || row?.classId)
    const date = text(row?.session_date || row?.sessionDate).slice(0, 10)
    const state = text(row?.schedule_state || row?.scheduleState) || "active"
    if (!classId || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || !["active", "makeup"].includes(state)) {
      continue
    }

    const key = `${date}|${state}`
    const current = sessionsByClassId.get(classId) || new Map()
    current.set(key, { date, state })
    sessionsByClassId.set(classId, current)
  }

  return (classes || []).map((classItem) => {
    if (!classItem || typeof classItem !== "object") return classItem

    const record = classItem
    const classId = text(record.id)
    const sessions = [...(sessionsByClassId.get(classId)?.values() || [])]
      .sort((left, right) => left.date.localeCompare(right.date) || left.state.localeCompare(right.state))
    const storageMode = text(record.schedule_storage_mode || record.scheduleStorageMode)

    if (storageMode === "normalized") {
      return {
        ...record,
        lessonSessions: sessions.map((session) => ({
          date: session.date,
          scheduleState: session.state,
        })),
      }
    }

    return {
      ...record,
      schedule_plan: {
        sessions: sessions.map((session) => ({
          date: session.date,
          state: session.state,
        })),
      },
    }
  })
}
