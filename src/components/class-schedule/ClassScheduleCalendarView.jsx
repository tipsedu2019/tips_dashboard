import { format } from "date-fns";
import { ko } from "date-fns/locale";

import {
  formatKoreanDate,
  formatRangeLabel,
  getProgressTone,
} from "./classScheduleWorkspaceUtils.js";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function SessionChip({
  item,
  selectedKey = "",
  onPlanClick,
  onActualClick,
}) {
  const tone = getProgressTone(item.session.progressStatus);
  const firstEntry = item.session.textbookEntries?.[0];
  const key = `${item.row.classItem.id}:${item.session.id}:${firstEntry?.textbookId || ""}`;
  const isSelected = Boolean(selectedKey) && selectedKey === key;

  return (
    <div className={`class-schedule-calendar__session-chip${isSelected ? " is-selected" : ""}`}>
      <div className="class-schedule-calendar__session-chip-top">
        <strong>{item.row.classItem.className || item.row.classItem.name}</strong>
        <span style={{ color: tone.text }}>
          {item.session.progressStatus === "done"
            ? "완료"
            : item.session.progressStatus === "partial"
              ? "진행"
              : "예정"}
        </span>
      </div>
      <button type="button" onClick={() => onPlanClick(item.row)}>
        계획: {formatRangeLabel(firstEntry?.plan) || "없음"}
      </button>
      <button
        type="button"
        className={`is-actual${isSelected ? " is-selected" : ""}`}
        style={{ "--actual-text": tone.text, "--actual-bg": tone.bg }}
        onClick={() => onActualClick(item.row, item.session, firstEntry)}
      >
        실제: {formatRangeLabel(firstEntry?.actual) || "미입력"}
      </button>
    </div>
  );
}

export default function ClassScheduleCalendarView({
  cells = [],
  calendarBaseDate,
  calendarMode = "month",
  selectedKey = "",
  onPrevious,
  onNext,
  onPlanClick,
  onActualClick,
}) {
  return (
    <div className="class-schedule-calendar">
      <div className="class-schedule-calendar__toolbar">
        <div className="class-schedule-calendar__toolbar-copy">
          <strong>
            {format(calendarBaseDate, calendarMode === "week" ? "M월 d일" : "yyyy년 M월", {
              locale: ko,
            })}
          </strong>
          <span>{calendarMode === "week" ? "주간" : "월간"} 일정과 선택 회차를 같은 상태로 유지합니다.</span>
        </div>
        <div className="class-schedule-calendar__toolbar-actions">
          <button type="button" className="class-schedule-calendar__nav-button" onClick={onPrevious}>
            이전
          </button>
          <button type="button" className="class-schedule-calendar__nav-button" onClick={onNext}>
            다음
          </button>
        </div>
      </div>

      <div className="class-schedule-calendar__weekday-row">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="class-schedule-calendar__grid">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className={`class-schedule-calendar__cell${cell.isCurrentMonth ? "" : " is-adjacent-month"}${cell.sessions.length ? " has-sessions" : ""}`}
          >
            <div className="class-schedule-calendar__cell-head">
              <strong>{format(cell.date, "d")}</strong>
              <span>{formatKoreanDate(cell.key)}</span>
            </div>
            <div className="class-schedule-calendar__cell-stack">
              {cell.sessions.slice(0, 4).map((item) => (
                <SessionChip
                  key={`${item.row.classItem.id}:${item.session.id}`}
                  item={item}
                  selectedKey={selectedKey}
                  onPlanClick={onPlanClick}
                  onActualClick={onActualClick}
                />
              ))}
              {cell.sessions.length > 4 ? (
                <span className="class-schedule-calendar__overflow">
                  +{cell.sessions.length - 4}개 일정 더 있음
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
