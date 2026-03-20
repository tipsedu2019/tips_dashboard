import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  LogIn,
  MapPin,
  Search,
  UserRound,
} from 'lucide-react';
import { useDeferredValue } from 'react';
import { ACTIVE_CLASS_STATUS, computeClassStatus } from '../lib/classStatus';
import { getAllManagedGrades } from '../lib/schoolConfig';
import { sortSubjectOptions } from '../lib/subjectUtils';
import { parseSchedule, stripClassPrefix } from '../data/sampleData';
import useViewport from '../hooks/useViewport';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';
import BottomSheet from './ui/BottomSheet';

function text(value) {
  return String(value || '').trim();
}

function normalizeGrade(value) {
  return text(value) || '미정';
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

function filterGradeOptions(classes) {
  const available = new Set(classes.map((item) => normalizeGrade(item.grade)));
  return getAllManagedGrades().filter((grade) => available.has(grade));
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
  isLoading = false,
  onLogin,
  showBackToDashboard = false,
  onBackToDashboard,
}) {
  const { isMobile, isCompact } = useViewport();
  const isCompactLayout = isMobile || isCompact;
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [publicSelectedClass, setSelectedClass] = useState(null);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  const activeClasses = useMemo(
    () => (classes || []).filter((item) => computeClassStatus(item) === ACTIVE_CLASS_STATUS),
    [classes]
  );

  const subjectOptions = useMemo(
    () => ['all', ...sortSubjectOptions(activeClasses.map((item) => item.subject).filter(Boolean))],
    [activeClasses]
  );

  const gradeOptions = useMemo(
    () => ['all', ...filterGradeOptions(activeClasses)],
    [activeClasses]
  );

  const visibleClasses = useMemo(() => {
    const query = text(deferredSearchQuery).toLowerCase();
    return activeClasses.filter((item) => {
      const matchesSubject = selectedSubject === 'all' || item.subject === selectedSubject;
      const matchesGrade = selectedGrade === 'all' || normalizeGrade(item.grade) === selectedGrade;
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
      return matchesSubject && matchesGrade && (!query || haystack.includes(query));
    });
  }, [activeClasses, deferredSearchQuery, selectedGrade, selectedSubject]);

  const groupedClasses = useMemo(() => {
    const buckets = new Map();
    visibleClasses.forEach((item) => {
      const key = item.subject || '기타';
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push(item);
    });

    return [...buckets.entries()].map(([groupName, items]) => ({
      groupName,
      items: items.sort((left, right) =>
        stripClassPrefix(left.className).localeCompare(stripClassPrefix(right.className), 'ko')
      ),
    }));
  }, [visibleClasses]);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    const query = text(searchQuery);

    if (selectedSubject !== 'all') {
      chips.push({ key: 'subject', label: `과목 ${selectedSubject}` });
    }
    if (selectedGrade !== 'all') {
      chips.push({ key: 'grade', label: `학년 ${selectedGrade}` });
    }
    if (query) {
      chips.push({ key: 'search', label: `검색 ${query}` });
    }

    return chips;
  }, [searchQuery, selectedGrade, selectedSubject]);

  const activeFilterCount = activeFilterChips.length;
  const quickMobileSubjectOptions = useMemo(
    () => subjectOptions.filter((option) => option !== 'all').slice(0, 3),
    [subjectOptions]
  );
  const clearFilters = () => {
    setSearchQuery('');
    setSelectedSubject('all');
    setSelectedGrade('all');
  };

  const mobileSearchControls = (
    <div className="public-mobile-search-row">
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
      <button
        type="button"
        className="action-chip public-mobile-filter-button"
        data-testid="public-filter-button"
        onClick={() => setIsFilterSheetOpen(true)}
      >
        필터
        {activeFilterCount > 0 ? <span className="public-mobile-filter-count">{activeFilterCount}</span> : null}
      </button>
    </div>
  );

  return (
    <div data-testid="public-class-list-view" className="public-page-shell">
      <div className="public-page-shell-header">
        <div className="public-page-shell-inner">
          <div className="public-page-brand">
            <img
              src="/logo_tips.png"
              alt="TIPS"
              className="public-page-brand-mark"
            />
            <div>
              <div className="public-page-brand-title">
                팁스영어수학학원 수업시간표
              </div>
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
        <section className="card-custom public-page-hero">
          <div className="public-hero-copy">
            <div className="public-hero-eyebrow">현재 운영 중인 공개 수업</div>
            <h1 className="public-page-hero-title">
              {isMobile ? (
                <>
                  필요한 수업만 찾고
                  <br />
                  일정표를 바로 여세요.
                </>
              ) : (
                <>
                  필요한 수업만 빠르게 찾고,
                  <br />
                  카드를 눌러 일정표를 바로 확인하세요.
                </>
              )}
            </h1>
            <p className="public-page-hero-description">
              {isMobile
                ? '과목은 아래 빠른 칩에서, 학년은 필터 시트에서 고른 뒤 바로 카드로 내려가면 됩니다.'
                : '현재 진행 중인 수업만 공개합니다. 과목과 학년을 먼저 고른 뒤 필요한 수업 카드를 눌러 세부 일정표와 기본 정보를 확인할 수 있습니다.'}
            </p>
            <div className="public-filter-summary-row">
              <div className="public-filter-summary-pill">
                현재 {visibleClasses.length}개 수업
              </div>
              {!isMobile && activeFilterChips.length > 0 ? (
                <button type="button" className="public-filter-reset-button" onClick={clearFilters}>
                  필터 초기화
                </button>
              ) : null}
            </div>
            {!isMobile && activeFilterChips.length > 0 ? (
              <div className="public-filter-chip-rail">
                {activeFilterChips.map((chip) => (
                  <span key={chip.key} className="public-filter-chip">
                    {chip.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        {isMobile ? (
          <section className="card-custom public-mobile-control-shell" data-testid="public-mobile-control-shell">
            {mobileSearchControls}
            <div className="public-mobile-quick-filter-row" data-testid="public-mobile-quick-subjects">
              <button
                type="button"
                className={`public-mobile-quick-pill ${selectedSubject === 'all' ? 'active' : ''}`}
                data-testid="public-mobile-quick-subject-all"
                onClick={() => setSelectedSubject('all')}
              >
                전체 과목
              </button>
              {quickMobileSubjectOptions.map((option) => (
                <button
                  key={`quick-${option}`}
                  type="button"
                  className={`public-mobile-quick-pill ${selectedSubject === option ? 'active' : ''}`}
                  data-testid={`public-mobile-quick-subject-${option}`}
                  onClick={() => setSelectedSubject(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            {activeFilterCount > 0 ? (
              <div className="public-filter-chip-rail public-filter-chip-rail-mobile">
                {activeFilterChips.map((chip) => (
                  <span key={chip.key} className="public-filter-chip">
                    {chip.label}
                  </span>
                ))}
                <button type="button" className="public-filter-reset-button" onClick={clearFilters}>
                  초기화
                </button>
              </div>
            ) : (
              <div className="public-mobile-control-copy">
                과목과 학년은 시트에서 고르고, 아래 카드에서 바로 일정표를 확인할 수 있습니다.
              </div>
            )}
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

              <div className="public-filter-button-grid public-filter-button-grid-grade">
                {gradeOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`h-segment-btn public-filter-pill ${selectedGrade === option ? 'active' : ''}`}
                    aria-pressed={selectedGrade === option}
                    onClick={() => setSelectedGrade(option)}
                  >
                    {option === 'all' ? '전체 학년' : option}
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
          <div className="card-custom public-empty-state">
            수업시간표를 불러오는 중입니다.
          </div>
        ) : groupedClasses.length === 0 ? (
          <div className="card-custom public-empty-state">
            조건에 맞는 수업이 없습니다.
          </div>
        ) : (
          <div className="public-class-group-stack">
            {groupedClasses.map(({ groupName, items }) => (
              <section key={groupName} className="public-class-group">
                <div className="public-class-group-head">
                  <div className="public-class-group-title-wrap">
                    <h2 className="public-class-group-title">
                      {groupName}
                    </h2>
                  </div>
                  <div className="public-class-group-count">수업 {items.length}개</div>
                </div>

                <div className={`public-class-grid ${isCompact ? 'is-compact' : 'is-wide'}`}>
                  {items.map((classItem) => (
                    <PublicClassCard
                      key={`${groupName}-${classItem.id}`}
                      classItem={classItem}
                      compact={isCompactLayout}
                      onOpenPlan={setSelectedClass}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <ClassSchedulePlanModal
        open={Boolean(publicSelectedClass)}
        classItem={publicSelectedClass}
        plan={publicSelectedClass?.schedulePlan || publicSelectedClass?.schedule_plan || null}
        emptyMessage="아직 등록된 일정표가 없습니다."
        onClose={() => setSelectedClass(null)}
      />

      <BottomSheet
        open={Boolean(isMobile && isFilterSheetOpen)}
        onClose={() => setIsFilterSheetOpen(false)}
        title="수업 필터"
        subtitle="과목과 학년을 한 번에 조정하고, 필요한 수업만 빠르게 좁혀 보세요."
        testId="public-filter-sheet"
        actions={(
          <div className="public-filter-sheet-actions">
            <button type="button" className="action-chip" onClick={clearFilters}>
              초기화
            </button>
            <button type="button" className="action-pill" onClick={() => setIsFilterSheetOpen(false)}>
              적용
            </button>
          </div>
        )}
      >
        <div className="public-filter-sheet-stack">
          <section className="public-filter-sheet-section">
            <div className="public-filter-sheet-label">과목</div>
            <div className="public-filter-button-grid public-filter-button-grid-subject">
              {subjectOptions.map((option) => (
                <button
                  key={`mobile-subject-${option}`}
                  type="button"
                  className={`h-segment-btn public-filter-pill ${selectedSubject === option ? 'active' : ''}`}
                  aria-pressed={selectedSubject === option}
                  onClick={() => setSelectedSubject(option)}
                >
                  {option === 'all' ? '전체 과목' : option}
                </button>
              ))}
            </div>
          </section>

          <section className="public-filter-sheet-section">
            <div className="public-filter-sheet-label">학년</div>
            <div className="public-filter-button-grid public-filter-button-grid-grade">
              {gradeOptions.map((option) => (
                <button
                  key={`mobile-grade-${option}`}
                  type="button"
                  className={`h-segment-btn public-filter-pill ${selectedGrade === option ? 'active' : ''}`}
                  aria-pressed={selectedGrade === option}
                  onClick={() => setSelectedGrade(option)}
                >
                  {option === 'all' ? '전체 학년' : option}
                </button>
              ))}
            </div>
          </section>
        </div>
      </BottomSheet>
    </div>
  );
}
