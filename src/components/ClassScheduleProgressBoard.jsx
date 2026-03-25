import { useMemo } from "react";

import { createMergedClassScheduleModel } from "../lib/classScheduleWorkspaceModel.js";
import { formatPlannerDateLabel, getProgressBadgeLabel, getStateBadgeLabel } from "../lib/classSchedulePlanner";

function hasRangeContent(range = {}) {
  return Boolean(
    String(range?.start || "").trim() ||
      String(range?.end || "").trim() ||
      String(range?.label || "").trim() ||
      String(range?.publicNote || "").trim() ||
      String(range?.teacherNote || "").trim(),
  );
}

function formatRange(range = {}) {
  const label = String(range?.label || "").trim();
  const start = String(range?.start || "").trim();
  const end = String(range?.end || "").trim();
  const parts = [];
  if (label) parts.push(label);
  if (start || end) parts.push([start, end].filter(Boolean).join(" - "));
  return parts.join(" / ");
}

export default function ClassScheduleProgressBoard({
  plan,
  classItem = null,
  className,
  subject,
  schedule,
  startDate,
  endDate,
  textbookIds = [],
  textbooksCatalog = [],
  progressLogs = [],
  mode = "plan",
  title = "",
  description = "",
  emptyMessage = "",
  hidePendingActual = false,
  publicOnly = false,
}) {
  const merged = useMemo(
    () =>
      createMergedClassScheduleModel({
        classItem: classItem || {
          id: classItem?.id || "preview-class",
          className,
          name: className,
          subject,
          schedule,
          startDate,
          endDate,
          textbookIds,
          schedulePlan: plan,
        },
        textbooksCatalog,
        progressLogs,
        plan,
      }),
    [
      classItem,
      className,
      endDate,
      plan,
      progressLogs,
      schedule,
      startDate,
      subject,
      textbookIds,
      textbooksCatalog,
    ],
  );

  const sessions = useMemo(
    () =>
      (merged.sessions || []).filter((session) => {
        if (mode === "plan") {
          return (session.textbookEntries || []).some((entry) => hasRangeContent(entry.plan));
        }
        const hasActual = (session.textbookEntries || []).some(
          (entry) => hasRangeContent(entry.actual) || entry.actual?.status !== "pending",
        );
        return hidePendingActual
          ? hasActual
          : hasActual || session.progressStatus !== "pending" || session.publicNote;
      }),
    [hidePendingActual, merged.sessions, mode],
  );
  const textbookTitleById = useMemo(
    () =>
      new Map((textbooksCatalog || []).map((item) => [String(item.id || ""), String(item.title || item.name || "")])),
    [textbooksCatalog],
  );

  if (!sessions.length) {
    return (
      <div
        style={{
          padding: 20,
          borderRadius: 20,
          border: "1px solid rgba(15, 23, 42, 0.06)",
          background: "rgba(15, 23, 42, 0.03)",
          color: "#667085",
          lineHeight: 1.7,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {title ? (
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 18, color: "#101828" }}>{title}</strong>
          {description ? <span style={{ fontSize: 13, color: "#667085" }}>{description}</span> : null}
        </div>
      ) : null}

      {sessions.map((session) => (
        <section
          key={session.id}
          style={{
            borderRadius: 22,
            border: "1px solid rgba(15, 23, 42, 0.06)",
            background: "#ffffff",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ borderRadius: 999, background: "rgba(49,130,246,0.12)", color: "#155eef", padding: "4px 8px", fontSize: 11, fontWeight: 800 }}>
                  {session.sessionNumber ? `${session.sessionNumber}회차` : "예외 일정"}
                </span>
                <span style={{ borderRadius: 999, background: "rgba(15,23,42,0.06)", color: "#344054", padding: "4px 8px", fontSize: 11, fontWeight: 800 }}>
                  {getStateBadgeLabel(session.scheduleState)}
                </span>
                <span style={{ borderRadius: 999, background: "rgba(22,163,74,0.12)", color: session.progressStatus === "done" ? "#155eef" : session.progressStatus === "partial" ? "#15803d" : "#475467", padding: "4px 8px", fontSize: 11, fontWeight: 800 }}>
                  {getProgressBadgeLabel(session.progressStatus)}
                </span>
              </div>
              <strong style={{ fontSize: 17, color: "#101828" }}>{formatPlannerDateLabel(session.date)}</strong>
              <span style={{ fontSize: 13, color: "#667085" }}>{session.billingLabel}</span>
            </div>

            {mode === "actual" && session.publicNote ? (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 16,
                  background: "rgba(37, 99, 235, 0.08)",
                  color: "#1d4ed8",
                  fontSize: 12,
                  lineHeight: 1.6,
                  maxWidth: 320,
                }}
              >
                {session.publicNote}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {(session.textbookEntries || []).map((entry) => {
              const range = mode === "plan" ? entry.plan : entry.actual;
              const isVisible =
                mode === "plan"
                  ? hasRangeContent(entry.plan)
                  : hasRangeContent(entry.actual) || entry.actual?.status !== "pending";

              if (!isVisible) return null;

              return (
                <div
                  key={`${session.id}-${entry.textbookId}`}
                  style={{
                    borderRadius: 18,
                    border: "1px solid rgba(15, 23, 42, 0.06)",
                    background: "rgba(15, 23, 42, 0.02)",
                    padding: 14,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14, color: "#101828" }}>
                      {textbookTitleById.get(String(entry.textbookId || "")) || entry.textbookId}
                    </strong>
                    {mode === "actual" ? (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#155eef" }}>
                        {getProgressBadgeLabel(entry.actual?.status || "pending")}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, color: "#101828" }}>
                    {formatRange(range) || (mode === "plan" ? "계획 없음" : "기록 없음")}
                  </div>
                  {mode === "actual" && !publicOnly && entry.actual?.teacherNote ? (
                    <div style={{ fontSize: 12, color: "#667085" }}>
                      교사용 메모: {entry.actual.teacherNote}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
