import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, School } from 'lucide-react';
import {
  DAY_LABELS,
  generateTimeSlots,
  getClassroomCanonicalKey,
  parseSchedule,
  stripClassPrefix,
  timeToSlotIndex,
} from '../data/sampleData';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import ClassDetailModal from './ClassDetailModal';
import TimetableGrid from './ui/TimetableGrid';
import TimetableEditDialog from './ui/TimetableEditDialog';
import MobileAgendaTimetable from './ui/MobileAgendaTimetable';
import NextSemesterPlannerView from './NextSemesterPlannerView';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { exportElementAsImage } from '../lib/exportAsImage';
import useViewport from '../hooks/useViewport';
import {
  buildQuickClassPayload,
  buildQuickCreateDraft,
  validateQuickCreateDraft,
} from '../lib/quickClassSchedule';
import {
  buildTimetableTooltip,
  canTeacherOpenClass,
  collectClassroomEntries,
  collectGradeOptions,
  collectSubjectOptions,
  collectTeacherEntries,
  getClassColor,
  getClassMeta,
  resolveSlotClassroom,
  resolveSlotTeachers,
} from './timetableViewUtils';
import {
  applySlotMove,
  buildEditableSlots,
  findScheduleConflicts,
  findQuickCreateConflicts,
  isEditableScheduleClass,
} from '../lib/timetableEditing';

const ALL_CLASSROOMS = '__all_classrooms__';

function EmptyState({ message }) {
  return (
    <div
      style={{
        padding: '48px 20px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        background: 'var(--bg-surface-hover)',
        borderRadius: 16,
      }}
    >
      {message}
    </div>
  );
}

function getRangeFromSlots(timeSlots, startSlot, endSlot) {
  return {
    start: timeSlots[startSlot]?.split('-')[0] || '09:00',
    end: timeSlots[endSlot - 1]?.split('-')[1] || '09:30',
  };
}

export default function ClassroomWeeklyView({
  classes,
  allClasses = classes,
  data,
  dataService,
  onViewStudentSchedule,
  onBack,
  defaultStatus = '수업 진행 중',
  defaultPeriod = '',
  termKey = '',
  termStatus = defaultStatus,
  terms = [],
  embedded = false,
  floatingFilters = false,
  subjectOptions = [],
  selectedSubject = '전체',
  onSelectSubject = () => {},
}) {
  const { isMobile } = useViewport();
  const toast = useToast();
  const { isStaff, isTeacher, user } = useAuth();
  const [selectedClassroom, setSelectedClassroom] = useState(ALL_CLASSROOMS);
  const [selectedMobileDay, setSelectedMobileDay] = useState(DAY_LABELS[0]);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [createState, setCreateState] = useState(null);
  const [moveState, setMoveState] = useState(null);
  const [plannerMode, setPlannerMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const scheduleRef = useRef(null);

  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);
  const classroomEntries = useMemo(() => collectClassroomEntries(allClasses), [allClasses]);
  const teacherOptions = useMemo(() => collectTeacherEntries(allClasses).map((entry) => entry.label), [allClasses]);
  const fieldOptions = useMemo(() => ({
    subjects: collectSubjectOptions(allClasses),
    grades: collectGradeOptions(allClasses),
    teachers: teacherOptions,
    classrooms: classroomEntries.map((entry) => entry.label),
  }), [allClasses, teacherOptions, classroomEntries]);
  const selectedClassroomEntry = useMemo(
    () => classroomEntries.find((entry) => entry.key === selectedClassroom) || null,
    [classroomEntries, selectedClassroom]
  );

  useEffect(() => {
    if (selectedClassroom === ALL_CLASSROOMS) {
      return;
    }

    if (!selectedClassroomEntry) {
      setSelectedClassroom(ALL_CLASSROOMS);
    }
  }, [selectedClassroom, selectedClassroomEntry]);
  useEffect(() => {
    if (!isMobile || classroomEntries.length === 0 || selectedClassroom !== ALL_CLASSROOMS) {
      return;
    }

    setSelectedClassroom(classroomEntries[0].key);
  }, [classroomEntries, isMobile, selectedClassroom]);
  useEffect(() => {
    if (!plannerMode) {
      return;
    }
    setCreateState(null);
    setMoveState(null);
  }, [plannerMode]);
  useEffect(() => {
    const openPlanner = () => setPlannerMode(true);
    window.addEventListener('tips-open-planner', openPlanner);
    return () => window.removeEventListener('tips-open-planner', openPlanner);
  }, []);
  const canEditTimetable = Boolean(isStaff && selectedClassroom !== ALL_CLASSROOMS && selectedClassroomEntry);
  const canExportImage = selectedClassroom !== ALL_CLASSROOMS && Boolean(selectedClassroomEntry);

  const buildBlocksForClassroom = useCallback(
    (targetKey) =>
      classes.flatMap((cls, colorIndex) => {
        const meta = getClassMeta(cls);
        const editableState = isEditableScheduleClass(cls);
        const editableSlots = buildEditableSlots(cls);

        return parseSchedule(cls.schedule, cls).flatMap((slot, slotIndex) => {
          const classroom = resolveSlotClassroom(cls, slot);
          const classroomKey = getClassroomCanonicalKey(classroom);
          if (!classroomKey || classroomKey !== targetKey) {
            return [];
          }

          const teacherNames = resolveSlotTeachers(cls, slot);
          const primaryTeacher = teacherNames[0] || cls.teacher || '-';
          const canOpen = canTeacherOpenClass({ isStaff, isTeacher, user, teacherNames });
          const dayIndex = DAY_LABELS.indexOf(slot.day);
          if (dayIndex === -1) {
            return [];
          }

          const palette = getClassColor(colorIndex);
          const startSlot = timeToSlotIndex(slot.start, 9);
          const endSlot = Math.max(timeToSlotIndex(slot.end, 9), startSlot + 1);
          const editSlot = editableSlots[slotIndex];

          return [{
            key: `${cls.id}-${classroomKey}-${slot.day}-${slot.start}-${slot.end}-${primaryTeacher}`,
            columnIndex: dayIndex,
            startSlot,
            endSlot,
            backgroundColor: palette.bg,
            borderColor: palette.border,
            textColor: palette.text,
            clickable: canOpen,
            editable: canEditTimetable && editableState.editable,
            editableReason: editableState.reason,
            editData: editSlot ? { classItem: cls, slotId: editSlot.slotId, teacher: primaryTeacher, classroom } : null,
            onClick: () => {
              if (canOpen) {
                setSelectedClassForDetails(cls);
              }
            },
            variantDot: Boolean(meta.hasVariants),
            variantDotTitle: editableState.editable ? '드래그로 이동할 수 있습니다.' : editableState.reason,
            header: cls.subject ? `[${cls.subject}]` : '',
            title: stripClassPrefix(cls.className),
            detailLines: [{ label: '선생님', value: primaryTeacher }],
            tooltip: buildTimetableTooltip({ cls, teacher: primaryTeacher, classroom, meta }),
          }];
        });
      }),
    [classes, canEditTimetable, isStaff, isTeacher, user]
  );

  const handleSaveImage = useCallback(async () => {
    if (!canExportImage) {
      toast.info('이미지 저장은 단일 강의실을 선택했을 때만 사용할 수 있습니다.');
      return;
    }

    try {
      await exportElementAsImage(scheduleRef.current, `classroom-${selectedClassroom}-weekly.png`, {
        preset: 'a4-portrait',
      });
      toast.success('강의실 시간표 이미지를 저장했습니다.');
    } catch {
      toast.error('이미지 저장에 실패했습니다.');
    }
  }, [canExportImage, selectedClassroom, toast]);

  const handleSaveCardImage = useCallback(async (event, fileName) => {
    const card = event.currentTarget.closest('section');
    if (!card) return;
    try {
      await exportElementAsImage(card, fileName, { preset: 'a4-portrait' });
      toast.success('현재 시간표 카드를 이미지로 저장했습니다.');
    } catch {
      toast.error('시간표 카드 이미지 저장에 실패했습니다.');
    }
  }, [toast]);

  const handleCreateSelection = ({ columnIndex, startSlot, endSlot }) => {
    if (!selectedClassroomEntry) return;
    const range = getRangeFromSlots(timeSlots, startSlot, endSlot);
    const day = DAY_LABELS[columnIndex];

    setCreateState({
      summary: {
        day,
        start: range.start,
        end: range.end,
        fixedAxisLabel: '강의실',
        fixedAxisValue: selectedClassroomEntry.label,
      },
      draft: buildQuickCreateDraft({
        day,
        start: range.start,
        end: range.end,
        classroom: selectedClassroomEntry.label,
        teacher: teacherOptions[0] || '',
        defaultStatus,
        period: defaultPeriod,
      }),
      slot: { day, ...range, classroom: selectedClassroomEntry.label },
    });
  };

  const handleMoveBlock = ({ block, columnIndex, startSlot }) => {
    const range = getRangeFromSlots(timeSlots, startSlot, startSlot + (block.endSlot - block.startSlot));
    const day = DAY_LABELS[columnIndex];
    const warnings = findScheduleConflicts({
      classes,
      ignoreClassId: block.editData.classItem.id,
      slot: { day, start: range.start, end: range.end },
      teacher: block.editData.teacher,
      classroom: selectedClassroomEntry?.label,
    });

    setMoveState({
      block,
      next: { day, ...range, classroom: selectedClassroomEntry?.label || '' },
      warnings,
    });
  };

  const confirmCreate = async () => {
    const validationError = validateQuickCreateDraft(createState?.draft, { needsTeacher: true });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    try {
      await dataService.addClass({
        ...buildQuickClassPayload(createState.draft),
        studentIds: [],
        waitlistIds: [],
        textbookIds: [],
        textbookInfo: '',
        lessons: [],
        capacity: 0,
        fee: 0,
        startDate: '',
        endDate: '',
      });
      setCreateState(null);
      toast.success('새 수업을 시간표에 추가했습니다.');
    } catch (error) {
      toast.error(`수업 생성에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const confirmMove = async () => {
    if (!moveState?.block?.editData) return;

    setIsSaving(true);
    try {
      const { classItem, slotId, teacher } = moveState.block.editData;
      const { updates } = applySlotMove({
        cls: classItem,
        slotId,
        nextDay: moveState.next.day,
        nextStart: moveState.next.start,
        nextEnd: moveState.next.end,
        nextTeacher: teacher,
        nextClassroom: moveState.next.classroom,
      });
      await dataService.updateClass(classItem.id, { ...classItem, ...updates });
      setMoveState(null);
      toast.success('시간표 위치를 업데이트했습니다.');
    } catch (error) {
      toast.error(`시간표 이동에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const renderGrid = (classroomEntry) => {
    const blocks = buildBlocksForClassroom(classroomEntry.key);
    const isAllView = selectedClassroom === ALL_CLASSROOMS;
    const showEditableEmptyGrid = !isAllView && canEditTimetable && classroomEntry.key === selectedClassroom && blocks.length === 0;
    const showEmptyState = blocks.length === 0 && !showEditableEmptyGrid;

    return (
      <section className={`card ${isAllView ? 'view-all-container' : ''}`} key={classroomEntry.key} style={{ position: 'relative', padding: 24, marginBottom: isAllView ? 0 : 24, breakInside: 'avoid' }}>
        <button
          type="button"
          className="timetable-card-camera"
          onClick={(event) => handleSaveCardImage(event, `classroom-${classroomEntry.key}-weekly.png`)}
          title="현재 시간표 카드 이미지를 저장합니다."
        >
          <Camera size={14} />
        </button>
        <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <School size={20} className="text-accent" /> {classroomEntry.label} 주간 시간표
        </h2>
        {showEditableEmptyGrid && (
          <div style={{ marginBottom: 14, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
            아직 배정된 수업이 없습니다. 빈 시간표를 드래그해서 개강 준비 중 수업을 바로 생성할 수 있습니다.
          </div>
        )}
        {showEmptyState ? (
          <EmptyState message="해당 강의실에 배정된 수업이 없습니다." />
        ) : (
          <div className={isAllView ? 'view-all-mode' : undefined} style={isAllView ? { overflow: 'hidden', height: `${Math.round((timeSlots.length * 48 + 48) * 0.65)}px` } : undefined}>
            <TimetableGrid
              columns={DAY_LABELS}
              timeSlots={timeSlots}
              blocks={blocks}
              timeLabel="시간"
              editable={Boolean(canEditTimetable && classroomEntry.key === selectedClassroom)}
              onCreateSelection={handleCreateSelection}
              onMoveBlock={handleMoveBlock}
            />
          </div>
        )}
      </section>
    );
  };

  const targetsToRender = selectedClassroom === ALL_CLASSROOMS ? classroomEntries : classroomEntries.filter((entry) => entry.key === selectedClassroom);
  const mobileBlocks = useMemo(
    () => (selectedClassroomEntry ? buildBlocksForClassroom(selectedClassroomEntry.key) : []),
    [buildBlocksForClassroom, selectedClassroomEntry]
  );
  const floatingPanelTarget = typeof document !== 'undefined' ? document.getElementById('timetable-floating-slot') : null;

  if (plannerMode) {
    return (
      <div className="animate-in">
        <div className="embedded-view-toolbar">
          <div className="embedded-view-copy">
            <div className="embedded-view-title">배치 모드</div>
            <div className="embedded-view-description">강의실 기준으로 수업을 만들고 배치한 뒤 마지막에 한 번만 적용합니다.</div>
          </div>
          <button className="action-pill" onClick={() => setPlannerMode(false)}>
            배치 모드 종료
          </button>
        </div>
        <NextSemesterPlannerView
          surface="classroom-weekly"
          classes={classes}
          allClasses={allClasses}
          data={data}
          dataService={dataService}
          defaultStatus={defaultStatus}
          defaultPeriod={defaultPeriod}
          termKey={termKey}
          termStatus={termStatus}
          terms={terms}
          selectedBoardValue={selectedClassroom === ALL_CLASSROOMS ? '' : selectedClassroomEntry?.label || ''}
        />
      </div>
    );
  }

  return (
    <div className="animate-in">
      {floatingFilters && floatingPanelTarget && createPortal(
        <div className="timetable-floating-controls">
          <div className="h-segment-container timetable-floating-selector">
            <button className={`h-segment-btn ${selectedClassroom === ALL_CLASSROOMS ? 'active' : ''}`} onClick={() => setSelectedClassroom(ALL_CLASSROOMS)}>	
              {'\uC804\uCCB4 \uBCF4\uAE30'}
            </button>
            {classroomEntries.map((classroomEntry) => (
              <button key={classroomEntry.key} className={`h-segment-btn ${selectedClassroom === classroomEntry.key ? 'active' : ''}`} onClick={() => setSelectedClassroom(classroomEntry.key)}>	
                {classroomEntry.label}
              </button>
            ))}
          </div>
          <button className="action-pill timetable-floating-action" onClick={() => setPlannerMode(true)}>	
            {'\uBC30\uCE58 \uBAA8\uB4DC \uC5F4\uAE30'}
          </button>
        </div>,
        floatingPanelTarget
      )}
      {!embedded ? (
        <div className="page-header">
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {onBack && (
                <button className="btn-icon" onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
                  <ArrowLeft size={20} />
                </button>
              )}
              <School size={28} /> 강의실별 주간 시간표
            </h1>
            <p>강의실 배정 상태를 한눈에 보고, 직원 권한에서는 블록 드래그로 시간표를 빠르게 수정할 수 있습니다.</p>
          </div>
        </div>
      ) : !floatingFilters ? (
        <div className="embedded-view-toolbar">
          <div className="embedded-view-copy">
            <div className="embedded-view-title">강의실 주간 시간표</div>
            <div className="embedded-view-description">강의실 기준 주간 배치를 빠르게 보고 수정할 수 있습니다.</div>
          </div>
        </div>
      ) : null}

      <div className={`filter-bar ${floatingFilters ? 'filter-bar-floating' : ''}`} style={{ display: !isMobile ? 'none' : undefined }}>
        {floatingFilters && (
          <div className="timetable-inline-subject-filter">
            <span className="timetable-inline-subject-label">과목</span>
            <div className="h-segment-container timetable-inline-subject-segment">
              {subjectOptions.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  className={`h-segment-btn ${selectedSubject === subject ? 'active' : ''}`}
                  onClick={() => onSelectSubject(subject)}
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="h-segment-container">
          <button className={`h-segment-btn ${selectedClassroom === ALL_CLASSROOMS ? 'active' : ''}`} onClick={() => setSelectedClassroom(ALL_CLASSROOMS)}>
            전체 보기
          </button>
          {classroomEntries.map((classroomEntry) => (
            <button key={classroomEntry.key} className={`h-segment-btn ${selectedClassroom === classroomEntry.key ? 'active' : ''}`} onClick={() => setSelectedClassroom(classroomEntry.key)}>
              {classroomEntry.label}
            </button>
          ))}
        </div>
      </div>
      {classroomEntries.length === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <EmptyState message="표시할 강의실 데이터가 없습니다." />
        </div>
      ) : isMobile ? (
        <div ref={scheduleRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <MobileAgendaTimetable
            title={selectedClassroomEntry ? `${selectedClassroomEntry.label} 주간 시간표` : '강의실 주간 시간표'}
            options={DAY_LABELS.map((day) => ({ key: day, label: day }))}
            selectedKey={selectedMobileDay}
            onSelectKey={setSelectedMobileDay}
            emptyMessage="해당 강의실에 배정된 수업이 없습니다."
            blocks={mobileBlocks}
            timeSlots={timeSlots}
            editable={canEditTimetable}
            onCreateSelection={handleCreateSelection}
            onMoveBlock={handleMoveBlock}
            onBlockClick={(block) => block.onClick?.()}
          />
        </div>
      ) : (
        <div ref={scheduleRef} className={selectedClassroom === ALL_CLASSROOMS ? 'view-all-grid-container' : undefined}>
          {targetsToRender.map(renderGrid)}
        </div>
      )}

      <TimetableEditDialog
        open={Boolean(createState)}
        mode="create"
        draft={createState?.draft || {}}
        summary={createState?.summary || {}}
        needsTeacher
        fieldOptions={fieldOptions}
        warnings={createState ? findQuickCreateConflicts({
          classes,
          scheduleLines: createState.draft.scheduleLines,
          teacher: createState.draft.teacher,
        }) : []}
        busy={isSaving}
        onChange={(key, value) => setCreateState((current) => (
          current
            ? { ...current, draft: { ...(current.draft || {}), [key]: value } }
            : current
        ))}
        onCancel={() => setCreateState(null)}
        onConfirm={confirmCreate}
      />

      <TimetableEditDialog
        open={Boolean(moveState)}
        mode="move"
        draft={{}}
        summary={moveState ? {
          day: moveState.next.day,
          start: moveState.next.start,
          end: moveState.next.end,
          fixedAxisLabel: '강의실',
          fixedAxisValue: moveState.next.classroom,
          className: stripClassPrefix(moveState.block.editData.classItem.className),
          previousTime: `${DAY_LABELS[moveState.block.columnIndex]} ${getRangeFromSlots(timeSlots, moveState.block.startSlot, moveState.block.endSlot).start} ~ ${getRangeFromSlots(timeSlots, moveState.block.startSlot, moveState.block.endSlot).end}`,
          nextTime: `${moveState.next.day} ${moveState.next.start} ~ ${moveState.next.end}`,
        } : {}}
        warnings={moveState?.warnings || []}
        busy={isSaving}
        onChange={() => {}}
        onCancel={() => setMoveState(null)}
        onConfirm={confirmMove}
      />

      {selectedClassForDetails && (
        <ClassDetailModal
          cls={selectedClassForDetails}
          data={data}
          dataService={dataService}
          onClose={() => setSelectedClassForDetails(null)}
          onNavigateToStudent={onViewStudentSchedule}
        />
      )}
    </div>
  );
}
