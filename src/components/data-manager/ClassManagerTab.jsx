import { Calendar, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import ManagementHeader from './ManagementHeader';
import DataListView from './DataListView';

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
  onExport,
  onDownloadSample,
  onUpload,
  isBusy,
}) {
  return (
    <>
      <ManagementHeader
        title="수업 관리"
        count={filteredData.length}
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="수업명, 과목, 선생님, 강의실 검색"
        toolbarActions={[
          { label: '내보내기', icon: <FileSpreadsheet size={16} />, onClick: onExport },
          { label: '샘플 다운로드', icon: <Calendar size={16} />, onClick: onDownloadSample },
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
        bulkUpdateLabel="수업 속성 일괄 수정"
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
        <button type="button" className="btn-primary" onClick={onAddClass} disabled={isBusy}>
          <Plus size={18} />
          수업 등록
        </button>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          칼럼 보기/숨기기, 정렬, 그룹화는 오른쪽 설정 패널에서 바로 바꿀 수 있습니다.
        </div>
      </div>

      <DataListView
        columns={tableControls.visibleColumns}
        listData={filteredData}
        rowModels={tableControls.rowModels}
        emptyTitle="등록된 수업 데이터가 없습니다."
        emptyDescription="수업을 직접 등록하거나 파일 업로드로 운영 수업을 채워 주세요."
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
      />
    </>
  );
}
