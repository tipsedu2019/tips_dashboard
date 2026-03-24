import { useMemo } from "react";
import { Badge, ListHeader, SegmentedControl, TextField } from "../ui/tds";
import useViewport from "../../hooks/useViewport";
import {
  calculateSchedulePlan,
  formatPlannerDateLabel,
  getProgressBadgeLabel,
  getProgressTone,
  getStateBadgeLabel,
  normalizeSchedulePlan,
} from "../../lib/classSchedulePlanner";

const STATUS_ITEMS = [
  { value: "pending", label: "미진행", ariaLabel: "미진행" },
  { value: "partial", label: "진행 중", ariaLabel: "진행 중" },
  { value: "done", label: "완료", ariaLabel: "완료" },
];

function buildPlanner(value, defaults) {
  return normalizeSchedulePlan(value, defaults);
}

function updateSessionProgress(planner, sessionId, patch) {
  const updatedAt = new Date().toISOString();

  return {
    ...planner,
    sessions: (planner.sessions || []).map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      return {
        ...session,
        progressStatus: patch.progressStatus ?? session.progressStatus,
        teacherNote: patch.teacherNote ?? session.teacherNote ?? "",
        textbookEntries: (session.textbookEntries || []).map((entry) => ({
          ...entry,
          actual: {
            ...(entry.actual || {}),
            status: patch.progressStatus ?? entry.actual?.status ?? "pending",
            updatedAt,
          },
        })),
      };
    }),
  };
}

export default function ClassScheduleChecklistEditor({
  value,
  className,
  subject,
  schedule,
  startDate,
  endDate,
  onPlanChange,
  textbooksCatalog = [],
  textbookIds = [],
}) {
  const { isCompact } = useViewport();

  const planner = useMemo(
    () =>
      buildPlanner(value, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
        textbookIds,
        textbooks: textbooksCatalog,
      }),
    [
      className,
      endDate,
      schedule,
      startDate,
      subject,
      textbookIds,
      textbooksCatalog,
      value,
    ],
  );
  const calculated = useMemo(() => calculateSchedulePlan(planner), [planner]);
  const sessions = calculated.sessions || [];
  const completedCount = sessions.filter(
    (session) => session.progressStatus === "done",
  ).length;
  const partialCount = sessions.filter(
    (session) => session.progressStatus === "partial",
  ).length;
  const pendingCount = Math.max(
    sessions.length - completedCount - partialCount,
    0,
  );

  const commitPlan = (nextPlan) => {
    onPlanChange?.(
      buildPlanner(nextPlan, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
        textbookIds,
        textbooks: textbooksCatalog,
      }),
    );
  };

  if (sessions.length === 0) {
    return (
      <div
        data-testid="class-plan-checklist-editor"
        className="class-plan-checklist-editor"
      >
        <div className="class-plan-checklist-empty">
          먼저 일정 생성 섹션에서 회차를 만든 뒤 진도 체크를 시작해 주세요.
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="class-plan-checklist-editor"
      className="class-plan-checklist-editor"
    >
      <div
        className="class-plan-checklist-summary"
        style={{
          display: "grid",
          gridTemplateColumns: isCompact
            ? "1fr"
            : "repeat(4, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <div className="planner-inline-stat">
          <span>생성 회차</span>
          <strong>{sessions.length}회</strong>
        </div>
        <div className="planner-inline-stat">
          <span>완료</span>
          <strong>{completedCount}회</strong>
        </div>
        <div className="planner-inline-stat">
          <span>진행 중</span>
          <strong>{partialCount}회</strong>
        </div>
        <div className="planner-inline-stat">
          <span>미진행</span>
          <strong>{pendingCount}회</strong>
        </div>
      </div>

      <div className="class-plan-checklist-list">
        {sessions.map((session) => {
          const progressTone = getProgressTone(session.progressStatus);
          return (
            <article key={session.id} className="class-plan-checklist-card">
              <ListHeader
                upper={
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                  >
                    <Badge size="small" type="blue" badgeStyle="weak">
                      {session.sessionNumber
                        ? `${session.sessionNumber}회차`
                        : "예외 일정"}
                    </Badge>
                    <Badge size="small" type="teal" badgeStyle="weak">
                      {getStateBadgeLabel(session.scheduleState)}
                    </Badge>
                    <Badge
                      size="small"
                      type={
                        session.progressStatus === "done"
                          ? "blue"
                          : session.progressStatus === "partial"
                            ? "amber"
                            : "gray"
                      }
                      badgeStyle="weak"
                      style={{
                        background: progressTone.background,
                        color: progressTone.color,
                      }}
                    >
                      {getProgressBadgeLabel(session.progressStatus)}
                    </Badge>
                  </div>
                }
                title={
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                  >
                    <strong style={{ fontSize: 17 }}>
                      {formatPlannerDateLabel(session.date)}
                    </strong>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      {session.billingLabel}
                    </span>
                  </div>
                }
                lower={
                  session.originalDate
                    ? `원래 일정 ${formatPlannerDateLabel(session.originalDate)} 기준 보강 회차입니다.`
                    : session.memo || "회차 메모가 없습니다."
                }
              />

              <div className="class-plan-checklist-actions">
                <SegmentedControl
                  value={session.progressStatus || "pending"}
                  onValueChange={(nextStatus) =>
                    commitPlan(
                      updateSessionProgress(planner, session.id, {
                        progressStatus: nextStatus,
                      }),
                    )
                  }
                  items={STATUS_ITEMS}
                  size="small"
                  alignment="fixed"
                />
              </div>

              <TextField
                as="textarea"
                label="내부 메모"
                labelOption="sustain"
                help="선생님 운영 메모만 남기고 저장할 수 있습니다."
                value={session.teacherNote || ""}
                placeholder="수업 진행 상황이나 다음 차시 메모를 남겨 주세요."
                onChangeText={(teacherNote) =>
                  commitPlan(
                    updateSessionProgress(planner, session.id, {
                      teacherNote,
                    }),
                  )
                }
                style={{ minHeight: 84 }}
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}
