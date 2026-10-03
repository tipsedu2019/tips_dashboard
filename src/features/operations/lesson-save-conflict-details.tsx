import {
  TIMETABLE_MISSING_FIELD_LABELS,
  type TimetableOperationalConflictDetails,
} from "../academic/timetable-operational-conflict-details";

function time(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function dateLabel(row: { date?: string; weekday?: number }) {
  return row.date || (row.weekday === undefined ? "날짜 확인 필요" : `매주 ${["일", "월", "화", "수", "목", "금", "토"][row.weekday]}요일`);
}

export function LessonSaveConflictDetails({ details }: { details: TimetableOperationalConflictDetails }) {
  return <div className="grid w-full min-w-0 gap-3">
    {details.confirmedCount > 0 ? <section aria-label="확인된 일정 충돌" className="grid min-w-0 gap-1">
      <p className="font-medium">확인된 일정 충돌 {details.confirmedCount}건</p>
      <ul className="grid min-w-0 gap-2">
        {details.confirmed.map((row, index) => <li key={index} className="grid min-w-0 gap-0.5 break-words">
          <span className="font-medium">{row.className}</span>
          <span>{dateLabel(row)} · {time(row.startMinute)}–{time(row.endMinute)}</span>
          <span>겹친 시간 {time(row.overlapStartMinute)}–{time(row.overlapEndMinute)} · {[
            row.teacherName ? `같은 선생님 ${row.teacherName}` : "",
            row.classroomName ? `같은 강의실 ${row.classroomName}` : "",
            row.sameClass ? "같은 수업" : "",
          ].filter(Boolean).join(" · ")}</span>
        </li>)}
      </ul>
      {details.confirmedCount > details.confirmed.length ? <p>전체 {details.confirmedCount}건 중 {details.confirmed.length}건 표시</p> : null}
      <p>겹친 회차의 시간·선생님·강의실을 조정한 뒤 다시 저장해 주세요.</p>
    </section> : null}
    {details.unresolvedCount > 0 ? <section aria-label="정보 확인 필요" className="grid min-w-0 gap-1">
      <p className="font-medium">정보 확인 필요 {details.unresolvedCount}건</p>
      <ul className="grid min-w-0 gap-2">
        {details.unresolved.map((row, index) => <li key={index} className="grid min-w-0 gap-0.5 break-words">
          <span className="font-medium">{row.className || "수업명 확인 필요"}</span>
          <span>{dateLabel(row)} · {row.missingFields.map(field => TIMETABLE_MISSING_FIELD_LABELS[field]).join("·")} 정보 확인 필요</span>
        </li>)}
      </ul>
      {details.unresolvedCount > details.unresolved.length ? <p>전체 {details.unresolvedCount}건 중 {details.unresolved.length}건 표시</p> : null}
      <p>해당 일정의 누락된 정보를 확인해 주세요. 충돌이 확인된 일정은 아닙니다.</p>
    </section> : null}
  </div>;
}
