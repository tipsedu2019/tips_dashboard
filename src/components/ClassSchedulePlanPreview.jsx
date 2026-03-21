import { useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, Plus } from 'lucide-react';
import { exportElementAsImage } from '../lib/exportAsImage';
import useViewport from '../hooks/useViewport';
import {
  DAY_OPTIONS,
  calculateSchedulePlan,
  formatPlannerDateLabel,
  getFullClassName,
  getStateBadgeLabel,
  getStateTone,
  parseDateValue,
} from '../lib/classSchedulePlanner';

const CALENDAR_DAY_HEADERS = ['일', '월', '화', '수', '목', '금', '토'];
const HIDE_ADJACENT_DAY_VARIANTS = new Set(['public-detail', 'editor-summary']);

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
    cells.push({ date: new Date(year, month + 1, nextIndex), isCurrentMonth: false });
  }

  return cells;
}

function getPrimarySession(entries = []) {
  if (entries.length === 0) {
    return null;
  }

  return entries.find((entry) => entry.state !== 'makeup') || entries[0];
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
      const periodSessions = [...(sessionsByBillingId.get(period.id) || [])].sort((left, right) => {
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
        billingLabel: period.label || periodSessions[0]?.billingLabel || '청구월 미설정',
        billingColor: period.color || periodSessions[0]?.billingColor || '#216e4e',
        sessions: periodSessions,
      };
    })
    .filter(Boolean);
}

function getSelectedDayLabel(plan) {
  if (!plan?.selectedDays?.length) {
    return '요일 미설정';
  }

  const labels = plan.selectedDays
    .map((value) => DAY_OPTIONS.find((item) => item.value === value)?.label)
    .filter(Boolean);

  return labels.length ? labels.join(' · ') : '요일 미설정';
}

function buildPreviewBadges(calculation, selectedDayLabel) {
  const badges = [
    {
      key: 'days',
      label: `선택 요일 ${selectedDayLabel}`,
      tone: 'neutral',
    },
  ];

  (calculation.billingPeriods || []).forEach((period) => {
    badges.push({
      key: `period-${period.id}`,
      label: `${period.label} ${period.totalSessions || 0}회`,
      tone: 'period',
      color: period.color,
    });
  });

  ['exception', 'tbd', 'makeup'].forEach((state) => {
    badges.push({
      key: `state-${state}`,
      label: getStateBadgeLabel(state),
      tone: state,
    });
  });

  return badges;
}

function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'class-plan';
}

function PreviewBadge({ badge }) {
  const tone = badge.tone === 'period'
    ? {
        background: `${badge.color || '#216e4e'}18`,
        color: badge.color || '#216e4e',
      }
    : badge.tone === 'neutral'
      ? {
          background: 'rgba(15, 23, 42, 0.06)',
          color: '#334155',
        }
      : getStateTone(badge.tone);

  return (
    <span
      className="class-plan-preview-badge"
      style={{
        background: tone.background,
        color: tone.color,
      }}
    >
      {badge.label}
    </span>
  );
}

function SessionStatePill({ state }) {
  const tone = getStateTone(state);

  return (
    <span
      className="class-plan-session-state-pill"
      style={{
        background: tone.background,
        color: tone.color,
      }}
    >
      {getStateBadgeLabel(state)}
    </span>
  );
}

function SessionMeta({ session }) {
  return (
    <>
      {session.memo ? (
        <div className="class-plan-session-note">{session.memo}</div>
      ) : null}
      {session.state === 'exception' && session.makeupDate ? (
        <div className="class-plan-session-note is-makeup">보강 {formatPlannerDateLabel(session.makeupDate)}</div>
      ) : null}
      {session.state === 'makeup' && session.originalDate ? (
        <div className="class-plan-session-note is-cancelled">{formatPlannerDateLabel(session.originalDate)} 휴강 보강</div>
      ) : null}
    </>
  );
}

function MonthCard({
  month,
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
  variant = 'editor-summary',
}) {
  const cells = useMemo(() => buildMonthCells(month.year, month.month), [month.month, month.year]);
  const showAdjacentDayNumbers = !HIDE_ADJACENT_DAY_VARIANTS.has(variant);

  return (
    <div className={`class-plan-month-card ${compact ? 'is-compact' : ''}`}>
      <div className="class-plan-month-heading">{month.year}년 {month.month + 1}월</div>

      <div className="class-plan-month-grid">
        {CALENDAR_DAY_HEADERS.map((dayLabel) => (
          <div key={`${month.year}-${month.month}-${dayLabel}`} className="class-plan-month-weekday">
            {dayLabel}
          </div>
        ))}

        {cells.map((cell) => {
          const dateKey = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`;
          const sessionEntries = sessionsByDate.get(dateKey) || [];
          const primarySession = getPrimarySession(sessionEntries);
          const hasSession = Boolean(primarySession);
          const isDragSource = dragSource === dateKey;
          const isDropTarget = dropTarget === dateKey;
          const canShowAddHint = interactive && cell.isCurrentMonth && !hasSession;
          const tone = hasSession ? getStateTone(primarySession.state) : null;
          const CellTag = interactive ? 'button' : 'div';
          const dayNumber = cell.isCurrentMonth || showAdjacentDayNumbers ? String(cell.date.getDate()) : '';

          return (
            <CellTag
              key={`${month.year}-${month.month}-${dateKey}`}
              {...(interactive ? { type: 'button' } : {})}
              draggable={interactive && Boolean(primarySession) && primarySession.state !== 'makeup'}
              onDragStart={(event) => {
                if (!interactive || !primarySession || primarySession.state === 'makeup') {
                  return;
                }
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', dateKey);
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
                event.dataTransfer.dropEffect = 'move';
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
                const sourceDate = event.dataTransfer.getData('text/plain');
                setDropTarget(null);
                setDragSource(null);
                if (sourceDate && sourceDate !== dateKey) {
                  onSubstitution(sourceDate, dateKey);
                }
              }}
              onClick={() => {
                if (!interactive || !onToggleDate || primarySession?.state === 'makeup') {
                  return;
                }
                onToggleDate(dateKey, {
                  hasSession,
                  hasBaseSession: selectedDays.includes(cell.date.getDay()),
                  isMakeup: primarySession?.state === 'makeup',
                });
              }}
              className={[
                'class-plan-day-cell',
                cell.isCurrentMonth ? 'is-current-month' : 'is-adjacent-month',
                hasSession ? 'is-filled' : '',
                isDropTarget ? 'is-drop-target' : '',
                isDragSource ? 'is-drag-source' : '',
                interactive ? 'is-interactive' : '',
              ].filter(Boolean).join(' ')}
              style={{
                ...(tone ? {
                  '--class-plan-cell-fill': tone.background,
                  '--class-plan-cell-text': tone.color,
                } : {}),
              }}
            >
              <div className="class-plan-day-number">{dayNumber}</div>
              <div className="class-plan-day-entry class-plan-day-entry-stack">
                {primarySession?.sessionNumber ? (
                  <>
                    <span className="class-plan-day-session-dot" />
                    <span className="class-plan-day-session-num">{primarySession.sessionNumber}</span>
                  </>
                ) : canShowAddHint ? (
                  <span className="class-plan-day-add-hint" aria-hidden="true">
                    <Plus size={compact ? 10 : 12} />
                  </span>
                ) : null}
              </div>
            </CellTag>
          );
        })}
      </div>
    </div>
  );
}

function SessionCards({ group, variant }) {
  const isPublicDetail = variant === 'public-detail';

  return (
    <section className="class-plan-session-group" key={group.key}>
      {!isPublicDetail && (
        <header className="class-plan-session-group-header">
          <strong>{group.label}</strong>
          <span>{group.billingLabel}</span>
        </header>
      )}
      <div className="class-plan-session-cards-grid">
        {group.sessions.map((session) => (
          <article
            key={`${group.key}-${session.date}-${session.originalDate || 'base'}-${session.sessionNumber || 'na'}`}
            className="class-plan-session-card"
          >
            {isPublicDetail ? (
              <>
                <div className="class-plan-session-card-single-row">
                  <div className="class-plan-session-info-group">
                    <span className="class-plan-session-billing">
                      <span
                        className="class-plan-session-billing-dot"
                        style={{ background: group.billingColor || session.billingColor || '#216e4e' }}
                      />
                      {group.billingLabel}
                    </span>
                    <span className="class-plan-session-divider">·</span>
                    <strong className="class-plan-session-meta-number">
                      {session.sessionNumber ? `${session.sessionNumber}회` : '예외 일정'}
                    </strong>
                    <span className="class-plan-session-divider">·</span>
                    <span className="class-plan-session-date-inline">
                      {formatPlannerDateLabel(session.date)}
                    </span>
                  </div>
                  <SessionStatePill state={session.state} />
                </div>
                <SessionMeta session={session} />
              </>
            ) : (
              <>
                <div className="class-plan-session-card-top">
                  <span className="class-plan-session-billing">
                    <span
                      className="class-plan-session-billing-dot"
                      style={{ background: group.billingColor || session.billingColor || '#216e4e' }}
                    />
                    {group.billingLabel}
                  </span>
                  <SessionStatePill state={session.state} />
                </div>
                <strong className="class-plan-session-date">{formatPlannerDateLabel(session.date)}</strong>
                <div className="class-plan-session-card-meta">
                  <span>{session.sessionNumber ? `${session.sessionNumber}회차` : '예외 일정'}</span>
                </div>
                <SessionMeta session={session} />
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function SessionTable({ group, compact }) {
  return (
    <section className="class-plan-session-group" key={group.key}>
      <header className="class-plan-session-group-header is-desktop">
        <strong>{group.label}</strong>
        <span>{group.billingLabel}</span>
      </header>
      <div className="class-plan-session-table-head" style={{ gridTemplateColumns: compact ? '72px 56px 1fr auto' : '76px 64px 1fr auto' }}>
        <div>청구월</div>
        <div>회차</div>
        <div>수업일</div>
        <div>상태</div>
      </div>
      <div className="class-plan-session-table-body">
        {group.sessions.map((session) => (
          <div
            key={`${group.key}-${session.date}-${session.originalDate || 'base'}-${session.sessionNumber || 'na'}`}
            className="class-plan-session-row"
            style={{ gridTemplateColumns: compact ? '72px 56px 1fr auto' : '76px 64px 1fr auto' }}
          >
            <div className="class-plan-session-billing">
              <span
                className="class-plan-session-billing-dot"
                style={{ background: group.billingColor || session.billingColor || '#216e4e' }}
              />
              {group.billingLabel}
            </div>
            <div className="class-plan-session-number">{session.sessionNumber ? `${session.sessionNumber}회` : '-'}</div>
            <div className="class-plan-session-date-wrap">
              <strong className="class-plan-session-date">{formatPlannerDateLabel(session.date)}</strong>
              <SessionMeta session={session} />
            </div>
            <div className="class-plan-session-state-wrap">
              <SessionStatePill state={session.state} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionList({ groups, isCompact, variant }) {
  if (!groups.length) {
    return null;
  }

  if (isCompact) {
    return (
      <div className="class-plan-session-stack" data-testid="class-plan-session-list">
        {variant !== 'public-detail' && (
          <div className="class-plan-session-panel-header">
            <strong>회차 목록</strong>
            <span>모바일 카드 보기</span>
          </div>
        )}
        {groups.map((group) => <SessionCards key={group.key} group={group} variant={variant} />)}
      </div>
    );
  }

  return (
    <aside className="class-plan-session-panel" data-testid="class-plan-session-list">
      <div className="class-plan-session-panel-header is-sticky">
        <strong>회차 목록</strong>
        <span>기간별 수업 구성</span>
      </div>
      <div className="class-plan-session-scroll">
        {groups.map((group) => <SessionTable key={group.key} group={group} compact={false} />)}
      </div>
    </aside>
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
  emptyMessage = '아직 생성한 수업 계획이 없습니다.',
  variant = 'editor-summary',
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
    [calculation.sessions]
  );
  const sessionGroups = useMemo(
    () => buildSessionGroups(calculation.sessions, calculation.billingPeriods),
    [calculation.billingPeriods, calculation.sessions]
  );
  const selectedDayLabel = useMemo(() => getSelectedDayLabel(plan), [plan]);
  const previewBadges = useMemo(
    () => buildPreviewBadges(calculation, selectedDayLabel),
    [calculation, selectedDayLabel]
  );
  const fullClassName = getFullClassName(subject, className) || className || '수업 계획';
  const isSummaryVariant = variant !== 'planner-editor';

  const handleExport = async () => {
    if (!allowExport || !exportRef.current || calculation.sessions.length === 0) {
      return;
    }

    const filename = `class-plan-${sanitizeFilePart(subject)}-${sanitizeFilePart(className)}.png`;

    await exportElementAsImage(exportRef.current, filename, {
      preset: 'a4-portrait',
      width: 794,
      padding: 20,
      scale: 4,
      backgroundColor: '#ffffff',
    });
  };

  return (
    <div
      className={`class-plan-preview class-plan-preview--${variant} ${isCompact ? 'is-compact' : ''}`}
      data-testid="class-plan-preview"
    >
      <div ref={exportRef} className={`class-plan-preview-surface ${isSummaryVariant ? 'is-summary' : ''}`}>
        <div className="class-plan-preview-header">
          <div className="class-plan-preview-copy">
            <span className="class-plan-preview-eyebrow">CLASS PLAN</span>
            <strong className="class-plan-preview-title">{fullClassName}</strong>
            <span className="class-plan-preview-subtitle">선택 요일 {selectedDayLabel}</span>
          </div>

          {allowExport ? (
            <button type="button" className="btn-secondary class-plan-export-button" onClick={handleExport} disabled={calculation.sessions.length === 0}>
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
          <div className={`class-plan-empty-state ${isSummaryVariant ? 'is-summary' : ''}`}>
            <CalendarDays size={24} />
            <strong>{emptyMessage}</strong>
            {variant === 'editor-summary' ? (
              <span>요일과 기간을 정하면 미리보기와 상세 시트에 같은 구조로 반영됩니다.</span>
            ) : null}
          </div>
        ) : (
          <div
            className={`class-plan-preview-layout ${isCompact ? 'is-mobile' : 'is-desktop'}`}
            data-testid="class-plan-preview-layout"
          >
            <div className="class-plan-month-stack">
              {calculation.months.map((month) => (
                <MonthCard
                  key={`${month.year}-${month.month}`}
                  month={month}
                  sessionsByDate={sessionsByDate}
                  selectedDays={plan?.selectedDays || []}
                  interactive={interactive}
                  onToggleDate={onToggleDate}
                  onSubstitution={onSubstitution}
                  dragSource={dragSource}
                  setDragSource={setDragSource}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                  compact={isCompact}
                  variant={variant}
                />
              ))}
            </div>

            <SessionList groups={sessionGroups} isCompact={isCompact || isMobile} variant={variant} />
          </div>
        )}
      </div>
    </div>
  );
}

export default ClassSchedulePlanPreview;
