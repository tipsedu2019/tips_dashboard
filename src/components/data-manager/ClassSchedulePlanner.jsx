import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import ClassSchedulePlanPreview from "../ClassSchedulePlanPreview";
import HelpTooltip from "../ui/HelpTooltip";
import useViewport from "../../hooks/useViewport";
import {
  applyCalendarDateSubstitution,
  applyCalendarDateToggle,
  DAY_OPTIONS,
  SESSION_COUNT_OPTIONS,
  SUBJECT_OPTIONS,
  buildSchedulePlanForSave,
  calculateSchedulePlan,
  computeAutoEndDate,
  formatPlannerDateLabel,
  getSuggestedNextStartDate,
  normalizeSchedulePlan,
} from "../../lib/classSchedulePlanner";

function ToggleChip({
  active,
  children,
  onClick,
  tone = "default",
  compact = false,
  fullWidth = false,
}) {
  const color =
    tone === "danger"
      ? "#b91c1c"
      : tone === "warning"
        ? "#b45309"
        : "var(--accent-color)";
  const background =
    tone === "danger"
      ? "rgba(239, 68, 68, 0.12)"
      : tone === "warning"
        ? "rgba(245, 158, 11, 0.14)"
        : "var(--accent-light)";

  return (
    <button
      type="button"
      className={active ? "btn-primary" : "btn-secondary"}
      onClick={onClick}
      style={{
        minHeight: compact ? 32 : 36,
        minWidth: compact ? 0 : 54,
        width: fullWidth ? "100%" : undefined,
        padding: compact ? "0 10px" : "0 12px",
        border: active ? "none" : `1px solid ${background}`,
        background: active ? color : background,
        color: active ? "#ffffff" : color,
        boxShadow: active ? "0 12px 20px rgba(33, 110, 78, 0.16)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function updateSessionStateDraft(
  existing,
  { nextState, memo, makeupDate, isForced },
) {
  const current = existing || {
    state: isForced ? "force_active" : "active",
    memo: "",
    makeupDate: "",
  };
  const nextMemo = memo ?? current.memo ?? "";
  const nextMakeupDate = makeupDate ?? current.makeupDate ?? "";

  if (nextState === "active") {
    if (isForced) {
      return {
        state: "force_active",
        memo: nextMemo,
        makeupDate: "",
      };
    }

    if (!nextMemo && !nextMakeupDate) {
      return null;
    }

    return {
      state: "active",
      memo: nextMemo,
      makeupDate: "",
    };
  }

  return {
    state: nextState,
    memo: nextMemo,
    makeupDate: nextMakeupDate,
  };
}

function SectionLabel({ children, tooltip }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}
    >
      <div
        style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)" }}
      >
        {children}
      </div>
      {tooltip ? <HelpTooltip content={tooltip} /> : null}
    </div>
  );
}

function summarizeEntries(entries = []) {
  return entries.reduce(
    (summary, entry) => {
      summary.total += 1;
      if (entry.state === "exception") {
        summary.exception += 1;
      }
      if (entry.state === "makeup") {
        summary.makeup += 1;
      }
      if (entry.state === "tbd") {
        summary.tbd += 1;
      }
      return summary;
    },
    { total: 0, exception: 0, makeup: 0, tbd: 0 },
  );
}

function compactSummary(summary) {
  const parts = [`총 ${summary.total}`];
  if (summary.exception > 0) {
    parts.push(`휴강 ${summary.exception}`);
  }
  if (summary.makeup > 0) {
    parts.push(`보강 ${summary.makeup}`);
  }
  if (summary.tbd > 0) {
    parts.push(`미정 ${summary.tbd}`);
  }
  return parts.join(" · ");
}

export default function ClassSchedulePlanner({
  value,
  className,
  subject,
  schedule,
  startDate,
  endDate,
  onPlanChange,
  onSubjectChange,
  onClassNameChange,
  showPreview = true,
  showIdentityFields = true,
  controlsLayout = "stack",
}) {
  const { isCompact } = useViewport();
  const useSplitControlsLayout =
    controlsLayout === "split" && !showPreview && !isCompact;
  const planner = useMemo(
    () =>
      normalizeSchedulePlan(value, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
      }),
    [className, endDate, schedule, startDate, subject, value],
  );

  const calculation = useMemo(() => calculateSchedulePlan(planner), [planner]);
  const overlapIdSet = useMemo(
    () => new Set(calculation.overlapIds || []),
    [calculation.overlapIds],
  );
  const persistedPlan = useMemo(
    () =>
      buildSchedulePlanForSave(planner, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
      }),
    [className, endDate, planner, schedule, startDate, subject],
  );
  const [expandedPeriods, setExpandedPeriods] = useState({});
  const [mobileSection, setMobileSection] = useState("setup");

  useEffect(() => {
    setExpandedPeriods((current) => {
      const next = {};
      planner.billingPeriods.forEach((period) => {
        next[period.id] = current[period.id] ?? false;
      });
      return next;
    });
  }, [planner.billingPeriods]);

  const commitPlan = (nextPlan, overrides = {}) => {
    const normalized = normalizeSchedulePlan(nextPlan, {
      className: overrides.className ?? className,
      subject: overrides.subject ?? subject,
      schedule,
      startDate,
      endDate,
    });
    onPlanChange?.(normalized);
    return normalized;
  };

  const recalcPeriods = (
    periods,
    selectedDays = planner.selectedDays,
    globalSessionCount = planner.globalSessionCount,
  ) =>
    (periods || []).map((period, index) => ({
      ...period,
      id: period.id || `period-${index}`,
      month: Number(period.month) || 1,
      label: `${Number(period.month) || 1}월`,
      endDate: period.startDate
        ? computeAutoEndDate(
            period.startDate,
            selectedDays,
            globalSessionCount,
          ) ||
          period.endDate ||
          ""
        : period.endDate || "",
    }));

  const handleSubjectSelect = (nextSubject) => {
    const nextPlan = commitPlan(
      { ...planner, subject: nextSubject },
      { subject: nextSubject },
    );
    onSubjectChange?.(nextSubject, nextPlan);
  };

  const handleClassNameInput = (nextClassName) => {
    const nextPlan = commitPlan(
      { ...planner, className: nextClassName },
      { className: nextClassName },
    );
    onClassNameChange?.(nextClassName, nextPlan);
  };

  const handleDayToggle = (dayValue) => {
    const nextDays = planner.selectedDays.includes(dayValue)
      ? planner.selectedDays.filter((valueItem) => valueItem !== dayValue)
      : [...planner.selectedDays, dayValue];

    commitPlan({
      ...planner,
      selectedDays: nextDays,
      billingPeriods: recalcPeriods(
        planner.billingPeriods,
        nextDays,
        planner.globalSessionCount,
      ),
    });
  };

  const handleSessionCountChange = (nextCount) => {
    commitPlan({
      ...planner,
      globalSessionCount: nextCount,
      billingPeriods: recalcPeriods(
        planner.billingPeriods,
        planner.selectedDays,
        nextCount,
      ),
    });
  };

  const handlePeriodChange = (
    periodId,
    patch,
    { recalcEndDate = false } = {},
  ) => {
    const nextPeriods = planner.billingPeriods.map((period) => {
      if (period.id !== periodId) {
        return period;
      }

      const nextPeriod = {
        ...period,
        ...patch,
      };

      if ("month" in patch) {
        nextPeriod.month = Number(patch.month) || 1;
        nextPeriod.label = `${nextPeriod.month}월`;
      }

      if (recalcEndDate && nextPeriod.startDate) {
        nextPeriod.endDate = computeAutoEndDate(
          nextPeriod.startDate,
          planner.selectedDays,
          planner.globalSessionCount,
        );
      }

      return nextPeriod;
    });

    commitPlan({
      ...planner,
      billingPeriods: nextPeriods,
    });
  };

  const handleAddPeriod = () => {
    const lastPeriod =
      planner.billingPeriods[planner.billingPeriods.length - 1];
    const suggestedStartDate = getSuggestedNextStartDate(
      lastPeriod?.endDate,
      planner.selectedDays,
    );
    const suggestedEndDate = suggestedStartDate
      ? computeAutoEndDate(
          suggestedStartDate,
          planner.selectedDays,
          planner.globalSessionCount,
        )
      : "";
    const previousMonth = Number(lastPeriod?.month) || 1;
    const suggestedMonth = previousMonth >= 12 ? 1 : previousMonth + 1;
    const nextId = `period-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    setExpandedPeriods((current) => ({
      ...current,
      [nextId]: false,
    }));

    commitPlan({
      ...planner,
      billingPeriods: [
        ...planner.billingPeriods,
        {
          id: nextId,
          month: suggestedMonth,
          label: `${suggestedMonth}월`,
          startDate: suggestedStartDate,
          endDate: suggestedEndDate,
        },
      ],
    });
  };

  const handleRemovePeriod = (periodId) => {
    setExpandedPeriods((current) => {
      const next = { ...current };
      delete next[periodId];
      return next;
    });

    commitPlan({
      ...planner,
      billingPeriods: planner.billingPeriods.filter(
        (period) => period.id !== periodId,
      ),
    });
  };

  const handleSessionStateChange = (date, nextState, isForced) => {
    const current = planner.sessionStates?.[date];
    const nextStates = { ...(planner.sessionStates || {}) };
    const draft = updateSessionStateDraft(current, { nextState, isForced });

    if (!draft) {
      delete nextStates[date];
    } else {
      nextStates[date] = draft;
    }

    commitPlan({
      ...planner,
      sessionStates: nextStates,
    });
  };

  const handleSessionMemoChange = (date, memo, isForced) => {
    const current = planner.sessionStates?.[date];
    const nextStates = { ...(planner.sessionStates || {}) };
    const draft = updateSessionStateDraft(current, {
      nextState:
        current?.state === "force_active"
          ? "active"
          : current?.state || "active",
      memo,
      makeupDate: current?.makeupDate || "",
      isForced,
    });

    if (!draft) {
      delete nextStates[date];
    } else {
      nextStates[date] = draft;
    }

    commitPlan({
      ...planner,
      sessionStates: nextStates,
    });
  };

  const handleMakeupDateChange = (date, makeupDate, isForced) => {
    const current = planner.sessionStates?.[date];
    const nextStates = { ...(planner.sessionStates || {}) };
    const draft = updateSessionStateDraft(current, {
      nextState: "exception",
      memo: current?.memo || "",
      makeupDate,
      isForced,
    });

    if (!draft) {
      delete nextStates[date];
    } else {
      nextStates[date] = draft;
    }

    commitPlan({
      ...planner,
      sessionStates: nextStates,
    });
  };

  const handleCalendarToggle = (date, meta) => {
    commitPlan(applyCalendarDateToggle(planner, date, meta));
  };

  const handleSubstitution = (sourceDate, targetDate) => {
    const current = planner.sessionStates?.[sourceDate];
    const nextStates = {
      ...(planner.sessionStates || {}),
      [sourceDate]: {
        state: "exception",
        memo: current?.memo || "수업 대체",
        makeupDate: targetDate,
      },
    };

    commitPlan({
      ...planner,
      sessionStates: nextStates,
    });
  };

  const renderPeriodEntries = (periodId) => {
    const entries = calculation.editorEntriesByPeriod?.[periodId] || [];

    if (entries.length === 0) {
      return (
        <div
          style={{
            padding: "14px 12px",
            borderRadius: 16,
            background: "var(--bg-surface-hover)",
            color: "var(--text-secondary)",
            fontSize: 12,
          }}
        >
          아직 계산된 수업일이 없습니다.
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {entries.map((entry) => (
          <div
            key={`${periodId}-${entry.date}`}
            style={{
              borderRadius: 18,
              border: "1px solid var(--border-color)",
              background: "var(--bg-surface)",
              padding: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  {entry.sessionNumber
                    ? `${entry.sessionNumber}회차`
                    : "회차 외 일정"}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>
                  {formatPlannerDateLabel(entry.date)}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <ToggleChip
                  compact
                  active={entry.state === "active"}
                  onClick={() =>
                    handleSessionStateChange(
                      entry.date,
                      "active",
                      entry.isForced,
                    )
                  }
                >
                  진행
                </ToggleChip>
                <ToggleChip
                  compact
                  active={entry.state === "exception"}
                  onClick={() =>
                    handleSessionStateChange(
                      entry.date,
                      "exception",
                      entry.isForced,
                    )
                  }
                  tone="danger"
                >
                  휴강
                </ToggleChip>
                <ToggleChip
                  compact
                  active={entry.state === "tbd"}
                  onClick={() =>
                    handleSessionStateChange(entry.date, "tbd", entry.isForced)
                  }
                  tone="warning"
                >
                  미정
                </ToggleChip>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  entry.state === "exception"
                    ? "minmax(0, 1fr) minmax(0, 140px)"
                    : "minmax(0, 1fr)",
                gap: 8,
                marginTop: 10,
              }}
            >
              <input
                type="text"
                className="styled-input"
                placeholder="메모"
                value={entry.memo || ""}
                onChange={(event) =>
                  handleSessionMemoChange(
                    entry.date,
                    event.target.value,
                    entry.isForced,
                  )
                }
                style={{ minWidth: 0 }}
              />
              {entry.state === "exception" ? (
                <input
                  type="date"
                  className="styled-input"
                  value={entry.makeupDate || ""}
                  onChange={(event) =>
                    handleMakeupDateChange(
                      entry.date,
                      event.target.value,
                      entry.isForced,
                    )
                  }
                  style={{ minWidth: 0 }}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const selectedDayLabel = planner.selectedDays.length
    ? planner.selectedDays
        .map((value) => DAY_OPTIONS.find((day) => day.value === value)?.label)
        .filter(Boolean)
        .join(" · ")
    : "요일 선택 필요";

  return (
    <div
      className={`planner-surface planner-surface--workspace ${useSplitControlsLayout ? "planner-surface--builder-split" : ""}`.trim()}
    >
      {isCompact && showPreview ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <ToggleChip
            compact
            fullWidth
            active={mobileSection === "setup"}
            onClick={() => setMobileSection("setup")}
          >
            기본
          </ToggleChip>
          <ToggleChip
            compact
            fullWidth
            active={mobileSection === "periods"}
            onClick={() => setMobileSection("periods")}
          >
            기간
          </ToggleChip>
          <ToggleChip
            compact
            fullWidth
            active={mobileSection === "preview"}
            onClick={() => setMobileSection("preview")}
          >
            미리보기
          </ToggleChip>
        </div>
      ) : null}

      <div
        className={`planner-top-grid ${!showPreview ? "is-controls-only" : ""}`.trim()}
      >
        <div
          className={`planner-controls-column ${useSplitControlsLayout ? "is-builder-split" : ""}`.trim()}
          data-testid="planner-controls-column"
          style={{
            display:
              !isCompact || !showPreview || mobileSection !== "preview"
                ? "grid"
                : "none",
          }}
        >
          <section
            className="planner-panel planner-panel--setup"
            style={{
              display:
                !isCompact || !showPreview || mobileSection === "setup"
                  ? "block"
                  : "none",
            }}
          >
            <div className="planner-title">기본 설정</div>
            <div className="planner-copy">
              과목, 공식 수업명, 반복 요일과 월 회차를 먼저 정리해 두면 오른쪽
              미리보기와 퍼블릭 상세가 같은 구조로 이어집니다.
            </div>

            <div className="planner-inline-stats">
              <div className="planner-inline-stat">
                <span>선택 요일</span>
                <strong>{selectedDayLabel}</strong>
              </div>
              <div className="planner-inline-stat">
                <span>월 기준 회차</span>
                <strong>{planner.globalSessionCount}회</strong>
              </div>
              <div className="planner-inline-stat">
                <span>기간 수</span>
                <strong>{planner.billingPeriods.length}개</strong>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                marginTop: 16,
              }}
            >
              {showIdentityFields ? (
                <div>
                  <SectionLabel tooltip="수업 일정표 제목에 반영되는 과목입니다.">
                    과목 선택
                  </SectionLabel>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {SUBJECT_OPTIONS.map((option) => (
                      <ToggleChip
                        key={option}
                        active={subject === option}
                        onClick={() => handleSubjectSelect(option)}
                      >
                        {option}
                      </ToggleChip>
                    ))}
                  </div>
                </div>
              ) : null}

              {showIdentityFields ? (
                <div>
                  <SectionLabel tooltip="공개 일정표와 이미지 저장 제목에 사용됩니다.">
                    공식 수업명
                  </SectionLabel>
                  <input
                    type="text"
                    className="styled-input"
                    value={className || ""}
                    onChange={(event) =>
                      handleClassNameInput(event.target.value)
                    }
                    placeholder="예: 대기고3"
                  />
                </div>
              ) : null}

              <div>
                <SectionLabel tooltip="선택한 요일 수를 기준으로 기본 회차가 자동 추천됩니다.">
                  수업 요일
                </SectionLabel>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {DAY_OPTIONS.map((day) => (
                    <ToggleChip
                      key={day.value}
                      active={planner.selectedDays.includes(day.value)}
                      onClick={() => handleDayToggle(day.value)}
                    >
                      {day.label}
                    </ToggleChip>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel tooltip="월 4주 기준으로 운영할 회차를 고릅니다. 최대 12회까지 설정할 수 있습니다.">
                  월 총 회차
                </SectionLabel>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                    gap: 8,
                  }}
                >
                  {SESSION_COUNT_OPTIONS.map((count) => (
                    <ToggleChip
                      key={count}
                      compact
                      fullWidth
                      active={planner.globalSessionCount === count}
                      onClick={() => handleSessionCountChange(count)}
                    >
                      {count}회
                    </ToggleChip>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section
            className="planner-panel planner-panel--periods"
            style={{
              display:
                !isCompact || !showPreview || mobileSection === "periods"
                  ? "block"
                  : "none",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  className="planner-title"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span>기간 및 회차</span>
                  <HelpTooltip content="월별 기간을 나눠 시작일과 종료일을 관리합니다. 상세 관리에서는 날짜별 휴강·미정·보강을 세밀하게 바꿀 수 있습니다." />
                </div>
                <div className="planner-copy" style={{ marginTop: 4 }}>
                  월별 운영 기간을 나누고, 기간마다 휴강/보강/미정 회차를 이어서
                  관리합니다.
                </div>
              </div>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddPeriod}
              >
                <Plus size={16} />
                기간 추가
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {planner.billingPeriods.map((period) => {
                const entries =
                  calculation.editorEntriesByPeriod?.[period.id] || [];
                const summary = summarizeEntries(entries);
                const expanded = expandedPeriods[period.id] ?? false;

                return (
                  <div
                    key={period.id}
                    style={{
                      borderRadius: 20,
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-surface-hover)",
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ fontSize: 15, fontWeight: 800 }}>
                            {period.label}
                          </div>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "5px 10px",
                              borderRadius: 999,
                              background: `${period.color}18`,
                              color: period.color,
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            {compactSummary(summary)}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {period.startDate || "-"} ~ {period.endDate || "-"}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() =>
                            setExpandedPeriods((current) => ({
                              ...current,
                              [period.id]: !expanded,
                            }))
                          }
                          aria-label={expanded ? "상세 접기" : "상세 펼치기"}
                        >
                          {expanded ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => handleRemovePeriod(period.id)}
                          disabled={planner.billingPeriods.length <= 1}
                          style={{ color: "#ef4444" }}
                          aria-label="기간 삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                      <select
                        className="styled-input"
                        value={period.month}
                        onChange={(event) =>
                          handlePeriodChange(period.id, {
                            month: Number(event.target.value) || 1,
                          })
                        }
                      >
                        {Array.from(
                          { length: 12 },
                          (_, index) => index + 1,
                        ).map((monthNumber) => (
                          <option key={monthNumber} value={monthNumber}>
                            {monthNumber}월
                          </option>
                        ))}
                      </select>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <input
                          type="date"
                          className="styled-input"
                          value={period.startDate || ""}
                          onChange={(event) =>
                            handlePeriodChange(
                              period.id,
                              { startDate: event.target.value },
                              { recalcEndDate: true },
                            )
                          }
                          style={{ minWidth: 0 }}
                        />
                        <input
                          type="date"
                          className="styled-input"
                          value={period.endDate || ""}
                          onChange={(event) =>
                            handlePeriodChange(period.id, {
                              endDate: event.target.value,
                            })
                          }
                          style={{ minWidth: 0 }}
                        />
                      </div>
                    </div>

                    {overlapIdSet.has(period.id) ? (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "10px 12px",
                          borderRadius: 14,
                          background: "rgba(239, 68, 68, 0.10)",
                          border: "1px solid rgba(239, 68, 68, 0.14)",
                          color: "#b91c1c",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        다른 기간과 날짜가 겹칩니다. 시작일 또는 종료일을 조정해
                        주세요.
                      </div>
                    ) : null}

                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          setExpandedPeriods((current) => ({
                            ...current,
                            [period.id]: !expanded,
                          }))
                        }
                        style={{ padding: "8px 14px", fontSize: 12 }}
                      >
                        {expanded ? "상세 접기" : "상세 보기"}
                      </button>
                    </div>

                    {expanded ? (
                      <div style={{ marginTop: 12 }}>
                        {renderPeriodEntries(period.id)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div
          className="planner-preview-column"
          data-testid="planner-preview-column"
          style={{
            display: !showPreview
              ? "none"
              : !isCompact || mobileSection === "preview"
                ? "block"
                : "none",
            minWidth: 0,
          }}
        >
          <section
            className="planner-panel planner-panel--preview"
            style={{ minWidth: 0 }}
          >
            <div className="planner-title">실시간 미리보기</div>
            <div className="planner-copy">
              여기서 본 구성은 저장 후 퍼블릭 상세와 관리자 화면의 `CLASS PLAN`
              미리보기에 같은 구조로 반영됩니다.
            </div>

            <div style={{ marginTop: 16 }}>
              <ClassSchedulePlanPreview
                plan={persistedPlan}
                className={className}
                subject={subject}
                interactive
                allowExport
                onToggleDate={handleCalendarToggle}
                onSubstitution={handleSubstitution}
                emptyMessage="수업명, 요일, 기간을 입력하면 수업 계획이 생성됩니다."
                variant="planner-editor"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
