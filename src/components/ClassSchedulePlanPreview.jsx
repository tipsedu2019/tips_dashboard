import { useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, Plus } from 'lucide-react';
import { exportElementAsImage } from '../lib/exportAsImage';
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
  const groups = [];
  const groupMap = new Map();
  const sessionsByBillingId = new Map();

  (sessions || []).forEach((session) => {
    if (!sessionsByBillingId.has(session.billingId)) {
      sessionsByBillingId.set(session.billingId, []);
    }
    sessionsByBillingId.get(session.billingId).push(session);
  });

  (billingPeriods || []).forEach((period) => {
    const periodSessions = [...(sessionsByBillingId.get(period.id) || [])].sort((left, right) => {
      const diff = new Date(left.date) - new Date(right.date);
      if (diff !== 0) {
        return diff;
      }
      return (left.sessionNumber || 0) - (right.sessionNumber || 0);
    });

    if (periodSessions.length === 0) {
      return;
    }

    const billingLabel = period.label || periodSessions[0]?.billingLabel || '청구월 미설정';
    const heading = getBillingHeading(period, periodSessions[0]);
    const key = `${heading}__${billingLabel}`;

    if (!groupMap.has(key)) {
      const nextGroup = {
        key,
        label: heading,
        billingLabel,
        billingColor: period.color || periodSessions[0]?.billingColor,
        sessions: [],
      };
      groupMap.set(key, nextGroup);
      groups.push(nextGroup);
    }

    groupMap.get(key).sessions.push(...periodSessions);
  });

  return groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((left, right) => {
        const diff = new Date(left.date) - new Date(right.date);
        if (diff !== 0) {
          return diff;
        }
        return (left.sessionNumber || 0) - (right.sessionNumber || 0);
      }),
    }))
    .filter((group) => group.sessions.length > 0);
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
}) {
  const cells = useMemo(() => buildMonthCells(month.year, month.month), [month.month, month.year]);

  return (
    <div
      className="card-custom"
      style={{
        padding: 12,
        borderRadius: 20,
        boxShadow: '0 14px 28px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
        {month.year}년 {month.month + 1}월
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 6,
        }}
      >
        {CALENDAR_DAY_HEADERS.map((dayLabel) => (
          <div
            key={dayLabel}
            style={{
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 800,
              color: 'var(--text-muted)',
              paddingBottom: 2,
            }}
          >
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

          let background = cell.isCurrentMonth ? 'var(--bg-surface)' : 'rgba(139, 157, 144, 0.08)';
          let color = cell.isCurrentMonth ? 'var(--text-primary)' : 'var(--text-muted)';
          let border = '1px solid transparent';

          if (primarySession) {
            if (primarySession.state === 'exception') {
              background = 'rgba(239, 68, 68, 0.12)';
              color = '#b91c1c';
            } else if (primarySession.state === 'tbd') {
              background = 'rgba(245, 158, 11, 0.14)';
              color = '#b45309';
            } else if (primarySession.state === 'makeup') {
              background = 'rgba(16, 185, 129, 0.14)';
              color = '#047857';
            } else {
              background = primarySession.billingColor;
              color = '#ffffff';
            }
            border = '1px solid rgba(0, 0, 0, 0.06)';
          } else if (isDropTarget) {
            background = 'rgba(33, 110, 78, 0.10)';
            border = '2px dashed var(--accent-color)';
          } else if (canShowAddHint) {
            border = '1px dashed rgba(33, 110, 78, 0.14)';
          }

          return (
            <button
              key={`${month.year}-${month.month}-${dateKey}`}
              type="button"
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
                if (!interactive || !onToggleDate) {
                  return;
                }
                if (primarySession?.state === 'makeup') {
                  return;
                }
                onToggleDate(dateKey, {
                  hasSession,
                  hasBaseSession: selectedDays.includes(cell.date.getDay()),
                  isMakeup: primarySession?.state === 'makeup',
                });
              }}
              style={{
                minHeight: 60,
                padding: '7px 8px',
                borderRadius: 16,
                border,
                background,
                color,
                textAlign: 'left',
                cursor: interactive ? (primarySession?.state === 'makeup' ? 'default' : 'pointer') : 'default',
                boxShadow: isDragSource ? '0 14px 30px rgba(0, 0, 0, 0.16)' : 'none',
                opacity: isDragSource ? 0.4 : cell.isCurrentMonth ? 1 : 0.72,
                transition: 'all 0.18s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>{cell.date.getDate()}</span>
                {primarySession?.sessionNumber ? (
                  <span
                    style={{
                      minWidth: 20,
                      height: 20,
                      borderRadius: 999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 900,
                      background: primarySession.state === 'active'
                        ? 'rgba(255, 255, 255, 0.22)'
                        : 'rgba(255, 255, 255, 0.72)',
                      color: primarySession.state === 'active' ? '#ffffff' : color,
                      flexShrink: 0,
                    }}
                  >
                    {primarySession.sessionNumber}
                  </span>
                ) : null}
              </div>

              {canShowAddHint ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    opacity: 0.55,
                  }}
                >
                  <Plus size={12} />
                </div>
              ) : (
                <div style={{ height: 14 }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
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
  emptyMessage = '아직 생성된 수업 일정표가 없습니다.',
}) {
  const exportRef = useRef(null);
  const [dragSource, setDragSource] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const calculation = useMemo(() => calculateSchedulePlan(plan), [plan]);
  const sessionsByDate = useMemo(() => {
    return calculation.sessions.reduce((result, session) => {
      const bucket = result.get(session.date) || [];
      bucket.push(session);
      result.set(session.date, bucket);
      return result;
    }, new Map());
  }, [calculation.sessions]);
  const sessionGroups = useMemo(
    () => buildSessionGroups(calculation.sessions, calculation.billingPeriods),
    [calculation.billingPeriods, calculation.sessions]
  );

  const fullClassName = getFullClassName(subject, className) || className || '수업 일정표';
  const selectedDayLabel = plan?.selectedDays?.length > 0
    ? plan.selectedDays
      .map((value) => DAY_OPTIONS.find((day) => day.value === value)?.label)
      .filter(Boolean)
      .join(' · ')
    : '미설정';

  const handleExport = async () => {
    if (!allowExport || !exportRef.current || calculation.sessions.length === 0) {
      return;
    }

    await exportElementAsImage(
      exportRef.current,
      `팁스영어수학학원 [${subject || '영어'}] ${className || '수업'}_수업 일정표.png`,
      {
        preset: 'a4-portrait',
        width: 794,
        padding: 20,
        scale: 4,
        backgroundColor: '#ffffff',
      }
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {allowExport ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>캘린더 뷰</div>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExport}
            disabled={calculation.sessions.length === 0}
          >
            <Download size={16} />
            이미지 저장
          </button>
        </div>
      ) : null}

      <div
        ref={exportRef}
        className="card-custom"
        style={{
          padding: 16,
          borderRadius: 24,
          background: '#ffffff',
          color: '#1e2920',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.3, color: '#216e4e' }}>
              TIPS DASHBOARD
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4, lineHeight: 1.15, wordBreak: 'keep-all' }}>
              {fullClassName}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#5a6b5e' }}>
              선택 요일: {selectedDayLabel}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(calculation.billingPeriods || []).map((period) => (
              <span
                key={period.id}
                style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
                background: `${period.color}18`,
                color: period.color,
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: period.color,
                  }}
                />
                {period.label}
              </span>
            ))}
            {['exception', 'tbd', 'makeup'].map((state) => {
              const tone = getStateTone(state);
              return (
                <span
                  key={state}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '7px 11px',
                    borderRadius: 999,
                    background: tone.background,
                    color: tone.color,
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {getStateBadgeLabel(state)}
                </span>
              );
            })}
          </div>
        </div>

        {calculation.sessions.length === 0 ? (
          <div
            style={{
              borderRadius: 22,
              border: '1px dashed rgba(33, 110, 78, 0.18)',
              background: '#f7faf8',
              padding: '40px 20px',
              textAlign: 'center',
              color: '#5a6b5e',
            }}
          >
            <CalendarDays size={28} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 800 }}>{emptyMessage}</div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.08fr) minmax(320px, 360px)',
              gap: 12,
              alignItems: 'start',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
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
                />
              ))}
            </div>

            <div
              className="card-custom"
              style={{
                borderRadius: 22,
                overflow: 'hidden',
                borderColor: 'rgba(30, 41, 32, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid rgba(30, 41, 32, 0.08)',
                  fontSize: 16,
                  fontWeight: 800,
                }}
              >
                회차 목록
              </div>

              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sessionGroups.map((group) => (
                  <div
                    key={group.key}
                    style={{
                      borderRadius: 16,
                      border: '1px solid rgba(30, 41, 32, 0.08)',
                      overflow: 'hidden',
                      background: '#ffffff',
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 12px',
                        background: '#f7faf8',
                        borderBottom: '1px solid rgba(30, 41, 32, 0.08)',
                        fontSize: 13,
                        fontWeight: 900,
                        color: '#2b4134',
                      }}
                    >
                      {group.label}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '72px 56px 92px auto',
                        gap: 8,
                        padding: '10px 12px 8px',
                        fontSize: 11,
                        fontWeight: 900,
                        color: '#5a6b5e',
                        borderBottom: '1px solid rgba(30, 41, 32, 0.08)',
                      }}
                    >
                      <div>청구월</div>
                      <div>회차</div>
                      <div>수업일</div>
                      <div>상태</div>
                    </div>

                    {group.sessions.map((session) => {
                      const tone = getStateTone(session.state);
                      return (
                        <div
                          key={`${group.key}-${session.billingId}-${session.date}-${session.originalDate || 'base'}`}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '72px 56px 92px auto',
                            gap: 8,
                            alignItems: 'start',
                            padding: '10px 12px',
                            borderBottom: '1px solid rgba(30, 41, 32, 0.06)',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#2b4134' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 999,
                                  background: group.billingColor || session.billingColor || '#216e4e',
                                  flexShrink: 0,
                                }}
                              />
                              <span>{group.billingLabel}</span>
                            </span>
                          </div>

                          <div style={{ fontSize: 12, fontWeight: 800, color: '#2b4134' }}>
                            {session.sessionNumber ? `${session.sessionNumber}회` : '-'}
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#1e2920', whiteSpace: 'nowrap' }}>
                              {formatPlannerDateLabel(session.date)}
                            </div>
                            {session.memo ? (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#5a6b5e', lineHeight: 1.45 }}>
                                {session.memo}
                              </div>
                            ) : null}
                            {session.state === 'exception' && session.makeupDate ? (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#047857', fontWeight: 700 }}>
                                보강: {formatPlannerDateLabel(session.makeupDate)}
                              </div>
                            ) : null}
                            {session.state === 'makeup' && session.originalDate ? (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#b91c1c', fontWeight: 700 }}>
                                {formatPlannerDateLabel(session.originalDate)} 휴강 보강
                              </div>
                            ) : null}
                          </div>

                          <div>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '6px 10px',
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 900,
                                background: tone.background,
                                color: tone.color,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {getStateBadgeLabel(session.state)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClassSchedulePlanPreview;
