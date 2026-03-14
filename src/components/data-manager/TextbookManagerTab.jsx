import { Book, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import ManagementHeader from './ManagementHeader';
import DataListView from './DataListView';

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
  onExport,
  onDownloadSample,
  onUpload,
  isBusy,
}) {
  return (
    <>
      <ManagementHeader
        title="교재 관리"
        count={filteredData.length}
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="교재명, 출판사, 태그 검색"
        toolbarActions={[
          { label: '내보내기', icon: <FileSpreadsheet size={16} />, onClick: onExport },
          { label: '샘플 다운로드', icon: <Book size={16} />, onClick: onDownloadSample },
          {
            label: '파일 업로드',
            icon: <Upload size={16} />,
            kind: 'file',
            variant: 'primary',
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
        bulkUpdateLabel="태그/출판사 일괄 수정"
        isBusy={isBusy}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 24,
          padding: '0 4px',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" className="btn-primary" onClick={onAddTextbook} disabled={isBusy}>
          <Plus size={18} />
          교재 등록
        </button>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          여러 권을 한 번에 올릴 때는 샘플 양식을 그대로 사용해 주세요.
        </div>
      </div>

      <DataListView
        columns={tableControls.visibleColumns}
        listData={filteredData}
        rowModels={tableControls.rowModels}
        emptyTitle="등록된 교재 데이터가 없습니다."
        emptyDescription="교재를 직접 등록하거나 파일 업로드로 목록을 채워 주세요."
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
      />
    </>
  );
}
