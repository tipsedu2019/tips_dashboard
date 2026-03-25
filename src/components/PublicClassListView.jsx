import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  LogIn,
  MapPin,
  MessageCircle,
  Search,
  UserRound,
} from 'lucide-react';
import { useDeferredValue, useEffect, useRef } from 'react';
import { ACTIVE_CLASS_STATUS, computeClassStatus } from '../lib/classStatus';
import { sortSubjectOptions } from '../lib/subjectUtils';
import { CLASS_COLORS, generateTimeSlots, parseSchedule, stripClassPrefix } from '../data/sampleData';
import useViewport from '../hooks/useViewport';
import { useToast } from '../contexts/ToastContext';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';
import BottomSheet from './ui/BottomSheet';
import { PublicTimetableSkeleton } from './ui/PageLoader';
import TimetableGrid from './ui/TimetableGrid';

const MOBILE_GRADE_FAMILIES = [
  { id: 'high', label: '고등', grades: ['고1', '고2', '고3'] },
  { id: 'middle', label: '중등', grades: ['중1', '중2', '중3'] },
  { id: 'elementary', label: '초등', grades: ['초6'] },
];

const MOBILE_GRADE_ORDER = MOBILE_GRADE_FAMILIES.flatMap((family) => family.grades);
const DAY_COLUMNS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_INDEX_MAP = Object.fromEntries(DAY_COLUMNS.map((day, index) => [day, index]));
const SLOT_START_HOUR = 6;
const SLOT_END_HOUR = 24;
const SLOT_START_MINUTES = SLOT_START_HOUR * 60;
const FULL_TIME_SLOTS = generateTimeSlots(SLOT_START_HOUR, SLOT_END_HOUR);
const DEFAULT_START_SLOT = 6;
const DEFAULT_END_SLOT = 28;

const SUBJECT_TONES = {
  영어: { bg: 'rgba(46, 124, 255, 0.16)', border: 'rgba(46, 124, 255, 0.34)', text: '#1d4ed8' },
  수학: { bg: 'rgba(15, 172, 112, 0.16)', border: 'rgba(15, 172, 112, 0.34)', text: '#047857' },
};

function text(value) {
  return String(value || '').trim();
}

function normalizeGrade(value) {
  return text(value) || '미정';
}

function normalizeGradeToken(value) {
  return text(value).replace(/\s+/g, '');
}

function inferGradeFamily(grade) {
  const normalized = normalizeGradeToken(grade);
  if (normalized.startsWith('고')) return 'high';
  if (normalized.startsWith('중')) return 'middle';
  if (normalized.startsWith('초')) return 'elementary';
  return 'high';
}

function getGradeFamilyLabel(family) {
  return MOBILE_GRADE_FAMILIES.find((item) => item.id === family)?.label || '전체';
}

function getGradeOptionsForFamily(family) {
  if (family === 'all') {
    return MOBILE_GRADE_ORDER;
  }
  return MOBILE_GRADE_FAMILIES.find((item) => item.id === family)?.grades || [];
}

function getMobileSubjectOptions(options = []) {
  const filtered = options.filter((option) => option !== 'all');
  const preferred = ['영어', '수학'].filter((option) => filtered.includes(option));
  const extras = filtered.filter((option) => !preferred.includes(option));
  return [...preferred, ...extras];
}

function getGradeSortValue(grade) {
  const normalized = normalizeGradeToken(grade);
  const index = MOBILE_GRADE_ORDER.indexOf(normalized);
  return index >= 0 ? index : MOBILE_GRADE_ORDER.length + 99;
}

function summarizeSubjects(items = []) {
  const counts = items.reduce((accumulator, item) => {
    const subject = text(item.subject) || '기타';
    accumulator[subject] = (accumulator[subject] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right, 'ko'))
    .map(([subject, count]) => `${subject} ${count}`)
    .join(' · ');
}

function buildScheduleLines(classItem) {
  const slots = parseSchedule(classItem?.schedule, classItem) || [];
  if (slots.length === 0) {
    return ['시간 미정'];
  }

  return slots.map((slot) => `${slot.day} ${slot.start} - ${slot.end}`);
}

function splitLines(value, limit = 2) {
  return text(value)
    .split(/[,\n]/)
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, limit);
}

function timeToMinutes(value) {
  const [hour, minute] = text(value).split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return Number.NaN;
  }
  return hour * 60 + minute;
}

function getSlotIndexForTimeValue(value) {
  const minutes = timeToMinutes(value);
  if (Number.isNaN(minutes)) {
    return 0;
  }
  return Math.max(0, Math.min(FULL_TIME_SLOTS.length, Math.round((minutes - SLOT_START_MINUTES) / 30)));
}

function getTodayDayLabel() {
  const day = new Date().getDay();
  if (day === 0) return '일';
  return DAY_COLUMNS[day - 1] || '월';
}

function getToneForClass(classItem, index = 0) {
  const subject = text(classItem?.subject);
  if (SUBJECT_TONES[subject]) {
    return SUBJECT_TONES[subject];
  }
  const fallback = CLASS_COLORS[index % CLASS_COLORS.length] || CLASS_COLORS[0];
  return {
    bg: fallback.bg,
    border: fallback.border,
    text: fallback.text,
  };
}

function getClassSortKey(classItem) {
  const slot = parseSchedule(classItem?.schedule, classItem)?.[0];
  const dayIndex = slot ? (DAY_INDEX_MAP[slot.day] ?? 99) : 99;
  const startMinutes = slot ? timeToMinutes(slot.start) : 9999;
  return `${String(dayIndex).padStart(2, '0')}-${String(startMinutes).padStart(4, '0')}-${stripClassPrefix(classItem.className || '')}`;
}

function sortClassesForDisplay(items = []) {
  return items
    .slice()
    .sort((left, right) => getClassSortKey(left).localeCompare(getClassSortKey(right), 'ko'));
}

function buildSearchLabel(query) {
  const cleaned = text(query);
  if (!cleaned) {
    return '검색';
  }
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}...` : cleaned;
}

function buildCounselContextLabel(context = {}) {
  return [context.grade, context.subject, context.className]
    .map((item) => text(item))
    .filter(Boolean)
    .join(' ');
}

function buildModalSummaryBadges(classItem, context = {}) {
  const badgeMap = new Map();

  if (context.grade) {
    badgeMap.set(`grade-${context.grade}`, { label: context.grade, tone: 'neutral' });
  }
  if (classItem?.subject) {
    badgeMap.set(`subject-${classItem.subject}`, { label: classItem.subject, tone: 'accent' });
  }

  getUrgencyMeta(classItem).forEach((badge) => {
    badgeMap.set(`urgency-${badge.label}`, badge);
  });

  if (context.source === 'timetable') {
    badgeMap.set('source-timetable', { label: '시간표에서 선택', tone: 'neutral' });
  }

  return [...badgeMap.values()].slice(0, 4);
}

function buildTimetableData(items = []) {
  const entries = [];

  items.forEach((classItem, itemIndex) => {
    const parsedSlots = parseSchedule(classItem?.schedule, classItem) || [];
    parsedSlots.forEach((slot, slotIndex) => {
      const columnIndex = DAY_INDEX_MAP[slot.day];
      if (columnIndex === undefined) {
        return;
      }

      const startSlot = getSlotIndexForTimeValue(slot.start);
      const endSlot = getSlotIndexForTimeValue(slot.end);
      if (endSlot <= startSlot) {
        return;
      }

      entries.push({
        key: `${classItem.id || itemIndex}-${slot.day}-${slot.start}-${slot.end}-${slotIndex}`,
        classItem,
        columnIndex,
        startSlot,
        endSlot,
        scheduleLabel: `${slot.day} ${slot.start} - ${slot.end}`,
        tone: getToneForClass(classItem, itemIndex),
      });
    });
  });

  if (entries.length === 0) {
    return {
      timeSlots: FULL_TIME_SLOTS.slice(DEFAULT_START_SLOT, DEFAULT_END_SLOT),
      blocks: [],
    };
  }

  const mergedEntries = [];

  DAY_COLUMNS.forEach((_, columnIndex) => {
    const dayEntries = entries
      .filter((entry) => entry.columnIndex === columnIndex)
      .sort((left, right) => left.startSlot - right.startSlot || left.endSlot - right.endSlot);

    let cluster = [];
    let clusterEnd = -1;

    const flushCluster = () => {
      if (cluster.length === 0) {
        return;
      }

      const clusterStart = Math.min(...cluster.map((entry) => entry.startSlot));
      const clusterFinish = Math.max(...cluster.map((entry) => entry.endSlot));

      if (cluster.length === 1) {
        const entry = cluster[0];
        mergedEntries.push({
          key: entry.key,
          type: 'single',
          classItem: entry.classItem,
          title: stripClassPrefix(entry.classItem.className || '이름 없는 수업'),
          header: entry.classItem.subject || '수업',
          detailLines: [
            { label: 'time', value: entry.scheduleLabel },
            { label: 'teacher', value: text(entry.classItem.teacher) || '선생님 미정', subtle: true },
          ],
          columnIndex: entry.columnIndex,
          startSlot: entry.startSlot,
          endSlot: entry.endSlot,
          backgroundColor: entry.tone.bg,
          borderColor: entry.tone.border,
          textColor: entry.tone.text,
        });
      } else {
        const classes = sortClassesForDisplay(cluster.map((entry) => entry.classItem));
        const primary = classes[0];
        const mergedTone = getToneForClass(primary, columnIndex);

        mergedEntries.push({
          key: `merged-${columnIndex}-${clusterStart}-${clusterFinish}-${classes.map((item) => item.id).join('-')}`,
          type: 'merged',
          classItems: classes,
          title: `${text(primary?.subject) || '수업'} 외 ${classes.length - 1}개`,
          header: stripClassPrefix(primary?.className || '겹침 수업'),
          detailLines: [
            { label: 'time', value: `${DAY_COLUMNS[columnIndex]} ${FULL_TIME_SLOTS[clusterStart]?.split('-')[0]} - ${FULL_TIME_SLOTS[clusterFinish - 1]?.split('-')[1]}` },
            { label: 'classes', value: classes.slice(0, 2).map((item) => stripClassPrefix(item.className || item.subject || '수업')).join(' · '), subtle: true },
          ],
          columnIndex,
          startSlot: clusterStart,
          endSlot: clusterFinish,
          backgroundColor: 'rgba(15, 23, 42, 0.08)',
          borderColor: mergedTone.border,
          textColor: 'var(--text-primary)',
        });
      }

      cluster = [];
      clusterEnd = -1;
    };

    dayEntries.forEach((entry) => {
      if (cluster.length === 0) {
        cluster = [entry];
        clusterEnd = entry.endSlot;
        return;
      }

      if (entry.startSlot < clusterEnd) {
        cluster.push(entry);
        clusterEnd = Math.max(clusterEnd, entry.endSlot);
        return;
      }

      flushCluster();
      cluster = [entry];
      clusterEnd = entry.endSlot;
    });

    flushCluster();
  });

  const minSlot = Math.max(0, Math.min(...mergedEntries.map((entry) => entry.startSlot)) - 1);
  const maxSlot = Math.min(FULL_TIME_SLOTS.length, Math.max(...mergedEntries.map((entry) => entry.endSlot)) + 1);

  return {
    timeSlots: FULL_TIME_SLOTS.slice(minSlot, maxSlot),
    blocks: mergedEntries.map((entry) => ({
      ...entry,
      startSlot: entry.startSlot - minSlot,
      endSlot: entry.endSlot - minSlot,
    })),
  };
}

function buildGradePages(classes = []) {
  const grouped = new Map();
  const todayLabel = getTodayDayLabel();

  classes.forEach((item) => {
    const grade = normalizeGrade(item.grade);
    if (!grade || grade === '미정') {
      return;
    }

    if (!grouped.has(grade)) {
      grouped.set(grade, {
        grade,
        family: inferGradeFamily(grade),
        items: [],
      });
    }

    grouped.get(grade).items.push(item);
  });

  return [...grouped.values()]
    .sort((left, right) => getGradeSortValue(left.grade) - getGradeSortValue(right.grade))
    .map((entry) => {
      const items = sortClassesForDisplay(entry.items);
      return {
        ...entry,
        items,
        previewItems: items.slice(0, 3),
        subjectSummary: summarizeSubjects(items),
        todayCount: items.reduce((count, item) => count + (parseSchedule(item?.schedule, item) || []).filter((slot) => slot.day === todayLabel).length, 0),
        urgentCount: items.filter((item) => getUrgencyMeta(item).length > 0).length,
        timetable: buildTimetableData(items),
      };
    });
}

function PublicInfoTile({ title, icon: Icon, lines, tone = 'green', wide = false }) {
  return (
    <div className={`public-info-tile is-${tone} ${wide ? 'is-wide' : ''}`}>
      <div className="public-info-tile-head">
        <Icon size={15} />
        <div className="public-info-tile-label">{title}</div>
      </div>
      <div className="public-info-tile-values">
        {(lines.length > 0 ? lines : ['미정']).map((line, index) => (
          <div
            key={`${title}-${index}`}
            className="public-info-tile-value"
            data-wide={wide ? 'true' : 'false'}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function PublicCompactMetaRow({ icon: Icon, label, value }) {
  return (
    <div className="public-card-compact-row">
      <span className="public-card-compact-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <div className="public-card-compact-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function getUrgencyMeta(classItem) {
  const capacity = Number(classItem.capacity || 0);
  const enrolled = Array.isArray(classItem.studentIds) ? classItem.studentIds.length : 0;

  if (capacity <= 0) {
    return [];
  }

  const seatsLeft = Math.max(0, capacity - enrolled);
  if (seatsLeft === 0) {
    return [{ label: '마감', tone: 'danger' }];
  }
  if (seatsLeft <= 3) {
    return [
      { label: '마감 임박', tone: 'warning' },
      { label: `마지막 ${seatsLeft}자리`, tone: 'accent' },
    ];
  }

  return [];
}

function PublicClassCard({ classItem, compact, onOpenPlan }) {
  const scheduleLines = buildScheduleLines(classItem);
  const title = stripClassPrefix(classItem.className || '이름 없는 수업');
  const teacherLines = splitLines(classItem.teacher);
  const classroomLines = splitLines(classItem.classroom || classItem.room);
  const urgencyBadges = getUrgencyMeta(classItem);
  const statusBadges = urgencyBadges.length > 0 ? urgencyBadges : [{ label: '모집 중', tone: 'neutral' }];
  const scheduleSummary = scheduleLines.length > 1 ? `${scheduleLines.length}개 시간 블록` : scheduleLines[0] || '시간 미정';
  const enrolledCount = Array.isArray(classItem.studentIds) ? classItem.studentIds.length : 0;
  const capacity = Number(classItem.capacity || 0);
  const footerSummary = capacity > 0 ? `정원 ${enrolledCount}/${capacity}` : scheduleSummary;

  return (
    <button
      type="button"
      className={`public-class-card ${compact ? 'is-compact' : ''}`}
      data-testid={`public-class-card-${classItem.id}`}
      onClick={() => onOpenPlan(classItem)}
      title={`${title} 일정표 보기`}
    >
      <div className="public-class-card-head">
        <div className="public-class-card-copy">
          <div className="public-class-card-eyebrow">
            {classItem.subject || '과목'} · {normalizeGrade(classItem.grade)}
          </div>
          <div className="public-class-card-title">{title}</div>
        </div>

        {statusBadges.length > 0 ? (
          <div className="public-card-badges">
            {statusBadges.map((badge) => (
              <span key={badge.label} className={`public-card-badge is-${badge.tone}`}>
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {compact ? (
        <div className="public-card-compact-list">
          <PublicCompactMetaRow icon={CalendarDays} label="일정" value={scheduleSummary} />
          <PublicCompactMetaRow icon={UserRound} label="선생님" value={teacherLines[0] || '미정'} />
          <PublicCompactMetaRow icon={MapPin} label="강의실" value={classroomLines[0] || '미정'} />
        </div>
      ) : (
        <div
          className={`public-card-info-grid ${compact ? 'is-compact' : ''}`}
        >
          <PublicInfoTile title="요일 / 시간" icon={CalendarDays} lines={scheduleLines} tone="bronze" wide={!compact} />
          <PublicInfoTile title="선생님" icon={UserRound} lines={teacherLines} tone="green" />
          <PublicInfoTile title="강의실" icon={MapPin} lines={classroomLines} tone="blue" />
        </div>
      )}

      <div className="public-card-footer">
        <span className="public-card-footer-meta">{compact ? footerSummary : scheduleSummary}</span>
        <span className="public-card-cta">일정표 열기</span>
      </div>
    </button>
  );
}

export default function PublicClassListView({
  classes,
  textbooks = [],
  progressLogs = [],
  isLoading = false,
  onLogin,
  showBackToDashboard = false,
  onBackToDashboard,
}) {
  const { isMobile, isCompact } = useViewport();
  const toast = useToast();
  const isCompactLayout = isMobile || isCompact;
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedGradeFamily, setSelectedGradeFamily] = useState('all');
  const [selectedGradeValue, setSelectedGradeValue] = useState('all');
  const [selectedViewMode, setSelectedViewMode] = useState('timetable');
  const [mobileDockTab, setMobileDockTab] = useState(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [selectedClassState, setSelectedClassState] = useState(null);
  const [mergedBlockState, setMergedBlockState] = useState(null);

  const pagerRef = useRef(null);
  const pageRefs = useRef(new Map());

  const activeClasses = useMemo(
    () => (classes || []).filter((item) => computeClassStatus(item) === ACTIVE_CLASS_STATUS),
    [classes]
  );

  const subjectOptions = useMemo(
    () => ['all', ...sortSubjectOptions(activeClasses.map((item) => item.subject).filter(Boolean))],
    [activeClasses]
  );

  const mobileSubjectOptions = useMemo(
    () => getMobileSubjectOptions(subjectOptions),
    [subjectOptions]
  );

  const subjectSearchFilteredClasses = useMemo(() => {
    const query = text(deferredSearchQuery).toLowerCase();
    return activeClasses.filter((item) => {
      const matchesSubject = selectedSubject === 'all' || item.subject === selectedSubject;
      const haystack = [
        stripClassPrefix(item.className),
        item.subject,
        item.grade,
        item.teacher,
        item.classroom,
        item.room,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesSubject && (!query || haystack.includes(query));
    });
  }, [activeClasses, deferredSearchQuery, selectedSubject]);

  const gradePages = useMemo(
    () => buildGradePages(subjectSearchFilteredClasses),
    [subjectSearchFilteredClasses]
  );

  const availableFamilyMap = useMemo(
    () => MOBILE_GRADE_FAMILIES.reduce((accumulator, family) => {
      accumulator[family.id] = gradePages.filter((page) => page.family === family.id).map((page) => page.grade);
      return accumulator;
    }, {}),
    [gradePages]
  );

  useEffect(() => {
    if (gradePages.length === 0) {
      setSelectedGradeFamily('all');
      setSelectedGradeValue('all');
      return;
    }

    if (selectedGradeValue !== 'all' && gradePages.some((page) => page.grade === selectedGradeValue)) {
      const inferredFamily = inferGradeFamily(selectedGradeValue);
      if (selectedGradeFamily !== inferredFamily) {
        setSelectedGradeFamily(inferredFamily);
      }
      return;
    }

    const nextGrade = (selectedGradeFamily !== 'all' ? availableFamilyMap[selectedGradeFamily] : null)?.[0]
      || gradePages[0].grade;
    setSelectedGradeValue(nextGrade);
    setSelectedGradeFamily(inferGradeFamily(nextGrade));
  }, [availableFamilyMap, gradePages, selectedGradeFamily, selectedGradeValue]);

  const currentPage = useMemo(
    () => gradePages.find((page) => page.grade === selectedGradeValue) || gradePages[0] || null,
    [gradePages, selectedGradeValue]
  );

  useEffect(() => {
    if (!isMobile || !currentPage || !pagerRef.current) {
      return;
    }

    const target = pageRefs.current.get(currentPage.grade);
    if (!target) {
      return;
    }

    const container = pagerRef.current;
    if (Math.abs(container.scrollLeft - target.offsetLeft) < 4) {
      return;
    }

    container.scrollTo({ left: target.offsetLeft, behavior: 'smooth' });
  }, [currentPage, isMobile]);

  const currentItems = currentPage?.items || [];
  const currentBlocks = useMemo(
    () => (currentPage?.timetable.blocks || []).map((block) => ({
      ...block,
      clickable: true,
      editable: false,
    })),
    [currentPage]
  );

  const activeFilterChips = useMemo(() => {
    const chips = [];
    const query = text(searchQuery);

    if (selectedSubject !== 'all') {
      chips.push({ key: 'subject', label: `과목 ${selectedSubject}` });
    }
    if (currentPage?.grade) {
      chips.push({ key: 'grade', label: `학년 ${currentPage.grade}` });
    }
    if (query) {
      chips.push({ key: 'search', label: `검색 ${query}` });
    }

    return chips;
  }, [currentPage, searchQuery, selectedSubject]);

  const summaryChips = useMemo(() => {
    if (!currentPage) {
      return [];
    }

    const chips = [{ key: 'count', label: `${currentPage.items.length}개 수업`, tone: 'neutral' }];
    if (currentPage.todayCount > 0) {
      chips.push({ key: 'today', label: `오늘 ${currentPage.todayCount}개`, tone: 'accent' });
    }
    if (currentPage.urgentCount > 0) {
      chips.push({ key: 'urgent', label: `마감 임박 ${currentPage.urgentCount}`, tone: 'warning' });
    }
    return chips;
  }, [currentPage]);

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedSubject('all');
    setSelectedGradeFamily('all');
    setSelectedGradeValue('all');
    setSelectedViewMode('timetable');
    setMobileDockTab(null);
    setMobileSearchOpen(false);
  };

  const setGradeCategory = (family) => {
    setSelectedGradeFamily(family);
    const familyGrades = availableFamilyMap[family] || [];
    if (familyGrades[0]) {
      setSelectedGradeValue(familyGrades[0]);
      setSelectedViewMode('timetable');
    }
  };

  const selectGradeValue = (grade) => {
    setSelectedGradeFamily(inferGradeFamily(grade));
    setSelectedGradeValue(grade);
    setSelectedViewMode('timetable');
    setMobileDockTab(null);
  };

  const selectSubjectValue = (subject) => {
    setSelectedSubject(subject);
    setSelectedViewMode('timetable');
    setMobileDockTab(null);
  };

  const toggleMobileDockTab = (tab) => {
    setMobileDockTab((current) => (current === tab ? null : tab));
  };

  const openClassDetails = (classItem, context = {}) => {
    setMergedBlockState(null);
    setSelectedClassState({
      classItem,
      summaryBadges: buildModalSummaryBadges(classItem, context),
      counselContext: {
        grade: context.grade || normalizeGrade(classItem.grade),
        subject: classItem.subject || context.subject || '',
        className: stripClassPrefix(classItem.className || classItem.name || '수업'),
      },
    });
  };

  const handleOpenChannelTalk = (context = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.__tipsPublicCounselContext = {
        source: 'public-timetable',
        grade: context.grade || currentPage?.grade || '',
        subject: context.subject && context.subject !== 'all'
          ? context.subject
          : (selectedSubject !== 'all' ? selectedSubject : ''),
        className: context.className || '',
      };
      if (typeof window.ChannelIO === 'function') {
        window.ChannelIO('showMessenger');
        window.ChannelIO('openChat');
        return;
      }

      if (window.ChannelIO?.showMessenger) {
        window.ChannelIO.showMessenger();
        window.ChannelIO.openChat?.();
        return;
      }

      if (window.ChannelTalk?.showMessenger) {
        window.ChannelTalk.showMessenger();
        return;
      }
    } catch (error) {
      console.error(error);
    }

    const contextLabel = buildCounselContextLabel(window.__tipsPublicCounselContext || {});
    toast.info(contextLabel ? `${contextLabel} 상담은 채널톡 연결 후 바로 시작됩니다.` : '채널톡 스크립트가 아직 연결되지 않았습니다.');
  };

  const handleOpenTimetableBlock = (block) => {
    if (block.type === 'merged') {
      setMergedBlockState({
        title: `${currentPage?.grade || ''} 겹침 수업`,
        subtitle: block.detailLines?.[0]?.value || '',
        classItems: block.classItems || [],
      });
      return;
    }

    openClassDetails(block.classItem, {
      source: 'timetable',
      grade: currentPage?.grade,
      subject: block.classItem?.subject,
    });
  };

  const handlePagerScroll = (event) => {
    const container = event.currentTarget;
    let closestGrade = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    gradePages.forEach((page) => {
      const node = pageRefs.current.get(page.grade);
      if (!node) {
        return;
      }
      const distance = Math.abs(node.offsetLeft - container.scrollLeft);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestGrade = page.grade;
      }
    });

    if (closestGrade && closestGrade !== selectedGradeValue) {
      setSelectedGradeValue(closestGrade);
      setSelectedGradeFamily(inferGradeFamily(closestGrade));
    }
  };

  const mobileSearchControls = mobileSearchOpen || text(searchQuery) ? (
    <div className="public-mobile-search-panel" data-testid="public-mobile-search-panel">
      <div className="public-search-wrap public-search-wrap-mobile">
        <Search size={16} className="public-search-icon" />
        <input
          className="styled-input public-search-input"
          data-testid="public-class-search-input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="수업명, 선생님, 강의실 검색"
        />
      </div>
      <div className="public-mobile-search-actions">
        <button type="button" className="public-filter-reset-button" onClick={() => { setSearchQuery(''); setMobileSearchOpen(false); }}>
          검색 초기화
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div data-testid="public-class-list-view" className={`public-page-shell ${isMobile ? 'is-mobile' : 'is-desktop'}`}>
      <div className="public-page-shell-header">
        <div className="public-page-shell-inner">
          <div className="public-page-brand">
            <img src="/logo_tips.png" alt="TIPS" className="public-page-brand-mark" />
            <div>
              <div className="public-page-brand-title">팁스영어수학학원 수업시간표</div>
              {isMobile ? <div className="public-page-brand-subtitle">학년별 시간표를 빠르게 넘겨보세요</div> : null}
            </div>
          </div>

          <div className="public-page-actions">
            {showBackToDashboard ? (
              <button
                type="button"
                className={`btn btn-primary public-page-action-button ${isMobile ? 'is-full' : ''}`}
                onClick={onBackToDashboard}
              >
                <ArrowLeft size={16} />
                운영 화면으로 돌아가기
              </button>
            ) : (
              <button
                type="button"
                className={`btn btn-secondary public-page-action-button ${isMobile ? 'is-full' : ''}`}
                data-testid="public-login-button"
                onClick={onLogin}
              >
                <LogIn size={16} />
                직원 로그인
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="public-page-shell-body">
        <section className={`card-custom public-page-hero ${isMobile ? 'is-mobile' : ''}`}>
          <div className="public-hero-copy">
            <div className="public-hero-eyebrow">현재 운영 중인 공개 수업</div>
            {isMobile ? (
              <>
                <div className="public-mobile-hero-summary">
                  <strong>{currentPage?.grade || '학년 선택 중'}</strong>
                  <span>{currentPage ? `${currentPage.items.length}개 수업` : '수업을 확인하는 중입니다.'}</span>
                </div>
                <p className="public-page-hero-description">
                  학년을 먼저 고르고, 필요한 블록만 눌러 일정표와 상담까지 바로 이어가세요.
                </p>
              </>
            ) : (
              <>
                <h1 className="public-page-hero-title">
                  필요한 학년의 시간표를 먼저 보고,
                  <br />
                  수업을 빠르게 결정하세요.
                </h1>
                <p className="public-page-hero-description">
                  학년과 과목을 고르면 공개 수업의 주간 시간표와 목록이 함께 정리됩니다. 필요한 블록이나 수업 카드만 눌러 일정표와 기본 정보를 확인할 수 있습니다.
                </p>
              </>
            )}

            <div className="public-filter-summary-row">
              <div className="public-filter-summary-pill">
                현재 {currentPage?.items.length ?? subjectSearchFilteredClasses.length}개 수업
              </div>
              {!isMobile && activeFilterChips.length > 0 ? (
                <button type="button" className="public-filter-reset-button" onClick={clearFilters}>
                  필터 초기화
                </button>
              ) : null}
            </div>

            {activeFilterChips.length > 0 ? (
              <div className={`public-filter-chip-rail ${isMobile ? 'public-filter-chip-rail-mobile' : ''}`}>
                {activeFilterChips.map((chip) => (
                  <span key={chip.key} className="public-filter-chip">{chip.label}</span>
                ))}
                {isMobile ? (
                  <button type="button" className="public-filter-reset-button" onClick={clearFilters}>
                    초기화
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {isMobile ? (
          <section className="card-custom public-mobile-control-shell" data-testid="public-mobile-control-shell">
            <div className="public-mobile-toolbar">
              <button
                type="button"
                className={`public-mobile-search-toggle ${mobileSearchOpen || Boolean(text(searchQuery)) ? 'is-open' : ''}`}
                data-testid="public-mobile-search-toggle"
                aria-expanded={mobileSearchOpen || Boolean(text(searchQuery))}
                onClick={() => setMobileSearchOpen((current) => !current)}
              >
                <Search size={16} />
                <span>{buildSearchLabel(searchQuery)}</span>
              </button>
              <div className="public-mobile-toolbar-meta">
                <span>{currentPage?.grade || '학년 선택 중'}</span>
                <strong>{currentPage ? `${currentPage.items.length}개 수업` : '0개 수업'}</strong>
              </div>
            </div>
            {mobileSearchControls}

            {gradePages.length > 0 ? (
              <div className="public-mobile-grade-carousel" data-testid="public-mobile-grade-carousel">
                {gradePages.map((page) => (
                  <button
                    key={`grade-card-${page.grade}`}
                    type="button"
                    className={`public-mobile-grade-card ${currentPage?.grade === page.grade ? 'is-active' : ''}`}
                    data-testid={`public-mobile-grade-card-${page.grade}`}
                    onClick={() => selectGradeValue(page.grade)}
                  >
                    <div className="public-mobile-grade-card-head">
                      <span className="public-mobile-grade-card-family">{getGradeFamilyLabel(page.family)}</span>
                      <span className="public-mobile-grade-card-count">{page.items.length}개</span>
                    </div>
                    <div className="public-mobile-grade-card-title">{page.grade}</div>
                    <div className="public-mobile-grade-card-subtitle">{page.subjectSummary || '운영 중인 수업'}</div>
                    <div className="public-mobile-grade-card-preview">
                      {page.previewItems.map((item) => (
                        <div key={`${page.grade}-${item.id}`} className="public-mobile-grade-card-preview-item">
                          <span>{item.subject || '수업'}</span>
                          <strong>{buildScheduleLines(item)[0] || '시간 미정'}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="public-mobile-grade-card-footer">
                      <span>{stripClassPrefix(page.previewItems[0]?.className || '바로 보기')}</span>
                      <ChevronRight size={14} />
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="card-custom public-filter-shell">
            <div className="public-filter-grid">
              <div className="public-filter-button-grid public-filter-button-grid-subject">
                {subjectOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`h-segment-btn public-filter-pill ${selectedSubject === option ? 'active' : ''}`}
                    aria-pressed={selectedSubject === option}
                    onClick={() => setSelectedSubject(option)}
                  >
                    {option === 'all' ? '전체 과목' : option}
                  </button>
                ))}
              </div>

              <div className="public-search-wrap">
                <Search size={16} className="public-search-icon" />
                <input
                  className="styled-input public-search-input"
                  data-testid="public-class-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="수업명, 선생님, 강의실 검색"
                />
              </div>
            </div>
          </section>
        )}

        {isLoading ? (
          <PublicTimetableSkeleton />
        ) : subjectSearchFilteredClasses.length === 0 ? (
          <div className="card-custom public-empty-state" data-testid="public-empty-state">조건에 맞는 수업이 없습니다.</div>
        ) : currentPage ? (
          <section className="card-custom public-timetable-shell" data-testid="public-timetable-shell">
            <div className="public-timetable-shell-head">
              <div className="public-timetable-shell-copy">
                <div className="public-timetable-shell-eyebrow">
                  {getGradeFamilyLabel(currentPage.family)} · {currentPage.subjectSummary || '운영 중인 수업'}
                </div>
                <h2 className="public-timetable-shell-title">{currentPage.grade} 주간 시간표</h2>
                <p className="public-timetable-shell-description">
                  원하는 블록을 바로 눌러 수업 일정표와 기본 정보를 확인하고 상담까지 이어가세요.
                </p>
              </div>
              <div className="public-timetable-shell-actions">
                <button
                  type="button"
                  className="btn btn-secondary public-inline-chat-button"
                  onClick={() => handleOpenChannelTalk({ grade: currentPage.grade, subject: selectedSubject })}
                >
                  <MessageCircle size={16} />
                  상담하기
                </button>
              </div>
            </div>

            {summaryChips.length > 0 ? (
              <div className="public-current-summary-chip-row">
                {summaryChips.map((chip) => (
                  <span key={chip.key} className={`public-current-summary-chip is-${chip.tone}`}>
                    {chip.label}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="public-view-toggle-row" data-testid="public-view-toggle">
              <button
                type="button"
                className={`h-segment-btn ${selectedViewMode === 'timetable' ? 'active' : ''}`}
                data-testid="public-view-toggle-timetable"
                onClick={() => setSelectedViewMode('timetable')}
              >
                주간 시간표
              </button>
              <button
                type="button"
                className={`h-segment-btn ${selectedViewMode === 'list' ? 'active' : ''}`}
                data-testid="public-view-toggle-list"
                onClick={() => setSelectedViewMode('list')}
              >
                수업 목록
              </button>
            </div>

            {selectedViewMode === 'timetable' ? (
              isMobile ? (
                <div
                  className="public-mobile-timetable-pager"
                  data-testid="public-mobile-timetable-pager"
                  ref={pagerRef}
                  onScroll={handlePagerScroll}
                >
                  {gradePages.map((page) => (
                    <section
                      key={page.grade}
                      className="public-mobile-timetable-page"
                      data-testid={`public-mobile-timetable-page-${page.grade}`}
                      ref={(node) => {
                        if (node) {
                          pageRefs.current.set(page.grade, node);
                        } else {
                          pageRefs.current.delete(page.grade);
                        }
                      }}
                    >
                      <div className="public-mobile-timetable-page-head">
                        <div>
                          <div className="public-mobile-timetable-page-family">{getGradeFamilyLabel(page.family)}</div>
                          <div className="public-mobile-timetable-page-title">{page.grade}</div>
                        </div>
                        <div className="public-mobile-timetable-page-count">{page.items.length}개 수업</div>
                      </div>
                      <div className="public-mobile-timetable-status-row">
                        {page.todayCount > 0 ? <span className="public-current-summary-chip is-accent">오늘 {page.todayCount}개</span> : null}
                        {page.urgentCount > 0 ? <span className="public-current-summary-chip is-warning">마감 임박 {page.urgentCount}</span> : null}
                        <span className="public-current-summary-chip is-neutral">{page.subjectSummary || '운영 중'}</span>
                      </div>
                      <div className="public-timetable-grid-wrap">
                        <TimetableGrid
                          columns={DAY_COLUMNS}
                          timeSlots={page.timetable.timeSlots}
                          blocks={page.timetable.blocks.map((block) => ({
                            ...block,
                            clickable: true,
                            editable: false,
                            onClick: () => handleOpenTimetableBlock(block),
                          }))}
                          editable={false}
                          density="micro"
                          slotHeight={44}
                          shellClassName="public-readonly-timetable"
                        />
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="public-desktop-timetable-layout">
                  <div className="public-desktop-grade-rail" data-testid="public-desktop-grade-rail">
                    {gradePages.map((page) => (
                      <button
                        key={`desktop-grade-${page.grade}`}
                        type="button"
                        className={`public-desktop-grade-pill ${page.grade === currentPage.grade ? 'is-active' : ''}`}
                        onClick={() => selectGradeValue(page.grade)}
                      >
                        <span>{page.grade}</span>
                        <strong>{page.items.length}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="public-timetable-grid-wrap">
                    <TimetableGrid
                      columns={DAY_COLUMNS}
                      timeSlots={currentPage.timetable.timeSlots}
                      blocks={currentBlocks.map((block) => ({
                        ...block,
                        onClick: () => handleOpenTimetableBlock(block),
                      }))}
                      editable={false}
                      density="comfortable"
                      slotHeight={50}
                      shellClassName="public-readonly-timetable"
                    />
                  </div>
                </div>
              )
            ) : (
              <div className="public-current-grade-list" data-testid="public-current-grade-list">
                {currentItems.map((classItem) => (
                  <PublicClassCard
                    key={`current-grade-${classItem.id}`}
                    classItem={classItem}
                    compact={isCompactLayout}
                    onOpenPlan={(item) => openClassDetails(item, {
                      source: 'list',
                      grade: currentPage.grade,
                      subject: item.subject,
                    })}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>

      <ClassSchedulePlanModal
        open={Boolean(selectedClassState?.classItem)}
        mode="readonly"
        classItem={selectedClassState?.classItem}
        plan={selectedClassState?.classItem?.schedulePlan || selectedClassState?.classItem?.schedule_plan || null}
        textbooksCatalog={textbooks}
        progressLogs={progressLogs}
        emptyMessage="아직 등록된 일정표가 없습니다."
        onClose={() => setSelectedClassState(null)}
        primaryActionLabel="이 시간 상담하기"
        onPrimaryAction={() => {
          if (selectedClassState?.counselContext) {
            handleOpenChannelTalk(selectedClassState.counselContext);
          }
        }}
        summaryBadges={selectedClassState?.summaryBadges || []}
      />

      <BottomSheet
        open={Boolean(mergedBlockState)}
        onClose={() => setMergedBlockState(null)}
        title={mergedBlockState?.title || '겹침 수업'}
        subtitle={mergedBlockState?.subtitle || ''}
        testId="public-merged-class-sheet"
      >
        <div className="public-merged-sheet-list">
          {(mergedBlockState?.classItems || []).map((classItem) => (
            <button
              key={`merged-class-${classItem.id}`}
              type="button"
              className="public-merged-sheet-item"
              onClick={() => openClassDetails(classItem, {
                source: 'timetable',
                grade: currentPage?.grade,
                subject: classItem.subject,
              })}
            >
              <div className="public-merged-sheet-item-copy">
                <strong>{stripClassPrefix(classItem.className || '수업')}</strong>
                <span>{classItem.subject || '과목'} · {normalizeGrade(classItem.grade)}</span>
                <span>{buildScheduleLines(classItem)[0] || '시간 미정'}</span>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </BottomSheet>

      {isMobile ? (
        <div className={`public-mobile-dock-zone ${mobileDockTab ? 'has-panel' : ''}`}>
          {mobileDockTab === 'subject' ? (
            <div className="public-mobile-dock-panel public-mobile-dock-panel-subject" data-testid="public-mobile-dock-panel-subject">
              <div className="public-mobile-dock-panel-label">과목 선택</div>
              <div className="public-mobile-dock-chip-row">
                <button
                  type="button"
                  className={`public-mobile-dock-chip ${selectedSubject === 'all' ? 'is-active' : ''}`}
                  onClick={() => selectSubjectValue('all')}
                >
                  전체
                </button>
                {mobileSubjectOptions.map((option) => (
                  <button
                    key={`dock-subject-${option}`}
                    type="button"
                    className={`public-mobile-dock-chip ${selectedSubject === option ? 'is-active' : ''}`}
                    onClick={() => selectSubjectValue(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {mobileDockTab === 'grade' ? (
            <div className="public-mobile-dock-panel public-mobile-dock-panel-grade" data-testid="public-mobile-dock-panel-grade">
              <div className="public-mobile-dock-panel-label">학년 선택</div>
              <div className="public-mobile-grade-family-row">
                {MOBILE_GRADE_FAMILIES.map((family) => (
                  <button
                    key={`family-${family.id}`}
                    type="button"
                    className={`public-mobile-dock-chip ${selectedGradeFamily === family.id ? 'is-active' : ''}`}
                    onClick={() => setGradeCategory(family.id)}
                    disabled={(availableFamilyMap[family.id] || []).length === 0}
                  >
                    {family.label}
                  </button>
                ))}
              </div>
              {selectedGradeFamily !== 'all' ? (
                (availableFamilyMap[selectedGradeFamily] || []).length > 0 ? (
                  <div className="public-mobile-grade-detail-row">
                    {(availableFamilyMap[selectedGradeFamily] || []).map((grade) => (
                      <button
                        key={`grade-${grade}`}
                        type="button"
                        className={`public-mobile-dock-chip is-detail ${selectedGradeValue === grade ? 'is-active' : ''}`}
                        onClick={() => selectGradeValue(grade)}
                      >
                        {grade}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="public-mobile-dock-caption">현재 선택한 과목과 검색 조건에 맞는 세부 학년이 없습니다.</div>
                )
              ) : (
                <div className="public-mobile-dock-caption">고등, 중등, 초등 중 하나를 먼저 고르면 세부 학년이 바로 열립니다.</div>
              )}
            </div>
          ) : null}

          <div className="public-mobile-dock" data-testid="public-mobile-dock">
            <button
              type="button"
              className={`public-mobile-dock-button ${mobileDockTab === 'subject' ? 'is-active' : ''}`}
              data-testid="public-mobile-dock-subject"
              aria-expanded={mobileDockTab === 'subject'}
              onClick={() => toggleMobileDockTab('subject')}
            >
              <BookOpen size={18} />
              <span>과목</span>
            </button>
            <button
              type="button"
              className={`public-mobile-dock-button ${mobileDockTab === 'grade' ? 'is-active' : ''}`}
              data-testid="public-mobile-dock-grade"
              aria-expanded={mobileDockTab === 'grade'}
              onClick={() => toggleMobileDockTab('grade')}
            >
              <GraduationCap size={18} />
              <span>학년</span>
            </button>
            <button
              type="button"
              className="public-mobile-dock-button"
              data-testid="public-mobile-dock-chat"
              onClick={() => handleOpenChannelTalk({ grade: currentPage?.grade, subject: selectedSubject })}
            >
              <MessageCircle size={18} />
              <span>상담</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
