import { useEffect, useMemo, useState } from 'react';
import { Badge, ListHeader, TextField } from '../ui/tds';
import useViewport from '../../hooks/useViewport';
import {
  calculateSchedulePlan,
  formatPlannerDateLabel,
  getProgressBadgeLabel,
  getProgressTone,
  getStateBadgeLabel,
  normalizeSchedulePlan,
} from '../../lib/classSchedulePlanner';

function hasRangeContent(range = {}) {
  return Boolean(
    String(range?.start || '').trim() ||
      String(range?.end || '').trim() ||
      String(range?.label || '').trim() ||
      String(range?.memo || '').trim() ||
      String(range?.publicNote || '').trim() ||
      String(range?.teacherNote || '').trim()
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

function ProgressStatusButtons({ value, onChange }) {
  const statuses = [
    { value: 'pending', label: '예정' },
    { value: 'partial', label: '진행 중' },
    { value: 'done', label: '완료' },
  ];

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {statuses.map((status) => {
        const active = value === status.value;
        const tone = getProgressTone(status.value);

        return (
          <button
            key={status.value}
            type="button"
            className={active ? 'btn-primary' : 'btn-secondary'}
            onClick={() => onChange(status.value)}
            style={{
              minHeight: 32,
              padding: '0 12px',
              borderRadius: 999,
              border: active ? 'none' : `1px solid ${tone.background}`,
              background: active ? tone.color : tone.background,
              color: active ? '#fff' : tone.color,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {status.label}
          </button>
        );
      })}
    </div>
  );
}

function TextbookEntryEditor({
  entry,
  mode,
  session,
  plannerTextbooks,
  textbooksCatalog,
  onEntryChange,
}) {
  const title = getTextbookTitle(entry, plannerTextbooks, textbooksCatalog);
  const planValue = entry.plan || {};
  const actualValue = entry.actual || {};

  const activeRange = mode === 'plan' ? planValue : actualValue;
  const helperText =
    mode === 'plan'
      ? '계획 범위, 표시 문구, 메모를 차시별로 정리합니다.'
      : '실제 진도, 공개 메모, 내부 메모를 나눠 기록합니다.';

  return (
    <div
      style={{
        borderRadius: 20,
        border: '1px solid var(--border-color)',
        background: 'var(--bg-surface)',
        padding: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      <ListHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{title}</strong>
            <Badge
              size="small"
              type={entry.role === 'main' ? 'blue' : 'teal'}
              badgeStyle="weak"
            >
              {entry.role === 'main' ? '대표 교재' : '보조 교재'}
            </Badge>
            {mode === 'actual' ? (
                <Badge
                  size="small"
                  type={actualValue.status === 'done' ? 'blue' : actualValue.status === 'partial' ? 'amber' : 'teal'}
                  badgeStyle="weak"
                >
                {getProgressBadgeLabel(actualValue.status)}
              </Badge>
            ) : null}
          </div>
        }
        lower={helperText}
      />

      {mode === 'actual' ? (
        <ProgressStatusButtons
          value={actualValue.status || 'pending'}
          onChange={(status) =>
            onEntryChange({
              actual: {
                ...actualValue,
                status,
                updatedAt: new Date().toISOString(),
              },
            })
          }
        />
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <TextField
          label={mode === 'plan' ? '시작 범위' : '실제 시작'}
          value={activeRange.start || ''}
          placeholder={mode === 'plan' ? '12' : '12'}
          onChangeText={(value) =>
            onEntryChange({
              [mode]: {
                ...activeRange,
                start: value,
                ...(mode === 'actual' ? { updatedAt: new Date().toISOString() } : {}),
              },
            })
          }
        />
        <TextField
          label={mode === 'plan' ? '종료 범위' : '실제 종료'}
          value={activeRange.end || ''}
          placeholder={mode === 'plan' ? '19' : '15'}
          onChangeText={(value) =>
            onEntryChange({
              [mode]: {
                ...activeRange,
                end: value,
                ...(mode === 'actual' ? { updatedAt: new Date().toISOString() } : {}),
              },
            })
          }
        />
        <TextField
          label={mode === 'plan' ? '표시 문구' : '진도 요약'}
          value={activeRange.label || ''}
          placeholder={mode === 'plan' ? 'Unit 1-2' : '기본 문법 1~3'}
          onChangeText={(value) =>
            onEntryChange({
              [mode]: {
                ...activeRange,
                label: value,
                ...(mode === 'actual' ? { updatedAt: new Date().toISOString() } : {}),
              },
            })
          }
        />
      </div>

      <TextField
        as="textarea"
        label={mode === 'plan' ? '계획 메모' : '공개 메모'}
        value={mode === 'plan' ? planValue.memo || '' : actualValue.publicNote || ''}
        placeholder={
          mode === 'plan'
            ? '해당 차시에 고객이 보게 될 계획 메모를 적어 주세요.'
            : '고객에게 공개될 진도 요약을 기록해 주세요.'
        }
        onChangeText={(value) =>
          onEntryChange({
            [mode]: {
              ...activeRange,
              ...(mode === 'plan'
                ? { memo: value }
                : { publicNote: value, updatedAt: new Date().toISOString() }),
            },
          })
        }
        style={{ minHeight: 88 }}
      />

      {mode === 'actual' ? (
        <TextField
          as="textarea"
          label="내부 메모"
          value={actualValue.teacherNote || ''}
          placeholder="선생님/관리자만 볼 메모를 기록해 주세요."
          onChangeText={(value) =>
            onEntryChange({
              actual: {
                ...actualValue,
                teacherNote: value,
                updatedAt: new Date().toISOString(),
              },
            })
          }
          style={{ minHeight: 88 }}
        />
      ) : null}

      {!hasRangeContent(activeRange) && mode === 'plan' ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          아직 입력된 계획 진도가 없습니다.
        </div>
      ) : null}
      {!hasRangeContent(activeRange) && mode === 'actual' && actualValue.status === 'pending' ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          아직 실진도 입력 전입니다.
        </div>
      ) : null}
    </div>
  );
}

export default function ClassScheduleProgressEditor({
  value,
  className,
  subject,
  schedule,
  startDate,
  endDate,
  onPlanChange,
  mode = 'plan',
  compact = false,
  textbooksCatalog = [],
  textbookIds = [],
}) {
  const { isCompact } = useViewport();
  const [activeSessionId, setActiveSessionId] = useState('');
  const planner = useMemo(
    () =>
      normalizeSchedulePlan(value, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
        textbookIds,
        textbooks: textbooksCatalog,
      }),
    [className, endDate, schedule, startDate, subject, textbookIds, textbooksCatalog, value]
  );
  const calculation = useMemo(() => calculateSchedulePlan(planner), [planner]);
  const activeSession = useMemo(
    () => (calculation.sessions || []).find((session) => session.id === activeSessionId) || calculation.sessions?.[0] || null,
    [activeSessionId, calculation.sessions]
  );

  useEffect(() => {
    if (!calculation.sessions?.length) {
      setActiveSessionId('');
      return;
    }

    if (!activeSessionId || !calculation.sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(calculation.sessions[0].id);
    }
  }, [activeSessionId, calculation.sessions]);

  const commitPlan = (nextPlan) => {
    onPlanChange?.(
      normalizeSchedulePlan(nextPlan, {
        className,
        subject,
        schedule,
        startDate,
        endDate,
        textbookIds,
        textbooks: textbooksCatalog,
      })
    );
  };

  const updateEntry = (sessionId, textbookId, patch) => {
    const nextSessions = (planner.sessions || []).map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      return {
        ...session,
        textbookEntries: (session.textbookEntries || []).map((entry) => {
          if (entry.textbookId !== textbookId) {
            return entry;
          }

          return {
            ...entry,
            ...patch,
          };
        }),
      };
    });

    commitPlan({ ...planner, sessions: nextSessions });
  };

  const updateSessionMeta = (sessionId, patch) => {
    const nextSessions = (planner.sessions || []).map((session) =>
      session.id === sessionId ? { ...session, ...patch } : session
    );

    commitPlan({ ...planner, sessions: nextSessions });
  };

  if ((planner.textbooks || []).length === 0) {
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
        상단 `교재 연결` 영역에서 한 권 이상의 교재를 연결해 주세요. 선택한 교재가 이 탭의 차시별
        계획/실진도 입력 기준이 됩니다.
      </div>
    );
  }

  if ((calculation.sessions || []).length === 0) {
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
        먼저 `일정` 탭에서 청구월 기준 차시를 생성해 주세요. 차시가 생기면 각 회차별로 교재 진도를
        바로 입력할 수 있습니다.
      </div>
    );
  }

  const renderSessionDetail = (session) => {
    if (!session) {
      return null;
    }

    const progressTone = getProgressTone(session.progressStatus);

    return (
      <div
        style={{
          borderRadius: 24,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-surface-hover)',
          padding: 16,
          display: 'grid',
          gap: 16,
        }}
      >
        <ListHeader
          upper={
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
          }
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 17 }}>{formatPlannerDateLabel(session.date)}</strong>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{session.billingLabel}</span>
            </div>
          }
          lower={
            session.originalDate
              ? `원래 일정 ${formatPlannerDateLabel(session.originalDate)} 기준으로 보강된 차시입니다.`
              : session.memo || ''
          }
        />

        <div style={{ display: 'grid', gap: 12 }}>
          {(session.textbookEntries || []).map((entry) => (
            <TextbookEntryEditor
              key={`${session.id}-${entry.textbookId}`}
              entry={entry}
              mode={mode}
              session={session}
              plannerTextbooks={planner.textbooks}
              textbooksCatalog={textbooksCatalog}
              onEntryChange={(patch) => updateEntry(session.id, entry.textbookId, patch)}
            />
          ))}
        </div>

        {mode === 'actual' ? (
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: isCompact ? '1fr' : 'repeat(2, minmax(0, 1fr))',
            }}
          >
            <TextField
              as="textarea"
              label="차시 공개 메모"
              value={session.publicNote || ''}
              placeholder="고객 화면에 보일 차시 요약을 적어 주세요."
              onChangeText={(publicNote) => updateSessionMeta(session.id, { publicNote })}
              style={{ minHeight: 88 }}
            />
            <TextField
              as="textarea"
              label="차시 내부 메모"
              value={session.teacherNote || ''}
              placeholder="관리자/선생님용 차시 메모를 기록해 주세요."
              onChangeText={(teacherNote) => updateSessionMeta(session.id, { teacherNote })}
              style={{ minHeight: 88 }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div data-testid={`class-plan-progress-editor-${mode}`} style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isCompact ? '1fr' : 'repeat(3, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <div className="planner-inline-stat">
          <span>연결 교재</span>
          <strong>{planner.textbooks.length}권</strong>
        </div>
        <div className="planner-inline-stat">
          <span>생성된 차시</span>
          <strong>{calculation.sessions.length}회</strong>
        </div>
        <div className="planner-inline-stat">
          <span>{mode === 'plan' ? '계획 입력' : '실진도 입력'}</span>
          <strong>
            {calculation.sessions.filter((session) =>
              (session.textbookEntries || []).some((entry) =>
                mode === 'plan' ? hasRangeContent(entry.plan) : hasRangeContent(entry.actual) || entry.actual?.status !== 'pending'
              )
            ).length}
            회
          </strong>
        </div>
      </div>

      <div
        className="class-plan-progress-workspace"
        style={{
          display: 'grid',
          gridTemplateColumns: isCompact ? '1fr' : 'minmax(220px, 260px) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div
          className="class-plan-progress-session-nav"
          style={{
            display: 'grid',
            gap: 8,
            alignContent: 'start',
          }}
        >
          {calculation.sessions.map((session) => {
            const selected = session.id === activeSession?.id;
            const progressTone = getProgressTone(session.progressStatus);
            return (
              <button
                key={session.id}
                type="button"
                className="class-plan-progress-session-nav-item"
                onClick={() => setActiveSessionId(session.id)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 18,
                  border: selected ? `1px solid ${progressTone.color}` : '1px solid var(--border-color)',
                  background: selected ? `${progressTone.background}` : 'var(--bg-surface)',
                  display: 'grid',
                  gap: 6,
                  boxShadow: selected ? '0 10px 24px rgba(15, 23, 42, 0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    {session.sessionNumber ? `${session.sessionNumber}회차` : '예외 일정'}
                  </strong>
                  <span style={{ fontSize: 11, fontWeight: 800, color: progressTone.color }}>
                    {getProgressBadgeLabel(session.progressStatus)}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatPlannerDateLabel(session.date)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{getStateBadgeLabel(session.scheduleState)}</span>
              </button>
            );
          })}
        </div>

        <div className="class-plan-progress-session-detail">{renderSessionDetail(activeSession)}</div>
      </div>
    </div>
  );
}
