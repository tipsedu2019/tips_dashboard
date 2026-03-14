import { useState, useEffect, useMemo } from 'react';
import { X, CheckSquare, Square, Save, Users, Calendar, BookOpen, Clock, UserPlus, Info } from 'lucide-react';
import { stripClassPrefix } from '../data/sampleData';
import { useToast } from '../contexts/ToastContext';
import ClassSchedulePlanPreview from './ClassSchedulePlanPreview';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';

function collectCompletedLessonIds(progressLogs, classId) {
  const completedIds = new Set();

  (progressLogs || [])
    .filter((log) => log.classId === classId)
    .forEach((log) => {
      (log.completedLessonIds || []).forEach((lessonId) => completedIds.add(lessonId));

      const chapterId = log.chapterId || log.chapter_id;
      if (chapterId) {
        completedIds.add(chapterId);
      }
    });

  return [...completedIds];
}

export default function ClassDetailModal({ cls, data, dataService, onClose, onNavigateToStudent }) {
  const [activeTab, setActiveTab] = useState('students'); // 'students' | 'progress' | 'info'
  const [selectedLessons, setSelectedLessons] = useState([]);
  const [textbook, setTextbook] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const toast = useToast();

  const students = data?.students || [];
  const enrolledStudents = useMemo(() => {
    return (cls.studentIds || []).map(id => students.find(s => s.id === id)).filter(Boolean);
  }, [cls.studentIds, students]);

  const waitlistStudents = useMemo(() => {
    return (cls.waitlistIds || []).map(id => students.find(s => s.id === id)).filter(Boolean);
  }, [cls.waitlistIds, students]);

  useEffect(() => {
    const textbooks = data?.textbooks || [];
    const progressLogs = data?.progressLogs || [];
    if (cls.textbookIds && cls.textbookIds.length > 0) {
      const tb = textbooks.find(t => t.id === cls.textbookIds[0]);
      setTextbook(tb);
    }
    setSelectedLessons(collectCompletedLessonIds(progressLogs, cls.id));
  }, [cls, data]);

  const handleToggleLesson = (lessonId) => {
    setSelectedLessons(prev => 
      prev.includes(lessonId) ? prev.filter(id => id !== lessonId) : [...prev, lessonId]
    );
  };

  const handleSaveProgress = async () => {
    if (!textbook) {
      toast.error('아직 이 수업에 연결된 교재가 없습니다.');
      return;
    }

    if (!dataService?.addProgressLog || !dataService?.deleteProgressLog) {
      toast.error('현재 모드에서는 진도 기록을 수정할 수 없습니다.');
      return;
    }
    const progressLogs = data?.progressLogs || [];
    const today = new Date().toISOString().split('T')[0];
    const existingLogs = progressLogs.filter(log => log.classId === cls.id);
    const existingLessonIds = collectCompletedLessonIds(progressLogs, cls.id);

    const newLessonIds = selectedLessons.filter(id => !existingLessonIds.includes(id));
    const removedLessonIds = existingLessonIds.filter(id => !selectedLessons.includes(id));

    try {
      setIsSaving(true);
      for (const lessonId of newLessonIds) {
        await dataService.addProgressLog({
          classId: cls.id,
          textbookId: textbook.id,
          chapterId: lessonId,
          date: today
        });
      }
      for (const lessonId of removedLessonIds) {
        const log = existingLogs.find((item) => {
          if ((item.completedLessonIds || []).includes(lessonId)) {
            return true;
          }
          return (item.chapterId || item.chapter_id) === lessonId;
        });
        if (log) await dataService.deleteProgressLog(log.id);
      }
      toast.success('진도 기록을 저장했습니다.');
      onClose();
    } catch (err) {
      console.error('Progress save error:', err);
      toast.error(`진도 저장에 실패했습니다: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(4px)'
    }}>
      <div className="card-custom animate-in" onClick={e => e.stopPropagation()} style={{ 
        width: '100%', maxWidth: 650, margin: 0, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)', border: '1px solid var(--border-color)'
      }}>
        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ padding: '2px 8px', background: 'var(--accent-light)', color: 'var(--accent-color)', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                {cls.subject}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{cls.grade}</span>
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{stripClassPrefix(cls.className)}</h2>
          </div>
          <button className="theme-toggle" onClick={onClose} style={{ width: 40, height: 40, borderRadius: 20 }}>
            <X size={24} />
          </button>
        </div>

        {/* Custom Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-base)' }}>
          {[
            { id: 'students', label: '학생 명단', icon: Users },
            { id: 'progress', label: '진도 기록', icon: BookOpen },
            { id: 'info', label: '상세 정보', icon: Info },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '14px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                fontSize: 14, fontWeight: 700, color: activeTab === tab.id ? 'var(--accent-color)' : 'var(--text-muted)',
                borderBottom: `3px solid ${activeTab === tab.id ? 'var(--accent-color)' : 'transparent'}`,
                transition: 'all 0.2s'
              }}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 32, background: 'var(--bg-surface)' }}>
          {activeTab === 'students' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <section>
                <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Users size={18} /> 수강 학생 ({enrolledStudents.length}명)
                </h3>
                {enrolledStudents.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                    {enrolledStudents.map(s => (
                      <div 
                        key={s.id} 
                        className="student-pill" 
                        onClick={() => { onNavigateToStudent && onNavigateToStudent(s.id); onClose(); }}
                        style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 10, cursor: 'pointer', textAlign: 'center' }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.school || '-'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', border: '2px dashed var(--border-color)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 13 }}>수강 중인 학생이 없습니다.</div>
                )}
              </section>

              <section>
                <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', color: '#d97706' }}>
                  <UserPlus size={18} /> 대기 학생 ({waitlistStudents.length}명)
                </h3>
                {waitlistStudents.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                    {waitlistStudents.map(s => (
                      <div 
                        key={s.id} 
                        className="student-pill-wait"
                        onClick={() => { onNavigateToStudent && onNavigateToStudent(s.id); onClose(); }}
                        style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, cursor: 'pointer', textAlign: 'center' }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>{s.school || '-'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', border: '2px dashed #fef3c7', borderRadius: 12, color: '#d97706', fontSize: 13, opacity: 0.6 }}>대기 중인 학생이 없습니다.</div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'progress' && (
            <div>
              {!textbook ? (
                <div style={{ textAlign: 'center', padding: 40, background: 'var(--bg-base)', borderRadius: 16, color: 'var(--text-muted)' }}>
                  등록된 교재가 없습니다.
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--accent-light)', color: 'var(--accent-color)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <BookOpen size={20} />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{textbook.title}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{textbook.publisher}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {textbook.lessons?.map((lesson, idx) => {
                      const isSelected = selectedLessons.includes(lesson.id);
                      return (
                        <div 
                          key={lesson.id}
                          onClick={() => handleToggleLesson(lesson.id)}
                          style={{ 
                            display: 'flex', alignItems: 'center', padding: '14px 18px', 
                            background: isSelected ? 'rgba(33, 110, 78, 0.05)' : 'var(--bg-surface)', 
                            border: `1px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s'
                          }}
                        >
                          <div style={{ marginRight: 16, color: isSelected ? 'var(--accent-color)' : 'var(--text-muted)' }}>
                            {isSelected ? <CheckSquare size={22} /> : <Square size={22} />}
                          </div>
                          <div style={{ flex: 1, fontWeight: isSelected ? 800 : 500 }}>
                            <span style={{ opacity: 0.4, marginRight: 8 }}>{idx + 1}.</span> {lesson.title}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn-primary" onClick={handleSaveProgress} disabled={isSaving}>
                      <Save size={18} /> {isSaving ? '저장 중...' : '진도 저장'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>선생님</div>
                  <div style={{ fontWeight: 700 }}>{cls.teacher || '-'}</div>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>강의실</div>
                  <div style={{ fontWeight: 700 }}>{cls.classroom || '-'}</div>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>수업 요일/시간</div>
                  <div style={{ fontWeight: 700, whiteSpace: 'pre-line' }}>{cls.schedule}</div>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-base)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>정원</div>
                  <div style={{ fontWeight: 700 }}>{(cls.studentIds || []).length} / {cls.capacity || 0} 명</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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
                  emptyMessage="아직 저장된 수업 일정표가 없습니다."
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '20px 32px', background: 'var(--bg-base)', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose} style={{ minWidth: 100 }}>닫기</button>
        </div>
      </div>
      <ClassSchedulePlanModal
        open={isPlanModalOpen}
        classItem={{
          className: cls.className || cls.name || '',
          subject: cls.subject || '',
          teacher: cls.teacher || '',
          classroom: cls.classroom || cls.room || '',
          schedule: cls.schedule || '',
          capacity: cls.capacity || 0,
        }}
        plan={cls.schedulePlan || cls.schedule_plan || null}
        onClose={() => setIsPlanModalOpen(false)}
      />
    </div>
  );
}
