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
  computeTimetableWindow,
  formatCollapsedTimeHint,
  getClassColor,
  getClassMeta,
  getTimetableCompareGridStyle,
  getTimetableDensity,
  getTimetableSlotHeight,
  rebaseBlocksToWindow,
  resolveSlotClassroom,
  resolveSlotTeachers,
  toggleCompareSelection,
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
  defaultStatus = '\uC218\uC5C5 \uC9C4\uD589 \uC911',
  defaultPeriod = '',
  termKey = '',
  termStatus = defaultStatus,
  terms = [],
  embedded = false,
  floatingFilters = false,
  subjectOptions = [],
  selectedSubject = '\uC804\uCCB4',
  onSelectSubject = () => {},
}) {
  const { isMobile } = useViewport();
  const toast = useToast();
  const { isStaff, isTeacher, user } = useAuth();
  const [selectedClassroom, setSelectedClassroom] = useState(ALL_CLASSROOMS);
  const [compareClassroomKeys, setCompareClassroomKeys] = useState(null);
  const [selectedMobileDay, setSelectedMobileDay] = useState(DAY_LABELS[0]);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [createState, setCreateState] = useState(null);
  const [moveState, setMoveState] = useState(null);
  const [sharedMoveState, setSharedMoveState] = useState(null);
  const [plannerMode, setPlannerMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const scheduleRef = useRef(null);

  const timeSlots = useMemo(() => generateTimeSlots(11, 24).filter((slot) => !slot.startsWith('23:30-')), []);
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
    if (isMobile) {
      return;
    }
    const available = new Set(classroomEntries.map((entry) => entry.key));
    setCompareClassroomKeys((current) => {
      if (current === null) {
        return current;
      }
      return current.filter((key) => available.has(key));
    });
  }, [classroomEntries, isMobile]);
  useEffect(() => {
    if (isMobile) {
      return;
    }
    const effectiveCompareKeys = compareClassroomKeys ?? classroomEntries.map((entry) => entry.key);
    if (effectiveCompareKeys.length === 1) {
      setSelectedClassroom(effectiveCompareKeys[0]);
      return;
    }
    setSelectedClassroom(ALL_CLASSROOMS);
  }, [compareClassroomKeys, classroomEntries, isMobile]);
  useEffect(() => {
    if (!plannerMode) {
      return;
    }
    setCreateState(null);
    setMoveState(null);
    setSharedMoveState(null);
  }, [plannerMode]);
  useEffect(() => {
    const openPlanner = () => setPlannerMode(true);
    window.addEventListener('tips-open-planner', openPlanner);
    return () => window.removeEventListener('tips-open-planner', openPlanner);
  }, []);
  const canEditTimetable = Boolean(isStaff);
  const canExportImage = selectedClassroom !== ALL_CLASSROOMS && Boolean(selectedClassroomEntry);
  const classroomLabelByKey = useMemo(
    () => new Map(classroomEntries.map((entry) => [entry.key, entry.label])),
    [classroomEntries]
  );

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
          const startSlot = Math.max(0, timeToSlotIndex(slot.start, 11));
          const endSlot = Math.max(Math.min(timeToSlotIndex(slot.end, 11), timeSlots.length), startSlot + 1);
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
            detailLines: [{ label: '\uC120\uC0DD\uB2D8', value: primaryTeacher }],
            tooltip: buildTimetableTooltip({ cls, teacher: primaryTeacher, classroom, meta }),
          }];
        });
      }),
    [classes, canEditTimetable, isStaff, isTeacher, timeSlots.length, user]
  );

  const targetsToRender = useMemo(() => {
    if (!isMobile) {
      const effectiveCompareKeys = compareClassroomKeys ?? classroomEntries.map((entry) => entry.key);
      const compareSet = new Set(effectiveCompareKeys);
      return classroomEntries.filter((entry) => compareSet.has(entry.key));
    }
    if (selectedClassroom === ALL_CLASSROOMS) {
      return classroomEntries;
    }
    return classroomEntries.filter((entry) => entry.key === selectedClassroom);
  }, [classroomEntries, compareClassroomKeys, isMobile, selectedClassroom]);

  const blocksByClassroomKey = useMemo(
    () => Object.fromEntries(targetsToRender.map((entry) => [entry.key, buildBlocksForClassroom(entry.key)])),
    [buildBlocksForClassroom, targetsToRender]
  );

  const visibleWindow = useMemo(
    () => computeTimetableWindow(Object.values(blocksByClassroomKey), timeSlots.length, { paddingSlots: 0, defaultVisibleSlots: 8, minVisibleSlots: 6 }),
    [blocksByClassroomKey, timeSlots.length]
  );

  const windowedTimeSlots = useMemo(
    () => timeSlots.slice(visibleWindow.startSlot, visibleWindow.endSlot),
    [timeSlots, visibleWindow.endSlot, visibleWindow.startSlot]
  );

  const collapsedTimeHint = useMemo(
    () => formatCollapsedTimeHint(timeSlots, visibleWindow.startSlot, visibleWindow.endSlot),
    [timeSlots, visibleWindow.endSlot, visibleWindow.startSlot]
  );

  const timetableDensity = useMemo(
    () => getTimetableDensity(Math.max(1, targetsToRender.length), visibleWindow.visibleSlotCount),
    [targetsToRender.length, visibleWindow.visibleSlotCount]
  );

  const slotHeight = useMemo(
    () => getTimetableSlotHeight(timetableDensity),
    [timetableDensity]
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
        fixedAxisLabel: '\uAC15\uC758\uC2E4',
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

  const handleMoveBlock = useCallback(({ block, columnIndex, startSlot, gridKey }) => {
    const range = getRangeFromSlots(timeSlots, startSlot, startSlot + (block.endSlot - block.startSlot));
    const day = DAY_LABELS[columnIndex];
    const nextClassroom = (gridKey ? classroomLabelByKey.get(gridKey) : selectedClassroomEntry?.label) || '';
    const warnings = findScheduleConflicts({
      classes,
      ignoreClassId: block.editData.classItem.id,
      slot: { day, start: range.start, end: range.end },
      teacher: block.editData.teacher,
      classroom: nextClassroom,
    });

    setMoveState({
      block,
      next: { day, ...range, classroom: nextClassroom },
      warnings,
    });
  }, [classes, classroomLabelByKey, selectedClassroomEntry, timeSlots]);

  const handleSharedMoveStart = useCallback(({ gridKey, block }) => {
    setSharedMoveState({
      sourceGridKey: gridKey,
      targetGridKey: gridKey,
      block,
      targetColumnIndex: block.columnIndex,
      targetStartSlot: block.startSlot,
      blockDuration: block.endSlot - block.startSlot,
    });
  }, []);

  const handleSharedMoveUpdate = useCallback(({ gridKey, columnIndex, rowIndex }) => {
    setSharedMoveState((current) => (
      current
        ? {
            ...current,
            targetGridKey: gridKey,
            targetColumnIndex: columnIndex,
            targetStartSlot: rowIndex,
          }
        : current
    ));
  }, []);

  useEffect(() => {
    if (!sharedMoveState) {
      return undefined;
    }

    const handleSharedPointerUp = () => {
      setSharedMoveState((current) => {
        if (!current) {
          return current;
        }

        const moved =
          current.sourceGridKey !== current.targetGridKey ||
          current.block.columnIndex !== current.targetColumnIndex ||
          current.block.startSlot !== current.targetStartSlot;

        if (moved) {
          handleMoveBlock({
            block: current.block,
            columnIndex: current.targetColumnIndex,
            startSlot: current.targetStartSlot + visibleWindow.startSlot,
            gridKey: current.targetGridKey,
          });
        }

        return null;
      });
    };

    window.addEventListener('mouseup', handleSharedPointerUp);
    return () => window.removeEventListener('mouseup', handleSharedPointerUp);
  }, [handleMoveBlock, sharedMoveState, visibleWindow.startSlot]);

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
    const blocks = blocksByClassroomKey[classroomEntry.key] || [];
    const windowedBlocks = rebaseBlocksToWindow(blocks, visibleWindow.startSlot, visibleWindow.endSlot);
    const compareActive = !isMobile && targetsToRender.length !== 1;
    const showEditableEmptyGrid = !compareActive && canEditTimetable && classroomEntry.key === selectedClassroom && blocks.length === 0;
    const showEmptyState = blocks.length === 0 && !showEditableEmptyGrid;

    return (
      <section className="card timetable-compare-card" key={classroomEntry.key} style={{ position: 'relative', padding: 14, marginBottom: compareActive ? 0 : 18, breakInside: 'avoid' }}>
        <button
          type="button"
          className="timetable-card-camera"
          onClick={(event) => handleSaveCardImage(event, `classroom-${classroomEntry.key}-weekly.png`)}
          title="현재 시간표 카드 이미지를 저장합니다."
        >
          <Camera size={14} />
        </button>
        <h2 style={{ marginBottom: 10, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <School size={18} className="text-accent" /> {classroomEntry.label}
        </h2>
        {showEditableEmptyGrid ? (
          <div style={{ marginBottom: 14, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
            {'\uBE48 \uC2DC\uAC04\uC744 \uB4DC\uB798\uADF8\uD558\uBA74 \uC774 \uAC15\uC758\uC2E4 \uAE30\uC900\uC73C\uB85C \uBC14\uB85C \uC218\uC5C5\uC744 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}
          </div>
        ) : null}
        {showEmptyState ? (
          <EmptyState message="해당 강의실에 배정된 수업이 없습니다." />
        ) : (
          <div className="timetable-window-shell">
            {collapsedTimeHint.topLabel ? <div className="timetable-collapsed-time">~ {collapsedTimeHint.topLabel}</div> : null}
            <TimetableGrid
              gridKey={classroomEntry.key}
              columns={DAY_LABELS}
              timeSlots={windowedTimeSlots}
              blocks={windowedBlocks}
              slotOffset={visibleWindow.startSlot}
              timeLabel={'\uC2DC\uAC04'}
              editable={Boolean(canEditTimetable && (compareActive || classroomEntry.key === selectedClassroom))}
              editableMode={compareActive ? 'move' : 'edit'}
              onCreateSelection={handleCreateSelection}
              onMoveBlock={handleMoveBlock}
              sharedDragState={compareActive ? sharedMoveState : null}
              onSharedDragStart={compareActive ? handleSharedMoveStart : undefined}
              onSharedDragUpdate={compareActive ? handleSharedMoveUpdate : undefined}
              slotHeight={slotHeight}
              density={timetableDensity}
              shellClassName="timetable-compact-shell"
            />
            {collapsedTimeHint.bottomLabel ? <div className="timetable-collapsed-time">~ {collapsedTimeHint.bottomLabel}</div> : null}
          </div>
        )}
      </section>
    );
  };

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
      {floatingFilters && floatingPanelTarget && !isMobile && createPortal(
        <div className="timetable-floating-controls">
          <button className="action-pill timetable-floating-action" onClick={() => setPlannerMode(true)}>	
            {'\uBC30\uCE58 \uBAA8\uB4DC \uC5F4\uAE30'}
          </button>
        </div>,
        floatingPanelTarget
      )}
      {isMobile ? (
      <div className={`filter-bar ${floatingFilters ? 'filter-bar-floating' : 'timetable-axis-filter'}`} style={{ display: !isMobile && floatingFilters ? 'none' : undefined }}>
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
      ) : null}
      {!isMobile && classroomEntries.length > 0 ? (() => {
        const allClassroomKeys = classroomEntries.map((entry) => entry.key);
        const effectiveCompareKeys = compareClassroomKeys ?? allClassroomKeys;
        const hasAllClassroomsSelected = effectiveCompareKeys.length === allClassroomKeys.length && allClassroomKeys.length > 0;
        return (
          <div className="timetable-compare-toolbar">
            <div className="timetable-compare-density">
              <button
                type="button"
                className={`h-segment-btn ${hasAllClassroomsSelected ? 'active' : ''}`}
                onClick={() => setCompareClassroomKeys((current) => {
                  const base = current ?? allClassroomKeys;
                  return base.length === allClassroomKeys.length ? [] : allClassroomKeys;
                })}
              >
                전체 보기
              </button>
            </div>
            <div className="timetable-compare-targets">
              {classroomEntries.map((classroomEntry) => (
                <button
                  key={classroomEntry.key}
                  type="button"
                  className={`timetable-compare-chip ${effectiveCompareKeys.includes(classroomEntry.key) ? 'is-active' : ''}`}
                  onClick={() => setCompareClassroomKeys((current) => {
                    const base = current ?? allClassroomKeys;
                    return toggleCompareSelection(base, classroomEntry.key);
                  })}
                >
                  {classroomEntry.label}
                </button>
              ))}
            </div>
          </div>
        );
      })() : null}
      {classroomEntries.length === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <EmptyState message="표시할 강의실 데이터가 없습니다." />
        </div>
      ) : isMobile ? (
        <div ref={scheduleRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <MobileAgendaTimetable
            title={selectedClassroomEntry ? selectedClassroomEntry.label + ' \uC8FC\uAC04 \uC2DC\uAC04\uD45C' : '\uAC15\uC758\uC2E4 \uC8FC\uAC04 \uC2DC\uAC04\uD45C'}
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
        <div
          ref={scheduleRef}
          className={targetsToRender.length > 1 ? 'view-all-grid-container timetable-compare-layout' : 'timetable-single-layout'}
          style={targetsToRender.length > 1 ? getTimetableCompareGridStyle(targetsToRender.length) : undefined}
        >
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
          className: stripClassPrefix(moveState.block.editData.classItem.className),
          currentTime: `${DAY_LABELS[moveState.block.columnIndex]} ${getRangeFromSlots(timeSlots, moveState.block.absoluteStartSlot ?? moveState.block.startSlot, moveState.block.absoluteEndSlot ?? moveState.block.endSlot).start} ~ ${getRangeFromSlots(timeSlots, moveState.block.absoluteStartSlot ?? moveState.block.startSlot, moveState.block.absoluteEndSlot ?? moveState.block.endSlot).end}`,
          nextTime: `${moveState.next.day} ${moveState.next.start} ~ ${moveState.next.end}`,
          currentTeacher: moveState.block.editData.teacher,
          nextTeacher: moveState.block.editData.teacher,
          currentClassroom: moveState.block.editData.classroom,
          nextClassroom: moveState.next.classroom,
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




