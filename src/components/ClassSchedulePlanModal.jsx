import { CalendarDays, Info, X } from 'lucide-react';
import ClassSchedulePlanner from './data-manager/ClassSchedulePlanner';
import ClassSchedulePlanPreview from './ClassSchedulePlanPreview';

function InfoItem({ label, value }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: 'var(--bg-base)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'pre-line' }}>{value || '-'}</div>
    </div>
  );
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
  emptyMessage = '아직 등록된 수업 일정표가 없습니다.',
  warningBanner = null,
}) {
  if (!open) {
    return null;
  }

  const safeClass = classItem || {};
  const displayClassName = safeClass.displayClassName || safeClass.className || safeClass.name || '수업 일정표';

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
        padding: 6,
      }}
    >
      <div
        className="card animate-in"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1740px, calc(100vw - 12px))',
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
              <span>{editable ? '수업 계획 편집' : '수업 일정표'}</span>
            </div>
            <h2 style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 900 }}>
              {displayClassName}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {editable ? '왼쪽에서 기간과 휴강·보강을 조정하고, 오른쪽에서 전체 일정표를 확인합니다.' : '저장된 일정표와 기본 수업 정보를 함께 확인할 수 있습니다.'}
            </p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        {warningBanner ? (
          <div
            style={{
              margin: '14px 18px 0',
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.18)',
              color: '#b91c1c',
              fontSize: 12,
              lineHeight: 1.55,
            }}
          >
            {warningBanner}
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            background: 'var(--bg-base)',
          }}
        >
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
            <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
              <div className="card-custom" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800 }}>
                  <Info size={17} />
                  기본 정보
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <InfoItem label="과목" value={safeClass.subject} />
                  <InfoItem label="선생님" value={safeClass.teacher} />
                  <InfoItem label="강의실" value={safeClass.classroom || safeClass.room} />
                  <InfoItem label="정원" value={safeClass.capacity ? `${safeClass.capacity}명` : '-'} />
                </div>
                <InfoItem label="요일/시간" value={safeClass.schedule} />
              </div>

              <ClassSchedulePlanPreview
                plan={plan}
                className={displayClassName}
                subject={safeClass.subject || ''}
                allowExport
                emptyMessage={emptyMessage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
