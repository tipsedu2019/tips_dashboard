import { Download, Plus, Upload } from 'lucide-react';
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
  onDownloadSample,
  onUpload,
  isBusy,
  sectionDescription,
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
        description={sectionDescription}
        toolbarActions={[
          {
            label: '학생 등록',
            icon: <Plus size={16} />,
            onClick: onAddStudent,
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
        isBusy={isBusy}
      />

      <DataListView
        columns={tableControls.visibleColumns}
        listData={filteredData}
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
      />
    </>
  );
}
