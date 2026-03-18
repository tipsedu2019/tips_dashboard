import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import BottomSheet from '../ui/BottomSheet';
import {
  SCHOOL_CATEGORY_OPTIONS,
  getGradesForSchoolCategory,
  normalizeSchoolCategory,
  schoolKey,
  sortSchoolsForManagement,
  text,
} from '../../lib/schoolConfig';

const DEFAULT_SCHOOL_COLOR = '#216e4e';

function moveInCategory(rows, category, index, direction) {
  const visibleIndexes = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter((item) => item.row.category === category);
  const current = visibleIndexes[index];
  const target = visibleIndexes[index + direction];
  if (!current || !target) {
    return rows;
  }
  const next = [...rows];
  const [removed] = next.splice(current.rowIndex, 1);
  const insertIndex = current.rowIndex < target.rowIndex ? target.rowIndex : target.rowIndex;
  next.splice(insertIndex, 0, removed);
  return next;
}

export default function SchoolCatalogManagerModal({
  open,
  schools = [],
  onClose,
  onSave,
  isSaving = false,
}) {
  const [activeCategory, setActiveCategory] = useState(SCHOOL_CATEGORY_OPTIONS[0].value);
  const [draftRows, setDraftRows] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftRows(sortSchoolsForManagement(schools).map((school) => ({
      id: school.id || '',
      name: school.name || '',
      category: normalizeSchoolCategory(school.category),
      color: school.color || DEFAULT_SCHOOL_COLOR,
      sortOrder: school.sortOrder ?? 0,
    })));
    setDeletedIds([]);
  }, [open, schools]);

  const visibleRows = useMemo(
    () => draftRows.filter((row) => row.category === activeCategory),
    [activeCategory, draftRows]
  );

  const hasInvalidRows = useMemo(() => {
    const normalizedNames = draftRows.map((row) => schoolKey(row.name)).filter(Boolean);
    return (
      draftRows.some((row) => !text(row.name)) ||
      new Set(normalizedNames).size !== normalizedNames.length
    );
  }, [draftRows]);

  const handleSave = async () => {
    if (hasInvalidRows || isSaving) {
      return;
    }

    const orderedRows = SCHOOL_CATEGORY_OPTIONS.flatMap((category) =>
      draftRows
        .filter((row) => row.category === category.value)
        .map((row, index) => ({
          ...row,
          name: text(row.name),
          category: category.value,
          color: row.color || DEFAULT_SCHOOL_COLOR,
          sortOrder: index,
        }))
    );

    await onSave?.(orderedRows, deletedIds);
  };

  if (!open) {
    return null;
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="학교 마스터 관리"
      subtitle="학교 구분별 학교 목록을 전역 기준으로 관리합니다. 학년은 학교 구분에 따라 자동으로 고정됩니다."
      maxWidth={860}
      actions={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <div className="academic-inline-state">
            {getGradesForSchoolCategory(activeCategory).join(' / ')}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="action-chip" onClick={onClose} disabled={isSaving}>
              닫기
            </button>
            <button type="button" className="action-pill" onClick={handleSave} disabled={hasInvalidRows || isSaving}>
              <Save size={16} />
              {isSaving ? '저장 중...' : '학교 저장'}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="h-segment-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {SCHOOL_CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`h-segment-btn ${activeCategory === option.value ? 'active' : ''}`}
              onClick={() => setActiveCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="academic-type-manager-add">
          <div className="academic-type-manager-add-field">
            <span className="academic-section-caption">학교 추가</span>
            <div className="academic-inline-state">선택한 학교 구분에 새 학교를 추가하고 순서를 정렬할 수 있습니다.</div>
          </div>
          <button
            type="button"
            className="action-pill"
            onClick={() => {
              setDraftRows((current) => [
                ...current,
                {
                  id: '',
                  name: '',
                  category: activeCategory,
                  color: DEFAULT_SCHOOL_COLOR,
                  sortOrder: visibleRows.length,
                },
              ]);
            }}
            disabled={isSaving}
          >
            <Plus size={16} />
            학교 추가
          </button>
        </div>

        <div className="academic-type-manager-list">
          {visibleRows.length === 0 ? (
            <div className="academic-inline-state">아직 등록된 학교가 없습니다.</div>
          ) : (
            visibleRows.map((row, index) => (
              <article key={`${row.id || 'new'}-${index}`} className="academic-type-manager-row">
                <div className="academic-type-manager-copy">
                  <input
                    className="styled-input"
                    value={row.name}
                    placeholder="학교 이름"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setDraftRows((current) =>
                        current.map((item) =>
                          item === row ? { ...item, name: nextValue } : item
                        )
                      );
                    }}
                  />
                  <div className="academic-type-manager-note">
                    학년: {getGradesForSchoolCategory(row.category).join(', ')}
                  </div>
                </div>
                <div className="academic-type-manager-actions">
                  <button
                    type="button"
                    className="action-chip"
                    onClick={() => setDraftRows((current) => moveInCategory(current, row.category, index, -1))}
                    disabled={index === 0 || isSaving}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="action-chip"
                    onClick={() => setDraftRows((current) => moveInCategory(current, row.category, index, 1))}
                    disabled={index === visibleRows.length - 1 || isSaving}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="action-chip"
                    onClick={() => {
                      setDraftRows((current) => current.filter((item) => item !== row));
                      if (row.id) {
                        setDeletedIds((current) => [...new Set([...current, row.id])]);
                      }
                    }}
                    disabled={isSaving}
                  >
                    <Trash2 size={14} />
                    삭제
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        {hasInvalidRows ? (
          <div className="academic-inline-state">학교 이름은 비워둘 수 없고, 같은 이름의 학교를 중복 저장할 수 없습니다.</div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
