import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDataTableControls } from '../hooks/useDataTableControls';
import { useSharedTablePreference } from '../hooks/useSharedTablePreference';
import ClassDetailModal from './ClassDetailModal';
import DataListView from './data-manager/DataListView';
import ManagementHeader from './data-manager/ManagementHeader';
import { buildClassColumns, getDefaultClassSearchText } from './data-manager/columnSchemas';
import {
  buildClassroomMaster,
  buildTeacherMaster,
  getResourceSubjectOptions,
} from '../lib/resourceCatalogs';

const CLASS_LIST_STORAGE_KEY = 'workspace:classes';
const CLASS_LIST_TITLE = '수업 목록';
const CLASS_LIST_DESCRIPTION = '시간표 작업 전에 전체 수업을 검색하고 정렬한 뒤, 필요한 시간표 화면으로 바로 넘어갈 수 있습니다.';
const CLASS_LIST_SEARCH_PLACEHOLDER = '\uC218\uC5C5\uBA85, \uC120\uC0DD\uB2D8, \uAC15\uC758\uC2E4\uB85C \uAC80\uC0C9';
const CLASS_LIST_EMPTY_TITLE = '\uD45C\uC2DC\uD560 \uC218\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4';
const CLASS_LIST_EMPTY_DESCRIPTION = '\uAC80\uC0C9\uC5B4\uB098 \uD544\uD130 \uC870\uAC74\uC744 \uC870\uC815\uD574 \uBCF4\uC138\uC694.';
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

export default function ClassListWorkspace({ classes, data, dataService, integrated = false }) {
  const { isStaff } = useAuth();
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const teacherMaster = useMemo(
    () => buildTeacherMaster(data?.teacherCatalogs, data?.classes),
    [data?.classes, data?.teacherCatalogs]
  );
  const classroomMaster = useMemo(
    () => buildClassroomMaster(data?.classroomCatalogs, data?.classes),
    [data?.classes, data?.classroomCatalogs]
  );
  const subjectOptions = useMemo(
    () => getResourceSubjectOptions([...teacherMaster, ...classroomMaster], data?.classes),
    [classroomMaster, data?.classes, teacherMaster]
  );

  const classColumns = useMemo(
    () =>
      buildClassColumns({
        data,
        onOpenClassDetail: setSelectedClassForDetails,
        editable: false,
        includeRecruitment: true,
        subjectOptions,
        teacherOptions: teacherMaster.filter((item) => item.isVisible !== false).map((item) => item.name),
        classroomOptions: classroomMaster.filter((item) => item.isVisible !== false).map((item) => item.name),
      }),
    [classroomMaster, data, subjectOptions, teacherMaster]
  );

  const sharedPreference = useSharedTablePreference({
    storageKey: CLASS_LIST_STORAGE_KEY,
    dataService,
    canPersist: isStaff,
  });

  const tableControls = useDataTableControls({
    storageKey: CLASS_LIST_STORAGE_KEY,
    columns: classColumns,
    data: classes,
    searchAccessor: (item) => getDefaultClassSearchText(item),
    defaultSortKey: 'className',
    externalState: sharedPreference.isHydrated ? sharedPreference.externalState : null,
    onStateChange: sharedPreference.isHydrated ? sharedPreference.queuePersist : null,
  });

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

  const content = (
    <>
      <ManagementHeader
        title={CLASS_LIST_TITLE}
        description={CLASS_LIST_DESCRIPTION}
        count={tableControls.totalCount}
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder={CLASS_LIST_SEARCH_PLACEHOLDER}
        embedded={integrated}
        hideSummary={integrated}
        quickFilterKeys={QUICK_FILTER_KEYS}
        quickFilterOptions={quickFilterOptions}
      />

      <DataListView
        columns={tableControls.visibleColumns}
        listData={tableControls.pagedData}
        rowModels={tableControls.rowModels}
        emptyTitle={CLASS_LIST_EMPTY_TITLE}
        emptyDescription={CLASS_LIST_EMPTY_DESCRIPTION}
        onEdit={setSelectedClassForDetails}
        onDelete={() => {}}
        selectedIds={[]}
        currentIds={tableControls.currentIds}
        toggleSelectAll={() => {}}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        onDragStart={() => {}}
        onDragEnter={() => {}}
        activeTab="classes"
        onInlineEdit={async () => {}}
        isBusy={false}
        selectable={false}
        showActions={false}
        cardless={integrated}
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

  return (
    <>
      {integrated ? (
        <div className="card-custom class-list-workspace-panel animate-in">
          {content}
        </div>
      ) : (
        <div className="animate-in" style={{ display: 'grid', gap: 20 }}>
          {content}
        </div>
      )}

      {selectedClassForDetails ? (
        <ClassDetailModal
          cls={selectedClassForDetails}
          data={data}
          dataService={dataService}
          onClose={() => setSelectedClassForDetails(null)}
        />
      ) : null}
    </>
  );
}
