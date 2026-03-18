import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDataTableControls } from '../hooks/useDataTableControls';
import { useSharedTablePreference } from '../hooks/useSharedTablePreference';
import ClassDetailModal from './ClassDetailModal';
import DataListView from './data-manager/DataListView';
import ManagementHeader from './data-manager/ManagementHeader';
import { buildClassColumns, getDefaultClassSearchText } from './data-manager/columnSchemas';

const CLASS_LIST_STORAGE_KEY = 'workspace:classes';
const CLASS_LIST_TITLE = '\uC804\uCCB4 \uC218\uC5C5 \uBAA9\uB85D';
const CLASS_LIST_DESCRIPTION = '\uC2DC\uAC04\uD45C \uC791\uC5C5 \uC804\uC5D0 \uC804\uCCB4 \uC218\uC5C5\uC744 \uAC80\uC0C9\uD558\uACE0 \uC815\uB82C\uD558\uBA70, \uC218\uC5C5\uBA85\uC744 \uB204\uB974\uBA74 \uC0C1\uC138 \uC815\uBCF4\uB97C \uBC14\uB85C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.';
const CLASS_LIST_SEARCH_PLACEHOLDER = '\uC218\uC5C5\uBA85, \uC120\uC0DD\uB2D8, \uAC15\uC758\uC2E4\uB85C \uAC80\uC0C9';
const CLASS_LIST_EMPTY_TITLE = '\uD45C\uC2DC\uD560 \uC218\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4';
const CLASS_LIST_EMPTY_DESCRIPTION = '\uAC80\uC0C9\uC5B4\uB098 \uD544\uD130 \uC870\uAC74\uC744 \uC870\uC815\uD574 \uBCF4\uC138\uC694.';

export default function ClassListWorkspace({ classes, data, dataService, integrated = false }) {
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
