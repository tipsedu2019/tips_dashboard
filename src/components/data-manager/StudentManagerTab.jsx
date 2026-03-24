import { Download, Plus, Upload } from 'lucide-react';
import ManagementHeader from './ManagementHeader';
import ManagementCommandBar from './ManagementCommandBar';
import ManagementViewSettingsPanel from './ManagementViewSettingsPanel';
import DataListView from './DataListView';

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

export default function StudentManagerTab({
  currentIds,
  tableControls,
  selectedIds,
  hoveredId,
  setHoveredId,
  toggleSelectAll,
  handleDragStart,
  handleDragEnter,
  handleDeleteSelected,
  onInlineEdit,
  onAddStudent,
  onEditStudent,
  onDeleteStudent,
  onDownloadSample,
  onUpload,
  onManageSchools,
  isBusy,
}) {
  return (
    <div className="management-pane-shell">
      <div className="management-top-shell">
        <ManagementCommandBar
          searchValue={tableControls.searchQuery}
          onSearchChange={tableControls.setSearchQuery}
          searchPlaceholder="이름, 학교, 연락처, 고유번호 검색"
          primaryAction={{
            label: '학생 등록',
            icon: <Plus size={16} />,
            onClick: onAddStudent,
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
              label: '학교 마스터',
              onClick: onManageSchools,
            },
          ]}
          settingsContent={<ManagementViewSettingsPanel tableControls={tableControls} />}
          settingsBadge={getActiveFilterCount(tableControls)}
          isBusy={isBusy}
        />

        <ManagementHeader
          selectedCount={selectedIds.size}
          currentCount={currentIds.length}
          onToggleSelectAll={() => toggleSelectAll(currentIds)}
          onDeleteSelected={handleDeleteSelected}
        />
      </div>

      <DataListView
        columns={tableControls.visibleColumns}
        listData={tableControls.pagedData}
        rowModels={tableControls.rowModels}
        emptyTitle="등록된 학생 데이터가 없습니다."
        emptyDescription="학생을 직접 등록하거나 템플릿 업로드로 목록을 채워 주세요."
        onEdit={onEditStudent}
        onDelete={onDeleteStudent}
        selectedIds={selectedIds}
        currentIds={currentIds}
        toggleSelectAll={toggleSelectAll}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        onDragStart={handleDragStart}
        onDragEnter={handleDragEnter}
        activeTab="students"
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
