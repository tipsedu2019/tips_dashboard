import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DAY_LABELS } from '../../data/sampleData';
import { CLASS_STATUS_OPTIONS } from '../../lib/classStatus';
import { normalizeClassroomText } from '../../lib/classroomUtils';
import { createQuickScheduleLine, ensureQuickScheduleLines } from '../../lib/quickClassSchedule';

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <strong style={{ color: 'var(--text-secondary)' }}>{label}</strong>
      <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{value || '-'}</span>
    </div>
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

function OptionPicker({
  label,
  value,
  options,
  onChange,
  allowCustom = false,
  searchable = false,
  customPlaceholder,
  customEnabled = false,
  onCustomEnabledChange,
}) {
  const [query, setQuery] = useState('');
  const filteredOptions = useMemo(() => {
    if (!query.trim()) {
      return options;
    }

    const normalizedQuery = query.trim().toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  return (
    <div className="dialog-field-block">
      <div className="dialog-field-header">
        <span className="dialog-field-label">{label}</span>
        {allowCustom && (
          <button
            type="button"
            className={`dialog-inline-toggle ${customEnabled ? 'active' : ''}`}
            onClick={() => onCustomEnabledChange(!customEnabled)}
          >
            {customEnabled ? '선택형으로 보기' : '직접 입력'}
          </button>
        )}
      </div>

      {customEnabled ? (
        <input
          type="text"
          className="styled-input"
          placeholder={customPlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className="dialog-option-panel">
          {searchable && options.length > 8 && (
            <input
              type="text"
              className="styled-input"
              placeholder={`${label} 빠르게 찾기`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <div className="dialog-option-list">
            {filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`dialog-option-button ${value === option ? 'active' : ''}`}
                onClick={() => onChange(option)}
              >
                {option}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="dialog-option-empty">표시할 선택지가 없습니다.</div>
            )}
          </div>
        </div>
      )}
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
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 1fr minmax(180px, 1.3fr) auto',
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
            <option key={day} value={day}>{day}</option>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            className="styled-input"
            list="quick-classroom-options"
            placeholder="예: 본관 7강"
            value={line.classroom}
            onChange={(event) => onChange(lineIndex, { classroom: normalizeClassroomText(event.target.value) })}
          />
          {classroomOptions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {classroomOptions.slice(0, 6).map((option) => (
                <button
                  key={`${line.id}-${option}`}
                  type="button"
                  className="dialog-chip"
                  onClick={() => onChange(lineIndex, { classroom: option })}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      </label>

      <button
        type="button"
        className="btn-icon"
        onClick={() => onRemove(lineIndex)}
        disabled={!canRemove}
        title={canRemove ? '이 일정 줄 삭제' : '최소 한 줄은 유지해야 합니다.'}
        style={{ marginBottom: 2 }}
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
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
  const [customMode, setCustomMode] = useState({
    subject: false,
    grade: false,
    teacher: false,
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    setCustomMode({
      subject: draft?.subject ? !(fieldOptions.subjects || []).includes(draft.subject) : false,
      grade: draft?.grade ? !(fieldOptions.grades || []).includes(draft.grade) : false,
      teacher: draft?.teacher ? !(fieldOptions.teachers || []).includes(draft.teacher) : false,
    });
  }, [draft, fieldOptions.grades, fieldOptions.subjects, fieldOptions.teachers, open]);

  if (!open) {
    return null;
  }

  const isCreate = mode === 'create';
  const warningBadges = [...new Map((warnings || []).map((warning) => [warning.type, warning.label])).values()];
  const scheduleLines = ensureQuickScheduleLines(draft?.scheduleLines || [], {
    day: summary.day,
    start: summary.start,
    end: summary.end,
    classroom: summary.fixedAxisLabel === '강의실' ? summary.fixedAxisValue : '',
  });

  const updateScheduleLine = (lineIndex, changes) => {
    const nextLines = scheduleLines.map((line, index) => (
      index === lineIndex ? { ...line, ...changes } : line
    ));
    onChange('scheduleLines', ensureQuickScheduleLines(nextLines));
  };

  const addScheduleLine = () => {
    const lastLine = scheduleLines[scheduleLines.length - 1] || createQuickScheduleLine();
    const nextLines = [...scheduleLines, createQuickScheduleLine({
      day: lastLine.day,
      start: lastLine.start,
      end: lastLine.end,
      classroom: lastLine.classroom,
    })];
    onChange('scheduleLines', ensureQuickScheduleLines(nextLines));
  };

  const removeScheduleLine = (lineIndex) => {
    if (scheduleLines.length <= 1) {
      return;
    }
    onChange('scheduleLines', ensureQuickScheduleLines(scheduleLines.filter((_, index) => index !== lineIndex)));
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
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="card-custom"
        style={{ width: '100%', maxWidth: isCreate ? 860 : 580, padding: 28, maxHeight: '88vh', overflow: 'auto' }}
      >
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
          {isCreate ? '빠른 수업 생성' : '시간표 이동 확인'}
        </h3>
        <p style={{ margin: '8px 0 20px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {isCreate
            ? '드래그한 범위를 시작점으로 사용합니다. 여러 요일과 시간, 강의실을 한 번에 추가할 수 있습니다.'
            : '이동할 시간과 축을 확인한 뒤 저장해 주세요.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SummaryRow label="기준 요일" value={summary.day} />
          <SummaryRow label="기준 시간" value={`${summary.start || '-'} ~ ${summary.end || '-'}`} />
          {summary.fixedAxisLabel && <SummaryRow label={summary.fixedAxisLabel} value={summary.fixedAxisValue} />}
          {!isCreate && summary.previousTime && <SummaryRow label="이전 시간" value={summary.previousTime} />}
        </div>

        {isCreate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 18 }}>
            <div className="dialog-field-block">
              <div className="dialog-field-label">수업명</div>
              <input
                type="text"
                className="styled-input"
                placeholder="예: 고1 영어 심화"
                value={draft.className || ''}
                onChange={(event) => onChange('className', event.target.value)}
              />
            </div>

            <OptionPicker
              label="과목"
              value={draft.subject || ''}
              options={fieldOptions.subjects || []}
              onChange={(value) => onChange('subject', value)}
              allowCustom
              customPlaceholder="직접 과목 입력"
              customEnabled={customMode.subject}
              onCustomEnabledChange={(value) => setCustomMode((current) => ({ ...current, subject: value }))}
            />

            <OptionPicker
              label="학년"
              value={draft.grade || ''}
              options={fieldOptions.grades || []}
              onChange={(value) => onChange('grade', value)}
              allowCustom
              customPlaceholder="예: 중3, 고1"
              customEnabled={customMode.grade}
              onCustomEnabledChange={(value) => setCustomMode((current) => ({ ...current, grade: value }))}
            />

            {needsTeacher && (
              <OptionPicker
                label="선생님"
                value={draft.teacher || ''}
                options={fieldOptions.teachers || []}
                onChange={(value) => onChange('teacher', value)}
                allowCustom
                searchable
                customPlaceholder="선생님 이름 직접 입력"
                customEnabled={customMode.teacher}
                onCustomEnabledChange={(value) => setCustomMode((current) => ({ ...current, teacher: value }))}
              />
            )}

            <div className="dialog-field-block">
              <div className="dialog-field-label">학기</div>
              <input
                type="text"
                className="styled-input"
                placeholder="예: 2026 봄학기"
                value={draft.period || ''}
                onChange={(event) => onChange('period', event.target.value)}
              />
            </div>

            <div className="dialog-field-block">
              <div className="dialog-field-label">운영 상태</div>
              <ChipGroup
                options={CLASS_STATUS_OPTIONS}
                value={draft.status || CLASS_STATUS_OPTIONS[0]}
                onChange={(value) => onChange('status', value)}
              />
            </div>

            <div className="dialog-field-block">
              <div className="dialog-field-header">
                <span className="dialog-field-label">수업 일정</span>
                <button type="button" className="btn-secondary" onClick={addScheduleLine}>
                  <Plus size={16} /> 요일 추가
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {scheduleLines.map((line, lineIndex) => (
                  <ScheduleRowEditor
                    key={line.id}
                    line={line}
                    lineIndex={lineIndex}
                    canRemove={scheduleLines.length > 1}
                    classroomOptions={fieldOptions.classrooms || []}
                    onChange={updateScheduleLine}
                    onRemove={removeScheduleLine}
                  />
                ))}
                <datalist id="quick-classroom-options">
                  {(fieldOptions.classrooms || []).map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>
        )}

        {!isCreate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
            <SummaryRow label="수업명" value={summary.className} />
            <SummaryRow label="변경 후 시간" value={summary.nextTime} />
            {summary.nextAxis && <SummaryRow label={summary.nextAxisLabel} value={summary.nextAxis} />}
            {summary.previousAxis && <SummaryRow label={summary.previousAxisLabel} value={summary.previousAxis} />}
          </div>
        )}

        {warnings.length > 0 && (
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
        )}

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
