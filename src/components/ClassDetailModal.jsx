import { useMemo, useState } from 'react';
import { X, Users, Calendar, BookOpen, UserPlus, Info } from 'lucide-react';
import { stripClassPrefix } from '../data/sampleData';
import ClassSchedulePlanPreview from './ClassSchedulePlanPreview';
import ClassScheduleProgressBoard from './ClassScheduleProgressBoard';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';

function PersonGrid({ items, emptyText, onOpen }) {
  if (items.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: 'center',
          border: '2px dashed var(--border-color)',
          borderRadius: 12,
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
      {items.map((student) => (
        <div
          key={student.id}
          className="student-pill"
          onClick={() => onOpen?.(student.id)}
          style={{
            padding: '10px 14px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            cursor: onOpen ? 'pointer' : 'default',
            textAlign: 'center',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13 }}>{student.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{student.school || '-'}</div>
        </div>
      ))}
    </div>
  );
}

export default function ClassDetailModal({ cls, data, onClose, onNavigateToStudent }) {
  const [activeTab, setActiveTab] = useState('students');
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  const students = data?.students || [];
  const enrolledStudents = useMemo(
    () => (cls.studentIds || []).map((id) => students.find((student) => student.id === id)).filter(Boolean),
    [cls.studentIds, students]
  );
  const waitlistStudents = useMemo(
    () => (cls.waitlistIds || []).map((id) => students.find((student) => student.id === id)).filter(Boolean),
    [cls.waitlistIds, students]
  );

  const tabs = [
    { id: 'students', label: '수강 학생', icon: Users },
    { id: 'progress', label: '수업 진도', icon: BookOpen },
    { id: 'info', label: '상세 정보', icon: Info },
  ];

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="card-custom animate-in"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 920,
          margin: 0,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div
          style={{
            padding: '24px 32px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  padding: '2px 8px',
                  background: 'var(--accent-light)',
                  color: 'var(--accent-color)',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {cls.subject}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{cls.grade}</span>
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
              {stripClassPrefix(cls.className || cls.name || '')}
            </h2>
          </div>
          <button className="theme-toggle" onClick={onClose} style={{ width: 40, height: 40, borderRadius: 20 }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-base)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '14px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 700,
                color: activeTab === tab.id ? 'var(--accent-color)' : 'var(--text-muted)',
                borderBottom: `3px solid ${activeTab === tab.id ? 'var(--accent-color)' : 'transparent'}`,
                transition: 'all 0.2s',
              }}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 32, background: 'var(--bg-surface)' }}>
          {activeTab === 'students' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <section>
                <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Users size={18} /> 수강 학생 ({enrolledStudents.length}명)
                </h3>
                <PersonGrid
                  items={enrolledStudents}
                  emptyText="수강 중인 학생이 없습니다."
                  onOpen={(studentId) => {
                    onNavigateToStudent?.(studentId);
                    onClose();
                  }}
                />
              </section>

              <section>
                <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', color: '#d97706' }}>
                  <UserPlus size={18} /> 대기 학생 ({waitlistStudents.length}명)
                </h3>
                <PersonGrid
                  items={waitlistStudents}
                  emptyText="대기 중인 학생이 없습니다."
                  onOpen={(studentId) => {
                    onNavigateToStudent?.(studentId);
                    onClose();
                  }}
                />
              </section>
            </div>
          ) : null}

          {activeTab === 'progress' ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <div
                style={{
                  padding: '16px 20px',
                  background: 'var(--accent-light)',
                  color: 'var(--accent-color)',
                  borderRadius: 16,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <BookOpen size={20} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>수업 진도 현황</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>
                      차시별 실제 진행 범위와 공개 메모를 한곳에서 확인합니다.
                    </div>
                  </div>
                </div>

                <button type="button" className="btn-primary" onClick={() => setIsPlanModalOpen(true)}>
                  수업계획 열기
                </button>
              </div>

              <ClassScheduleProgressBoard
                plan={cls.schedulePlan || cls.schedule_plan || null}
                classItem={cls}
                className={cls.className || cls.name || ''}
                subject={cls.subject || ''}
                schedule={cls.schedule || ''}
                startDate={cls.startDate || cls.start_date || ''}
                endDate={cls.endDate || cls.end_date || ''}
                textbookIds={cls.textbookIds || []}
                textbooksCatalog={data?.textbooks || []}
                progressLogs={data?.progressLogs || []}
                mode="actual"
                title="현재 진도"
                description="차시별 실제 진행 범위와 상태를 바로 확인할 수 있습니다."
                emptyMessage="아직 기록된 실진도가 없습니다."
              />
            </div>
          ) : null}

          {activeTab === 'info' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>선생님</div>
                  <div style={{ fontWeight: 700 }}>{cls.teacher || '-'}</div>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>강의실</div>
                  <div style={{ fontWeight: 700 }}>{cls.classroom || cls.room || '-'}</div>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>수업 요일/시간</div>
                  <div style={{ fontWeight: 700, whiteSpace: 'pre-line' }}>{cls.schedule || '-'}</div>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>정원</div>
                  <div style={{ fontWeight: 700 }}>
                    {(cls.studentIds || []).length} / {cls.capacity || 0} 명
                  </div>
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Calendar size={18} />
                    수업 일정표 미리보기
                  </span>
                  <button type="button" className="btn-secondary" onClick={() => setIsPlanModalOpen(true)}>
                    크게 보기
                  </button>
                </div>
                <ClassSchedulePlanPreview
                  plan={cls.schedulePlan || cls.schedule_plan || null}
                  className={cls.className || cls.name || ''}
                  subject={cls.subject || ''}
                  emptyMessage="아직 등록된 수업 일정표가 없습니다."
                />
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: '20px 32px',
            background: 'var(--bg-base)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button className="btn-secondary" onClick={onClose} style={{ minWidth: 100 }}>
            닫기
          </button>
        </div>
      </div>

      <ClassSchedulePlanModal
        open={isPlanModalOpen}
        mode="readonly"
        classItem={{
          ...cls,
          className: cls.className || cls.name || '',
          subject: cls.subject || '',
          teacher: cls.teacher || '',
          classroom: cls.classroom || cls.room || '',
          schedule: cls.schedule || '',
          capacity: cls.capacity || 0,
        }}
        plan={cls.schedulePlan || cls.schedule_plan || null}
        textbooksCatalog={data?.textbooks || []}
        progressLogs={data?.progressLogs || []}
        onClose={() => setIsPlanModalOpen(false)}
      />
    </div>
  );
}
