import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DAY_LABELS } from '../../data/sampleData';
import { CLASS_STATUS_OPTIONS } from '../../lib/classStatus';
import { normalizeClassroomText } from '../../lib/classroomUtils';
import { createQuickScheduleLine, ensureQuickScheduleLines } from '../../lib/quickClassSchedule';

function SummaryRow({ label, value, emphasize = false }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '104px minmax(0, 1fr)',
        gap: 12,
        alignItems: 'start',
        fontSize: 13,
      }}
    >
      <strong style={{ color: 'var(--text-secondary)' }}>{label}</strong>
      <span
        style={{
          color: emphasize ? 'var(--accent-color)' : 'var(--text-primary)',
          fontWeight: emphasize ? 700 : 500,
        }}
      >
        {value || '-'}
      </span>
    </div>
  );
}

function ChangeRow({ label, from, to }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '104px minmax(0, 1fr)',
        gap: 12,
        alignItems: 'start',
        fontSize: 13,
      }}
    >
      <strong style={{ color: 'var(--text-secondary)' }}>{label}</strong>
      <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
        <span>{from || '-'}</span>
        <span style={{ margin: '0 8px', color: 'var(--accent-color)' }}>{'->'}</span>
        <span style={{ color: 'var(--accent-color)' }}>{to || '-'}</span>
      </div>
    </div>
  );
}

function SelectField({ label, value, options, onChange, placeholder }) {
  return (
    <label className="dialog-field-block">
      <span className="dialog-field-label">{label}</span>
      <select
        className="styled-select"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="dialog-field-block">
      <span className="dialog-field-label">{label}</span>
      <input
        type="text"
        className="styled-input"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function ChipGroup({ options, value, onChange }) {
  return (
    <div className="dialog-chip-group">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`dialog-chip ${value === option ? 'active' : ''}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function ScheduleRowEditor({
  line,
  lineIndex,
  canRemove,
  classroomOptions,
  onChange,
  onRemove,
}) {
  const visibleClassrooms = Array.from(new Set([line.classroom, ...classroomOptions].filter(Boolean)));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '96px 1fr 1fr minmax(180px, 1.2fr) auto',
        gap: 12,
        alignItems: 'end',
        padding: 14,
        borderRadius: 16,
        border: '1px solid var(--border-color)',
        background: 'var(--bg-base)',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        요일
        <select
          className="styled-select"
          value={line.day}
          onChange={(event) => onChange(lineIndex, { day: event.target.value })}
        >
          {DAY_LABELS.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        시작
        <input
          type="time"
          className="styled-input"
          value={line.start}
          onChange={(event) => onChange(lineIndex, { start: event.target.value })}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        종료
        <input
          type="time"
          className="styled-input"
          value={line.end}
          onChange={(event) => onChange(lineIndex, { end: event.target.value })}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        강의실
        <select
          className="styled-select"
          value={line.classroom || ''}
          onChange={(event) => onChange(lineIndex, { classroom: normalizeClassroomText(event.target.value) })}
        >
          <option value="">강의실 선택</option>
          {visibleClassrooms.map((option) => (
            <option key={`${line.id}-${option}`} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn-icon"
        onClick={() => onRemove(lineIndex)}
        disabled={!canRemove}
        title={canRemove ? '일정 줄 삭제' : '최소 한 줄은 남아 있어야 합니다.'}
        style={{ marginBottom: 2 }}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
}

function buildOptions(currentValue, options = []) {
  return Array.from(new Set([currentValue, ...options].filter(Boolean)));
}

export default function TimetableEditDialog({
  open,
  mode,
  draft,
  warnings = [],
  busy = false,
  onChange,
  onCancel,
  onConfirm,
  needsTeacher = false,
  summary = {},
  fieldOptions = {},
}) {
  const isCreate = mode === 'create';
  const warningBadges = [...new Map((warnings || []).map((warning) => [warning.type, warning.label])).values()];
  const scheduleLines = ensureQuickScheduleLines(draft?.scheduleLines || [], {
    day: summary.day,
    start: summary.start,
    end: summary.end,
    classroom: summary.fixedAxisLabel === '강의실' ? summary.fixedAxisValue : '',
  });

  const subjectOptions = useMemo(
    () => buildOptions(draft?.subject, fieldOptions.subjects || []),
    [draft?.subject, fieldOptions.subjects]
  );
  const gradeOptions = useMemo(
    () => buildOptions(draft?.grade, fieldOptions.grades || []),
    [draft?.grade, fieldOptions.grades]
  );
  const teacherOptions = useMemo(() => buildOptions(
    draft?.teacher,
    fieldOptions.teacherOptionsBySubject?.[draft?.subject || '']?.length
      ? fieldOptions.teacherOptionsBySubject[draft?.subject || '']
      : fieldOptions.teachers || []
  ), [draft?.subject, draft?.teacher, fieldOptions.teacherOptionsBySubject, fieldOptions.teachers]);
  const classroomOptions = useMemo(() => buildOptions(
    summary.fixedAxisLabel === '강의실' ? summary.fixedAxisValue : '',
    fieldOptions.classroomOptionsBySubject?.[draft?.subject || '']?.length
      ? fieldOptions.classroomOptionsBySubject[draft?.subject || '']
      : fieldOptions.classrooms || []
  ), [draft?.subject, fieldOptions.classroomOptionsBySubject, fieldOptions.classrooms, summary.fixedAxisLabel, summary.fixedAxisValue]);

  const changeRows = [
    summary.currentTime && summary.nextTime && summary.currentTime !== summary.nextTime
      ? { label: '요일/시간', from: summary.currentTime, to: summary.nextTime }
      : null,
    summary.currentTeacher && summary.nextTeacher && summary.currentTeacher !== summary.nextTeacher
      ? { label: '선생님', from: summary.currentTeacher, to: summary.nextTeacher }
      : null,
    summary.currentClassroom && summary.nextClassroom && summary.currentClassroom !== summary.nextClassroom
      ? { label: '강의실', from: summary.currentClassroom, to: summary.nextClassroom }
      : null,
  ].filter(Boolean);

  if (!open) {
    return null;
  }

  const updateScheduleLine = (lineIndex, changes) => {
    const nextLines = scheduleLines.map((line, index) => (
      index === lineIndex ? { ...line, ...changes } : line
    ));
    onChange('scheduleLines', ensureQuickScheduleLines(nextLines));
  };

  const addScheduleLine = () => {
    const lastLine = scheduleLines[scheduleLines.length - 1] || createQuickScheduleLine();
    const nextLines = [
      ...scheduleLines,
      createQuickScheduleLine({
        day: lastLine.day,
        start: lastLine.start,
        end: lastLine.end,
        classroom: lastLine.classroom,
      }),
    ];
    onChange('scheduleLines', ensureQuickScheduleLines(nextLines));
  };

  const removeScheduleLine = (lineIndex) => {
    if (scheduleLines.length <= 1) {
      return;
    }
    onChange('scheduleLines', ensureQuickScheduleLines(
      scheduleLines.filter((_, index) => index !== lineIndex)
    ));
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="card-custom"
        style={{
          width: '100%',
          maxWidth: isCreate ? 920 : 640,
          padding: 28,
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--bg-elevated)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
          {isCreate ? '새 수업 만들기' : '시간표 이동 확인'}
        </h3>
        <p style={{ margin: '8px 0 20px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {isCreate
            ? '선택한 시간 범위를 시작점으로 사용합니다. 여러 요일과 시간을 한 번에 정리할 수 있습니다.'
            : '현재 정보와 변경될 항목만 간단히 확인한 뒤 저장해 주세요.'}
        </p>

        {isCreate ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: needsTeacher ? '1.3fr 1fr 1fr' : '1.4fr 1fr 1fr',
                gap: 14,
              }}
            >
              <TextField
                label="수업명"
                value={draft?.className || ''}
                onChange={(value) => onChange('className', value)}
                placeholder="예: 고1 공통수학"
              />
              <SelectField
                label="과목"
                value={draft?.subject || ''}
                options={subjectOptions}
                onChange={(value) => onChange('subject', value)}
                placeholder="과목 선택"
              />
              <SelectField
                label="학년"
                value={draft?.grade || ''}
                options={gradeOptions}
                onChange={(value) => onChange('grade', value)}
                placeholder="학년 선택"
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: needsTeacher ? '1fr 1fr' : '1fr',
                gap: 14,
              }}
            >
              {needsTeacher ? (
                <SelectField
                  label="선생님"
                  value={draft?.teacher || ''}
                  options={teacherOptions}
                  onChange={(value) => onChange('teacher', value)}
                  placeholder="선생님 선택"
                />
              ) : null}

              <TextField
                label="학기"
                value={draft?.period || ''}
                onChange={(value) => onChange('period', value)}
                placeholder="예: 2026 봄학기"
              />
            </div>

            <div className="dialog-field-block">
              <span className="dialog-field-label">운영 상태</span>
              <ChipGroup
                options={CLASS_STATUS_OPTIONS}
                value={draft?.status || CLASS_STATUS_OPTIONS[0]}
                onChange={(value) => onChange('status', value)}
              />
            </div>

            <div className="dialog-field-block">
              <div className="dialog-field-header">
                <span className="dialog-field-label">수업 일정</span>
                <button type="button" className="btn-secondary" onClick={addScheduleLine}>
                  <Plus size={16} /> 일정 줄 추가
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {scheduleLines.map((line, lineIndex) => (
                  <ScheduleRowEditor
                    key={line.id}
                    line={line}
                    lineIndex={lineIndex}
                    canRemove={scheduleLines.length > 1}
                    classroomOptions={classroomOptions}
                    onChange={updateScheduleLine}
                    onRemove={removeScheduleLine}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SummaryRow label="수업명" value={summary.className} />
              <SummaryRow label="요일/시간" value={summary.currentTime} />
              <SummaryRow label="선생님" value={summary.currentTeacher} />
              <SummaryRow label="강의실" value={summary.currentClassroom} />
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 16,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-surface-hover)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>변경될 내용</div>
              {changeRows.length > 0 ? (
                changeRows.map((change) => (
                  <ChangeRow
                    key={`${change.label}-${change.from}-${change.to}`}
                    label={change.label}
                    from={change.from}
                    to={change.to}
                  />
                ))
              ) : (
                <SummaryRow label="안내" value="변경되는 항목이 없습니다." />
              )}
            </div>
          </div>
        )}

        {warnings.length > 0 ? (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 14,
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {warningBadges.map((badge) => (
                <span key={badge} className="dialog-warning-badge">
                  {badge}
                </span>
              ))}
            </div>
            {warnings.map((warning) => (
              <div key={warning.id || warning.message} style={{ fontSize: 12, color: '#92400e' }}>
                {warning.message || warning}
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={busy}>
            {isCreate ? '수업 생성' : '변경 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
