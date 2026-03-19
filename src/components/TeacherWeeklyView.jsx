import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  collectGradeOptions,
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
  buildClassroomMaster,
  buildTeacherMaster,
  getResourceSubjectOptions,
  getSubjectOptionMap,
} from '../lib/resourceCatalogs';
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
  const [selectedTeacher, setSelectedTeacher] = useState(ALL_TEACHERS);
  const [compareTeacherKeys, setCompareTeacherKeys] = useState(null);
  const [selectedMobileDay, setSelectedMobileDay] = useState(DAY_LABELS[0]);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [createState, setCreateState] = useState(null);
  const [moveState, setMoveState] = useState(null);
  const [sharedMoveState, setSharedMoveState] = useState(null);
  const [plannerMode, setPlannerMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const scheduleRef = useRef(null);

  const timeSlots = useMemo(() => generateTimeSlots(11, 24).filter((slot) => !slot.startsWith('23:30-')), []);
  const teacherMaster = useMemo(
    () => buildTeacherMaster(data?.teacherCatalogs, allClasses),
    [allClasses, data?.teacherCatalogs]
  );
  const classroomMaster = useMemo(
    () => buildClassroomMaster(data?.classroomCatalogs, allClasses),
    [allClasses, data?.classroomCatalogs]
  );
  const teacherEntries = useMemo(
    () => teacherMaster.filter((entry) => entry.isVisible !== false).map((entry) => ({ key: entry.key, label: entry.name })),
    [teacherMaster]
  );
  const classroomOptions = useMemo(
    () => classroomMaster.filter((entry) => entry.isVisible !== false).map((entry) => entry.name),
    [classroomMaster]
  );
  const fieldOptions = useMemo(() => ({
    subjects: getResourceSubjectOptions([...teacherMaster, ...classroomMaster], allClasses),
    grades: collectGradeOptions(allClasses),
    teachers: teacherEntries.map((entry) => entry.label),
    classrooms: classroomOptions,
    teacherOptionsBySubject: getSubjectOptionMap(teacherMaster),
    classroomOptionsBySubject: getSubjectOptionMap(classroomMaster),
  }), [allClasses, classroomMaster, classroomOptions, teacherEntries, teacherMaster]);
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
    if (isMobile) {
      return;
    }
    const available = new Set(teacherEntries.map((entry) => entry.key));
    setCompareTeacherKeys((current) => {
      if (current === null) {
        return current;
      }
      return current.filter((key) => available.has(key));
    });
  }, [isMobile, teacherEntries]);
  useEffect(() => {
    if (isMobile) {
      return;
    }
    const effectiveCompareKeys = compareTeacherKeys ?? teacherEntries.map((entry) => entry.key);
    if (effectiveCompareKeys.length === 1) {
      setSelectedTeacher(effectiveCompareKeys[0]);
      return;
    }
    setSelectedTeacher(ALL_TEACHERS);
  }, [compareTeacherKeys, isMobile, teacherEntries]);
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
  const canExportImage = selectedTeacher !== ALL_TEACHERS && Boolean(selectedTeacherEntry);
  const teacherLabelByKey = useMemo(
    () => new Map(teacherEntries.map((entry) => [entry.key, entry.label])),
    [teacherEntries]
  );

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
          const startSlot = Math.max(0, timeToSlotIndex(slot.start, 11));
          const endSlot = Math.max(Math.min(timeToSlotIndex(slot.end, 11), timeSlots.length), startSlot + 1);
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
            detailLines: [{ label: '\uAC15\uC758\uC2E4', value: classroom }],
            tooltip: buildTimetableTooltip({ cls, teacher: matchedTeacher, classroom, meta }),
          }];
        });
      }),
    [classes, canEditTimetable, isStaff, isTeacher, timeSlots.length, user]
  );

  const targetsToRender = useMemo(() => {
    if (!isMobile) {
      const effectiveCompareKeys = compareTeacherKeys ?? teacherEntries.map((entry) => entry.key);
      const compareSet = new Set(effectiveCompareKeys);
      return teacherEntries.filter((entry) => compareSet.has(entry.key));
    }
    if (selectedTeacher === ALL_TEACHERS) {
      return teacherEntries;
    }
    return teacherEntries.filter((entry) => entry.key === selectedTeacher);
  }, [compareTeacherKeys, isMobile, selectedTeacher, teacherEntries]);

  const blocksByTeacherKey = useMemo(
    () => Object.fromEntries(targetsToRender.map((entry) => [entry.key, buildBlocksForTeacher(entry.key)])),
    [buildBlocksForTeacher, targetsToRender]
  );

  const visibleWindow = useMemo(
    () => computeTimetableWindow(Object.values(blocksByTeacherKey), timeSlots.length, { paddingSlots: 0, defaultVisibleSlots: 8, minVisibleSlots: 6 }),
    [blocksByTeacherKey, timeSlots.length]
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
    if (!selectedTeacherEntry) return;
    const range = getRangeFromSlots(timeSlots, startSlot, endSlot);
    const day = DAY_LABELS[columnIndex];

    setCreateState({
      summary: {
        day,
        start: range.start,
        end: range.end,
        fixedAxisLabel: '\uC120\uC0DD\uB2D8',
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

  const handleMoveBlock = useCallback(({ block, columnIndex, startSlot, gridKey }) => {
    const range = getRangeFromSlots(timeSlots, startSlot, startSlot + (block.endSlot - block.startSlot));
    const day = DAY_LABELS[columnIndex];
    const nextTeacher = (gridKey ? teacherLabelByKey.get(gridKey) : selectedTeacherEntry?.label) || '';

    setMoveState({
      block,
      next: { day, ...range, teacher: nextTeacher },
      warnings: findScheduleConflicts({
        classes,
        ignoreClassId: block.editData.classItem.id,
        slot: { day, start: range.start, end: range.end },
        teacher: nextTeacher,
        classroom: block.editData.classroom,
      }),
    });
  }, [classes, selectedTeacherEntry, teacherLabelByKey, timeSlots]);

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
    const blocks = blocksByTeacherKey[teacherEntry.key] || [];
    const windowedBlocks = rebaseBlocksToWindow(blocks, visibleWindow.startSlot, visibleWindow.endSlot);
    const compareActive = !isMobile && targetsToRender.length !== 1;
    const showEditableEmptyGrid = !compareActive && canEditTimetable && teacherEntry.key === selectedTeacher && blocks.length === 0;
    const showEmptyState = blocks.length === 0 && !showEditableEmptyGrid;

    return (
      <section className="card timetable-compare-card" key={teacherEntry.key} style={{ position: 'relative', padding: 14, marginBottom: compareActive ? 0 : 18, breakInside: 'avoid' }}>
        <button
          type="button"
          className="timetable-card-camera"
          onClick={(event) => handleSaveCardImage(event, `teacher-${teacherEntry.key}-weekly.png`)}
          title="현재 시간표 카드 이미지를 저장합니다."
        >
          <Camera size={14} />
        </button>
        <h2 style={{ marginBottom: 10, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <User size={18} className="text-accent" /> {teacherEntry.label}
        </h2>
        {showEditableEmptyGrid ? (
          <div style={{ marginBottom: 14, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
            {'\uBE48 \uC2DC\uAC04\uC744 \uB4DC\uB798\uADF8\uD558\uBA74 \uC774 \uC120\uC0DD\uB2D8 \uAE30\uC900\uC73C\uB85C \uBC14\uB85C \uC218\uC5C5\uC744 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}
          </div>
        ) : null}
        {showEmptyState ? (
          <EmptyState message="해당 선생님에게 배정된 수업이 없습니다." />
        ) : (
          <div className="timetable-window-shell">
            {collapsedTimeHint.topLabel ? <div className="timetable-collapsed-time">~ {collapsedTimeHint.topLabel}</div> : null}
            <TimetableGrid
              gridKey={teacherEntry.key}
              columns={DAY_LABELS}
              timeSlots={windowedTimeSlots}
              blocks={windowedBlocks}
              slotOffset={visibleWindow.startSlot}
              timeLabel={'\uC2DC\uAC04'}
              editable={Boolean(canEditTimetable && (compareActive || teacherEntry.key === selectedTeacher))}
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
    () => (selectedTeacherEntry ? buildBlocksForTeacher(selectedTeacherEntry.key) : []),
    [buildBlocksForTeacher, selectedTeacherEntry]
  );
  const floatingPanelTarget = typeof document !== 'undefined' ? document.getElementById('timetable-floating-slot') : null;

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
      ) : null}
      {!isMobile && teacherEntries.length > 0 ? (() => {
        const allTeacherKeys = teacherEntries.map((entry) => entry.key);
        const effectiveCompareKeys = compareTeacherKeys ?? allTeacherKeys;
        const hasAllTeachersSelected = effectiveCompareKeys.length === allTeacherKeys.length && allTeacherKeys.length > 0;
        return (
          <div className="timetable-compare-toolbar">
            <div className="timetable-compare-density">
              <button
                type="button"
                className={`h-segment-btn ${hasAllTeachersSelected ? 'active' : ''}`}
                onClick={() => setCompareTeacherKeys((current) => {
                  const base = current ?? allTeacherKeys;
                  return base.length === allTeacherKeys.length ? [] : allTeacherKeys;
                })}
              >
                전체 보기
              </button>
            </div>
            <div className="timetable-compare-targets">
              {teacherEntries.map((teacherEntry) => (
                <button
                  key={teacherEntry.key}
                  type="button"
                  className={`timetable-compare-chip ${effectiveCompareKeys.includes(teacherEntry.key) ? 'is-active' : ''}`}
                  onClick={() => setCompareTeacherKeys((current) => {
                    const base = current ?? allTeacherKeys;
                    return toggleCompareSelection(base, teacherEntry.key);
                  })}
                >
                  {teacherEntry.label}
                </button>
              ))}
            </div>
          </div>
        );
      })() : null}
      {teacherEntries.length === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <EmptyState message="표시할 선생님 데이터가 없습니다." />
        </div>
      ) : isMobile ? (
        <div ref={scheduleRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <MobileAgendaTimetable
            title={selectedTeacherEntry ? selectedTeacherEntry.label + ' \uC8FC\uAC04 \uC2DC\uAC04\uD45C' : '\uC120\uC0DD\uB2D8 \uC8FC\uAC04 \uC2DC\uAC04\uD45C'}
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
          className: stripClassPrefix(moveState.block.editData.classItem.className),
          currentTime: `${DAY_LABELS[moveState.block.columnIndex]} ${getRangeFromSlots(timeSlots, moveState.block.absoluteStartSlot ?? moveState.block.startSlot, moveState.block.absoluteEndSlot ?? moveState.block.endSlot).start} ~ ${getRangeFromSlots(timeSlots, moveState.block.absoluteStartSlot ?? moveState.block.startSlot, moveState.block.absoluteEndSlot ?? moveState.block.endSlot).end}`,
          nextTime: `${moveState.next.day} ${moveState.next.start} ~ ${moveState.next.end}`,
          currentTeacher: moveState.block.editData.teacher,
          nextTeacher: moveState.next.teacher,
          currentClassroom: moveState.block.editData.classroom,
          nextClassroom: moveState.block.editData.classroom,
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





