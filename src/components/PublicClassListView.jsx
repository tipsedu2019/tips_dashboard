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
  const palette = {
    green: {
      background: 'linear-gradient(180deg, rgba(33, 110, 78, 0.10), rgba(33, 110, 78, 0.05))',
      border: '1px solid rgba(33, 110, 78, 0.12)',
      color: '#216e4e',
    },
    bronze: {
      background: 'linear-gradient(180deg, rgba(184, 124, 37, 0.12), rgba(184, 124, 37, 0.06))',
      border: '1px solid rgba(184, 124, 37, 0.14)',
      color: '#925b10',
    },
    blue: {
      background: 'linear-gradient(180deg, rgba(39, 89, 166, 0.10), rgba(39, 89, 166, 0.05))',
      border: '1px solid rgba(39, 89, 166, 0.14)',
      color: '#2759a6',
    },
  }[tone];

  return (
    <div
      className={`public-info-tile is-${tone} ${wide ? 'is-wide' : ''}`}
      style={{
        borderRadius: 18,
        padding: wide ? '16px 16px 14px' : '14px 14px 12px',
        background: palette.background,
        border: palette.border,
        minWidth: 0,
        display: 'grid',
        gap: 8,
      }}
      >
      <div className="public-info-tile-head" style={{ display: 'flex', alignItems: 'center', gap: 8, color: palette.color }}>
        <Icon size={15} />
        <div className="public-info-tile-label" style={{ fontSize: 12, fontWeight: 800 }}>{title}</div>
      </div>
      <div className="public-info-tile-values" style={{ display: 'grid', gap: 5 }}>
        {(lines.length > 0 ? lines : ['미정']).map((line, index) => (
          <div
            key={`${title}-${index}`}
            className="public-info-tile-value"
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: wide ? 'nowrap' : 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
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
      style={{
        width: '100%',
        textAlign: 'left',
        padding: compact ? 18 : 20,
        display: 'grid',
        gap: 14,
      }}
      title={`${title} 일정표 보기`}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: '#925b10', letterSpacing: '0.06em' }}>
            {classItem.subject || '과목'} · {normalizeGrade(classItem.grade)}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: compact ? 19 : 20,
              lineHeight: 1.28,
              fontWeight: 900,
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </div>
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
          style={{
            gridTemplateColumns: compact
              ? 'minmax(0, 1fr)'
              : 'minmax(0, 1.45fr) minmax(0, 0.78fr) minmax(0, 0.78fr)',
          }}
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

  const contentMaxWidth = isCompactLayout ? 1180 : 1320;
  const shellPaddingX = isMobile ? 16 : isCompact ? 20 : 28;
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
      <div className="public-search-wrap public-search-wrap-mobile" style={{ position: 'relative' }}>
        <Search
          size={16}
          style={{ position: 'absolute', top: '50%', left: 14, transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
        />
        <input
          className="styled-input"
          data-testid="public-class-search-input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="수업명, 선생님, 강의실 검색"
          style={{ paddingLeft: 40 }}
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
    <div
      data-testid="public-class-list-view"
      className="public-page-shell"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f7f3e8 0%, #f5f6f1 100%)',
      }}
    >
      <div className="public-page-shell-header">
        <div
          className="public-page-shell-inner"
          style={{
            maxWidth: contentMaxWidth,
            margin: '0 auto',
            paddingBlock: 14,
            paddingInline: shellPaddingX,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div className="public-page-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src="/logo_tips.png"
              alt="TIPS"
              style={{
                width: isMobile ? 36 : 42,
                height: isMobile ? 36 : 42,
                objectFit: 'contain',
              }}
            />
            <div>
              <div style={{ fontSize: isMobile ? 22 : 30, fontWeight: 900, color: '#12202f', lineHeight: 1.15 }}>
                팁스영어수학학원 수업시간표
              </div>
            </div>
          </div>

          <div className="public-page-actions" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
            {showBackToDashboard ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onBackToDashboard}
                style={{
                  borderRadius: 999,
                  padding: '0 18px',
                  boxShadow: '0 14px 28px rgba(33, 110, 78, 0.22)',
                  width: isMobile ? '100%' : 'auto',
                }}
              >
                <ArrowLeft size={16} />
                운영 화면으로 돌아가기
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="public-login-button"
                onClick={onLogin}
                style={{
                  borderRadius: 999,
                  padding: '0 18px',
                  width: isMobile ? '100%' : 'auto',
                }}
              >
                <LogIn size={16} />
                직원 로그인
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        className="public-page-shell-body"
        style={{
          maxWidth: contentMaxWidth,
          margin: '0 auto',
          paddingTop: isMobile ? 20 : 28,
          paddingBottom: isMobile ? 104 : 80,
          paddingInline: shellPaddingX,
        }}
      >
        <section
          className="card-custom public-page-hero"
          style={{
            padding: isMobile ? 14 : 24,
            borderRadius: 28,
            background:
              'radial-gradient(circle at top left, rgba(234, 220, 187, 0.55), rgba(255, 255, 255, 0.92) 46%), #ffffff',
            boxShadow: '0 20px 46px rgba(18, 32, 47, 0.08)',
            marginBottom: isMobile ? 14 : 18,
          }}
        >
          <div className="public-hero-copy" style={{ maxWidth: 760 }}>
            <div className="public-hero-eyebrow">현재 운영 중인 공개 수업</div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 24 : 38, lineHeight: 1.14, fontWeight: 900, color: '#12202f' }}>
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
            <p style={{ margin: isMobile ? '10px 0 0' : '14px 0 0', maxWidth: 680, fontSize: isMobile ? 13 : 14, lineHeight: 1.75, color: '#5a6b5e' }}>
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
          <section
            className="card-custom public-filter-shell"
            style={{
              padding: 18,
              borderRadius: 24,
              background: 'rgba(255, 255, 255, 0.92)',
              border: '1px solid rgba(18, 32, 47, 0.08)',
              marginBottom: 22,
              position: 'sticky',
              top: 96,
              zIndex: 60,
            }}
          >
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

              <div className="public-search-wrap" style={{ position: 'relative' }}>
                <Search
                  size={16}
                  style={{ position: 'absolute', top: '50%', left: 14, transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
                <input
                  className="styled-input"
                  data-testid="public-class-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="수업명, 선생님, 강의실 검색"
                  style={{ paddingLeft: 40 }}
                />
              </div>
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="card-custom public-empty-state" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
            수업시간표를 불러오는 중입니다.
          </div>
        ) : groupedClasses.length === 0 ? (
          <div className="card-custom public-empty-state" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
            조건에 맞는 수업이 없습니다.
          </div>
        ) : (
          <div className="public-class-group-stack" style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {groupedClasses.map(({ groupName, items }) => (
              <section key={groupName} className="public-class-group" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="public-class-group-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
                  <div className="public-class-group-title-wrap">
                    <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: '#12202f', letterSpacing: '-0.04em' }}>
                      {groupName}
                    </h2>
                  </div>
                  <div className="public-class-group-count" style={{ fontSize: 14, color: '#64748b', fontWeight: 700 }}>수업 {items.length}개</div>
                </div>

                <div
                  className="public-class-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : isCompact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
                    gap: 18,
                  }}
                >
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
