import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, User } from 'lucide-react';
import {
  DAY_LABELS,
  generateTimeSlots,
  getTeacherCanonicalKey,
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

const ALL_TEACHERS = '__all_teachers__';

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

export default function TeacherWeeklyView({
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
}) {
  const { isMobile } = useViewport();
  const toast = useToast();
  const { isStaff, isTeacher, user } = useAuth();
  const [selectedTeacher, setSelectedTeacher] = useState(ALL_TEACHERS);
  const [selectedMobileDay, setSelectedMobileDay] = useState(DAY_LABELS[0]);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [createState, setCreateState] = useState(null);
  const [moveState, setMoveState] = useState(null);
  const [plannerMode, setPlannerMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const scheduleRef = useRef(null);

  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);
  const teacherEntries = useMemo(() => collectTeacherEntries(allClasses), [allClasses]);
  const classroomOptions = useMemo(() => collectClassroomEntries(allClasses).map((entry) => entry.label), [allClasses]);
  const fieldOptions = useMemo(() => ({
    subjects: collectSubjectOptions(allClasses),
    grades: collectGradeOptions(allClasses),
    teachers: teacherEntries.map((entry) => entry.label),
    classrooms: classroomOptions,
  }), [allClasses, teacherEntries, classroomOptions]);
  const selectedTeacherEntry = useMemo(
    () => teacherEntries.find((entry) => entry.key === selectedTeacher) || null,
    [selectedTeacher, teacherEntries]
  );

  useEffect(() => {
    if (selectedTeacher === ALL_TEACHERS) {
      return;
    }

    if (!selectedTeacherEntry) {
      setSelectedTeacher(ALL_TEACHERS);
    }
  }, [selectedTeacher, selectedTeacherEntry]);
  useEffect(() => {
    if (!isMobile || teacherEntries.length === 0 || selectedTeacher !== ALL_TEACHERS) {
      return;
    }

    setSelectedTeacher(teacherEntries[0].key);
  }, [isMobile, selectedTeacher, teacherEntries]);
  useEffect(() => {
    if (!plannerMode) {
      return;
    }
    setCreateState(null);
    setMoveState(null);
  }, [plannerMode]);
  const canEditTimetable = Boolean(isStaff && selectedTeacher !== ALL_TEACHERS && selectedTeacherEntry);
  const canExportImage = selectedTeacher !== ALL_TEACHERS && Boolean(selectedTeacherEntry);

  const buildBlocksForTeacher = useCallback(
    (targetTeacherKey) =>
      classes.flatMap((cls, colorIndex) => {
        const meta = getClassMeta(cls);
        const editableState = isEditableScheduleClass(cls);
        const editableSlots = buildEditableSlots(cls);

        return parseSchedule(cls.schedule, cls).flatMap((slot, slotIndex) => {
          const teacherNames = resolveSlotTeachers(cls, slot);
          const matchedTeacher = teacherNames.find((teacherName) => getTeacherCanonicalKey(teacherName) === targetTeacherKey);
          if (!matchedTeacher) return [];

          const dayIndex = DAY_LABELS.indexOf(slot.day);
          if (dayIndex === -1) return [];

          const classroom = resolveSlotClassroom(cls, slot) || cls.classroom || cls.room || '-';
          const canOpen = canTeacherOpenClass({ isStaff, isTeacher, user, teacherNames });
          const palette = getClassColor(colorIndex);
          const startSlot = timeToSlotIndex(slot.start, 9);
          const endSlot = Math.max(timeToSlotIndex(slot.end, 9), startSlot + 1);
          const editSlot = editableSlots[slotIndex];

          return [{
            key: `${cls.id}-${targetTeacherKey}-${slot.day}-${slot.start}-${slot.end}-${classroom}`,
            columnIndex: dayIndex,
            startSlot,
            endSlot,
            backgroundColor: palette.bg,
            borderColor: palette.border,
            textColor: palette.text,
            clickable: canOpen,
            editable: canEditTimetable && editableState.editable,
            editableReason: editableState.reason,
            editData: editSlot ? { classItem: cls, slotId: editSlot.slotId, teacher: matchedTeacher, classroom } : null,
            onClick: () => canOpen && setSelectedClassForDetails(cls),
            variantDot: Boolean(meta.hasVariants),
            variantDotTitle: editableState.editable ? '드래그로 이동할 수 있습니다.' : editableState.reason,
            header: cls.subject ? `[${cls.subject}]` : '',
            title: stripClassPrefix(cls.className),
            detailLines: [{ label: '강의실', value: classroom }],
            tooltip: buildTimetableTooltip({ cls, teacher: matchedTeacher, classroom, meta }),
          }];
        });
      }),
    [classes, canEditTimetable, isStaff, isTeacher, user]
  );

  const handleSaveImage = useCallback(async () => {
    if (!canExportImage) {
      toast.info('이미지 저장은 단일 선생님을 선택했을 때만 사용할 수 있습니다.');
      return;
    }

    try {
      await exportElementAsImage(scheduleRef.current, `teacher-${selectedTeacher}-weekly.png`, {
        preset: 'a4-portrait',
      });
      toast.success('선생님 시간표 이미지를 저장했습니다.');
    } catch {
      toast.error('이미지 저장에 실패했습니다.');
    }
  }, [canExportImage, selectedTeacher, toast]);

  const handleCreateSelection = ({ columnIndex, startSlot, endSlot }) => {
    if (!selectedTeacherEntry) return;
    const range = getRangeFromSlots(timeSlots, startSlot, endSlot);
    const day = DAY_LABELS[columnIndex];

    setCreateState({
      summary: {
        day,
        start: range.start,
        end: range.end,
        fixedAxisLabel: '선생님',
        fixedAxisValue: selectedTeacherEntry.label,
      },
      draft: buildQuickCreateDraft({
        day,
        start: range.start,
        end: range.end,
        classroom: classroomOptions[0] || '',
        teacher: selectedTeacherEntry.label,
        defaultStatus,
        period: defaultPeriod,
      }),
      slot: { day, ...range, teacher: selectedTeacherEntry.label },
    });
  };

  const handleMoveBlock = ({ block, columnIndex, startSlot }) => {
    const range = getRangeFromSlots(timeSlots, startSlot, startSlot + (block.endSlot - block.startSlot));
    const day = DAY_LABELS[columnIndex];

    setMoveState({
      block,
      next: { day, ...range, teacher: selectedTeacherEntry?.label || '' },
      warnings: findScheduleConflicts({
        classes,
        ignoreClassId: block.editData.classItem.id,
        slot: { day, start: range.start, end: range.end },
        teacher: selectedTeacherEntry?.label,
        classroom: block.editData.classroom,
      }),
    });
  };

  const confirmCreate = async () => {
    const validationError = validateQuickCreateDraft(createState?.draft);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    try {
      await dataService.addClass({
        ...buildQuickClassPayload(createState.draft, { fallbackTeacher: createState.slot.teacher }),
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
      const { classItem, slotId, classroom } = moveState.block.editData;
      const { updates } = applySlotMove({
        cls: classItem,
        slotId,
        nextDay: moveState.next.day,
        nextStart: moveState.next.start,
        nextEnd: moveState.next.end,
        nextTeacher: moveState.next.teacher,
        nextClassroom: classroom,
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

  const renderGrid = (teacherEntry) => {
    const blocks = buildBlocksForTeacher(teacherEntry.key);
    const isAllView = selectedTeacher === ALL_TEACHERS;
    const showEditableEmptyGrid = !isAllView && canEditTimetable && teacherEntry.key === selectedTeacher && blocks.length === 0;
    const showEmptyState = blocks.length === 0 && !showEditableEmptyGrid;

    return (
      <section className={`card ${isAllView ? 'view-all-container' : ''}`} key={teacherEntry.key} style={{ padding: 24, marginBottom: isAllView ? 0 : 24, breakInside: 'avoid' }}>
        <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <User size={20} className="text-accent" /> {teacherEntry.label} 주간 시간표
        </h2>
        {showEditableEmptyGrid && (
          <div style={{ marginBottom: 14, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
            아직 배정된 수업이 없습니다. 빈 시간표를 드래그해서 개강 준비 중 수업을 바로 생성할 수 있습니다.
          </div>
        )}
        {showEmptyState ? (
          <EmptyState message="해당 선생님에게 배정된 수업이 없습니다." />
        ) : (
          <div className={isAllView ? 'view-all-mode' : undefined} style={isAllView ? { overflow: 'hidden', height: `${Math.round((timeSlots.length * 48 + 48) * 0.65)}px` } : undefined}>
            <TimetableGrid
              columns={DAY_LABELS}
              timeSlots={timeSlots}
              blocks={blocks}
              timeLabel="시간"
              editable={Boolean(canEditTimetable && teacherEntry.key === selectedTeacher)}
              onCreateSelection={handleCreateSelection}
              onMoveBlock={handleMoveBlock}
            />
          </div>
        )}
      </section>
    );
  };

  const targetsToRender = selectedTeacher === ALL_TEACHERS ? teacherEntries : teacherEntries.filter((entry) => entry.key === selectedTeacher);
  const mobileBlocks = useMemo(
    () => (selectedTeacherEntry ? buildBlocksForTeacher(selectedTeacherEntry.key) : []),
    [buildBlocksForTeacher, selectedTeacherEntry]
  );

  if (plannerMode) {
    return (
      <div className="animate-in">
        <div className="embedded-view-toolbar">
          <div className="embedded-view-copy">
            <div className="embedded-view-title">배치 모드</div>
            <div className="embedded-view-description">선생님 기준으로 수업을 만들고 배치한 뒤 마지막에 한 번만 적용합니다.</div>
          </div>
          <button className="action-pill" onClick={() => setPlannerMode(false)}>
            배치 모드 종료
          </button>
        </div>
        <NextSemesterPlannerView
          surface="teacher-weekly"
          classes={classes}
          allClasses={allClasses}
          data={data}
          dataService={dataService}
          defaultStatus={defaultStatus}
          defaultPeriod={defaultPeriod}
          termKey={termKey}
          termStatus={termStatus}
          terms={terms}
          selectedBoardValue={selectedTeacher === ALL_TEACHERS ? '' : selectedTeacherEntry?.label || ''}
        />
      </div>
    );
  }

  return (
    <div className="animate-in">
      {!embedded ? (
        <div className="page-header">
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {onBack && (
                <button className="btn-icon" onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
                  <ArrowLeft size={20} />
                </button>
              )}
              <User size={28} /> 선생님별 주간 시간표
            </h1>
            <p>선생님 기준 주간 배정을 보고, 직원 권한에서는 블록 드래그로 시간표를 빠르게 수정할 수 있습니다.</p>
          </div>
          <button className="btn btn-primary" onClick={handleSaveImage} disabled={!canExportImage} title={canExportImage ? '현재 선생님 시간표를 A4 세로 이미지로 저장합니다.' : '전체 보기에서는 이미지 저장을 사용할 수 없습니다.'}>
            <Camera size={18} /> 이미지 저장
          </button>
        </div>
      ) : (
        <div className="embedded-view-toolbar">
          <div className="embedded-view-copy">
            <div className="embedded-view-title">선생님 주간 시간표</div>
            <div className="embedded-view-description">선생님 기준 주간 배치를 빠르게 보고 수정할 수 있습니다.</div>
          </div>
          <button className="action-chip" onClick={handleSaveImage} disabled={!canExportImage} title={canExportImage ? '현재 선생님 시간표를 A4 세로 이미지로 저장합니다.' : '전체 보기에서는 이미지 저장을 사용할 수 없습니다.'}>
            <Camera size={16} /> 이미지 저장
          </button>
        </div>
      )}

      <div className="filter-bar">
        <div className="h-segment-container">
          <button className={`h-segment-btn ${selectedTeacher === ALL_TEACHERS ? 'active' : ''}`} onClick={() => setSelectedTeacher(ALL_TEACHERS)}>
            전체 보기
          </button>
          {teacherEntries.map((teacherEntry) => (
            <button key={teacherEntry.key} className={`h-segment-btn ${selectedTeacher === teacherEntry.key ? 'active' : ''}`} onClick={() => setSelectedTeacher(teacherEntry.key)}>
              {teacherEntry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="embedded-view-toolbar" style={{ marginBottom: 16 }}>
        <div className="embedded-view-copy">
          <div className="embedded-view-title">배치 워크스페이스</div>
          <div className="embedded-view-description">수업명만 먼저 만들고 시간표에 배치한 뒤 마지막에 한 번만 적용합니다.</div>
        </div>
        <button className="action-pill" onClick={() => setPlannerMode(true)}>
          배치 모드 열기
        </button>
      </div>

      {teacherEntries.length === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <EmptyState message="표시할 선생님 데이터가 없습니다." />
        </div>
      ) : isMobile ? (
        <div ref={scheduleRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <MobileAgendaTimetable
            title={selectedTeacherEntry ? `${selectedTeacherEntry.label} 주간 시간표` : '선생님 주간 시간표'}
            options={DAY_LABELS.map((day) => ({ key: day, label: day }))}
            selectedKey={selectedMobileDay}
            onSelectKey={setSelectedMobileDay}
            emptyMessage="아직 선생님에게 배치된 수업이 없습니다."
            blocks={mobileBlocks}
            timeSlots={timeSlots}
            editable={canEditTimetable}
            onCreateSelection={handleCreateSelection}
            onMoveBlock={handleMoveBlock}
            onBlockClick={(block) => block.onClick?.()}
          />
        </div>
      ) : (
        <div ref={scheduleRef} className={selectedTeacher === ALL_TEACHERS ? 'view-all-grid-container' : undefined}>
          {targetsToRender.map(renderGrid)}
        </div>
      )}

      <TimetableEditDialog
        open={Boolean(createState)}
        mode="create"
        draft={createState?.draft || {}}
        summary={createState?.summary || {}}
        fieldOptions={fieldOptions}
        warnings={createState ? findQuickCreateConflicts({
          classes,
          scheduleLines: createState.draft.scheduleLines,
          teacher: createState.slot.teacher,
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
          fixedAxisLabel: '선생님',
          fixedAxisValue: moveState.next.teacher,
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
