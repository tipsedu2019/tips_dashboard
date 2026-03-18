import { Download, Plus, Upload } from 'lucide-react';
import DataListView from './DataListView';
import ManagementHeader from './ManagementHeader';

export default function TextbookManagerTab({
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
  onAddTextbook,
  onEditTextbook,
  onDeleteTextbook,
  onDownloadSample,
  onUpload,
  isBusy,
  sectionDescription,
}) {
  return (
    <>
      <ManagementHeader
        title="교재 관리"
        count={tableControls.totalCount}
        hideSummary
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="교재명, 출판사, 태그 검색"
        description={sectionDescription}
        toolbarActions={[
          {
            label: '교재 등록',
            icon: <Plus size={16} />,
            onClick: onAddTextbook,
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
        ]}
        selectedCount={selectedIds.size}
        currentCount={currentIds.length}
        onToggleSelectAll={() => toggleSelectAll(currentIds)}
        onDeleteSelected={handleDeleteSelected}
        onBulkUpdate={onBulkUpdate}
        bulkUpdateLabel="교재 항목 일괄 수정"
        isBusy={isBusy}
      />

      <DataListView
        columns={tableControls.visibleColumns}
        listData={tableControls.pagedData}
        rowModels={tableControls.rowModels}
        emptyTitle="등록된 교재 데이터가 없습니다."
        emptyDescription="교재를 직접 등록하거나 템플릿 업로드로 목록을 채워 주세요."
        onEdit={onEditTextbook}
        onDelete={onDeleteTextbook}
        selectedIds={selectedIds}
        currentIds={currentIds}
        toggleSelectAll={toggleSelectAll}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        onDragStart={handleDragStart}
        onDragEnter={handleDragEnter}
        activeTab="textbooks"
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
