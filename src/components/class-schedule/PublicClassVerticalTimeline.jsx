import {
  buildInspectorSessionSummary,
  formatKoreanDate,
  formatRangeLabel,
  getProgressTone,
} from "./classScheduleWorkspaceUtils.js";

export default function PublicClassVerticalTimeline({
  row = null,
  selectedSessionId = "",
  compact = false,
}) {
  if (!row) {
    return (
      <div className="class-schedule-empty-state">
        수업을 선택하면 모바일 공개 뷰 미리보기가 함께 표시됩니다.
      </div>
    );
  }

  const summary = buildInspectorSessionSummary(row, selectedSessionId, 5);
  const items = summary.visibleSessions;

  return (
    <div className={`class-schedule-public${compact ? " is-compact" : ""}`}>
      {compact ? (
        <div className="class-schedule-public__header">
          <div className="class-schedule-public__meta">
            <span className="class-schedule-public__meta-pill">{summary.totalSessions}회차</span>
            {summary.selectedPosition > 0 ? (
              <span className="class-schedule-public__meta-pill is-active">
                선택 {summary.selectedPosition} / {summary.totalSessions}
              </span>
            ) : null}
          </div>
          <span className="class-schedule-public__subline">
            공개 페이지에서는 회차별 계획과 실제 메모가 세로 흐름으로 보입니다.
          </span>
        </div>
      ) : (
        <div className="class-schedule-public__header">
          <span className="class-schedule-public__eyebrow">PUBLIC PREVIEW</span>
          <strong>{row.classItem.className || row.classItem.name}</strong>
          <span className="class-schedule-public__subline">
            {row.classItem.subject} / {row.classItem.teacher || "교사 미지정"}
          </span>
          <div className="class-schedule-public__meta">
            <span className="class-schedule-public__meta-pill">{summary.totalSessions}회차</span>
            {summary.selectedPosition > 0 ? (
              <span className="class-schedule-public__meta-pill is-active">
                선택 {summary.selectedPosition} / {summary.totalSessions}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="class-schedule-public__list">
        {items.map((session, index) => {
          const entry = session.textbookEntries?.[0];
          const tone = getProgressTone(session.progressStatus);
          const isSelected = session.id === summary.selectedSessionId;

          return (
            <article
              key={`${row.classItem.id}:${session.id}`}
              className={`class-schedule-public__item${isSelected ? " is-active" : ""}`}
            >
              <div className="class-schedule-public__rail">
                <span
                  className="class-schedule-public__dot"
                  style={{ "--dot-color": tone.text }}
                />
                {index < items.length - 1 ? <span className="class-schedule-public__line" /> : null}
              </div>
              <div className="class-schedule-public__card">
                <div className="class-schedule-public__card-top">
                  <strong>{session.sessionNumber}회차 / {formatKoreanDate(session.date)}</strong>
                  <span style={{ color: tone.text }}>
                    {session.progressStatus === "done"
                      ? "완료"
                      : session.progressStatus === "partial"
                        ? "진행"
                        : "예정"}
                  </span>
                </div>
                <p>계획: {formatRangeLabel(entry?.plan) || "미정"}</p>
                <p>실제: {formatRangeLabel(entry?.actual) || "아직 입력되지 않았습니다."}</p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
