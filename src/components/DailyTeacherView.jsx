import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, Users } from 'lucide-react';
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

const ALL_DAYS = '__all_days__';

function EmptyState({ message }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 16 }}>
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

export default function DailyTeacherView({
  classes,
  allClasses = classes,
  data,
  dataService,
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
  const [selectedDay, setSelectedDay] = useState(ALL_DAYS);
  const [selectedMobileTeacher, setSelectedMobileTeacher] = useState('');
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [createState, setCreateState] = useState(null);
  const [moveState, setMoveState] = useState(null);
  const [plannerMode, setPlannerMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const scheduleRef = useRef(null);

  const timeSlots = useMemo(() => generateTimeSlots(9, 24), []);
  const teacherEntries = useMemo(() => collectTeacherEntries(classes), [classes]);
  const classroomOptions = useMemo(() => collectClassroomEntries(classes).map((entry) => entry.label), [classes]);
  const fieldOptions = useMemo(() => ({
    subjects: collectSubjectOptions(classes),
    grades: collectGradeOptions(classes),
    teachers: teacherEntries.map((entry) => entry.label),
    classrooms: classroomOptions,
  }), [classes, teacherEntries, classroomOptions]);
  const teacherIndexMap = useMemo(() => new Map(teacherEntries.map((entry, index) => [entry.key, index])), [teacherEntries]);
  const canEditTimetable = Boolean(isStaff && selectedDay !== ALL_DAYS);
  const canExportImage = selectedDay !== ALL_DAYS;

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    if (selectedDay === ALL_DAYS) {
      setSelectedDay(DAY_LABELS[0]);
    }
  }, [isMobile, selectedDay]);

  useEffect(() => {
    if (!isMobile || teacherEntries.length === 0) {
      return;
    }

    if (!selectedMobileTeacher || !teacherEntries.some((entry) => entry.key === selectedMobileTeacher)) {
      setSelectedMobileTeacher(teacherEntries[0].key);
    }
  }, [isMobile, selectedMobileTeacher, teacherEntries]);
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

  const buildBlocksForDay = useCallback(
    (targetDay) =>
      classes.flatMap((cls, colorIndex) => {
        const meta = getClassMeta(cls);
        const editableState = isEditableScheduleClass(cls);
        const editableSlots = buildEditableSlots(cls);

        return parseSchedule(cls.schedule, cls).flatMap((slot, slotIndex) => {
          if (slot.day !== targetDay) return [];

          const teacherNames = resolveSlotTeachers(cls, slot);
          if (teacherNames.length === 0) return [];

          const classroom = resolveSlotClassroom(cls, slot) || cls.classroom || cls.room || '-';
          const canOpen = canTeacherOpenClass({ isStaff, isTeacher, user, teacherNames });
          const palette = getClassColor(colorIndex);
          const startSlot = timeToSlotIndex(slot.start, 9);
          const endSlot = Math.max(timeToSlotIndex(slot.end, 9), startSlot + 1);
          const editSlot = editableSlots[slotIndex];

          return teacherNames.flatMap((teacherName) => {
            const teacherKey = getTeacherCanonicalKey(teacherName);
            const columnIndex = teacherIndexMap.get(teacherKey);
            if (!teacherKey || columnIndex === undefined) return [];

            return [{
              key: `${cls.id}-${targetDay}-${teacherKey}-${slot.start}-${slot.end}`,
              columnIndex,
              startSlot,
              endSlot,
              backgroundColor: palette.bg,
              borderColor: palette.border,
              textColor: palette.text,
              clickable: canOpen,
              editable: canEditTimetable && editableState.editable,
              editableReason: editableState.reason,
              editData: editSlot ? { classItem: cls, slotId: editSlot.slotId, teacher: teacherName, classroom } : null,
              onClick: () => canOpen && setSelectedClassForDetails(cls),
              variantDot: Boolean(meta.hasVariants),
              variantDotTitle: editableState.editable ? '드래그로 이동할 수 있습니다.' : editableState.reason,
              header: cls.subject ? `[${cls.subject}]` : '',
              title: stripClassPrefix(cls.className),
              detailLines: [{ label: '강의실', value: classroom }],
              tooltip: buildTimetableTooltip({ cls, teacher: teacherName, classroom, meta }),
            }];
          });
        });
      }),
    [classes, teacherIndexMap, canEditTimetable, isStaff, isTeacher, user]
  );

  const handleSaveImage = useCallback(async () => {
    if (!canExportImage) {
      toast.info('이미지 저장은 단일 요일을 선택했을 때만 사용할 수 있습니다.');
      return;
    }

    try {
      await exportElementAsImage(scheduleRef.current, `daily-teacher-${selectedDay}.png`, {
        preset: 'a4-portrait',
      });
      toast.success('일별 선생님 시간표 이미지를 저장했습니다.');
    } catch {
      toast.error('이미지 저장에 실패했습니다.');
    }
  }, [canExportImage, selectedDay, toast]);

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
    const range = getRangeFromSlots(timeSlots, startSlot, endSlot);
    const teacher = teacherEntries[columnIndex]?.label || '';
    setCreateState({
      summary: { day: selectedDay, start: range.start, end: range.end, fixedAxisLabel: '선생님', fixedAxisValue: teacher },
      draft: buildQuickCreateDraft({
        day: selectedDay,
        start: range.start,
        end: range.end,
        classroom: classroomOptions[0] || '',
        teacher,
        defaultStatus,
        period: defaultPeriod,
      }),
      slot: { day: selectedDay, ...range, teacher },
    });
  };

  const handleMoveBlock = ({ block, columnIndex, startSlot }) => {
    const range = getRangeFromSlots(timeSlots, startSlot, startSlot + (block.endSlot - block.startSlot));
    const teacher = teacherEntries[columnIndex]?.label || '';
    setMoveState({
      block,
      next: { day: selectedDay, ...range, teacher },
      warnings: findScheduleConflicts({
        classes,
        ignoreClassId: block.editData.classItem.id,
        slot: { day: selectedDay, start: range.start, end: range.end },
        teacher,
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

  const renderGrid = (dayLabel) => {
    const blocks = buildBlocksForDay(dayLabel);
    const isAllView = selectedDay === ALL_DAYS;
    const showEditableEmptyGrid = !isAllView && canEditTimetable && dayLabel === selectedDay && blocks.length === 0;
    const showEmptyState = blocks.length === 0 && !showEditableEmptyGrid;

    return (
      <section className={`card ${isAllView ? 'view-all-container' : ''}`} key={dayLabel} style={{ position: 'relative', padding: 24, marginBottom: isAllView ? 0 : 24, breakInside: 'avoid' }}>
        <button
          type="button"
          className="timetable-card-camera"
          onClick={(event) => handleSaveCardImage(event, `daily-teacher-${dayLabel}.png`)}
          title="현재 시간표 카드 이미지를 저장합니다."
        >
          <Camera size={14} />
        </button>
        <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={20} className="text-accent" /> {dayLabel}요일 선생님 시간표
        </h2>
        {showEditableEmptyGrid && (
          <div style={{ marginBottom: 14, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
            아직 배정된 수업이 없습니다. 빈 시간표를 드래그해서 개강 준비 중 수업을 바로 생성할 수 있습니다.
          </div>
        )}
        {showEmptyState ? (
          <EmptyState message="해당 요일에 배정된 선생님 수업이 없습니다." />
        ) : (
          <div className={isAllView ? 'view-all-mode' : undefined} style={isAllView ? { overflow: 'hidden', height: `${Math.round((timeSlots.length * 48 + 48) * 0.65)}px` } : undefined}>
            <TimetableGrid
              columns={teacherEntries.map((entry) => entry.label)}
              timeSlots={timeSlots}
              blocks={blocks}
              timeLabel="시간"
              editable={Boolean(canEditTimetable && dayLabel === selectedDay)}
              onCreateSelection={handleCreateSelection}
              onMoveBlock={handleMoveBlock}
            />
          </div>
        )}
      </section>
    );
  };

  const dayTabs = isMobile ? DAY_LABELS : [ALL_DAYS, ...DAY_LABELS];
  const targetsToRender = selectedDay === ALL_DAYS ? DAY_LABELS : [selectedDay];
  const mobileBlocks = useMemo(
    () => (selectedDay === ALL_DAYS ? [] : buildBlocksForDay(selectedDay)),
    [buildBlocksForDay, selectedDay]
  );
  const floatingPanelTarget = typeof document !== 'undefined' ? document.getElementById('timetable-floating-slot') : null;

  if (plannerMode) {
    return (
      <div className="animate-in">
        <div className="embedded-view-toolbar">
          <div className="embedded-view-copy">
            <div className="embedded-view-title">배치 모드</div>
            <div className="embedded-view-description">일별 선생님 기준으로 수업을 만들고 배치한 뒤 마지막에 한 번만 적용합니다.</div>
          </div>
          <button className="action-pill" onClick={() => setPlannerMode(false)}>
            배치 모드 종료
          </button>
        </div>
        <NextSemesterPlannerView
          surface="daily-teacher"
          classes={classes}
          allClasses={allClasses}
          data={data}
          dataService={dataService}
          defaultStatus={defaultStatus}
          defaultPeriod={defaultPeriod}
          termKey={termKey}
          termStatus={termStatus}
          terms={terms}
          selectedBoardValue={selectedDay === ALL_DAYS ? '' : selectedDay}
        />
      </div>
    );
  }

  return (
    <div className="animate-in">
      {floatingFilters && floatingPanelTarget && createPortal(
        <div className="timetable-floating-controls">
          <div className="h-segment-container timetable-floating-selector">
            {dayTabs.map((dayLabel) => (
              <button key={dayLabel} className={`h-segment-btn ${selectedDay === dayLabel ? 'active' : ''}`} onClick={() => setSelectedDay(dayLabel)}>	
                {dayLabel === ALL_DAYS ? '\uC804\uCCB4 \uBCF4\uAE30' : `${dayLabel}\uC694\uC77C`}
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
              <Users size={28} /> 일별 선생님 시간표
            </h1>
            <p>요일별 선생님 배정을 보고, 직원 권한에서는 블록 드래그로 수업 생성과 이동을 빠르게 처리할 수 있습니다.</p>
          </div>
        </div>
      ) : !floatingFilters ? (
        <div className="embedded-view-toolbar">
          <div className="embedded-view-copy">
            <div className="embedded-view-title">일별 선생님 시간표</div>
            <div className="embedded-view-description">요일별 선생님 배치를 빠르게 보고 수정할 수 있습니다.</div>
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
          {dayTabs.map((dayLabel) => (
            <button key={dayLabel} className={`h-segment-btn ${selectedDay === dayLabel ? 'active' : ''}`} onClick={() => setSelectedDay(dayLabel)}>
              {dayLabel === ALL_DAYS ? '전체 보기' : `${dayLabel}요일`}
            </button>
          ))}
        </div>
      </div>
      {teacherEntries.length === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <EmptyState message="표시할 선생님 데이터가 없습니다." />
        </div>
      ) : isMobile ? (
        <div ref={scheduleRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <MobileAgendaTimetable
            title={selectedDay === ALL_DAYS ? '일별 선생님 시간표' : `${selectedDay}요일 선생님 시간표`}
            options={teacherEntries.map((entry) => ({ key: entry.key, label: entry.label }))}
            selectedKey={selectedMobileTeacher}
            onSelectKey={setSelectedMobileTeacher}
            emptyMessage="아직 해당 요일에 배치된 선생님 수업이 없습니다."
            blocks={mobileBlocks}
            timeSlots={timeSlots}
            editable={canEditTimetable}
            onCreateSelection={handleCreateSelection}
            onMoveBlock={handleMoveBlock}
            onBlockClick={(block) => block.onClick?.()}
          />
        </div>
      ) : (
        <div ref={scheduleRef} className={selectedDay === ALL_DAYS ? 'view-all-grid-container' : undefined}>
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
          previousTime: `${selectedDay} ${getRangeFromSlots(timeSlots, moveState.block.startSlot, moveState.block.endSlot).start} ~ ${getRangeFromSlots(timeSlots, moveState.block.startSlot, moveState.block.endSlot).end}`,
          nextTime: `${moveState.next.day} ${moveState.next.start} ~ ${moveState.next.end}`,
          previousAxisLabel: '이전 선생님',
          previousAxis: moveState.block.editData.teacher,
          nextAxisLabel: '변경 선생님',
          nextAxis: moveState.next.teacher,
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
        />
      )}
    </div>
  );
}
