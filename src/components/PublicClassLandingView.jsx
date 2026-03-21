import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Home,
  MapPin,
  MessageCircle,
  Moon,
  Search,
  Share2,
  Star,
  Sun,
  Trophy,
  Trash2,
  UserRound,
} from 'lucide-react';
import { ACTIVE_CLASS_STATUS, computeClassStatus } from '../lib/classStatus';
import { CLASS_COLORS, generateTimeSlots, parseSchedule, stripClassPrefix } from '../data/sampleData';
import useViewport from '../hooks/useViewport';
import { useToast } from '../contexts/ToastContext';
import { captureElementAsPngBlob, downloadBlob } from '../lib/exportAsImage';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';
import BottomSheet from './ui/BottomSheet';
import TimetableGrid from './ui/TimetableGrid';

const PUBLIC_SUBJECT_TABS = ['영어', '수학'];
const PUBLIC_GRADE_TABS = ['고3', '고2', '고1', '중3', '중2', '중1', '초6'];
const PUBLIC_BOTTOM_NAV_ITEMS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'reviews', label: '리뷰', icon: Star },
  { id: 'classes', label: '수업', icon: BookOpen },
  { id: 'scores', label: '성적', icon: Trophy },
  { id: 'inquiry', label: '문의', icon: MessageCircle },
];

const DAY_COLUMNS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_INDEX_MAP = Object.fromEntries(DAY_COLUMNS.map((day, index) => [day, index]));
const SCHEDULE_DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일'];
const SLOT_START_HOUR = 6;
const SLOT_END_HOUR = 24;
const SLOT_START_MINUTES = SLOT_START_HOUR * 60;
const FULL_TIME_SLOTS = generateTimeSlots(SLOT_START_HOUR, SLOT_END_HOUR);
const DEFAULT_START_SLOT = 6;
const DEFAULT_END_SLOT = 28;
const CHANNEL_TALK_URL = 'https://tipsedu.channel.io/';
const REVIEW_URL = 'https://map.naver.com/p/search/%ED%8C%81%EC%8A%A4%ED%95%99%EC%9B%90/place/1218797840?placePath=/review?bk_query=%ED%8C%81%EC%8A%A4%ED%95%99%EC%9B%90&entry=pll&fromNxList=true&fromPanelNum=2&locale=ko&searchText=%ED%8C%81%EC%8A%A4%ED%95%99%EC%9B%90&svcName=map_pcv5&timestamp=202603211127&from=map&placeSearchOption=bk_query%3D%25ED%258C%2581%25EC%258A%25A4%25ED%2595%2599%25EC%259B%2590%26entry%3Dpll%26fromNxList%3Dtrue%26x%3D126.585464%26y%3D33.521802&searchType=place&c=15.00,0,0,0,dh';
const SCORE_URL = 'https://tipsedu.notion.site/81702b56937644e9a609b1f0b6b48105?v=d97e114279514356a2e70982379ed079';

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

function formatCurrency(amount) {
  const safe = Number(amount || 0);
  if (!Number.isFinite(safe) || safe <= 0) {
    return '수업료 문의';
  }
  return `${safe.toLocaleString('ko-KR')}원`;
}

function buildScheduleLines(classItem) {
  const slots = parseSchedule(classItem?.schedule, classItem) || [];
  if (slots.length === 0) {
    return ['시간 미정'];
  }

  const groupedByTime = new Map();

  slots.forEach((slot) => {
    const timeKey = `${slot.start}-${slot.end}`;
    const currentDays = groupedByTime.get(timeKey) || [];
    currentDays.push(slot.day);
    groupedByTime.set(timeKey, currentDays);
  });

  return [...groupedByTime.entries()].map(([timeKey, days]) => {
    const orderedDays = [...new Set(days)]
      .sort((left, right) => SCHEDULE_DAY_ORDER.indexOf(left) - SCHEDULE_DAY_ORDER.indexOf(right))
      .join('');

    return `${orderedDays} ${timeKey}`;
  });
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
  return [
    stripClassPrefix(classItem?.className || classItem?.name || ''),
    text(classItem?.subject),
    normalizeGrade(classItem?.grade),
  ]
    .map((value) => text(value))
    .join(' ');
}

function getStatusMeta(classItem) {
  const capacity = Number(classItem?.capacity || 0);
  const enrolled = Array.isArray(classItem?.studentIds) ? classItem.studentIds.length : 0;
  const waitlist = Array.isArray(classItem?.waitlistIds) ? classItem.waitlistIds.length : 0;

  if (capacity > 0) {
    const seatsLeft = Math.max(0, capacity - enrolled);

    if (seatsLeft === 0) {
      return { priority: 0, tone: 'danger', label: '마감', detail: `대기 ${waitlist}명` };
    }
    if (seatsLeft <= 3) {
      return { priority: 1, tone: 'warning', label: '마감임박', detail: `마지막 ${seatsLeft}자리` };
    }
    return { priority: 2, tone: 'accent', label: '모집중', detail: '' };
  }

  return { priority: 3, tone: 'accent', label: '모집중', detail: '' };
}

function getEnrollmentSummary(classItem) {
  const enrolled = Array.isArray(classItem?.studentIds) ? classItem.studentIds.length : 0;
  const capacity = Number(classItem?.capacity || 0);

  if (capacity > 0) {
    return `정원 ${enrolled}/${capacity}`;
  }

  return `정원 문의`;
}

function getDisplayFee(classItem) {
  return Number(classItem?.fee || classItem?.tuition || 0);
}

function sortClassesForLanding(items = []) {
  return items
    .slice()
    .sort((left, right) => getClassSortKey(left).localeCompare(getClassSortKey(right), 'ko'));
}

function buildSectionKicker(selectedSubject, selectedGrade) {
  const subjectLabel = selectedSubject || '전체 과목';
  const gradeLabel = selectedGrade || '전체 학년';
  return `${subjectLabel} · ${gradeLabel}`;
}

function buildSectionTitle(selectedSubject, selectedGrade) {
  if (selectedGrade) {
    return `${selectedGrade} 수업`;
  }

  if (selectedSubject) {
    return `${selectedSubject} 수업`;
  }

  return '전체 수업';
}

function buildCounselContextLabel(context = {}) {
  return [context.grade, context.subject, context.className]
    .map((item) => text(item))
    .filter(Boolean)
    .join(' ');
}

function buildModalSummaryBadges(classItem, context = {}) {
  const badges = [];

  if (context.grade) {
    badges.push({ label: context.grade, tone: 'neutral' });
  }
  if (classItem?.subject) {
    badges.push({ label: classItem.subject, tone: 'accent' });
  }

  const statusMeta = getStatusMeta(classItem);
  badges.push({ label: statusMeta.label, tone: statusMeta.tone });
  if (statusMeta.detail) {
    badges.push({ label: statusMeta.detail, tone: 'neutral' });
  }

  return badges.slice(0, 4);
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
            { label: 'room', value: text(entry.classItem.classroom || entry.classItem.room) || '강의실 미정', subtle: true },
          ],
          columnIndex: entry.columnIndex,
          startSlot: entry.startSlot,
          endSlot: entry.endSlot,
          backgroundColor: entry.tone.bg,
          borderColor: entry.tone.border,
          textColor: entry.tone.text,
        });
      } else {
        const primary = sortClassesForLanding(cluster.map((entry) => entry.classItem))[0];
        const mergedTone = getToneForClass(primary, columnIndex);

        mergedEntries.push({
          key: `merged-${columnIndex}-${clusterStart}-${clusterFinish}`,
          type: 'merged',
          classItems: cluster.map((entry) => entry.classItem),
          title: `${text(primary?.subject) || '수업'} 외 ${cluster.length - 1}개`,
          header: stripClassPrefix(primary?.className || '겹침 수업'),
          detailLines: [
            { label: 'time', value: `${DAY_COLUMNS[columnIndex]} ${FULL_TIME_SLOTS[clusterStart]?.split('-')[0]} - ${FULL_TIME_SLOTS[clusterFinish - 1]?.split('-')[1]}` },
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

function isSameGrade(classItem, grade) {
  return normalizeGradeToken(classItem?.grade) === normalizeGradeToken(grade);
}

function hasScheduleConflict(leftClass, rightClass) {
  const leftSlots = parseSchedule(leftClass?.schedule, leftClass) || [];
  const rightSlots = parseSchedule(rightClass?.schedule, rightClass) || [];

  return leftSlots.some((leftSlot) => {
    const leftStart = timeToMinutes(leftSlot.start);
    const leftEnd = timeToMinutes(leftSlot.end);

    return rightSlots.some((rightSlot) => {
      if (leftSlot.day !== rightSlot.day) {
        return false;
      }

      const rightStart = timeToMinutes(rightSlot.start);
      const rightEnd = timeToMinutes(rightSlot.end);
      return leftStart < rightEnd && rightStart < leftEnd;
    });
  });
}

function buildPlannerConflictMessage(candidate, conflict) {
  const candidateTitle = stripClassPrefix(candidate?.className || candidate?.name || '선택한 수업');
  const conflictTitle = stripClassPrefix(conflict?.className || conflict?.name || '기존 수업');
  const conflictLine = buildScheduleLines(conflict)[0] || '시간 미정';
  return `${candidateTitle} 수업은 ${conflictTitle} (${conflictLine})과 시간이 겹쳐 담을 수 없습니다.`;
}

function PublicPlaceholderPanel({ item }) {
  const Icon = item.icon;
  return (
    <section className="public-placeholder-panel" data-testid={`public-placeholder-${item.id}`}>
      <div className="public-placeholder-icon">
        <Icon size={28} />
      </div>
      <strong>{item.label} 모바일 랜딩은 다음 단계에서 연결됩니다.</strong>
      <p>
        지금은 퍼블릭 수업 랜딩과 장바구니형 시간표 경험을 우선 구현해두었습니다.
        이 탭은 추후 동일한 톤으로 전용 랜딩을 연결할 수 있도록 자리만 마련해둔 상태입니다.
      </p>
    </section>
  );
}

export function PublicLandingCard({
  classItem,
  rank,
  isSelected,
  onOpenDetails,
  onTogglePlanner,
  hideActions = false,
  semanticButton = true,
}) {
  const title = stripClassPrefix(classItem.className || classItem.name || '이름 없는 수업');
  const scheduleLines = buildScheduleLines(classItem);
  const scheduleLabel = scheduleLines.join(' · ');
  const teachers = splitLines(classItem.teacher, 5);
  const classrooms = splitLines(classItem.classroom || classItem.room, 5);
  const maxMetaLines = Math.max(teachers.length, classrooms.length, 1);
  const feeText = formatCurrency(getDisplayFee(classItem));
  const enrollmentSummary = getEnrollmentSummary(classItem);
  const statusMeta = getStatusMeta(classItem);
  const subject = text(classItem.subject) || '수업';
  const grade = normalizeGrade(classItem.grade);

  return (
    <article className={`public-landing-card ${rank !== undefined ? 'has-rank' : ''} ${isSelected ? 'is-selected' : ''}`} data-testid={`public-class-card-${classItem?.id || 'unknown'}`}>
      {rank !== undefined && <div className="public-landing-card-rank">{rank}</div>}
      <div className="public-landing-card-surface">
        <div
          role={onOpenDetails && semanticButton ? "button" : undefined}
          tabIndex={onOpenDetails && semanticButton ? 0 : undefined}
          aria-label={onOpenDetails && semanticButton ? `${title} 상세 보기` : undefined}
          className={`public-landing-card-main ${!onOpenDetails ? 'is-static' : ''}`}
          onClick={onOpenDetails ? () => onOpenDetails(classItem) : undefined}
          title={onOpenDetails && semanticButton ? `${title} 상세 보기` : undefined}
          style={!onOpenDetails || !semanticButton ? { cursor: 'default' } : {}}
        >
          <div className="public-landing-card-copy">
            <div className="public-landing-card-copy-top">
              <div className="public-landing-card-heading">
                <span className="public-landing-card-eyebrow">{subject} · {grade}</span>
                <h3 className="public-landing-card-title">{title}</h3>
              </div>
            </div>

            <div className="public-landing-card-meta-list">
              <div className="public-landing-card-meta-item public-landing-card-meta-item-schedule">
                <CalendarDays size={14} />
                <span>{scheduleLabel}</span>
              </div>
              <div className="public-landing-card-meta-grid">
                {Array.from({ length: maxMetaLines }).map((_, index) => (
                  <div style={{ display: 'contents' }} key={`meta-${index}`}>
                    <div className="public-landing-card-meta-item">
                      <div className="public-landing-card-meta-icon">
                        {index === 0 && <UserRound size={14} />}
                      </div>
                      <span>{teachers[index] || (index === 0 ? '선생님 미정' : '')}</span>
                    </div>
                    <div className="public-landing-card-meta-item">
                      <div className="public-landing-card-meta-icon">
                        {index === 0 && <MapPin size={14} />}
                      </div>
                      <span>{classrooms[index] || (index === 0 ? '강의실 미정' : '')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {onOpenDetails && <ChevronRight size={18} className="public-landing-card-arrow" />}
        </div>

        <div className="public-landing-card-status-anchor">
          <div className={`public-landing-status is-${statusMeta.tone} ${statusMeta.detail ? 'is-animated' : ''}`}>
            <strong>{statusMeta.label}</strong>
            {statusMeta.detail && <span>{statusMeta.detail}</span>}
          </div>
        </div>

        <div className="public-landing-card-footer">
          <div className="public-landing-card-price-block">
            <strong>{feeText}</strong>
            <span>{enrollmentSummary}</span>
          </div>
          {!hideActions && onTogglePlanner && (
            <button
              type="button"
              className={`public-landing-card-cart-button is-inline ${isSelected ? 'is-selected' : ''}`}
              data-testid={`public-card-toggle-${classItem?.id}`}
              onClick={() => onTogglePlanner(classItem)}
            >
              {isSelected ? <Check size={14} /> : <BookOpen size={14} />}
              <span>{isSelected ? '담김' : '담기'}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function PublicClassLandingView({
  classes,
  isLoading = false,
  onLogin,
  showBackToDashboard = false,
  onBackToDashboard,
  theme = '',
  onToggleTheme = () => {},
}) {
  const { isMobile, isCompact } = useViewport();
  const toast = useToast();
  const safeTheme = theme || (
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme') || 'light'
      : 'light'
  );

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activePublicTab, setActivePublicTab] = useState('classes');
  const [selectedSubject, setSelectedSubject] = useState(PUBLIC_SUBJECT_TABS[0]);
  const [selectedGrade, setSelectedGrade] = useState(PUBLIC_GRADE_TABS[0]);
  const [isCondensedHeader, setIsCondensedHeader] = useState(false);
  const [plannerItems, setPlannerItems] = useState([]);
  const [plannerGrade, setPlannerGrade] = useState('');
  const [isPlannerSheetOpen, setIsPlannerSheetOpen] = useState(false);
  const [selectedClassItem, setSelectedClassItem] = useState(null);
  const [isSharingPlanner, setIsSharingPlanner] = useState(false);

  const cardListRef = useRef(null);
  const plannerPreviewRef = useRef(null);

  const activeClasses = useMemo(
    () => (classes || []).filter((item) => computeClassStatus(item) === ACTIVE_CLASS_STATUS),
    [classes]
  );

  const availableSubjects = useMemo(
    () => PUBLIC_SUBJECT_TABS.filter((subject) => activeClasses.some((item) => text(item.subject) === subject)),
    [activeClasses]
  );

  useEffect(() => {
    if (!availableSubjects.length) {
      if (selectedSubject) {
        setSelectedSubject('');
      }
      return;
    }

    if (selectedSubject && !availableSubjects.includes(selectedSubject)) {
      setSelectedSubject(availableSubjects[0]);
    }
  }, [availableSubjects, selectedSubject]);

  const subjectSearchFilteredClasses = useMemo(() => {
    const query = text(deferredSearchQuery).toLowerCase();
    return activeClasses.filter((item) => {
      const matchesSubject = !selectedSubject || text(item.subject) === selectedSubject;
      const haystack = [
        stripClassPrefix(item.className || item.name),
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

  const gradeCounts = useMemo(
    () => Object.fromEntries(
      PUBLIC_GRADE_TABS.map((grade) => [
        grade,
        subjectSearchFilteredClasses.filter((item) => isSameGrade(item, grade)).length,
      ])
    ),
    [subjectSearchFilteredClasses]
  );

  const availableGrades = useMemo(
    () => PUBLIC_GRADE_TABS.filter((grade) => gradeCounts[grade] > 0),
    [gradeCounts]
  );

  useEffect(() => {
    if (!availableGrades.length) {
      if (selectedGrade) {
        setSelectedGrade('');
      }
      return;
    }

    if (selectedGrade && gradeCounts[selectedGrade] === 0) {
      setSelectedGrade(availableGrades[0]);
    }
  }, [availableGrades, gradeCounts, selectedGrade]);

  const filteredClasses = useMemo(
    () => sortClassesForLanding(
      subjectSearchFilteredClasses.filter((item) => !selectedGrade || isSameGrade(item, selectedGrade))
    ),
    [selectedGrade, subjectSearchFilteredClasses]
  );

  const plannerSelectedIds = useMemo(
    () => new Set(plannerItems.map((item) => item.id)),
    [plannerItems]
  );

  const plannerTimetable = useMemo(
    () => buildTimetableData(plannerItems),
    [plannerItems]
  );

  const plannerSummaryText = useMemo(() => {
    if (!plannerItems.length) {
      return '선택한 수업이 아직 없습니다.';
    }

    const summary = [...new Set(plannerItems.map((item) => text(item.subject)).filter(Boolean))].join(' · ');
    return `${plannerGrade} · ${summary || '선택 수업'} · ${plannerItems.length}개`;
  }, [plannerGrade, plannerItems]);

  const selectedClassBadges = useMemo(() => {
    if (!selectedClassItem) {
      return [];
    }

    const badges = buildModalSummaryBadges(selectedClassItem, {
      grade: normalizeGrade(selectedClassItem.grade),
      subject: selectedClassItem.subject,
      source: 'list',
    });

    if (plannerSelectedIds.has(selectedClassItem.id)) {
      badges.unshift({ label: '시간표에 담김', tone: 'accent' });
    }

    return badges.slice(0, 4);
  }, [plannerSelectedIds, selectedClassItem]);

  useEffect(() => {
    if (!isMobile) {
      setIsCondensedHeader(false);
      return undefined;
    }

    const handleScroll = () => {
      setIsCondensedHeader(window.scrollY > 36);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isMobile]);

  useEffect(() => {
    if (plannerItems.length === 0) {
      setPlannerGrade('');
    }
  }, [plannerItems.length]);

  const openClassDetails = (classItem) => {
    setSelectedClassItem(classItem);
  };

  const handleOpenChannelTalk = (context = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.__tipsPublicCounselContext = {
      source: 'public-landing',
      grade: context.grade || selectedGrade || plannerGrade || '',
      subject: context.subject || selectedSubject || '',
      className: context.className || '',
    };

    const popup = window.open(
      CHANNEL_TALK_URL,
      'tips-channel-talk',
      'popup=yes,width=420,height=760,noopener,noreferrer'
    );
    if (!popup) {
      toast.info('채널톡 새창이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.');
    }
  };

  const handleOpenExternalWindow = (url, label) => {
    if (typeof window === 'undefined') {
      return;
    }

    const popup = window.open(
      url,
      '_blank',
      'noopener,noreferrer'
    );

    if (!popup) {
      toast.info(`${label} 새창이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.`);
    }
  };

  const togglePlannerItem = (classItem) => {
    const normalizedGrade = normalizeGrade(classItem.grade);
    const title = stripClassPrefix(classItem.className || classItem.name || '수업');

    if (plannerSelectedIds.has(classItem.id)) {
      setPlannerItems((current) => current.filter((item) => item.id !== classItem.id));
      toast.info(`${title} 수업을 시간표에서 뺐습니다.`);
      return;
    }

    if (plannerGrade && plannerGrade !== normalizedGrade) {
      toast.info(`현재 장바구니는 ${plannerGrade} 기준입니다. 전체 비우기 후 다른 학년을 담아주세요.`);
      return;
    }

    const conflict = plannerItems.find((item) => hasScheduleConflict(item, classItem));
    if (conflict) {
      toast.error(buildPlannerConflictMessage(classItem, conflict));
      return;
    }

    setPlannerItems((current) => [...current, classItem]);
    setPlannerGrade((current) => current || normalizedGrade);
    toast.success('수업바구니에 수업을 담았어요.', {
      duration: 3800,
      actionLabel: '보러가기',
      onAction: () => setIsPlannerSheetOpen(true),
    });
  };

  const clearPlanner = () => {
    setPlannerItems([]);
    setPlannerGrade('');
    setIsPlannerSheetOpen(false);
    toast.info('내 시간표를 비웠습니다.');
  };

  const openPlannerSheet = () => {
    if (!plannerItems.length) {
      toast.info('먼저 수업을 시간표에 담아주세요.');
      return;
    }
    setIsPlannerSheetOpen(true);
  };

  const handleSharePlanner = async () => {
    if (!plannerPreviewRef.current || !plannerItems.length) {
      return;
    }

    setIsSharingPlanner(true);

    try {
      const blob = await captureElementAsPngBlob(plannerPreviewRef.current, {
        width: 1080,
        padding: 28,
        scale: 3,
      });

      if (!blob) {
        throw new Error('planner share blob missing');
      }

      const filename = `TIPS-${plannerGrade || 'public'}-주간시간표.png`;

      if (typeof navigator !== 'undefined' && typeof File !== 'undefined' && navigator.share) {
        const file = new File([blob], filename, { type: 'image/png' });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'TIPS 주간 시간표',
            text: plannerSummaryText,
            files: [file],
          });
          toast.success('시간표 공유 화면을 열었습니다.');
          return;
        }
      }

      downloadBlob(blob, filename);
      toast.info('공유를 지원하지 않아 이미지 다운로드로 대신했습니다.');
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      console.error(error);
      toast.error('시간표 이미지를 만드는 중 문제가 생겼습니다.');
    } finally {
      setIsSharingPlanner(false);
    }
  };

  const scrollToCards = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (cardListRef.current) {
      cardListRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectSubject = (subject) => {
    setSelectedSubject((current) => (current === subject ? '' : subject));
    scrollToCards();
  };

  const handleSelectGrade = (grade) => {
    setSelectedGrade((current) => (current === grade ? '' : grade));
    scrollToCards();
  };

  const handleBottomNavClick = (item) => {
    if (item.id === 'inquiry') {
      handleOpenChannelTalk({ grade: selectedGrade, subject: selectedSubject });
      return;
    }

    if (item.id === 'reviews') {
      handleOpenExternalWindow(REVIEW_URL, '리뷰');
      return;
    }

    if (item.id === 'scores') {
      handleOpenExternalWindow(SCORE_URL, '성적');
      return;
    }

    setActivePublicTab(item.id);
    if (item.id === 'classes' && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleLogoClick = () => {
    setActivePublicTab('classes');
    if (showBackToDashboard && typeof onBackToDashboard === 'function') {
      onBackToDashboard();
      return;
    }

    if (typeof onLogin === 'function') {
      onLogin();
      return;
    }

    scrollToCards();
  };

  const plannerActions = (
    <div className="public-planner-sheet-footer-actions">
      <button type="button" className="btn btn-secondary" onClick={clearPlanner} disabled={!plannerItems.length}>
        <Trash2 size={16} />
        전체 비우기
      </button>
      <button type="button" className="btn btn-primary" onClick={handleSharePlanner} disabled={!plannerItems.length || isSharingPlanner}>
        <Share2 size={16} />
        {isSharingPlanner ? '이미지 준비 중' : '이미지 공유'}
      </button>
    </div>
  );

  const selectedClassIsInPlanner = selectedClassItem ? plannerSelectedIds.has(selectedClassItem.id) : false;

  return (
    <div
      data-testid="public-class-list-view"
      className={`public-landing-shell ${isMobile ? 'is-mobile' : 'is-desktop'} ${safeTheme === 'dark' ? 'is-dark' : 'is-light'} ${isCondensedHeader ? 'is-condensed-header' : ''}`}
    >
      <header className={`public-landing-topbar ${isMobile ? 'is-mobile' : 'is-desktop'}`} data-testid="public-mobile-topbar">
        <div className="public-landing-search-row">
          <label className="public-landing-search-field">
            <Search size={18} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="public-landing-search-input"
              data-testid="public-class-search-input"
              placeholder="수업명, 선생님, 강의실"
            />
          </label>

          <button
            type="button"
            className="public-topbar-icon-button"
            data-testid="public-theme-toggle"
            onClick={onToggleTheme}
            aria-label="테마 전환"
            title="테마 전환"
          >
            {safeTheme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>

          <button
            type="button"
            className="public-topbar-icon-button public-topbar-logo-button"
            data-testid="public-logo-button"
            onClick={handleLogoClick}
            aria-label={showBackToDashboard ? '직원 페이지로 이동' : '직원 로그인'}
            title={showBackToDashboard ? '직원 페이지로 이동' : '직원 로그인'}
          >
            <img src="/logo_tips.png" alt="TIPS" />
          </button>
        </div>

        {activePublicTab === 'classes' ? (
          <>
            <div className="public-landing-tab-row public-landing-tab-row-subject" data-testid="public-subject-tabs">
              {PUBLIC_SUBJECT_TABS.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  className={`public-landing-chip-tab ${selectedSubject === subject ? 'is-active' : ''}`}
                  data-testid={`public-subject-tab-${subject}`}
                  onClick={() => handleSelectSubject(subject)}
                  disabled={!availableSubjects.includes(subject)}
                >
                  {subject}
                </button>
              ))}
            </div>

            <div className="public-landing-tab-row public-landing-tab-row-grade" data-testid="public-grade-tabs">
              {PUBLIC_GRADE_TABS.map((grade) => (
                <button
                  key={grade}
                  type="button"
                  className={`public-landing-pill-tab ${selectedGrade === grade ? 'is-active' : ''}`}
                  data-testid={`public-grade-tab-${grade}`}
                  onClick={() => handleSelectGrade(grade)}
                  disabled={gradeCounts[grade] === 0}
                >
                  {grade}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </header>

      <main className={`public-landing-main ${isCompact ? 'is-compact' : ''}`}>
        {activePublicTab !== 'classes' ? (
          <PublicPlaceholderPanel item={PUBLIC_BOTTOM_NAV_ITEMS.find((item) => item.id === activePublicTab) || PUBLIC_BOTTOM_NAV_ITEMS[0]} />
        ) : (
          <>
            <section className="public-landing-section-head">
              <div>
                <div className="public-landing-section-kicker">{buildSectionKicker(selectedSubject, selectedGrade)}</div>
                <h1 className="public-landing-section-title">{buildSectionTitle(selectedSubject, selectedGrade)}</h1>
                <p className="public-landing-section-description">
                  카드로 빠르게 훑어보고, 필요한 수업만 담아서 나만의 주간 시간표를 바로 만들어보세요.
                </p>
              </div>

            </section>

            {isLoading ? (
              <section className="public-empty-state">수업 목록을 불러오는 중입니다.</section>
            ) : filteredClasses.length === 0 ? (
              <section className="public-empty-state" data-testid="public-empty-state">
                조건에 맞는 수업이 없습니다.
              </section>
            ) : (
              <div className={`public-landing-content-grid ${!isMobile ? 'is-desktop' : ''}`}>
                <section ref={cardListRef} className="public-landing-card-list" data-testid="public-card-list">
                  {filteredClasses.map((classItem, index) => (
                    <PublicLandingCard
                      key={classItem.id || `${classItem.className}-${index}`}
                      classItem={classItem}
                      rank={index + 1}
                      isSelected={plannerSelectedIds.has(classItem.id)}
                      onOpenDetails={openClassDetails}
                      onTogglePlanner={togglePlannerItem}
                    />
                  ))}
                </section>

                {!isMobile ? (
                  <aside className="public-desktop-planner-panel">
                    <div className="public-desktop-planner-panel-head">
                      <strong>내 시간표</strong>
                      <span>{plannerItems.length}개 수업</span>
                    </div>
                    <p>{plannerSummaryText}</p>
                    <button type="button" className="btn btn-primary" onClick={openPlannerSheet}>
                      <CalendarDays size={16} />
                      시간표 열기
                    </button>
                  </aside>
                ) : null}
              </div>
            )}
          </>
        )}
      </main>

      <ClassSchedulePlanModal
        open={Boolean(selectedClassItem)}
        classItem={selectedClassItem}
        plan={selectedClassItem?.schedulePlan || selectedClassItem?.schedule_plan || null}
        emptyMessage="아직 등록된 일정표가 없습니다."
        onClose={() => setSelectedClassItem(null)}
        primaryActionLabel="상담하기"
        onPrimaryAction={() => handleOpenChannelTalk({
          grade: normalizeGrade(selectedClassItem?.grade),
          subject: selectedClassItem?.subject,
          className: stripClassPrefix(selectedClassItem?.className || selectedClassItem?.name || '수업'),
        })}
        secondaryActionLabel={selectedClassIsInPlanner ? '시간표에서 빼기' : '시간표에 담기'}
        onSecondaryAction={() => {
          if (selectedClassItem) {
            togglePlannerItem(selectedClassItem);
          }
        }}
        summaryBadges={selectedClassBadges}
      />

      <BottomSheet
        open={isPlannerSheetOpen}
        onClose={() => setIsPlannerSheetOpen(false)}
        title="내 시간표"
        subtitle={plannerSummaryText}
        testId="public-planner-sheet"
        fullHeightOnMobile
        maxWidth={900}
        actions={plannerActions}
      >
        <div className="public-planner-sheet-body">
          <div className="public-planner-selected-list">
            {plannerItems.map((item) => (
              <div key={`planner-item-${item.id}`} className="public-planner-selected-item">
                <div className="public-planner-selected-copy">
                  <strong>{stripClassPrefix(item.className || item.name || '수업')}</strong>
                  <span>{buildScheduleLines(item).join(' · ')}</span>
                </div>
                <button type="button" className="public-planner-selected-remove" onClick={() => togglePlannerItem(item)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <div ref={plannerPreviewRef} className="public-planner-preview-card">
            <div className="public-planner-preview-head">
              <span className="public-planner-preview-eyebrow">TIPS MY TIMETABLE</span>
              <strong>{plannerGrade ? `${plannerGrade} 주간 시간표` : '내 시간표'}</strong>
            </div>

            <div className="public-planner-preview-chip-row">
              {plannerItems.map((item) => (
                <span key={`planner-chip-${item.id}`} className="public-planner-preview-chip" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '8px 14px', borderRadius: '14px', gap: '2px', height: 'auto' }}>
                  <span>{text(item.subject)} · {stripClassPrefix(item.className || item.name || '수업')}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, opacity: 0.85 }}>{buildScheduleLines(item).join(', ')}</span>
                </span>
              ))}
            </div>

            <div className="public-planner-preview-grid">
              <TimetableGrid
                columns={DAY_COLUMNS}
                timeSlots={plannerTimetable.timeSlots}
                blocks={plannerTimetable.blocks}
                editable={false}
                density="micro"
                slotHeight={42}
                shellClassName="public-readonly-timetable public-planner-readonly-timetable"
              />
            </div>
          </div>

        </div>
      </BottomSheet>

      {isMobile ? (
        <>
          {activePublicTab === 'classes' && plannerItems.length > 0 ? (
            <div className="public-planner-floating-shell">
              <button
                type="button"
                className="public-planner-floating-clear"
                data-testid="public-planner-clear"
                onClick={clearPlanner}
                aria-label="전체 비우기"
                title="전체 비우기"
              >
                <Trash2 size={17} />
              </button>

              <button
                type="button"
                className="public-planner-floating-cta"
                data-testid="public-planner-cta"
                onClick={openPlannerSheet}
              >
                <CalendarDays size={18} />
                <div className="public-planner-floating-copy">
                  <strong>내 시간표 {plannerItems.length}개</strong>
                  <span>{plannerGrade || selectedGrade} · 이미지 공유 가능</span>
                </div>
                <ChevronRight size={18} />
              </button>
            </div>
          ) : null}

          <nav className="public-bottom-nav" data-testid="public-bottom-nav">
            {PUBLIC_BOTTOM_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePublicTab === item.id || (item.id === 'classes' && activePublicTab === 'classes');
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`public-bottom-nav-button ${isActive ? 'is-active' : ''}`}
                  data-testid={`public-bottom-nav-${item.id}`}
                  onClick={() => handleBottomNavClick(item)}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </>
      ) : null}
    </div>
  );
}
