import { useMemo, useState } from 'react';
import { Book, Calendar, ClipboardList, Users } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from './ui/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useManagerActions } from '../hooks/useManagerActions';
import { useDataTableControls } from '../hooks/useDataTableControls';
import { useSharedTablePreference } from '../hooks/useSharedTablePreference';
import { useAuth } from '../contexts/AuthContext';
import StudentManagerTab from './data-manager/StudentManagerTab';
import ClassManagerTab from './data-manager/ClassManagerTab';
import TextbookManagerTab from './data-manager/TextbookManagerTab';
import BulkUpdateModal from './data-manager/BulkUpdateModal';
import ClassEditor from './data-manager/ClassEditor';
import {
  StudentEditor,
  StudentManifestModal,
  TextbookEditor,
} from './data-manager/DataManagerEditors';
import {
  getClassSearchText,
  getStudentSearchText,
  getTextbookSearchText,
  createEmptyClass,
  createEmptyStudent,
  createEmptyTextbook,
} from './data-manager/utils';
import {
  buildClassColumns,
  buildStudentColumns,
  buildTextbookColumns,
} from './data-manager/columnSchemas';

const EMPTY_DATA = {
  classes: [],
  students: [],
  textbooks: [],
  academicSchools: [],
  academicCurriculumProfiles: [],
  academicSupplementMaterials: [],
  academicExamScopes: [],
  academicExamDays: [],
};

export default function DataManager({ data = EMPTY_DATA, dataService }) {
  const safeData = useMemo(() => ({
    ...EMPTY_DATA,
    ...data,
  }), [data]);

  const toast = useToast();
  const { isStaff } = useAuth();
  const { confirm, dialogProps } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState('students');
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [editingTextbook, setEditingTextbook] = useState(null);
  const [viewingClassStudents, setViewingClassStudents] = useState(null);

  const currentTabData = useMemo(() => {
    if (activeTab === 'students') {
      return safeData.students || [];
    }
    if (activeTab === 'classes') {
      return safeData.classes || [];
    }
    return safeData.textbooks || [];
  }, [activeTab, safeData]);

  const columnDefinitions = useMemo(() => {
    if (activeTab === 'students') {
      return buildStudentColumns();
    }
    if (activeTab === 'classes') {
      return buildClassColumns({
        data: safeData,
        onOpenManifest: setViewingClassStudents,
      });
    }
    return buildTextbookColumns();
  }, [activeTab, safeData]);

  const sharedPreference = useSharedTablePreference({
    storageKey: `data-manager:${activeTab}`,
    dataService,
    canPersist: isStaff,
  });

  const tableControls = useDataTableControls({
    storageKey: `data-manager:${activeTab}`,
    data: currentTabData,
    columns: columnDefinitions,
    searchAccessor: (item) => {
      if (activeTab === 'students') {
        return getStudentSearchText(item);
      }
      if (activeTab === 'classes') {
        return getClassSearchText(item);
      }
      return getTextbookSearchText(item);
    },
    defaultSortKey: activeTab === 'classes' ? 'className' : activeTab === 'students' ? 'name' : 'title',
    externalState: sharedPreference.isHydrated ? sharedPreference.externalState : null,
    onStateChange: sharedPreference.isHydrated ? sharedPreference.queuePersist : null,
  });

  const selection = useBulkSelection(activeTab, tableControls.currentIds);
  const actions = useManagerActions({
    activeTab,
    data: safeData,
    filteredData: tableControls.filteredData,
    dataService,
    toast,
    confirm,
    selectedIds: selection.selectedIds,
    clearSelection: selection.clearSelection,
    classSubjectOptions: tableControls.filterOptions.subject || [],
  });

  const handleSaveStudent = async (student) => {
    const saved = await actions.saveStudent(student);
    if (saved) {
      setEditingStudent(null);
    }
  };

  const handleSaveClass = async (classItem) => {
    const saved = await actions.saveClass(classItem);
    if (saved) {
      setEditingClass(null);
    }
  };

  const handleSaveTextbook = async (textbook) => {
    const saved = await actions.saveTextbook(textbook);
    if (saved) {
      setEditingTextbook(null);
    }
  };

  if (editingStudent) {
    return (
      <StudentEditor
        student={editingStudent}
        classes={safeData.classes}
        onSave={handleSaveStudent}
        onCancel={() => setEditingStudent(null)}
        isSaving={actions.isProcessing}
      />
    );
  }

  if (editingClass) {
    return (
      <ClassEditor
        cls={editingClass}
        textbooks={safeData.textbooks}
        students={safeData.students}
        academicSchools={safeData.academicSchools}
        academicExamDays={safeData.academicExamDays}
        requestConfirm={confirm}
        showToast={toast}
        onSave={handleSaveClass}
        onCancel={() => setEditingClass(null)}
        isSaving={actions.isProcessing}
      />
    );
  }

  if (editingTextbook) {
    return (
      <TextbookEditor
        textbook={editingTextbook}
        onSave={handleSaveTextbook}
        onCancel={() => setEditingTextbook(null)}
        isSaving={actions.isProcessing}
      />
    );
  }

  return (
    <div className="view-container">
      {viewingClassStudents && (
        <StudentManifestModal
          cls={viewingClassStudents}
          data={safeData}
          onClose={() => setViewingClassStudents(null)}
          onManage={() => {
            setEditingClass(viewingClassStudents);
            setViewingClassStudents(null);
          }}
        />
      )}

      <div className="view-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            className="view-header-icon"
            style={{ background: 'rgba(33, 110, 78, 0.1)', color: 'var(--accent-color)' }}
          >
            <ClipboardList size={22} />
          </div>
          <div>
            <h2 className="view-title">데이터 관리</h2>
            <p className="view-subtitle">
              학생, 수업, 교재 데이터를 한곳에서 정리하고 즉시 수정할 수 있습니다.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, padding: '0 24px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`h-segment-btn ${activeTab === 'students' ? 'active' : ''}`}
          onClick={() => setActiveTab('students')}
          style={{ flex: 1, minWidth: 160, padding: '12px', fontSize: 14 }}
        >
          <Users size={18} style={{ marginRight: 8 }} />
          학생 관리
        </button>
        <button
          type="button"
          className={`h-segment-btn ${activeTab === 'classes' ? 'active' : ''}`}
          onClick={() => setActiveTab('classes')}
          style={{ flex: 1, minWidth: 160, padding: '12px', fontSize: 14 }}
        >
          <Calendar size={18} style={{ marginRight: 8 }} />
          수업 관리
        </button>
        <button
          type="button"
          className={`h-segment-btn ${activeTab === 'textbooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('textbooks')}
          style={{ flex: 1, minWidth: 160, padding: '12px', fontSize: 14 }}
        >
          <Book size={18} style={{ marginRight: 8 }} />
          교재 관리
        </button>
      </div>

      {actions.isProcessing && (
        <div
          style={{
            margin: '0 24px 20px',
            padding: '14px 16px',
            borderRadius: 16,
            background: 'rgba(33, 110, 78, 0.08)',
            border: '1px solid rgba(33, 110, 78, 0.16)',
            color: 'var(--text-secondary)',
          }}
        >
          작업을 처리하고 있습니다. 완료될 때까지 잠시만 기다려 주세요.
        </div>
      )}

      <div style={{ padding: '0 24px 24px' }}>
        {activeTab === 'students' && (
          <StudentManagerTab
            filteredData={tableControls.filteredData}
            currentIds={tableControls.currentIds}
            tableControls={tableControls}
            selectedIds={selection.selectedIds}
            hoveredId={selection.hoveredId}
            setHoveredId={selection.setHoveredId}
            toggleSelectAll={selection.toggleSelectAll}
            handleDragStart={selection.handleDragStart}
            handleDragEnter={selection.handleDragEnter}
            handleDeleteSelected={actions.handleDeleteSelected}
            onInlineEdit={actions.handleInlineEdit}
            onAddStudent={() => setEditingStudent(createEmptyStudent())}
            onEditStudent={setEditingStudent}
            onDeleteStudent={actions.deleteStudent}
            onExport={actions.handleExportData}
            onDownloadSample={actions.handleDownloadSample}
            onUpload={(file) => actions.handleSpreadsheetUpload(file, 'students')}
            isBusy={actions.isProcessing}
          />
        )}

        {activeTab === 'classes' && (
          <ClassManagerTab
            filteredData={tableControls.filteredData}
            currentIds={tableControls.currentIds}
            tableControls={tableControls}
            selectedIds={selection.selectedIds}
            hoveredId={selection.hoveredId}
            setHoveredId={selection.setHoveredId}
            toggleSelectAll={selection.toggleSelectAll}
            handleDragStart={selection.handleDragStart}
            handleDragEnter={selection.handleDragEnter}
            handleDeleteSelected={actions.handleDeleteSelected}
            onBulkUpdate={actions.openBulkUpdate}
            onInlineEdit={actions.handleInlineEdit}
            onAddClass={() => setEditingClass(createEmptyClass())}
            onEditClass={setEditingClass}
            onDeleteClass={actions.deleteClass}
            onExport={actions.handleExportData}
            onDownloadSample={actions.handleDownloadSample}
            onUpload={(file) => actions.handleSpreadsheetUpload(file, 'classes')}
            isBusy={actions.isProcessing}
          />
        )}

        {activeTab === 'textbooks' && (
          <TextbookManagerTab
            filteredData={tableControls.filteredData}
            currentIds={tableControls.currentIds}
            tableControls={tableControls}
            selectedIds={selection.selectedIds}
            hoveredId={selection.hoveredId}
            setHoveredId={selection.setHoveredId}
            toggleSelectAll={selection.toggleSelectAll}
            handleDragStart={selection.handleDragStart}
            handleDragEnter={selection.handleDragEnter}
            handleDeleteSelected={actions.handleDeleteSelected}
            onBulkUpdate={actions.openBulkUpdate}
            onInlineEdit={actions.handleInlineEdit}
            onAddTextbook={() => setEditingTextbook(createEmptyTextbook())}
            onEditTextbook={setEditingTextbook}
            onDeleteTextbook={actions.deleteTextbook}
            onExport={actions.handleExportData}
            onDownloadSample={actions.handleDownloadSample}
            onUpload={(file) => actions.handleSpreadsheetUpload(file, 'textbooks')}
            isBusy={actions.isProcessing}
          />
        )}
      </div>

      <BulkUpdateModal
        open={actions.bulkUpdateModalOpen}
        selectedCount={selection.selectedIds.size}
        activeTab={activeTab}
        fieldOptions={actions.bulkFieldOptions}
        field={actions.bulkUpdateField}
        value={actions.bulkUpdateValue}
        onFieldChange={actions.setBulkUpdateField}
        onValueChange={actions.setBulkUpdateValue}
        onClose={actions.closeBulkUpdate}
        onApply={actions.applyBulkUpdate}
        isProcessing={actions.isProcessing}
        subjectOptions={tableControls.filterOptions.subject || []}
      />
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
