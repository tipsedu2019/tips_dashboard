import { useState, useEffect } from 'react';
import { X, CheckSquare, Square, Save } from 'lucide-react';

export default function ProgressEntryModal({ cls, data, dataService, onClose }) {
  const [selectedLessons, setSelectedLessons] = useState([]);
  const [textbook, setTextbook] = useState(null);

  useEffect(() => {
    // Find textbook associated with this class
    if (cls.textbookIds && cls.textbookIds.length > 0) {
      const tb = data.textbooks.find(t => t.id === cls.textbookIds[0]);
      setTextbook(tb);
    }
    
    // Select previously logged lessons for this class (for today/in general)
    const logsForClass = data.progressLogs.filter(log => log.classId === cls.id);
    const completedLessonIds = logsForClass.map(log => log.chapterId);
    setSelectedLessons(completedLessonIds);
  }, [cls, data]);

  const handleToggle = (lessonId) => {
    setSelectedLessons(prev => 
      prev.includes(lessonId) ? prev.filter(id => id !== lessonId) : [...prev, lessonId]
    );
  };

  const handleSave = () => {
    if (!textbook) return;
    
    // For simplicity, we create a new progress log for each newly selected lesson today
    // and let dataService handle deduplication or just simple addition.
    // In a real app we'd compare old state and new state to add/remove.
    
    // We'll replace the progress logs for this class with the newly selected ones
    // For mock purpose, we just save the newly selected as current progress
    const today = new Date().toISOString().split('T')[0];
    
    // Clear old logs for this class? No, dataService doesn't have a clear function.
    // Let's just add new logs for lessons that aren't in progressLogs yet.
    const existingLogs = data.progressLogs.filter(log => log.classId === cls.id);
    const existingLessonIds = existingLogs.map(l => l.chapterId);
    
    const newLessonIds = selectedLessons.filter(id => !existingLessonIds.includes(id));
    const removedLessonIds = existingLessonIds.filter(id => !selectedLessons.includes(id));
    
    newLessonIds.forEach(lessonId => {
      dataService.addProgressLog({
        classId: cls.id,
        textbookId: textbook.id,
        chapterId: lessonId,
        date: today
      });
    });

    removedLessonIds.forEach(lessonId => {
       const log = existingLogs.find(l => l.chapterId === lessonId);
       if (log) {
           dataService.deleteProgressLog(log.id);
       }
    });

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
    }}>
      <div className="card-custom" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 500, margin: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="card-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--accent-color)', fontWeight: 700, marginBottom: 4 }}>{cls.subject || '미분류'}</div>
            <h2 style={{ fontSize: 20, margin: 0 }}>{cls.className} <span style={{fontSize: 14, color: 'var(--text-muted)'}}>진도 기록</span></h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
              {textbook ? `📚 교재: ${textbook.title}` : '⚠️ 연결된 교재가 없습니다. [데이터 관리]에서 교재를 연결해주세요.'}
            </div>
          </div>
          <button className="theme-toggle" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="card-body" style={{ padding: 24, overflowY: 'auto' }}>
          {!textbook && (
            <div style={{ textAlign: 'center', padding: 32, background: 'var(--bg-surface-hover)', borderRadius: 12, color: 'var(--text-muted)' }}>
              해당 수업에 등록된 교재 정보가 없습니다.
            </div>
          )}

          {textbook && textbook.lessons && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {textbook.lessons.map((lesson, idx) => {
                const isSelected = selectedLessons.includes(lesson.id);
                return (
                  <div 
                    key={lesson.id}
                    onClick={() => handleToggle(lesson.id)}
                    style={{ 
                      display: 'flex', alignItems: 'center', padding: '12px 16px', 
                      background: isSelected ? 'rgba(33, 110, 78, 0.05)' : 'var(--bg-surface)', 
                      border: `1px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ marginRight: 12, color: isSelected ? 'var(--accent-color)' : 'var(--text-muted)' }}>
                      {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: isSelected ? 700 : 500, color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)' }}>
                        <span style={{opacity:0.5, marginRight:6}}>{idx + 1}회차.</span>
                        {lesson.title}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {textbook && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn-secondary" onClick={onClose}>취소</button>
            <button className="btn-primary" onClick={handleSave} disabled={selectedLessons.length === 0}><Save size={18} /> 진도 저장</button>
          </div>
        )}
      </div>
    </div>
  );
}
