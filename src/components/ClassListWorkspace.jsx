import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDataTableControls } from '../hooks/useDataTableControls';
import { useSharedTablePreference } from '../hooks/useSharedTablePreference';
import ClassDetailModal from './ClassDetailModal';
import DataListView from './data-manager/DataListView';
import ManagementHeader from './data-manager/ManagementHeader';
import { buildClassColumns, getDefaultClassSearchText } from './data-manager/columnSchemas';

const CLASS_LIST_STORAGE_KEY = 'workspace:classes';

export default function ClassListWorkspace({ classes, data, dataService }) {
  const { isStaff } = useAuth();
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const classColumns = useMemo(
    () =>
      buildClassColumns({
        data,
        onOpenClassDetail: setSelectedClassForDetails,
        editable: false,
        includeRecruitment: true,
      }),
    [data]
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

  return (
    <div className="animate-in" style={{ display: 'grid', gap: 20 }}>
      <ManagementHeader
        title="전체 수업 목록"
        description="현재 시간표 필터 기준 수업을 한 곳에서 검색하고 정렬할 수 있습니다. 수업명을 누르면 상세 정보를 바로 확인할 수 있습니다."
        count={tableControls.filteredData.length}
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="수업명, 선생님, 강의실로 검색"
      />

      <DataListView
        columns={tableControls.visibleColumns}
        listData={tableControls.filteredData}
        rowModels={tableControls.rowModels}
        emptyTitle="표시할 수업이 없습니다"
        emptyDescription="검색어나 필터 조건을 조정해 주세요."
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
        sortKey={tableControls.sortState.key}
        sortDirection={tableControls.sortState.direction}
        onSortChange={tableControls.toggleSort}
      />

      {selectedClassForDetails && (
        <ClassDetailModal
          cls={selectedClassForDetails}
          data={data}
          dataService={dataService}
          onClose={() => setSelectedClassForDetails(null)}
        />
      )}
    </div>
  );
}
