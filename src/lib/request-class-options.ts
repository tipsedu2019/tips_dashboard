import { ENDED_CLASS_STATUS, computeClassStatus } from "./class-status.js"

// Keep full catalogs for history and scheduling. Only new request choices omit
// ended classes; an already selected class remains available without data loss.
export function requestClassOptions<T extends { id: string; status?: string; startDate?: string; endDate?: string }>(classes: T[], selectedClassId = ""): T[] {
  return classes.filter(item => item.id === selectedClassId || computeClassStatus(item) !== ENDED_CLASS_STATUS)
}
