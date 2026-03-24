import { useEffect, useMemo } from 'react';
import { Calendar, Download, Plus, Upload } from 'lucide-react';
import { CheckboxMenu, SegmentedControl } from '../ui/tds';
import ManagementHeader from './ManagementHeader';
import ManagementCommandBar from './ManagementCommandBar';
import ManagementViewSettingsPanel from './ManagementViewSettingsPanel';
import DataListView from './DataListView';

function filterResourceOptionsBySubjects(master = [], selectedSubjects = []) {
  const visibleEntries = (master || []).filter((item) => item?.isVisible !== false);
  if (!Array.isArray(selectedSubjects) || selectedSubjects.length === 0) {
    return visibleEntries.map((item) => item.name);
  }

  const subjectSet = new Set(selectedSubjects);
  return visibleEntries
    .filter((item) => {
      const subjects = Array.isArray(item?.subjects) ? item.subjects.filter(Boolean) : [];
      return subjects.some((subject) => subjectSet.has(subject));
    })
    .map((item) => item.name);
}

function getActiveFilterCount(tableControls) {
  return tableControls.columns.reduce((countValue, column) => {
    const value = tableControls.filters[column.key];
    if (Array.isArray(value)) {
      return countValue + (value.length > 0 ? 1 : 0);
    }
    if (value && typeof value === 'object') {
      return countValue + (value.min || value.max ? 1 : 0);
    }
    return countValue + (String(value || '').trim() ? 1 : 0);
  }, 0);
}

export default function ClassManagerTab({
  currentIds,
  tableControls,
  selectedIds,
  hoveredId,
  setHoveredId,
  toggleSelectAll,
  handleDragStart,
  handleDragEnter,
  handleDeleteSelected,
  onBulkUpdate,
  onInlineEdit,
  onAddClass,
  onEditClass,
  onDeleteClass,
  onDownloadSample,
  onUpload,
  teacherMaster = [],
  classroomMaster = [],
  subjectOptions = [],
  classTerms = [],
  onManageTeachers,
  onManageClassrooms,
  onManageTerms,
  isBusy,
}) {
  const quickFilterOptions = useMemo(() => {
    const selectedSubjects = Array.isArray(tableControls.filters.subject)
      ? tableControls.filters.subject
      : [];

    return {
      subject: subjectOptions,
      grade: tableControls.filterOptions.grade || [],
      teacher: filterResourceOptionsBySubjects(teacherMaster, selectedSubjects),
      classroom: filterResourceOptionsBySubjects(classroomMaster, selectedSubjects),
    };
  }, [
    classroomMaster,
    subjectOptions,
    tableControls.filterOptions.grade,
    tableControls.filters.subject,
    teacherMaster,
  ]);

  const termOptions = useMemo(() => {
    const optionMap = new Map();

    (classTerms || []).forEach((term) => {
      const name = String(term?.name || term?.period || '').trim();
      if (!name) {
        return;
      }
      optionMap.set(name, {
        id: term.id,
        name,
        academicYear: Number(term.academicYear || term.academic_year || 0) || undefined,
        sortOrder: Number(term.sortOrder ?? term.sort_order ?? optionMap.size),
      });
    });

    (tableControls.filterOptions.period || []).forEach((name) => {
      const safeName = String(name || '').trim();
      if (!safeName || optionMap.has(safeName)) {
        return;
      }
      optionMap.set(safeName, { name: safeName, sortOrder: optionMap.size });
    });

    return [...optionMap.values()].sort((left, right) => {
      const yearGap = Number(right.academicYear || 0) - Number(left.academicYear || 0);
      if (yearGap !== 0) {
        return yearGap;
      }
      return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    });
  }, [classTerms, tableControls.filterOptions.period]);

  const selectedTerm = String(tableControls.filters.period || '');
  const selectedSubject = Array.isArray(tableControls.filters.subject)
    ? tableControls.filters.subject[0] || ''
    : '';
  const selectedGrade = Array.isArray(tableControls.filters.grade)
    ? tableControls.filters.grade[0] || ''
    : '';
  const selectedTeachers = Array.isArray(tableControls.filters.teacher)
    ? tableControls.filters.teacher
    : [];
  const selectedClassrooms = Array.isArray(tableControls.filters.classroom)
    ? tableControls.filters.classroom
    : [];

  useEffect(() => {
    const next = selectedTeachers.filter((value) => quickFilterOptions.teacher.includes(value));
    if (next.length !== selectedTeachers.length) {
      tableControls.setFilterValue('teacher', next);
    }
  }, [quickFilterOptions.teacher, selectedTeachers, tableControls]);

  useEffect(() => {
    const next = selectedClassrooms.filter((value) =>
      quickFilterOptions.classroom.includes(value),
    );
    if (next.length !== selectedClassrooms.length) {
      tableControls.setFilterValue('classroom', next);
    }
  }, [quickFilterOptions.classroom, selectedClassrooms, tableControls]);

  const subjectItems = quickFilterOptions.subject.map((subject) => ({
    value: subject,
    label: subject,
    ariaLabel: `${subject} 선택`,
  }));

  return (
    <div className="management-pane-shell">
      <div className="management-top-shell">
        <ManagementCommandBar
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        searchPlaceholder="수업명, 과목, 선생님, 강의실 검색"
        filtersContent={
          <>
            <div className="management-command-bar__filter management-command-bar__filter--term">
              <CheckboxMenu
                value={selectedTerm ? [selectedTerm] : []}
                options={termOptions.map((term) => ({
                  value: term.name,
                  label: [term.academicYear, term.name].filter(Boolean).join(' '),
                }))}
                onChange={(nextValues) => tableControls.setFilterValue('period', nextValues[0] || '')}
                placeholder="전체 학기"
                clearLabel="전체 학기"
                clearDescription="전체 학기 기준으로 수업을 확인합니다."
                label="학기 필터"
                selectionMode="single"
                showCountMeta={false}
                className="management-command-bar__menu"
              />
            </div>

            <div className="management-command-bar__filter management-command-bar__filter--subject">
              <SegmentedControl
                value={selectedSubject}
                onValueChange={(nextValue) =>
                  tableControls.setFilterValue(
                    'subject',
                    selectedSubject === nextValue ? [] : [nextValue],
                  )
                }
                items={subjectItems}
                size="small"
                alignment="fixed"
                selectionMode="single"
                className="management-command-bar__segmented management-command-bar__segmented-subject"
              />
            </div>

            <div className="management-command-bar__filter management-command-bar__filter--grade">
              <CheckboxMenu
                value={selectedGrade ? [selectedGrade] : []}
                options={quickFilterOptions.grade.map((grade) => ({
                  value: grade,
                  label: grade,
                }))}
                onChange={(nextValues) => tableControls.setFilterValue('grade', nextValues[0] ? [nextValues[0]] : [])}
                placeholder="전체 학년"
                clearLabel="전체 학년"
                clearDescription="전체 학년 기준으로 수업을 확인합니다."
                label="학년 필터"
                selectionMode="single"
                showCountMeta={false}
                className="management-command-bar__menu"
              />
            </div>

            <div className="management-command-bar__filter management-command-bar__filter--teacher">
              <CheckboxMenu
                value={selectedTeachers}
                options={quickFilterOptions.teacher.map((teacher) => ({
                  value: teacher,
                  label: teacher,
                }))}
                onChange={(nextValues) => tableControls.setFilterValue('teacher', nextValues)}
                placeholder="전체 선생님"
                clearLabel="전체 선생님"
                clearDescription="전체 선생님 기준으로 수업을 확인합니다."
                label="선생님 필터"
                maxPreview={1}
                className="management-command-bar__menu"
              />
            </div>

            <div className="management-command-bar__filter management-command-bar__filter--classroom">
              <CheckboxMenu
                value={selectedClassrooms}
                options={quickFilterOptions.classroom.map((classroom) => ({
                  value: classroom,
                  label: classroom,
                }))}
                onChange={(nextValues) => tableControls.setFilterValue('classroom', nextValues)}
                placeholder="전체 강의실"
                clearLabel="전체 강의실"
                clearDescription="전체 강의실 기준으로 수업을 확인합니다."
                label="강의실 필터"
                maxPreview={1}
                className="management-command-bar__menu"
              />
            </div>
          </>
        }
        primaryAction={{
          label: '수업 등록',
          icon: <Plus size={16} />,
          onClick: onAddClass,
        }}
        overflowActions={[
          {
            label: '템플릿 다운로드',
            icon: <Download size={16} />,
            onClick: onDownloadSample,
          },
          {
            label: '데이터 업로드',
            icon: <Upload size={16} />,
            kind: 'file',
            onChange: async (event) => {
              const file = event.target.files?.[0];
              await onUpload(file);
              event.target.value = '';
            },
          },
          {
            label: '선생님 마스터',
            onClick: onManageTeachers,
          },
          {
            label: '강의실 마스터',
            onClick: onManageClassrooms,
          },
          {
            label: '학기 마스터',
            icon: <Calendar size={16} />,
            onClick: onManageTerms,
          },
        ]}
        settingsContent={
          <ManagementViewSettingsPanel
            tableControls={tableControls}
            quickFilterOptions={quickFilterOptions}
            excludeFilterKeys={['period', 'subject', 'grade', 'teacher', 'classroom']}
          />
        }
        settingsBadge={getActiveFilterCount(tableControls)}
        isBusy={isBusy}
        />

        <ManagementHeader
          selectedCount={selectedIds.size}
          currentCount={currentIds.length}
          onToggleSelectAll={() => toggleSelectAll(currentIds)}
          onDeleteSelected={handleDeleteSelected}
          onBulkUpdate={onBulkUpdate}
          bulkUpdateLabel="수업 항목 일괄 수정"
        />
      </div>

      <DataListView
        columns={tableControls.visibleColumns}
        listData={tableControls.pagedData}
        rowModels={tableControls.rowModels}
        emptyTitle="등록된 수업 데이터가 없습니다."
        emptyDescription="수업을 직접 등록하거나 템플릿 업로드로 운영 수업 목록을 채워 주세요."
        onEdit={onEditClass}
        onDelete={onDeleteClass}
        selectedIds={selectedIds}
        currentIds={currentIds}
        toggleSelectAll={toggleSelectAll}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        onDragStart={handleDragStart}
        onDragEnter={handleDragEnter}
        activeTab="classes"
        onInlineEdit={onInlineEdit}
        isBusy={isBusy}
        sortKey={tableControls.sortState.key}
        sortDirection={tableControls.sortState.direction}
        onSortChange={tableControls.toggleSort}
        page={tableControls.page}
        pageSize={tableControls.pageSize}
        totalPages={tableControls.totalPages}
        totalCount={tableControls.totalCount}
        pageStart={tableControls.pageStart}
        pageEnd={tableControls.pageEnd}
        onPageChange={tableControls.setPage}
        onPageSizeChange={tableControls.setPageSize}
      />
    </div>
  );
}
