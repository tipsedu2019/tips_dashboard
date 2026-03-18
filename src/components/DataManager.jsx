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

const TAB_META = {
  students: {
    label: '\uD559\uC0DD \uAD00\uB9AC',
    icon: Users,
    description: '\uD559\uC0DD \uB370\uC774\uD130\uB97C \uC815\uB9AC\uD558\uACE0 \uBC18 \uBC30\uC815, \uC5F0\uB77D\uCC98, \uD559\uAD50\u00B7\uD559\uB144 \uC815\uBCF4\uB97C \uD55C \uD654\uBA74\uC5D0\uC11C \uAD00\uB9AC\uD569\uB2C8\uB2E4.',
  },
  classes: {
    label: '\uC218\uC5C5 \uAD00\uB9AC',
    icon: Calendar,
    description: '\uC218\uC5C5 \uC0C1\uD0DC, \uC2DC\uAC04\uD45C, \uB2F4\uB2F9 \uC120\uC0DD\uB2D8, \uAC15\uC758\uC2E4\uACFC \uC5F0\uACB0 \uD559\uC0DD \uC815\uBCF4\uB97C \uD55C \uACF3\uC5D0 \uC815\uB9AC\uD569\uB2C8\uB2E4.',
  },
  textbooks: {
    label: '\uAD50\uC7AC \uAD00\uB9AC',
    icon: Book,
    description: '\uAD50\uC7AC, \uCD9C\uD310\uC0AC, \uCC38\uC870 \uBA54\uBAA8, \uC218\uC5C5 \uC5F0\uACB0 \uC815\uBCF4\uB97C \uC815\uB9AC\uD569\uB2C8\uB2E4.',
  },
};

export default function DataManager({ data = EMPTY_DATA, dataService, onOpenCurriculum }) {
  const safeData = useMemo(
    () => ({
      ...EMPTY_DATA,
      ...data,
    }),
    [data]
  );

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

  const activeMeta = TAB_META[activeTab];
  const tabs = useMemo(
    () => [
      { id: 'students', label: TAB_META.students.label, icon: Users },
      { id: 'classes', label: TAB_META.classes.label, icon: Calendar },
      { id: 'textbooks', label: TAB_META.textbooks.label, icon: Book },
    ],
    []
  );

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
        classTerms={safeData.classTerms}
        academicSchools={safeData.academicSchools}
        academicExamDays={safeData.academicExamDays}
        academicEventExamDetails={safeData.academicEventExamDetails}
        academicEvents={safeData.academicEvents}
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
      {viewingClassStudents ? (
        <StudentManifestModal
          cls={viewingClassStudents}
          data={safeData}
          onClose={() => setViewingClassStudents(null)}
          onManage={() => {
            setEditingClass(viewingClassStudents);
            setViewingClassStudents(null);
          }}
        />
      ) : null}

      <section className="workspace-surface" style={{ padding: 20, marginBottom: 24 }}>
        <div
          className="h-segment-container"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
            padding: 6,
            background: 'var(--bg-surface-hover)',
            borderRadius: 24,
          }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`h-segment-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                style={{ padding: '13px 14px', fontSize: 14, justifyContent: 'center', minHeight: 52 }}
              >
                <Icon size={18} style={{ marginRight: 8 }} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {actions.isProcessing ? (
        <div
          style={{
            margin: '0 0 20px',
            padding: '14px 16px',
            borderRadius: 16,
            background: 'rgba(33, 110, 78, 0.08)',
            border: '1px solid rgba(33, 110, 78, 0.16)',
            color: 'var(--text-secondary)',
          }}
        >
          요청을 처리하고 있습니다. 업로드나 일괄 수정이 완료될 때까지 잠시만 기다려 주세요.
        </div>
      ) : null}

      <div style={{ padding: '0 4px 24px' }}>
        {activeTab === 'students' ? (
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
            sectionDescription={activeMeta.description}
          />
        ) : null}

        {activeTab === 'classes' ? (
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
            sectionDescription={activeMeta.description}
          />
        ) : null}

        {activeTab === 'textbooks' ? (
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
            sectionDescription={activeMeta.description}
            onOpenCurriculum={onOpenCurriculum}
          />
        ) : null}
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


