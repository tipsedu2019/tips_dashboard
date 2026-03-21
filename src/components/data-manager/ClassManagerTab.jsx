import { useEffect, useMemo } from 'react';
import { Calendar, Download, Plus, Upload } from 'lucide-react';
import ManagementHeader from './ManagementHeader';
import DataListView from './DataListView';
import TimetableUnifiedFilterPanel from '../ui/TimetableUnifiedFilterPanel';
import DashboardClassFilterTabs from '../ui/DashboardClassFilterTabs';

const QUICK_FILTER_KEYS = ['period', 'subject', 'grade', 'teacher', 'classroom'];

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
  classTerms = [],
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
    tableControls.filterOptions.period,
    tableControls.filters.subject,
    teacherMaster,
  ]);

  const unifiedFilters = useMemo(() => ({
    term: String(tableControls.filters.period || ''),
    subject: Array.isArray(tableControls.filters.subject) ? tableControls.filters.subject : [],
    grade: Array.isArray(tableControls.filters.grade) ? tableControls.filters.grade : [],
    teacher: Array.isArray(tableControls.filters.teacher) ? tableControls.filters.teacher : [],
    classroom: Array.isArray(tableControls.filters.classroom) ? tableControls.filters.classroom : [],
  }), [
    tableControls.filters.classroom,
    tableControls.filters.grade,
    tableControls.filters.period,
    tableControls.filters.subject,
    tableControls.filters.teacher,
  ]);

  const unifiedTermOptions = useMemo(
    () => {
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
    },
    [classTerms, tableControls.filterOptions.period]
  );

  const handleUnifiedFilterChange = (key, value) => {
    if (key === 'term') {
      tableControls.setFilterValue('period', value);
      return;
    }
    tableControls.setFilterValue(key, value);
  };

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
      <TimetableUnifiedFilterPanel
        filters={unifiedFilters}
        termOptions={unifiedTermOptions}
        subjectOptions={quickFilterOptions.subject}
        gradeOptions={quickFilterOptions.grade}
        teacherOptions={quickFilterOptions.teacher}
        classroomOptions={quickFilterOptions.classroom}
        onChange={handleUnifiedFilterChange}
      />

      <DashboardClassFilterTabs
        subjectOptions={quickFilterOptions.subject}
        gradeOptions={quickFilterOptions.grade}
        activeSubjects={Array.isArray(tableControls.filters.subject) ? tableControls.filters.subject : []}
        activeGrades={Array.isArray(tableControls.filters.grade) ? tableControls.filters.grade : []}
        onSubjectToggle={(values) => tableControls.setFilterValue('subject', values)}
        onGradeToggle={(values) => tableControls.setFilterValue('grade', values)}
      />

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
        classesUnifiedFilterMode
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
