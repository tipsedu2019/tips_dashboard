// Exact producer pairs; an unknown P0001 may have an uncertain outcome.
const staleMessages = new Set([
  "makeup_request_stale_status", "makeup_request_source_changed",
  "makeup_schedule_plan_stale", "makeup_lesson_session_stale",
])
const collisionMessages = new Set(["makeup_room_collision", "makeup_calendar_event_conflict", "timetable_resource_conflict"])
export function isMakeupDomainConflict(error) {
  return (error?.code === "P0001" && staleMessages.has(error?.message))
    || (error?.code === "23P01" && collisionMessages.has(error?.message))
}
export function makeupApprovalErrorStatus(error) {
  return error?.code === "42501" ? 403
    : error?.code === "40001" || isMakeupDomainConflict(error) ? 409
    : error?.code === "P0002" ? 404 : 503
}
export function makeupDomainErrorMessage(error) {
  if (!isMakeupDomainConflict(error)) return null
  if (collisionMessages.has(error.message)) return "보강 일정이나 강의실이 다른 일정과 겹칩니다. 최신 일정을 확인해 주세요."
  return "신청 또는 수업 정보가 변경되었습니다. 최신 내용을 확인한 후 다시 처리해 주세요."
}
