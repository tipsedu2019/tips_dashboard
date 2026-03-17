import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, GripVertical, Plus, Save, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { classifyDataError, getUserFriendlyDataError } from '../../lib/dataErrorUtils';
import { ACTIVE_CLASS_STATUS, CLASS_STATUS_OPTIONS, PREPARING_CLASS_STATUS } from '../../lib/classStatus';
import useViewport from '../../hooks/useViewport';

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTerm(term = {}, index = 0) {
  return {
    id: term.id || createId(),
    academicYear: String(term.academicYear || term.academic_year || new Date().getFullYear()),
    name: term.name || '',
    status: term.status || ACTIVE_CLASS_STATUS,
    startDate: term.startDate || term.start_date || '',
    endDate: term.endDate || term.end_date || '',
    sortOrder: Number(term.sortOrder ?? term.sort_order ?? index),
    legacyOnly: Boolean(term.legacyOnly),
    localOnly: Boolean(term.localOnly),
  };
}

function FieldLabel({ children }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
      {children}
    </span>
  );
}

function LegacyBadge({ label }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: 'rgba(59, 130, 246, 0.1)',
        color: '#1d4ed8',
        fontSize: 11,
        fontWeight: 800,
      }}
    >
      <Sparkles size={12} />
      {label}
    </span>
  );
}

function TermCard({ term, index, totalCount, compact, onChange, onMove, onDelete }) {
  return (
    <div
      className="card-custom"
      style={{
        padding: compact ? 16 : 18,
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-surface-hover)',
              color: 'var(--text-muted)',
            }}
          >
            <GripVertical size={16} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
              {term.name || `새 학기 ${index + 1}`}
            </div>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(33, 110, 78, 0.1)',
                  color: 'var(--accent-color)',
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                {term.status}
              </span>
              {term.legacyOnly ? <LegacyBadge label="기존 수업에서 가져옴" /> : null}
              {term.localOnly ? <LegacyBadge label="브라우저에 임시 저장됨" /> : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="action-chip" onClick={() => onMove(-1)} disabled={index === 0}>
            위로
          </button>
          <button type="button" className="action-chip" onClick={() => onMove(1)} disabled={index === totalCount - 1}>
            아래로
          </button>
          <button type="button" className="action-chip" onClick={onDelete}>
            <Trash2 size={14} />
            삭제
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(110px, 0.7fr) minmax(220px, 1.1fr) minmax(180px, 0.9fr) minmax(180px, 0.9fr) minmax(180px, 0.9fr)',
          gap: 12,
        }}
      >
        <label style={{ display: 'grid', gap: 6 }}>
          <FieldLabel>학년도</FieldLabel>
          <input
            className="styled-input"
            value={term.academicYear}
            inputMode="numeric"
            placeholder="2026"
            onChange={(event) => onChange({ academicYear: event.target.value })}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <FieldLabel>학기명</FieldLabel>
          <input
            className="styled-input"
            value={term.name}
            placeholder="예: 2026년 1학기"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <FieldLabel>상태</FieldLabel>
          <select className="styled-input" value={term.status} onChange={(event) => onChange({ status: event.target.value })}>
            {CLASS_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <FieldLabel>시작일</FieldLabel>
          <input
            className="styled-input"
            type="date"
            value={term.startDate}
            onChange={(event) => onChange({ startDate: event.target.value })}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <FieldLabel>종료일</FieldLabel>
          <input
            className="styled-input"
            type="date"
            value={term.endDate}
            onChange={(event) => onChange({ endDate: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

export default function TermManagerModal({ open, terms = [], classes = [], onClose, dataService, onSaved }) {
  const toast = useToast();
  const { isMobile, isTablet } = useViewport();
  const [drafts, setDrafts] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [deletedTermIds, setDeletedTermIds] = useState([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextDrafts = [...(terms || [])]
      .map((term, index) => normalizeTerm(term, index))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ko'));

    setDrafts(nextDrafts.length > 0 ? nextDrafts : [normalizeTerm({ status: PREPARING_CLASS_STATUS }, 0)]);
    setDeletedTermIds([]);
  }, [open, terms]);

  const compact = isMobile || isTablet;
  const duplicateNameExists = useMemo(() => {
    const names = drafts.map((term) => term.name.trim()).filter(Boolean);
    return new Set(names).size !== names.length;
  }, [drafts]);

  const canSave = useMemo(() => {
    if (drafts.length === 0) {
      return false;
    }

    return drafts.every((term) => term.academicYear.trim() && term.name.trim() && term.status) && !duplicateNameExists;
  }, [drafts, duplicateNameExists]);

  if (!open) {
    return null;
  }

  const updateDraft = (id, patch) => {
    setDrafts((current) => current.map((term) => (term.id === id ? { ...term, ...patch } : term)));
  };

  const addTerm = () => {
    setDrafts((current) => [
      ...current,
      normalizeTerm({ status: PREPARING_CLASS_STATUS, sortOrder: current.length }, current.length),
    ]);
  };

  const moveDraft = (id, direction) => {
    setDrafts((current) => {
      const next = [...current];
      const index = next.findIndex((term) => term.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
        return current;
      }
      const [removed] = next.splice(index, 1);
      next.splice(targetIndex, 0, removed);
      return next.map((term, order) => ({ ...term, sortOrder: order }));
    });
  };

  const getLinkedClassCount = (term) => (
    (classes || []).filter((classItem) => (
      String(classItem.termId || classItem.term_id || '') === String(term.id || '')
      || String(classItem.period || '').trim() === String(term.name || '').trim()
    )).length
  );

  const removeDraft = (id) => {
    const target = drafts.find((term) => term.id === id);
    if (!target) {
      return;
    }

    if (getLinkedClassCount(target) > 0) {
      toast.info('이 학기에 연결된 수업이 있어 삭제할 수 없습니다. 먼저 수업의 학기를 변경해 주세요.');
      return;
    }

    const persistedTerm = terms.find((term) => term.id === id && !term.legacyOnly && !term.localOnly);
    if (persistedTerm) {
      setDeletedTermIds((current) => (current.includes(id) ? current : [...current, id]));
    }

    setDrafts((current) => {
      const next = current.filter((term) => term.id !== id).map((term, index) => ({ ...term, sortOrder: index }));
      return next.length > 0 ? next : [normalizeTerm({ status: PREPARING_CLASS_STATUS }, 0)];
    });
  };

  const handleSave = async () => {
    if (duplicateNameExists) {
      toast.info('학기명은 서로 다르게 입력해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      let persistedTerms = [];
      let usedPermissionFallback = false;

      try {
        if (deletedTermIds.length > 0) {
          await Promise.all(deletedTermIds.map((termId) => dataService.deleteClassTerm(termId)));
        }

        persistedTerms = await dataService.upsertClassTerms(
          drafts.map((term, index) => ({
            id: term.legacyOnly || term.localOnly ? null : term.id,
            academicYear: Number(term.academicYear) || new Date().getFullYear(),
            name: term.name.trim(),
            status: term.status,
            startDate: term.startDate || null,
            endDate: term.endDate || null,
            sortOrder: index,
          }))
        );
      } catch (error) {
        const classified = classifyDataError(error);
        if (classified.kind !== 'permission') {
          throw error;
        }
        usedPermissionFallback = true;
      }

      const savedTerms = (persistedTerms && persistedTerms.length > 0)
        ? persistedTerms
        : drafts.map((term, index) => ({
            ...term,
            id: term.legacyOnly || term.localOnly ? createId() : term.id,
            academicYear: Number(term.academicYear) || new Date().getFullYear(),
            name: term.name.trim(),
            sortOrder: index,
            legacyOnly: false,
            localOnly: true,
          }));

      const savedTermMap = Object.fromEntries((savedTerms || []).map((term) => [term.name, term]));
      const changedClasses = (classes || []).filter((classItem) => {
        const matchedTerm = savedTermMap[classItem.period] || savedTerms.find((term) => term.id === classItem.termId);
        if (!matchedTerm) {
          return false;
        }
        return classItem.termId !== matchedTerm.id || classItem.period !== matchedTerm.name;
      });

      if (persistedTerms && persistedTerms.length > 0 && changedClasses.length > 0) {
        await Promise.all(
          changedClasses.map((classItem) => {
            const matchedTerm = savedTermMap[classItem.period] || savedTerms.find((term) => term.id === classItem.termId);
            if (!matchedTerm) {
              return Promise.resolve();
            }
            return dataService.updateClass(classItem.id, {
              termId: matchedTerm.id,
              term_id: matchedTerm.id,
              period: matchedTerm.name,
            });
          })
        );
      }

      if (usedPermissionFallback) {
        toast.info('DB 쓰기 권한이 막혀 있어 이 브라우저에 임시 저장했습니다. Supabase RLS 정책을 열면 서버 저장으로 바로 전환됩니다.');
      } else if (persistedTerms && persistedTerms.length > 0) {
        toast.success('학기 정보를 저장했습니다.');
      } else {
        toast.info('학기 테이블이 없어 이 브라우저에 임시 저장했습니다. 기본 학기 필터와 수업 편집에서는 바로 사용할 수 있습니다.');
      }

      onSaved?.(savedTerms);
      onClose();
    } catch (error) {
      toast.error(`학기 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        padding: compact ? 14 : 24,
        background: 'rgba(15, 23, 42, 0.44)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        className="workspace-surface"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1180px, 100%)',
          maxHeight: '92vh',
          overflow: 'auto',
          padding: compact ? 20 : 28,
          display: 'grid',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <div className="view-header-icon" style={{ width: 48, height: 48, borderRadius: 16 }}>
                <Settings2 size={20} />
              </div>
              <div>
                <div className="view-header-eyebrow">학기 설정</div>
                <h2 style={{ margin: 0, fontSize: compact ? 24 : 30, fontWeight: 900, letterSpacing: '-0.04em' }}>학기 관리</h2>
              </div>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7, maxWidth: 760 }}>
              시간표와 수업 운영의 기준이 되는 학기명, 상태, 시작일과 종료일을 한 곳에서 관리합니다.
              class_terms 테이블이 아직 없으면 이 브라우저에 임시 저장되어 계속 사용할 수 있습니다.
            </p>
          </div>

          <button type="button" className="action-chip" onClick={onClose}>
            <X size={16} />
            닫기
          </button>
        </div>

        <div
          className="card-custom"
          style={{
            padding: compact ? 16 : 18,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            background: 'rgba(244, 247, 245, 0.92)',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
            <CalendarRange size={16} />
            정렬 순서대로 학기 필터와 화면 기본 순서가 반영됩니다.
          </div>
          <button type="button" className="action-pill" onClick={addTerm}>
            <Plus size={16} />
            학기 추가
          </button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {drafts.map((term, index) => (
            <TermCard
              key={term.id}
              term={term}
              index={index}
              totalCount={drafts.length}
              compact={compact}
              onChange={(patch) => updateDraft(term.id, patch)}
              onMove={(direction) => moveDraft(term.id, direction)}
              onDelete={() => removeDraft(term.id)}
            />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="action-chip" onClick={onClose}>
            취소
          </button>
          <button type="button" className="action-pill" onClick={handleSave} disabled={!canSave || isSaving}>
            <Save size={16} />
            {isSaving ? '저장 중...' : '학기 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
