import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  buildTimelineDayLabel,
  formatKoreanDate,
  formatRangeLabel,
  getPixelsPerDay,
  getTimelineLayoutMetrics,
  getTimelineRowEstimate,
  getTimelineScheduleRailGeometry,
  getTimelineStepperNodeGeometry,
  getWarningTone,
} from "./classScheduleWorkspaceUtils.js";

function hasActual(entry = {}) {
  return Boolean(
    (entry?.actual?.status && entry.actual.status !== "pending") ||
      entry?.actual?.label ||
      entry?.actual?.start ||
      entry?.actual?.end ||
      entry?.actual?.publicNote ||
      entry?.actual?.teacherNote,
  );
}

function withAlpha(color, alpha, fallback) {
  const raw = String(color || "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
    const hex = raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
    const value = hex.slice(1);
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return fallback;
}

function resolveSessionEntry(session = {}, textbookId = "") {
  return textbookId
    ? (session.textbookEntries || []).find((item) => item.textbookId === textbookId)
    : (session.textbookEntries || [])[0];
}

function getStepperTone(color, status = "pending") {
  const baseColor = String(color || "").trim() || "#3182f6";

  if (status === "done") {
    return {
      bg: baseColor,
      border: baseColor,
      text: "#ffffff",
      shadow: `0 12px 22px ${withAlpha(baseColor, 0.24, "rgba(49, 130, 246, 0.24)")}`,
    };
  }

  if (status === "partial") {
    return {
      bg: withAlpha(baseColor, 0.3, "rgba(49, 130, 246, 0.3)"),
      border: baseColor,
      text: baseColor,
      shadow: `0 0 0 4px ${withAlpha(baseColor, 0.14, "rgba(49, 130, 246, 0.14)")}`,
    };
  }

  return {
    bg: withAlpha(baseColor, 0.18, "rgba(49, 130, 246, 0.18)"),
    border: baseColor,
    text: baseColor,
    shadow: `0 0 0 4px ${withAlpha(baseColor, 0.08, "rgba(49, 130, 246, 0.08)")}`,
  };
}

function WarningChip({ warning }) {
  if (!warning) return null;
  const tone = getWarningTone(warning.variant);

  return (
    <span
      className="class-schedule-timeline__warning-chip"
      title={warning.message}
      style={{
        "--warning-bg": tone.bg,
        "--warning-text": tone.text,
        "--warning-border": tone.border,
      }}
    >
      {`${warning.sessions}회차 ${warning.variant === "ahead" ? "앞섬" : "주의"}`}
    </span>
  );
}

function SessionStepper({
  sessions = [],
  textbookId = "",
  pixelsPerDay,
  timelineStart,
  layoutMetrics,
  onPlanClick,
  onActualClick,
  row,
}) {
  const railGeometry = getTimelineScheduleRailGeometry(
    sessions,
    timelineStart,
    pixelsPerDay,
    layoutMetrics.trackPadding,
  );
  const nodeSize = textbookId
    ? layoutMetrics.textbookStepperSize
    : layoutMetrics.classStepperSize;
  const nodeTop = textbookId
    ? layoutMetrics.textbookStepperTop
    : layoutMetrics.classStepperTop;
  const railTop = textbookId
    ? layoutMetrics.textbookStepperRailTop
    : layoutMetrics.classStepperRailTop;
  const firstSession = sessions[0];
  const lastSession = sessions[sessions.length - 1];

  return (
    <>
      {railGeometry.width > 0 ? (
        <button
          type="button"
          className="class-schedule-timeline__stepper-rail"
          onClick={() => onPlanClick(row)}
          title={
            firstSession && lastSession
              ? `${formatKoreanDate(firstSession.date)} ~ ${formatKoreanDate(lastSession.date)}`
              : ""
          }
          style={{
            "--rail-left": `${railGeometry.left}px`,
            "--rail-width": `${railGeometry.width}px`,
            "--rail-top": `${railTop}px`,
          }}
        />
      ) : null}

      {sessions.map((session) => {
        const entry = resolveSessionEntry(session, textbookId);
        if (!entry) return null;

        const stepperStatus = textbookId
          ? (entry.actual?.status || "pending")
          : (session.progressStatus || entry.actual?.status || "pending");
        const tone = getStepperTone(session.billingColor, stepperStatus);
        const geometry = getTimelineStepperNodeGeometry(
          session,
          timelineStart,
          pixelsPerDay,
          layoutMetrics.trackPadding,
          nodeSize,
        );
        const actualExists = hasActual(entry);
        const planLabel = formatRangeLabel(entry.plan) || "계획 없음";
        const actualLabel = actualExists
          ? (formatRangeLabel(entry.actual) || "실제 입력됨")
          : "실제 입력 없음";
        const sessionNumber = Number(session.sessionNumber || 0) > 0
          ? String(session.sessionNumber)
          : "?";

        return (
          <button
            key={`${row.classItem.id}:${session.id}:${textbookId || "all"}`}
            type="button"
            className={`class-schedule-timeline__stepper-node is-${stepperStatus}${actualExists ? " has-actual" : ""}`}
            title={`${formatKoreanDate(session.date)} / ${sessionNumber}회차 / 계획: ${planLabel} / 실제: ${actualLabel}`}
            onClick={() => onActualClick(row, session, entry)}
            style={{
              "--step-left": `${geometry.left}px`,
              "--step-top": `${nodeTop}px`,
              "--step-size": `${geometry.size}px`,
              "--step-bg": tone.bg,
              "--step-border": tone.border,
              "--step-text": tone.text,
              "--step-shadow": tone.shadow,
            }}
          >
            <span className="class-schedule-timeline__stepper-number">{sessionNumber}</span>
          </button>
        );
      })}
    </>
  );
}

export default function ClassScheduleTimelineView({
  timelineRows = [],
  axis = {},
  timelineRange,
  selectedClassId = "",
  expandedClassIds,
  onSelectClass,
  onToggleExpand,
  onPlanClick,
  onActualClick,
  timelineZoom = "day",
}) {
  const scrollRef = useRef(null);
  const days = axis.days || [];
  const weeks = axis.weeks || [];
  const months = axis.months || [];
  const pixelsPerDay = getPixelsPerDay(timelineZoom);
  const layoutMetrics = getTimelineLayoutMetrics(timelineZoom);
  const totalWidth = Math.max(
    days.length * pixelsPerDay + layoutMetrics.trackPadding * 2,
    960,
  );

  const rowVirtualizer = useVirtualizer({
    count: timelineRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => getTimelineRowEstimate(timelineRows[index]?.type, timelineZoom),
    overscan: 8,
  });

  const todayIndex = useMemo(
    () => days.findIndex((item) => item.isToday),
    [days],
  );
  const todayDay = todayIndex >= 0 ? days[todayIndex] : null;
  const todayOffset =
    todayIndex >= 0
      ? layoutMetrics.trackPadding + todayIndex * pixelsPerDay + pixelsPerDay / 2
      : -1;

  if (!timelineRows.length || !days.length) {
    return <div className="class-schedule-empty-state">표시할 일정이 없습니다.</div>;
  }

  return (
    <div
      className="class-schedule-timeline"
      style={{
        "--timeline-left-width": `${layoutMetrics.leftWidth}px`,
        "--timeline-header-height": `${layoutMetrics.headerHeight}px`,
      }}
    >
      <div ref={scrollRef} className="class-schedule-timeline__viewport">
        <div
          className="class-schedule-timeline__canvas"
          style={{
            width: layoutMetrics.leftWidth + totalWidth,
            height: layoutMetrics.headerHeight + rowVirtualizer.getTotalSize(),
          }}
        >
          <div className="class-schedule-timeline__header">
            <div className="class-schedule-timeline__header-left">
              <div className="class-schedule-timeline__header-left-copy">
                <strong>수업 / 교재</strong>
              </div>
            </div>

            <div className="class-schedule-timeline__header-right" style={{ width: totalWidth }}>
              <div className="class-schedule-timeline__axis-layer class-schedule-timeline__axis-layer--months">
                {months.map((segment) => (
                  <div
                    key={segment.key}
                    className="class-schedule-timeline__axis-segment class-schedule-timeline__axis-segment--month"
                    style={{
                      left: layoutMetrics.trackPadding + segment.startIndex * pixelsPerDay,
                      width: segment.span * pixelsPerDay,
                    }}
                  >
                    {segment.label}
                  </div>
                ))}
              </div>

              <div className="class-schedule-timeline__axis-layer class-schedule-timeline__axis-layer--weeks">
                {weeks.map((segment) => (
                  <div
                    key={segment.key}
                    className="class-schedule-timeline__axis-segment class-schedule-timeline__axis-segment--week"
                    style={{
                      left: layoutMetrics.trackPadding + segment.startIndex * pixelsPerDay,
                      width: segment.span * pixelsPerDay,
                    }}
                  >
                    {segment.label}
                  </div>
                ))}
              </div>

              <div className="class-schedule-timeline__axis-layer class-schedule-timeline__axis-layer--days">
                {days.map((day, index) => {
                  const label = buildTimelineDayLabel(day, timelineZoom);
                  const isWeekStart = day.date.getDay() === 1;
                  const isMonthStart = day.date.getDate() === 1;

                  return (
                    <div
                      key={day.key}
                      className={`class-schedule-timeline__day${day.isToday ? " is-today" : ""}${label.emphasis === "major" ? " is-major" : ""}${label.emphasis === "quiet" ? " is-quiet" : ""}${isWeekStart ? " is-week-start" : ""}${isMonthStart ? " is-month-start" : ""}`}
                      style={{
                        left: layoutMetrics.trackPadding + index * pixelsPerDay,
                        width: pixelsPerDay,
                      }}
                    >
                      <strong>{label.primary}</strong>
                      <span>{label.secondary}</span>
                    </div>
                  );
                })}
              </div>

              {todayOffset >= 0 && todayDay ? (
                <div
                  className="class-schedule-timeline__today-pill"
                  style={{ left: todayOffset }}
                >
                  {`오늘 ${formatKoreanDate(todayDay.date, "M.d")}`}
                </div>
              ) : null}

              {todayOffset >= 0 ? (
                <div
                  className="class-schedule-timeline__today-line"
                  style={{ left: todayOffset }}
                />
              ) : null}
            </div>
          </div>

          {todayOffset >= 0 ? (
            <div
              className="class-schedule-timeline__today-track"
              style={{
                left: layoutMetrics.leftWidth + todayOffset,
                top: layoutMetrics.headerHeight,
                height: rowVirtualizer.getTotalSize(),
              }}
            />
          ) : null}

          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = timelineRows[virtualRow.index];
            const row = item.row;
            const isSelected = row.classItem.id === selectedClassId;
            const sessions = item.type === "class"
              ? (row.sessions || [])
              : (row.sessions || []).filter((session) =>
                  (session.textbookEntries || []).some(
                    (entry) => entry.textbookId === item.textbookId,
                  ),
                );

            return (
              <div
                key={item.key}
                data-index={virtualRow.index}
                ref={(node) => rowVirtualizer.measureElement(node)}
                className={`class-schedule-timeline__row${item.type === "textbook" ? " is-textbook" : ""}${isSelected ? " is-selected" : ""}${virtualRow.index % 2 === 1 ? " is-alt" : ""}`}
                style={{
                  top: layoutMetrics.headerHeight + virtualRow.start,
                  minHeight: virtualRow.size,
                  width: layoutMetrics.leftWidth + totalWidth,
                }}
              >
                <div className="class-schedule-timeline__identity">
                  {item.type === "class" ? (
                    <>
                      <div className="class-schedule-timeline__identity-top">
                        <div className="class-schedule-timeline__identity-copy">
                          <button
                            type="button"
                            className="class-schedule-timeline__identity-button"
                            onClick={() => onSelectClass(row.classItem.id)}
                          >
                            <strong>{row.classItem.className || row.classItem.name}</strong>
                            <span>{row.classItem.subject} / {row.classItem.teacher || "교사 미정"}</span>
                          </button>
                          <div className="class-schedule-timeline__identity-meta">
                            <span>{row.term?.name || "학기 미정"}</span>
                            <span>{row.classItem.grade || "학년 미정"}</span>
                            <span>{`${row.sessions?.length || 0}회차`}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="class-schedule-timeline__expand-button"
                          onClick={() => {
                            onSelectClass(row.classItem.id);
                            onToggleExpand(row.classItem.id);
                          }}
                        >
                          {expandedClassIds.has(row.classItem.id) ? "교재 숨기기" : "교재 보기"}
                        </button>
                      </div>

                      {row.warningSummary?.planDrift || row.warningSummary?.syncGap ? (
                        <div className="class-schedule-timeline__warning-row">
                          <WarningChip warning={row.warningSummary?.planDrift} />
                          <WarningChip warning={row.warningSummary?.syncGap} />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="class-schedule-timeline__textbook-label">
                      {item.textbookTitle || item.textbookId || "교재"}
                    </div>
                  )}
                </div>

                <div className="class-schedule-timeline__lane" style={{ width: totalWidth }}>
                  {days.map((day, index) => {
                    const isWeekStart = day.date.getDay() === 1;
                    const isMonthStart = day.date.getDate() === 1;

                    return (
                      <div
                        key={`${item.key}:${day.key}`}
                        className={`class-schedule-timeline__lane-day${day.isToday ? " is-today" : ""}${isWeekStart ? " is-week-start" : ""}${isMonthStart ? " is-month-start" : ""}`}
                        style={{
                          left: layoutMetrics.trackPadding + index * pixelsPerDay,
                          width: pixelsPerDay,
                        }}
                      />
                    );
                  })}

                  <SessionStepper
                    row={row}
                    sessions={sessions}
                    textbookId={item.type === "textbook" ? item.textbookId : ""}
                    pixelsPerDay={pixelsPerDay}
                    timelineStart={timelineRange?.start || ""}
                    layoutMetrics={layoutMetrics}
                    onPlanClick={onPlanClick}
                    onActualClick={onActualClick}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
