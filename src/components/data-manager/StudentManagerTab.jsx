import { FileSpreadsheet, Plus, Upload, Users } from 'lucide-react';
import ManagementHeader from './ManagementHeader';
import DataListView from './DataListView';

export default function StudentManagerTab({
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
  onInlineEdit,
  onAddStudent,
  onEditStudent,
  onDeleteStudent,
  onExport,
  onDownloadSample,
  onUpload,
  isBusy,
}) {
  return (
    <>
      <ManagementHeader
        title="학생 관리"
        count={filteredData.length}
        searchValue={tableControls.searchQuery}
        onSearchChange={tableControls.setSearchQuery}
        tableControls={tableControls}
        searchPlaceholder="이름, 학교, 연락처, 고유번호 검색"
        toolbarActions={[
          { label: '내보내기', icon: <FileSpreadsheet size={16} />, onClick: onExport },
          { label: '샘플 다운로드', icon: <Users size={16} />, onClick: onDownloadSample },
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
        <button type="button" className="btn-primary" onClick={onAddStudent} disabled={isBusy}>
          <Plus size={18} />
          학생 등록
        </button>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          셀을 더블클릭하면 표 안에서 바로 수정할 수 있습니다.
        </div>
      </div>

      <DataListView
        columns={tableControls.visibleColumns}
        listData={filteredData}
        rowModels={tableControls.rowModels}
        emptyTitle="등록된 학생 데이터가 없습니다."
        emptyDescription="학생을 직접 등록하거나 파일 업로드로 데이터를 추가해 주세요."
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
      />
    </>
  );
}
