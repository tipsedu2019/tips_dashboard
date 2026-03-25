import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Download } from "lucide-react";
import { exportElementAsImage } from "../lib/exportAsImage";
import useViewport from "../hooks/useViewport";
import {
  DAY_OPTIONS,
  calculateSchedulePlan,
  formatPlannerDateLabel,
  getCalendarDaySurface,
  getFullClassName,
  getStateBadgeLabel,
  getStateTone,
  parseDateValue,
} from "../lib/classSchedulePlanner";
import {
  buildSessionStepKey,
  buildSessionStepStateMap,
  hasSessionDetailContent,
} from "../lib/classPlanStepper";
import { Badge } from "./ui/tds";

function text(value) {
  return String(value || "").trim();
}

const CALENDAR_DAY_HEADERS = ["일", "월", "화", "수", "목", "금", "토"];
const HIDE_ADJACENT_DAY_VARIANTS = new Set(["public-detail", "editor-summary"]);

function buildMonthCells(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const leadingCount = firstDay.getDay();
  const cells = [];

  for (let index = leadingCount - 1; index >= 0; index -= 1) {
    const date = new Date(year, month, 1 - index - 1);
    cells.push({ date, isCurrentMonth: false });
  }

  for (let day = 1; day <= lastDate; day += 1) {
    cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
  }

  while (cells.length % 7 !== 0) {
    const nextIndex = cells.length - leadingCount - lastDate + 1;
    cells.push({
      date: new Date(year, month + 1, nextIndex),
      isCurrentMonth: false,
    });
  }

  return cells;
}

function getPrimarySession(entries = []) {
  if (entries.length === 0) {
    return null;
  }

  return entries.find((entry) => entry.state !== "makeup") || entries[0];
}

function getBillingHeading(period, sampleSession) {
  const startDate = parseDateValue(period?.startDate);
  const endDate = parseDateValue(period?.endDate);
  const monthNumber = Number(period?.month) || 1;

  let year = startDate?.getFullYear();
  if (endDate && endDate.getMonth() + 1 === monthNumber) {
    year = endDate.getFullYear();
  } else if (startDate && startDate.getMonth() + 1 === monthNumber) {
    year = startDate.getFullYear();
  } else if (!year && sampleSession?.date) {
    year = parseDateValue(sampleSession.date)?.getFullYear();
  }

  return year ? `${year}년 ${monthNumber}월` : `${monthNumber}월`;
}

function buildSessionGroups(sessions = [], billingPeriods = []) {
  const sessionsByBillingId = new Map();

  (sessions || []).forEach((session) => {
    if (!sessionsByBillingId.has(session.billingId)) {
      sessionsByBillingId.set(session.billingId, []);
    }
    sessionsByBillingId.get(session.billingId).push(session);
  });

  return (billingPeriods || [])
    .map((period) => {
      const periodSessions = [
        ...(sessionsByBillingId.get(period.id) || []),
      ].sort((left, right) => {
        const diff = new Date(left.date) - new Date(right.date);
        if (diff !== 0) {
          return diff;
        }
        return (left.sessionNumber || 0) - (right.sessionNumber || 0);
      });

      if (periodSessions.length === 0) {
        return null;
      }

      return {
        key: period.id,
        label: getBillingHeading(period, periodSessions[0]),
        billingLabel:
          period.label || periodSessions[0]?.billingLabel || "청구월 미설정",
        billingColor:
          period.color || periodSessions[0]?.billingColor || "#216e4e",
        sessions: periodSessions,
      };
    })
    .filter(Boolean);
}

function getSelectedDayLabel(plan) {
  if (!plan?.selectedDays?.length) {
    return "요일 미설정";
  }

  const labels = plan.selectedDays
    .map((value) => DAY_OPTIONS.find((item) => item.value === value)?.label)
    .filter(Boolean);

  return labels.length ? labels.join(" · ") : "요일 미설정";
}

function countGroupSessions(sessions = []) {
  const numberedSessions = new Set(
    (sessions || [])
      .map((session) => Number(session.sessionNumber))
      .filter(
        (sessionNumber) => Number.isFinite(sessionNumber) && sessionNumber > 0,
      ),
  );

  if (numberedSessions.size > 0) {
    return numberedSessions.size;
  }

  const countedSessions = (sessions || []).filter(
    (session) => session.state !== "makeup",
  ).length;
  return countedSessions || (sessions || []).length;
}

function useSessionGroupTrackLayout(sessionCount, firstSessionKey, lastSessionKey) {
  const listRef = useRef(null);
  const firstDotRef = useRef(null);
  const lastDotRef = useRef(null);
  const [trackVars, setTrackVars] = useState(null);

  useLayoutEffect(() => {
    if (sessionCount <= 1) {
      setTrackVars(null);
      return undefined;
    }

    const listNode = listRef.current;
    const firstDotNode = firstDotRef.current;
    const lastDotNode = lastDotRef.current;

    if (!listNode || !firstDotNode || !lastDotNode) {
      return undefined;
    }

    let frameId = null;

    const measure = () => {
      const listRect = listNode.getBoundingClientRect();
      const firstRect = firstDotNode.getBoundingClientRect();
      const lastRect = lastDotNode.getBoundingClientRect();
      const nextTrackVars = {
        "--track-top": `${Math.max(0, firstRect.top - listRect.top)}px`,
        "--track-bottom": `${Math.max(0, listRect.bottom - lastRect.bottom)}px`,
        "--track-left": `${Math.max(0, firstRect.left - listRect.left)}px`,
        "--track-width": `${firstRect.width}px`,
      };

      setTrackVars((current) => {
        if (
          current?.["--track-top"] === nextTrackVars["--track-top"] &&
          current?.["--track-bottom"] === nextTrackVars["--track-bottom"] &&
          current?.["--track-left"] === nextTrackVars["--track-left"] &&
          current?.["--track-width"] === nextTrackVars["--track-width"]
        ) {
          return current;
        }

        return nextTrackVars;
      });
    };

    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(scheduleMeasure)
        : null;

    observer?.observe(listNode);
    observer?.observe(firstDotNode);
    observer?.observe(lastDotNode);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [firstSessionKey, lastSessionKey, sessionCount]);

  return {
    listRef,
    firstDotRef,
    lastDotRef,
    trackVars,
  };
}

function withAlpha(color, alpha) {
  if (typeof color !== "string" || !color.startsWith("#")) {
    return color;
  }

  const normalized =
    color.length === 4
      ? `#${color
          .slice(1)
          .split("")
          .map((char) => `${char}${char}`)
          .join("")}`
      : color;
  const value = Number.parseInt(normalized.slice(1), 16);

  if (Number.isNaN(value)) {
    return color;
  }

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildMonthColorMap(months = [], sessionGroups = []) {
  const monthColorMap = new Map();

  (sessionGroups || []).forEach((group) => {
    const groupColor = group.billingColor || "#216e4e";

    (group.sessions || []).forEach((session) => {
      const date = parseDateValue(session.date);
      if (!date) {
        return;
      }

      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      if (!monthColorMap.has(monthKey)) {
        monthColorMap.set(monthKey, groupColor);
      }
    });
  });

  (months || []).forEach((month, index) => {
    const monthKey = `${month.year}-${month.month}`;
    if (!monthColorMap.has(monthKey)) {
      monthColorMap.set(
        monthKey,
        sessionGroups[index]?.billingColor || "#216e4e",
      );
    }
  });

  return monthColorMap;
}

function buildPreviewBadges(sessionGroups) {
  const badges = [];
  (sessionGroups || []).forEach((group) => {
    badges.push({
      key: `period-${group.key}`,
      label: `${group.billingLabel} ${countGroupSessions(group.sessions)}회`,
      tone: "period",
      color: group.billingColor || "#216e4e",
    });
  });

  ["exception", "tbd", "makeup"].forEach((state) => {
    badges.push({
      key: `state-${state}`,
      label: getStateBadgeLabel(state),
      tone: state,
    });
  });

  return badges;
}

function sanitizeFilePart(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "class-plan"
  );
}

function PreviewBadge({ badge }) {
  return (
    <span
      className={`class-plan-preview-badge is-${badge.tone}`}
      style={
        badge.color ? { "--class-plan-preview-accent": badge.color } : undefined
      }
    >
      {badge.label}
    </span>
  );
}

function getDayLabelMeta(session) {
  if (!session) {
    return null;
  }

  if (
    session.state === "active" ||
    session.state === "force_active" ||
    session.state === "makeup"
  ) {
    return {
      text: session.sessionNumber ? `${session.sessionNumber}` : "수업",
      tone: session.state === "makeup" ? "makeup" : "session",
      secondary: "",
    };
  }

  return {
    text: getStateBadgeLabel(session.state),
    tone: session.state,
    secondary: session.sessionNumber ? `${session.sessionNumber}회` : "",
  };
}


function SessionMeta({ session }) {
  return (
    <>
      {session.memo ? (
        <div className="class-plan-session-note">{session.memo}</div>
      ) : null}
      {session.state === "exception" && session.makeupDate ? (
        <div className="class-plan-session-note is-makeup">
          보강 {formatPlannerDateLabel(session.makeupDate)}
        </div>
      ) : null}
      {session.state === "makeup" && session.originalDate ? (
        <div className="class-plan-session-note is-cancelled">
          {formatPlannerDateLabel(session.originalDate)} 휴강 보강
        </div>
      ) : null}
    </>
  );
}

function MonthCard({
  month,
  monthColor,
  sessionsByDate,
  selectedDays,
  interactive,
  onToggleDate,
  onSubstitution,
  dragSource,
  setDragSource,
  dropTarget,
  setDropTarget,
  compact = false,
  variant = "editor-summary",
}) {
  const cells = useMemo(
    () => buildMonthCells(month.year, month.month),
    [month.month, month.year],
  );
  const showAdjacentDayNumbers = !HIDE_ADJACENT_DAY_VARIANTS.has(variant);

  return (
    <div
      className={`class-plan-month-card ${compact ? "is-compact" : ""}`}
      style={{
        "--class-plan-month-color": monthColor || "#216e4e",
        "--class-plan-month-soft": withAlpha(monthColor || "#216e4e", 0.14),
      }}
    >
      <div className="class-plan-month-heading">
        {month.year}년 {month.month + 1}월
      </div>

      <div className="class-plan-month-grid">
        {CALENDAR_DAY_HEADERS.map((dayLabel) => (
          <div
            key={`${month.year}-${month.month}-${dayLabel}`}
            className="class-plan-month-weekday"
          >
            {dayLabel}
          </div>
        ))}

        {cells.map((cell) => {
          const dateKey = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`;
          const sessionEntries = sessionsByDate.get(dateKey) || [];
          const primarySession = getPrimarySession(sessionEntries);
          const hasSession = Boolean(primarySession);
          const isDragSource = dragSource === dateKey;
          const isDropTarget = dropTarget === dateKey;
          const dayLabelMeta = getDayLabelMeta(primarySession);
          const daySurface = getCalendarDaySurface(
            primarySession,
            monthColor || "#216e4e",
          );
          const CellTag = interactive ? "button" : "div";
          const dayNumber =
            cell.isCurrentMonth || showAdjacentDayNumbers
              ? String(cell.date.getDate())
              : "";

          return (
            <CellTag
              key={`${month.year}-${month.month}-${dateKey}`}
              {...(interactive ? { type: "button" } : {})}
              draggable={
                interactive &&
                Boolean(primarySession) &&
                primarySession.state !== "makeup"
              }
              onDragStart={(event) => {
                if (
                  !interactive ||
                  !primarySession ||
                  primarySession.state === "makeup"
                ) {
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", dateKey);
                setDragSource(dateKey);
              }}
              onDragEnd={() => {
                setDragSource(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => {
                if (!interactive || !onSubstitution || !dragSource) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(dateKey);
              }}
              onDragLeave={() => {
                if (dropTarget === dateKey) {
                  setDropTarget(null);
                }
              }}
              onDrop={(event) => {
                if (!interactive || !onSubstitution) {
                  return;
                }
                event.preventDefault();
                const sourceDate = event.dataTransfer.getData("text/plain");
                setDropTarget(null);
                setDragSource(null);
                if (sourceDate && sourceDate !== dateKey) {
                  onSubstitution(sourceDate, dateKey);
                }
              }}
              onClick={() => {
                if (!interactive || !onToggleDate) {
                  return;
                }
                onToggleDate(dateKey, {
                  hasSession,
                  hasBaseSession: selectedDays.includes(cell.date.getDay()),
                  isMakeup: primarySession?.state === "makeup",
                });
              }}
              className={[
                "class-plan-day-cell",
                cell.isCurrentMonth ? "is-current-month" : "is-adjacent-month",
                daySurface.isFilled ? "is-filled" : "",
                isDropTarget ? "is-drop-target" : "",
                isDragSource ? "is-drag-source" : "",
                interactive ? "is-interactive" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                "--class-plan-cell-fill": daySurface.fillColor,
                "--class-plan-cell-border": withAlpha(
                  daySurface.isFilled ? daySurface.fillColor : "#cbd5e1",
                  daySurface.isFilled ? 0.28 : 0.14,
                ),
                "--class-plan-cell-idle-text": daySurface.isFilled
                  ? "#0f172a"
                  : daySurface.textColor,
                "--class-plan-cell-adjacent-text": daySurface.isFilled
                  ? "#cbd5e1"
                  : daySurface.mutedTextColor,
                "--class-plan-cell-text": daySurface.textColor,
                "--class-plan-cell-muted-text": daySurface.mutedTextColor,
              }}
            >
              <div className="class-plan-day-bubble">
                <div className="class-plan-day-number">{dayNumber}</div>
                <div className="class-plan-day-entry class-plan-day-entry-stack">
                  {dayLabelMeta ? (
                    <>
                      <span
                        className={`class-plan-day-label is-${dayLabelMeta.tone}`}
                      >
                        {dayLabelMeta.text}
                      </span>
                      {dayLabelMeta.secondary ? (
                        <span className="class-plan-day-session-num is-secondary">
                          {dayLabelMeta.secondary}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </CellTag>
          );
        })}
      </div>
    </div>
  );
}

function SessionStatePill({ state }) {
  const statusLabels = {
    session: "정상 수업",
    active: "정상 수업",
    force_active: "정상 수업",
    exception: "휴강/보강",
    makeup: "보강",
    tbd: "미정",
  };

  const statusTones = {
    session: "success",
    active: "success",
    force_active: "success",
    exception: "warning",
    makeup: "primary",
    tbd: "gray",
  };

  return (
    <Badge size="small" color={statusTones[state] || "neutral"} variant="weak">
      {statusLabels[state] || "정상 수업"}
    </Badge>
  );
}

/**
 * Find the "active" step index — the session closest to today (on or before).
 * Steps before activeIdx → done, step at activeIdx → active (current),
 * steps after → pending.  Mirrors TDS ProgressStepper activeStepIndex.
 */
function SessionVerticalStepper({ group, variant, stepStates }) {
  const isPublicDetail = variant === "public-detail";
  const color = group.billingColor || "#216e4e";
  const firstSession = group.sessions[0] || null;
  const lastSession = group.sessions[group.sessions.length - 1] || null;
  const firstSessionKey = firstSession
    ? buildSessionStepKey(group.key, firstSession)
    : group.key;
  const lastSessionKey = lastSession
    ? buildSessionStepKey(group.key, lastSession)
    : group.key;
  const { listRef, firstDotRef, lastDotRef, trackVars } =
    useSessionGroupTrackLayout(
      group.sessions.length,
      firstSessionKey,
      lastSessionKey,
    );

  return (
    <section
      className="class-plan-session-group class-plan-session-vertical-group"
      key={group.key}
    >
      {!isPublicDetail && (
        <header className="class-plan-session-group-header">
          <strong>{group.label}</strong>
          <span>{countGroupSessions(group.sessions)}회</span>
        </header>
      )}
      <div
        className="class-plan-session-vertical-list"
        ref={listRef}
        style={{ "--stepper-color": color, ...trackVars }}
      >
        {group.sessions.length > 1 ? (
          <div className="class-plan-session-group-track" aria-hidden="true" />
        ) : null}
        {group.sessions.map((session, index) => {
          const sessionKey = buildSessionStepKey(group.key, session);
          const stepState = stepStates.get(sessionKey) || "pending";
          const isLast = index === group.sessions.length - 1;
          const stemState = stepState === "done" ? "filled" : "empty";
          const hasDetail = hasSessionDetailContent(session);

          return (
            <article
              key={`${group.key}-${session.date}-${session.originalDate || "base"}-${session.sessionNumber || "na"}`}
              className={`class-plan-session-card class-plan-session-vertical-item is-single-row is-step-${stepState} ${hasDetail ? "has-detail" : ""}`.trim()}
            >
              <div className="class-plan-session-stepper">
                <div
                  className={`class-plan-stepper-dot is-${stepState}`}
                  ref={(node) => {
                    if (index === 0) {
                      firstDotRef.current = node;
                    }
                    if (isLast) {
                      lastDotRef.current = node;
                    }
                  }}
                  style={{ "--stepper-color": color }}
                >
                  {session.sessionNumber || ""}
                </div>
                {!isLast && (
                  <div className="class-plan-stepper-stem" aria-hidden="true">
                    <div className={`class-plan-stepper-stem-fill is-${stemState}`} />
                  </div>
                )}
              </div>

              <div className="class-plan-session-card-content">
                <div className="class-plan-session-main-info">
                  <div className="class-plan-session-date-stack">
                    <span className="class-plan-session-date-label">
                      {formatPlannerDateLabel(session.date)}
                    </span>
                    <SessionMeta session={session} />
                  </div>
                </div>

                <div className="class-plan-session-status-info">
                  <SessionStatePill state={session.state} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SessionList({ groups, isCompact, variant }) {
  if (!groups.length) {
    return null;
  }

  const { stepStates } = useMemo(
    () => buildSessionStepStateMap(groups),
    [groups],
  );

  const ContainerTag = isCompact ? "div" : "aside";
  const containerClass = isCompact
    ? "class-plan-session-stack"
    : "class-plan-session-panel";
  const useStickyHeader = !isCompact && variant !== "share-image";

  return (
    <ContainerTag
      className={containerClass}
      data-testid="class-plan-session-list"
    >
      {variant !== "public-detail" ? (
        <div
          className={`class-plan-session-panel-header ${useStickyHeader ? "is-sticky" : ""}`.trim()}
        >
          <strong>회차 목록</strong>
        </div>
      ) : null}
      <div className="class-plan-session-scroll">
        {groups.map((group) => (
          <SessionVerticalStepper
            key={group.key}
            group={group}
            variant={variant}
            stepStates={stepStates}
          />
        ))}
      </div>
    </ContainerTag>
  );
}

export function ClassSchedulePlanPreview({
  plan,
  className,
  subject,
  interactive = false,
  onToggleDate,
  onSubstitution,
  allowExport = false,
  emptyMessage = "아직 생성한 수업 계획이 없습니다.",
  variant = "editor-summary",
}) {
  const { isMobile, isCompact } = useViewport();
  const exportRef = useRef(null);
  const [dragSource, setDragSource] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const calculation = useMemo(() => calculateSchedulePlan(plan), [plan]);
  const sessionsByDate = useMemo(
    () =>
      calculation.sessions.reduce((result, session) => {
        const bucket = result.get(session.date) || [];
        bucket.push(session);
        result.set(session.date, bucket);
        return result;
      }, new Map()),
    [calculation.sessions],
  );
  const sessionGroups = useMemo(
    () => buildSessionGroups(calculation.sessions, calculation.billingPeriods),
    [calculation.billingPeriods, calculation.sessions],
  );
  const monthColorMap = useMemo(
    () => buildMonthColorMap(calculation.months, sessionGroups),
    [calculation.months, sessionGroups],
  );
  const selectedDayLabel = useMemo(() => getSelectedDayLabel(plan), [plan]);
  const previewBadges = useMemo(
    () => buildPreviewBadges(sessionGroups),
    [sessionGroups],
  );
  const fullClassName =
    getFullClassName(subject, className) || className || "수업 계획";
  const isSummaryVariant = variant !== "planner-editor";
  const isShareImageVariant = variant === "share-image";
  const useCompactPreviewLayout = isShareImageVariant
    ? false
    : isMobile ||
      variant === "public-detail" ||
      variant === "planner-editor";
  const monthCardCompact = isShareImageVariant ? true : useCompactPreviewLayout;
  const sessionListCompact = isShareImageVariant
    ? false
    : useCompactPreviewLayout;

  const handleExport = async () => {
    if (
      !allowExport ||
      !exportRef.current ||
      calculation.sessions.length === 0
    ) {
      return;
    }

    const filename = `class-plan-${sanitizeFilePart(subject)}-${sanitizeFilePart(className)}.png`;

    await exportElementAsImage(exportRef.current, filename, {
      preset: "a4-portrait",
      width: 794,
      padding: 20,
      scale: 4,
      backgroundColor: "#ffffff",
    });
  };

  return (
    <div
      className={`class-plan-preview class-plan-preview--${variant} ${isCompact ? "is-compact" : ""}`}
      data-testid="class-plan-preview"
    >
      <div
        ref={exportRef}
        className={`class-plan-preview-surface ${isSummaryVariant ? "is-summary" : ""} ${isShareImageVariant ? "is-share-image" : ""}`.trim()}
      >
        <div className="class-plan-preview-header">
          <div className="class-plan-preview-copy">
            <span className="class-plan-preview-eyebrow">CLASS PLAN</span>
            <strong className="class-plan-preview-title">
              <Badge
                size="small"
                color={text(subject) === '수학' ? 'primary' : text(subject) === '영어' ? 'danger' : 'neutral'}
                variant="weak"
              >
                {text(subject) || '과목'}
              </Badge>
              <span className="class-plan-preview-title-sep"> </span>
              {className || "수업 계획"}
            </strong>
            <span className="class-plan-preview-subtitle">
              수업 요일 {selectedDayLabel}
            </span>
          </div>

          {allowExport ? (
            <button
              type="button"
              className="btn-secondary class-plan-export-button"
              onClick={handleExport}
              disabled={calculation.sessions.length === 0}
            >
              <Download size={16} />
              이미지 저장
            </button>
          ) : null}
        </div>

        <div className="class-plan-preview-badge-row">
          {previewBadges.map((badge) => (
            <PreviewBadge key={badge.key} badge={badge} />
          ))}
        </div>

        {calculation.sessions.length === 0 ? (
          <div
            className={`class-plan-empty-state ${isSummaryVariant ? "is-summary" : ""}`}
          >
            <CalendarDays size={24} />
            <strong>{emptyMessage}</strong>
            {variant === "editor-summary" ? (
              <span>
                요일과 기간을 정하면 미리보기와 상세 시트에 같은 구조로
                반영됩니다.
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className={`class-plan-preview-layout ${useCompactPreviewLayout ? "is-mobile" : "is-desktop"} ${isShareImageVariant ? "is-share-sheet" : ""}`.trim()}
            data-testid="class-plan-preview-layout"
          >
            <div className="class-plan-month-stack">
              {calculation.months.map((month) => (
                <MonthCard
                  key={`${month.year}-${month.month}`}
                  month={month}
                  monthColor={
                    monthColorMap.get(`${month.year}-${month.month}`) ||
                    "#216e4e"
                  }
                  sessionsByDate={sessionsByDate}
                  selectedDays={plan?.selectedDays || []}
                  interactive={interactive}
                  onToggleDate={onToggleDate}
                  onSubstitution={onSubstitution}
                  dragSource={dragSource}
                  setDragSource={setDragSource}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                  compact={monthCardCompact}
                  variant={variant}
                />
              ))}
            </div>

            <SessionList
              groups={sessionGroups}
              isCompact={sessionListCompact}
              variant={variant}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ClassSchedulePlanPreview;
