import { useMemo } from 'react';
import { Badge, ListHeader } from './ui/tds';
import {
  calculateSchedulePlan,
  formatPlannerDateLabel,
  getProgressBadgeLabel,
  getProgressTone,
  getStateBadgeLabel,
  normalizeSchedulePlan,
} from '../lib/classSchedulePlanner';

function hasRangeContent(range = {}) {
  return Boolean(
    String(range?.start || '').trim() ||
      String(range?.end || '').trim() ||
      String(range?.label || '').trim() ||
      String(range?.memo || '').trim() ||
      String(range?.publicNote || '').trim()
  );
}

function getTextbookTitle(entry, plannerTextbooks, textbooksCatalog) {
  const matchedPlanTextbook = (plannerTextbooks || []).find((item) => item.textbookId === entry.textbookId);
  if (matchedPlanTextbook?.alias) {
    return matchedPlanTextbook.alias;
  }

  const matchedCatalog = (textbooksCatalog || []).find((item) => String(item?.id || '') === entry.textbookId);
  return matchedCatalog?.title || '연결 교재';
}

function formatRange(range = {}, mode = 'plan') {
  const label = String(range?.label || '').trim();
  const start = String(range?.start || '').trim();
  const end = String(range?.end || '').trim();
  const memo = String(mode === 'plan' ? range?.memo || '' : range?.publicNote || '').trim();

  const parts = [];
  if (label) {
    parts.push(label);
  }
  if (start || end) {
    parts.push([start, end].filter(Boolean).join(' - '));
  }
  if (memo) {
    parts.push(memo);
  }

  return parts.join(' · ');
}

export default function ClassScheduleProgressBoard({
  plan,
  className,
  subject,
  schedule,
  startDate,
  endDate,
  textbookIds = [],
  textbooksCatalog = [],
  mode = 'plan',
  title = '',
  description = '',
  emptyMessage = '',
  hidePendingActual = false,
  publicOnly = false,
}) {
  const planner = useMemo(
    () =>
      normalizeSchedulePlan(plan, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
        textbookIds,
        textbooks: textbooksCatalog,
      }),
    [className, endDate, plan, schedule, startDate, subject, textbookIds, textbooksCatalog]
  );
  const calculation = useMemo(() => calculateSchedulePlan(planner), [planner]);

  const sessions = useMemo(() => {
    return (calculation.sessions || []).filter((session) => {
      if (mode === 'plan') {
        return (session.textbookEntries || []).some((entry) => hasRangeContent(entry.plan));
      }

      const hasActual = (session.textbookEntries || []).some((entry) => hasRangeContent(entry.actual) || entry.actual?.status !== 'pending');
      if (!hidePendingActual) {
        return hasActual || session.progressStatus !== 'pending' || session.publicNote;
      }
      return hasActual || session.progressStatus !== 'pending' || session.publicNote;
    });
  }, [calculation.sessions, hidePendingActual, mode]);

  if (sessions.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          borderRadius: 20,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-surface-hover)',
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {title ? (
        <ListHeader
          title={<strong style={{ fontSize: 18 }}>{title}</strong>}
          lower={description || null}
        />
      ) : null}

      {sessions.map((session) => {
        const progressTone = getProgressTone(session.progressStatus);

        return (
          <section
            key={session.id}
            style={{
              borderRadius: 22,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
              padding: 16,
              display: 'grid',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Badge size="small" type="teal" badgeStyle="weak">
                    {session.sessionNumber ? `${session.sessionNumber}회차` : '예외 일정'}
                  </Badge>
                  <Badge size="small" type="blue" badgeStyle="weak">
                    {getStateBadgeLabel(session.scheduleState)}
                  </Badge>
                  <Badge
                    size="small"
                    type={session.progressStatus === 'done' ? 'blue' : session.progressStatus === 'partial' ? 'amber' : 'teal'}
                    badgeStyle="weak"
                    style={{ background: progressTone.background, color: progressTone.color }}
                  >
                    {getProgressBadgeLabel(session.progressStatus)}
                  </Badge>
                </div>
                <strong style={{ fontSize: 17 }}>{formatPlannerDateLabel(session.date)}</strong>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{session.billingLabel}</span>
              </div>

              {mode === 'actual' && session.publicNote ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 16,
                    background: 'rgba(37, 99, 235, 0.08)',
                    color: '#1d4ed8',
                    fontSize: 12,
                    lineHeight: 1.6,
                    maxWidth: 320,
                  }}
                >
                  {session.publicNote}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {(session.textbookEntries || []).map((entry) => {
                const range = mode === 'plan' ? entry.plan : entry.actual;
                const content = formatRange(range, mode);
                const isVisible = mode === 'plan'
                  ? hasRangeContent(entry.plan)
                  : hasRangeContent(entry.actual) || entry.actual?.status !== 'pending';

                if (!isVisible) {
                  return null;
                }

                return (
                  <div
                    key={`${session.id}-${entry.textbookId}`}
                    style={{
                      borderRadius: 18,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-surface-hover)',
                      padding: 14,
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{getTextbookTitle(entry, planner.textbooks, textbooksCatalog)}</strong>
                      {mode === 'actual' ? (
                        <Badge
                          size="small"
                          type={entry.actual?.status === 'done' ? 'blue' : entry.actual?.status === 'partial' ? 'amber' : 'teal'}
                          badgeStyle="weak"
                        >
                          {getProgressBadgeLabel(entry.actual?.status || 'pending')}
                        </Badge>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)' }}>
                      {content || (mode === 'plan' ? '계획 없음' : '기록 없음')}
                    </div>
                    {mode === 'actual' && !publicOnly && entry.actual?.teacherNote ? (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        내부 메모: {entry.actual.teacherNote}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
