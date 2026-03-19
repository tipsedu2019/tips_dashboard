import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-react';
import BottomSheet from '../ui/BottomSheet';

function text(value) {
  return String(value || '').trim();
}

function moveVisibleRow(rows, visibleRows, targetRow, direction) {
  const visibleIndexes = visibleRows
    .map((row) => rows.indexOf(row))
    .filter((index) => index >= 0);
  const currentVisibleIndex = visibleRows.findIndex((row) => row === targetRow);
  const targetVisibleIndex = currentVisibleIndex + direction;

  if (currentVisibleIndex < 0 || targetVisibleIndex < 0 || targetVisibleIndex >= visibleIndexes.length) {
    return rows;
  }

  const currentIndex = visibleIndexes[currentVisibleIndex];
  const nextIndex = visibleIndexes[targetVisibleIndex];
  const nextRows = [...rows];
  const [removed] = nextRows.splice(currentIndex, 1);
  nextRows.splice(nextIndex, 0, removed);
  return nextRows;
}

export default function ResourceCatalogManagerModal({
  open,
  title,
  subtitle,
  resourceLabel,
  resources = [],
  subjectOptions = [],
  onClose,
  onSave,
  isSaving = false,
}) {
  const [draftRows, setDraftRows] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);
  const [activeSubject, setActiveSubject] = useState('all');

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraftRows((resources || []).map((resource, index) => ({
      id: resource.id || '',
      name: resource.name || '',
      subjects: Array.isArray(resource.subjects) ? resource.subjects : [],
      isVisible: resource.isVisible !== false,
      sortOrder: resource.sortOrder ?? resource.sort_order ?? index,
      source: resource.source || 'master',
    })));
    setDeletedIds([]);
    setActiveSubject('all');
  }, [open, resources]);

  const normalizedSubjectOptions = useMemo(
    () => [...new Set((subjectOptions || []).map((subject) => text(subject)).filter(Boolean))],
    [subjectOptions]
  );

  const subjectTabs = useMemo(
    () => [{ value: 'all', label: '전체' }, ...normalizedSubjectOptions.map((subject) => ({ value: subject, label: subject }))],
    [normalizedSubjectOptions]
  );

  const visibleRows = useMemo(() => {
    if (activeSubject === 'all') {
      return draftRows;
    }
    return draftRows.filter((row) => (row.subjects || []).length === 0 || (row.subjects || []).includes(activeSubject));
  }, [activeSubject, draftRows]);

  const hasInvalidRows = useMemo(() => {
    const names = draftRows.map((row) => text(row.name)).filter(Boolean);
    return (
      draftRows.some((row) => !text(row.name)) ||
      new Set(names.map((name) => name.toLowerCase())).size !== names.length
    );
  }, [draftRows]);

  const handleSave = async () => {
    if (hasInvalidRows || isSaving) {
      return;
    }

    const orderedRows = draftRows.map((row, index) => ({
      ...row,
      name: text(row.name),
      subjects: [...new Set((row.subjects || []).map((subject) => text(subject)).filter(Boolean))],
      isVisible: row.isVisible !== false,
      sortOrder: index,
    }));

    await onSave?.(orderedRows, deletedIds);
  };

  if (!open) {
    return null;
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      maxWidth={920}
      actions={(
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <div className="academic-inline-state">
            과목 연결을 비워 두면 모든 과목에서 공통으로 사용됩니다.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="action-chip" onClick={onClose} disabled={isSaving}>
              닫기
            </button>
            <button type="button" className="action-pill" onClick={handleSave} disabled={hasInvalidRows || isSaving}>
              <Save size={16} />
              {isSaving ? '저장 중...' : '마스터 저장'}
            </button>
          </div>
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {subjectTabs.length > 1 ? (
          <div
            className="h-segment-container"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${subjectTabs.length}, minmax(0, 1fr))`,
              gap: 8,
            }}
          >
            {subjectTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={`h-segment-btn ${activeSubject === tab.value ? 'active' : ''}`}
                onClick={() => setActiveSubject(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="academic-type-manager-add">
          <div className="academic-type-manager-add-field">
            <span className="academic-section-caption">{resourceLabel} 추가</span>
            <div className="academic-inline-state">
              {activeSubject === 'all'
                ? `전역 선택지와 필터에서 사용할 ${resourceLabel} 목록을 정리합니다.`
                : `${activeSubject} 탭에서 먼저 보일 ${resourceLabel}을 정리합니다.`}
            </div>
          </div>
          <button
            type="button"
            className="action-pill"
            onClick={() => {
              const nextSubjects = activeSubject === 'all' ? [] : [activeSubject];
              setDraftRows((current) => [
                ...current,
                {
                  id: '',
                  name: '',
                  subjects: nextSubjects,
                  isVisible: true,
                  sortOrder: current.length,
                  source: 'master',
                },
              ]);
            }}
            disabled={isSaving}
          >
            <Plus size={16} />
            {resourceLabel} 추가
          </button>
        </div>

        <div className="academic-type-manager-list">
          {visibleRows.length === 0 ? (
            <div className="academic-inline-state">
              {activeSubject === 'all'
                ? `아직 등록된 ${resourceLabel}이 없습니다.`
                : `${activeSubject} 탭에 보이는 ${resourceLabel}이 없습니다.`}
            </div>
          ) : (
            visibleRows.map((row, index) => (
              <article key={`${row.id || 'new'}-${index}`} className="resource-master-row">
                <div className="resource-master-row-main">
                  <div className="resource-master-row-head">
                    <input
                      className="styled-input"
                      value={row.name}
                      placeholder={`${resourceLabel} 이름`}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDraftRows((current) =>
                          current.map((item) => (item === row ? { ...item, name: nextValue } : item))
                        );
                      }}
                    />

                    <button
                      type="button"
                      className={`action-chip ${row.isVisible ? 'is-visible' : 'is-hidden'}`}
                      onClick={() => {
                        setDraftRows((current) =>
                          current.map((item) => (item === row ? { ...item, isVisible: !item.isVisible } : item))
                        );
                      }}
                    >
                      {row.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                      {row.isVisible ? '표시' : '숨김'}
                    </button>
                  </div>

                  <div className="resource-master-row-subjects">
                    <span className="academic-section-caption">연결 과목</span>
                    <div className="resource-master-chip-wrap">
                      {normalizedSubjectOptions.map((subject) => {
                        const selected = (row.subjects || []).includes(subject);
                        return (
                          <button
                            key={`${row.id || index}-${subject}`}
                            type="button"
                            className={`timetable-compare-chip ${selected ? 'is-active' : ''}`}
                            onClick={() => {
                              setDraftRows((current) =>
                                current.map((item) => {
                                  if (item !== row) {
                                    return item;
                                  }
                                  const nextSubjects = selected
                                    ? (item.subjects || []).filter((value) => value !== subject)
                                    : [...(item.subjects || []), subject];
                                  return { ...item, subjects: nextSubjects };
                                })
                              );
                            }}
                          >
                            {subject}
                          </button>
                        );
                      })}
                      {(row.subjects || []).length === 0 ? (
                        <span className="academic-inline-state">공통</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="academic-type-manager-actions">
                  <button
                    type="button"
                    className="action-chip"
                    onClick={() => setDraftRows((current) => moveVisibleRow(current, visibleRows, row, -1))}
                    disabled={index === 0 || isSaving}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="action-chip"
                    onClick={() => setDraftRows((current) => moveVisibleRow(current, visibleRows, row, 1))}
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
          <div className="academic-inline-state">
            이름을 비워 둘 수 없고, 같은 이름의 {resourceLabel}은 중복 저장할 수 없습니다.
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
