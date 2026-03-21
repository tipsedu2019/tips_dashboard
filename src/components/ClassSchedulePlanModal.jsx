import { CalendarDays, Clock3, MapPin, UserRound, Users, X } from 'lucide-react';
import ClassSchedulePlanner from './data-manager/ClassSchedulePlanner';
import ClassSchedulePlanPreview from './ClassSchedulePlanPreview';
import useViewport from '../hooks/useViewport';
import { PublicLandingCard } from './PublicClassLandingView';
import BottomSheet from './ui/BottomSheet';

function normalizeSummaryBadges(summaryBadges = []) {
  return (summaryBadges || [])
    .map((badge) => (typeof badge === 'string' ? { label: badge, tone: 'neutral' } : badge))
    .filter((badge) => badge?.label);
}

function buildMetaFacts(classItem = {}) {
  const facts = [
    {
      key: 'teacher',
      icon: UserRound,
      label: '선생님',
      value: classItem.teacher || '미정',
    },
    {
      key: 'room',
      icon: MapPin,
      label: '강의실',
      value: classItem.classroom || classItem.room || '미정',
    },
    {
      key: 'schedule',
      icon: Clock3,
      label: '반복 일정',
      value: classItem.schedule || '시간 미정',
    },
  ];

  if (classItem.capacity) {
    facts.push({
      key: 'capacity',
      icon: Users,
      label: '정원',
      value: `${classItem.capacity}명`,
    });
  }

  return facts;
}

export default function ClassSchedulePlanModal({
  open,
  editable = false,
  classItem,
  plan,
  onPlanChange,
  onSubjectChange,
  onClassNameChange,
  onClose,
  emptyMessage = '아직 등록한 수업 계획이 없습니다.',
  warningBanner = null,
  primaryActionLabel = '',
  onPrimaryAction,
  secondaryActionLabel = '',
  onSecondaryAction,
  summaryBadges = [],
}) {
  const { isMobile } = useViewport();

  if (!open) {
    return null;
  }

  const safeClass = classItem || {};
  const displayClassName = safeClass.displayClassName || safeClass.className || safeClass.name || '이름 없는 수업';
  const summaryFacts = buildMetaFacts(safeClass);
  const normalizedSummaryBadges = normalizeSummaryBadges(summaryBadges);
  const summaryEyebrow = [safeClass.subject, safeClass.grade].filter(Boolean).join(' · ') || '수업 계획';
  const headerTitle = editable ? '수업 계획' : '팁스 수업 정보';

  const content = (
    <div data-testid="class-schedule-plan-modal" className="class-plan-sheet">
      {editable ? (
        <div className="class-plan-sheet-summary is-editable" data-testid="class-plan-sheet-summary">
          <div className="class-plan-sheet-summary-head">
            <span className="class-plan-sheet-eyebrow">{summaryEyebrow}</span>
            <div className="class-plan-sheet-summary-copy">
              <p>요일, 기간, 휴강/보강 흐름을 먼저 정리하고 저장된 계획이 퍼블릭 상세와 관리자 화면에 같은 구조로 이어지게 만듭니다.</p>
            </div>
          </div>

          <div className="class-plan-sheet-meta-grid">
            {summaryFacts.map((fact) => {
              const Icon = fact.icon;
              return (
                <div key={fact.key} className="class-plan-sheet-meta-item">
                  <span className="class-plan-sheet-meta-label">
                    <Icon size={14} />
                    {fact.label}
                  </span>
                  <strong>{fact.value}</strong>
                </div>
              );
            })}
          </div>

          {normalizedSummaryBadges.length > 0 && (
            <div className="class-plan-sheet-badge-row">
              {normalizedSummaryBadges.map((badge) => (
                <span key={badge.label} className={`class-schedule-modal-mobile-summary-chip is-${badge.tone || 'neutral'}`}>
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="class-plan-sheet-public-card-wrapper" style={{ padding: '16px 12px' }}>
          <PublicLandingCard classItem={safeClass} hideActions={true} />
        </div>
      )}

      {warningBanner ? (
        <div className="class-plan-sheet-warning">
          {warningBanner}
        </div>
      ) : null}

      <div className={`class-plan-sheet-content ${!editable ? 'is-public' : ''}`}>
        {editable ? (
          <ClassSchedulePlanner
            value={plan}
            className={displayClassName}
            subject={safeClass.subject || ''}
            schedule={safeClass.schedule || ''}
            startDate={safeClass.startDate || ''}
            endDate={safeClass.endDate || ''}
            onPlanChange={onPlanChange}
            onSubjectChange={onSubjectChange}
            onClassNameChange={onClassNameChange}
          />
        ) : (
          <ClassSchedulePlanPreview
            plan={plan}
            className={displayClassName}
            subject={safeClass.subject || ''}
            allowExport
            emptyMessage={emptyMessage}
            variant="public-detail"
          />
        )}
      </div>

      {(primaryActionLabel || secondaryActionLabel) ? (
        <div className="class-schedule-modal-action-row">
          {secondaryActionLabel ? (
            <button type="button" className="btn btn-secondary" onClick={onSecondaryAction || onClose}>
              {secondaryActionLabel}
            </button>
          ) : null}
          {primaryActionLabel ? (
            <button type="button" className="btn btn-primary" onClick={onPrimaryAction}>
              {primaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={headerTitle}
        subtitle={editable ? displayClassName : undefined}
        testId="class-schedule-plan-sheet"
        fullHeightOnMobile
        floatingOnMobile={!editable}
      >
        <div>{content}</div>
      </BottomSheet>
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={editable ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1600,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
      }}
    >
      <div
        className="card animate-in"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1740px, calc(100vw - 16px))',
          height: 'min(98vh, 1180px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-color)', fontWeight: 800 }}>
              <CalendarDays size={18} />
              <span>{headerTitle}</span>
            </div>
            <h2 style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 900 }}>{displayClassName}</h2>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}
