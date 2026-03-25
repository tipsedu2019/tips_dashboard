import {
  PROGRESS_STATUS_ITEMS,
  buildInspectorSessionNavigator,
  formatKoreanDate,
  formatRangeLabel,
  getProgressTone,
  safeText,
} from "./classScheduleWorkspaceUtils.js";
import PublicClassVerticalTimeline from "./PublicClassVerticalTimeline";

function formatProgressLabel(status = "pending") {
  if (status === "done") return "완료";
  if (status === "partial") return "진행 중";
  return "예정";
}

function SessionButton({ session, active = false, onClick }) {
  const tone = getProgressTone(session.progressStatus);
  const planLabel = formatRangeLabel(session.textbookEntries?.[0]?.plan) || "계획 없음";

  return (
    <button
      type="button"
      className={`class-schedule-inspector__session-button${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      <div className="class-schedule-inspector__session-button-top">
        <strong>{session.sessionNumber}회차</strong>
        <span style={{ color: tone.text }}>{formatProgressLabel(session.progressStatus)}</span>
      </div>
      <span>{formatKoreanDate(session.date)}</span>
      <small>{planLabel}</small>
    </button>
  );
}

function SummaryMetric({ label, value, tone = "default" }) {
  return (
    <div className={`class-schedule-inspector__metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EntryButton({ entry, active = false, onClick }) {
  const label =
    safeText(entry?.textbookTitle) ||
    safeText(entry?.title) ||
    safeText(entry?.textbookName) ||
    safeText(entry?.textbookId);

  return (
    <button
      type="button"
      className={`class-schedule-inspector__entry-button${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {label || "교재"}
    </button>
  );
}

export default function ClassScheduleQuickProgressPopover({
  open = false,
  row = null,
  selectedSession = null,
  selectedEntry = null,
  draft,
  saveState = "idle",
  onClose,
  onSelectSession,
  onSelectEntry,
  onDraftChange,
  onOpenChecklist,
  onOpenBuilder,
  showClose = true,
}) {
  if (!open) {
    return null;
  }

  if (!row) {
    return (
      <aside className="class-schedule-inspector">
        <div className="class-schedule-inspector__header">
          <div className="class-schedule-inspector__header-copy">
            <span className="class-schedule-inspector__eyebrow">ACTUAL PROGRESS</span>
            <strong>수업을 선택해 주세요</strong>
          </div>
          {showClose ? (
            <button
              type="button"
              className="class-schedule-inspector__close"
              onClick={onClose}
            >
              닫기
            </button>
          ) : null}
        </div>
        <div className="class-schedule-empty-state">
          타임라인 막대나 표의 실제 셀을 누르면 바로 이 패널에서 진도를 기록할 수 있습니다.
        </div>
      </aside>
    );
  }

  const navigator = buildInspectorSessionNavigator(row.sessions || [], selectedSession?.id);
  const warningCount =
    Number(Boolean(row.warningSummary?.planDrift)) +
    Number(Boolean(row.warningSummary?.syncGap));
  const currentProgressTone = getProgressTone(
    draft?.status || selectedSession?.progressStatus || "pending",
  );
  const selectedPlanLabel = formatRangeLabel(selectedEntry?.plan) || "계획 없음";
  const draftActual = {
    status: draft?.status,
    label: draft?.rangeLabel,
    start: draft?.rangeStart,
    end: draft?.rangeEnd,
  };
  const selectedActualLabel =
    formatRangeLabel(draftActual) || formatRangeLabel(selectedEntry?.actual) || "아직 입력되지 않았습니다.";
  const selectedPublicNote = safeText(
    draft?.publicNote ?? selectedEntry?.actual?.publicNote,
  );
  const selectedTeacherNote = safeText(
    draft?.teacherNote ?? selectedEntry?.actual?.teacherNote,
  );
  const hasMultipleEntries = (selectedSession?.textbookEntries?.length || 0) > 1;

  return (
    <aside className="class-schedule-inspector">
      <div className="class-schedule-inspector__header">
        <div className="class-schedule-inspector__header-copy">
          <span className="class-schedule-inspector__eyebrow">ACTUAL PROGRESS</span>
          <strong>{row.classItem.className || row.classItem.name}</strong>
          <span className="class-schedule-inspector__subline">
            {row.classItem.subject} / {row.classItem.teacher || "교사 미지정"}
          </span>
        </div>
        {showClose ? (
          <button
            type="button"
            className="class-schedule-inspector__close"
            onClick={onClose}
          >
            닫기
          </button>
        ) : null}
      </div>

      <div className="class-schedule-inspector__metrics">
        <SummaryMetric label="전체 회차" value={`${navigator.totalSessions}회`} />
        <SummaryMetric label="완료" value={`${navigator.completedCount}회`} tone="blue" />
        <SummaryMetric label="진행 중" value={`${navigator.partialCount}회`} tone="green" />
        <SummaryMetric
          label="경고"
          value={`${warningCount}건`}
          tone={warningCount ? "amber" : "default"}
        />
      </div>

      <div className="class-schedule-inspector__selection-card">
        <div className="class-schedule-inspector__selection-header">
          <div className="class-schedule-inspector__selection-copy">
            <strong>
              {selectedSession
                ? `${selectedSession.sessionNumber}회차 / ${formatKoreanDate(selectedSession.date)}`
                : "회차를 선택해 주세요"}
            </strong>
            <span>
              {navigator.selectedIndex >= 0
                ? `${navigator.selectedIndex + 1} / ${navigator.totalSessions} 선택됨`
                : "선택된 회차 없음"}
            </span>
          </div>
          <div className="class-schedule-inspector__selection-actions">
            <button
              type="button"
              className="class-schedule-inspector__nav-button"
              disabled={!navigator.previousSession}
              onClick={() =>
                navigator.previousSession && onSelectSession(navigator.previousSession.id)
              }
            >
              이전
            </button>
            <button
              type="button"
              className="class-schedule-inspector__nav-button"
              disabled={!navigator.nextSession}
              onClick={() => navigator.nextSession && onSelectSession(navigator.nextSession.id)}
            >
              다음
            </button>
          </div>
        </div>

        <div className="class-schedule-inspector__selection-grid">
          <div className="class-schedule-inspector__selection-block">
            <span>계획</span>
            <strong>{selectedPlanLabel}</strong>
          </div>
          <div className="class-schedule-inspector__selection-block">
            <span>실제</span>
            <strong style={{ color: currentProgressTone.text }}>{selectedActualLabel}</strong>
          </div>
        </div>

        {row.warningSummary?.planDrift || row.warningSummary?.syncGap ? (
          <div className="class-schedule-inspector__notice">
            {row.warningSummary?.planDrift ? <span>{row.warningSummary.planDrift.message}</span> : null}
            {row.warningSummary?.syncGap ? <span>{row.warningSummary.syncGap.message}</span> : null}
          </div>
        ) : null}
      </div>

      <section className="class-schedule-inspector__section">
        <div className="class-schedule-inspector__section-head class-schedule-inspector__section-heading">
          <strong>회차 탐색</strong>
          <span>어느 뷰에서 선택해도 이 목록과 같은 회차가 유지됩니다.</span>
        </div>
        <div className="class-schedule-inspector__session-list">
          {(row.sessions || []).map((session) => (
            <SessionButton
              key={session.id}
              session={session}
              active={selectedSession?.id === session.id}
              onClick={() => onSelectSession(session.id)}
            />
          ))}
        </div>
      </section>

      <section className="class-schedule-inspector__section class-schedule-inspector__public-preview">
        <div className="class-schedule-inspector__section-head class-schedule-inspector__section-heading">
          <strong>공개 뷰 미리보기</strong>
          <span>학부모와 학생 화면에서 보일 회차 흐름을 같은 선택 상태로 확인합니다.</span>
        </div>
        <PublicClassVerticalTimeline
          row={row}
          selectedSessionId={selectedSession?.id || ""}
          compact
        />
      </section>

      {selectedSession && selectedEntry && draft ? (
        <section className="class-schedule-inspector__section class-schedule-inspector__section--editor">
          <div className="class-schedule-inspector__section-head class-schedule-inspector__section-heading">
            <strong>실제 진도 입력</strong>
            <span className={`class-schedule-inspector__save-state is-${saveState}`}>
              {saveState === "saving"
                ? "자동 저장 중..."
                : saveState === "saved"
                  ? "저장됨"
                  : saveState === "error"
                    ? "저장 실패"
                    : "변경 즉시 자동 저장"}
            </span>
          </div>

          {hasMultipleEntries ? (
            <div className="class-schedule-inspector__entry-strip">
              {(selectedSession.textbookEntries || []).map((entry) => (
                <EntryButton
                  key={`${selectedSession.id}:${entry.textbookId}`}
                  entry={entry}
                  active={selectedEntry?.textbookId === entry.textbookId}
                  onClick={() => onSelectEntry?.(entry.textbookId)}
                />
              ))}
            </div>
          ) : null}

          <div className="class-schedule-inspector__status-row">
            {PROGRESS_STATUS_ITEMS.map((item) => {
              const active = draft.status === item.value;
              const tone = getProgressTone(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`class-schedule-inspector__status-button${active ? " is-active" : ""}`}
                  style={{
                    "--status-bg": active ? tone.bg : "#ffffff",
                    "--status-text": active ? tone.text : "#344054",
                    "--status-border": active ? tone.border : "rgba(15, 23, 42, 0.08)",
                  }}
                  onClick={() => onDraftChange({ status: item.value })}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <label className="class-schedule-inspector__field">
            <span>실제 범위 라벨</span>
            <input
              value={draft.rangeLabel}
              onChange={(event) => onDraftChange({ rangeLabel: event.target.value })}
              placeholder="예: Lesson 3-4"
            />
          </label>

          <div className="class-schedule-inspector__field-grid">
            <label className="class-schedule-inspector__field">
              <span>시작</span>
              <input
                value={draft.rangeStart}
                onChange={(event) => onDraftChange({ rangeStart: event.target.value })}
                placeholder="예: 21"
              />
            </label>
            <label className="class-schedule-inspector__field">
              <span>끝</span>
              <input
                value={draft.rangeEnd}
                onChange={(event) => onDraftChange({ rangeEnd: event.target.value })}
                placeholder="예: 24"
              />
            </label>
          </div>

          <div className="class-schedule-inspector__note-preview">
            <div>
              <span>공개 메모 미리보기</span>
              <p>{selectedPublicNote || "아직 공개 메모가 없습니다."}</p>
            </div>
            <div>
              <span>교사 메모 미리보기</span>
              <p>{selectedTeacherNote || "아직 교사 메모가 없습니다."}</p>
            </div>
          </div>

          <label className="class-schedule-inspector__field">
            <span>공개 메모</span>
            <textarea
              value={draft.publicNote}
              onChange={(event) => onDraftChange({ publicNote: event.target.value })}
              rows={3}
            />
          </label>

          <label className="class-schedule-inspector__field">
            <span>교사 메모</span>
            <textarea
              value={draft.teacherNote}
              onChange={(event) => onDraftChange({ teacherNote: event.target.value })}
              rows={3}
            />
          </label>

          <div className="class-schedule-inspector__footer">
            <div className="class-schedule-inspector__footer-copy">
              <strong>상세 흐름 연결</strong>
              <span>체크리스트 편집이나 일정 설계로 바로 이어집니다.</span>
            </div>
            <div className="class-schedule-inspector__footer-actions">
              <button type="button" onClick={() => onOpenChecklist(row)}>
                상세 편집
              </button>
              <button type="button" onClick={() => onOpenBuilder(row)}>
                일정 설계
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
