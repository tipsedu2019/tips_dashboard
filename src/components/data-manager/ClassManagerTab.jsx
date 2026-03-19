import { useEffect, useMemo } from 'react';
import { Calendar, Download, Plus, Upload } from 'lucide-react';
import ManagementHeader from './ManagementHeader';
import DataListView from './DataListView';

const QUICK_FILTER_KEYS = ['subject', 'grade', 'teacher', 'classroom'];

function filterResourceOptionsBySubjects(master = [], selectedSubjects = []) {
  const visibleEntries = (master || []).filter((item) => item?.isVisible !== false);
  if (!Array.isArray(selectedSubjects) || selectedSubjects.length === 0) {
    return visibleEntries.map((item) => item.name);
  }

  const subjectSet = new Set(selectedSubjects);
  return visibleEntries
    .filter((item) => {
      const subjects = Array.isArray(item?.subjects) ? item.subjects.filter(Boolean) : [];
      return subjects.length === 0 || subjects.some((subject) => subjectSet.has(subject));
    })
    .map((item) => item.name);
}

export default function ClassManagerTab({
  filteredData,
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
  onManageTeachers,
  onManageClassrooms,
  onManageTerms,
  isBusy,
  sectionDescription,
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

  useEffect(() => {
    const current = Array.isArray(tableControls.filters.teacher) ? tableControls.filters.teacher : [];
    const next = current.filter((value) => quickFilterOptions.teacher.includes(value));
    if (next.length !== current.length) {
      tableControls.setFilterValue('teacher', next);
    }
  }, [quickFilterOptions.teacher, tableControls]);

  useEffect(() => {
    const current = Array.isArray(tableControls.filters.classroom) ? tableControls.filters.classroom : [];
    const next = current.filter((value) => quickFilterOptions.classroom.includes(value));
    if (next.length !== current.length) {
      tableControls.setFilterValue('classroom', next);
    }
  }, [quickFilterOptions.classroom, tableControls]);

  return (
    <>
      <ManagementHeader
        title="수업 관리"
        count={tableControls.totalCount}
        hideSummary
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="수업명, 과목, 선생님, 강의실 검색"
        description={sectionDescription}
        quickFilterKeys={QUICK_FILTER_KEYS}
        quickFilterOptions={quickFilterOptions}
        toolbarActions={[
          {
            label: '수업 등록',
            icon: <Plus size={16} />,
            onClick: onAddClass,
            variant: 'primary',
          },
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
        selectedCount={selectedIds.size}
        currentCount={currentIds.length}
        onToggleSelectAll={() => toggleSelectAll(currentIds)}
        onDeleteSelected={handleDeleteSelected}
        onBulkUpdate={onBulkUpdate}
        bulkUpdateLabel="수업 항목 일괄 수정"
        isBusy={isBusy}
      />

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
    </>
  );
}
