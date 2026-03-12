import { useMemo, useState } from 'react';
import { parseSchedule, stripClassPrefix } from '../data/sampleData';
import { ChevronDown, ChevronRight, Filter, Users, School, BookOpen, GraduationCap } from 'lucide-react';

const GRADE_ORDER = ['초6', '중1', '중2', '중3', '고1', '고2', '고3'];

function getGradeWeight(gradeStr) {
  const index = GRADE_ORDER.indexOf(gradeStr);
  return index !== -1 ? index : 999;
}

function buildNestedGroups(classes, groupBy) {
  if (groupBy === 'none') {
    return { '전체 수업': [...classes].sort((a, b) => (a.subject || '').localeCompare(b.subject || '') || (a.className || '').localeCompare(b.className || '')) };
  }

  return classes
    .sort((a, b) => (a.subject || '').localeCompare(b.subject || '') || (a.className || '').localeCompare(b.className || ''))
    .reduce((acc, cls) => {
      const key = cls[groupBy] || '미분류';
      if (!acc[key]) acc[key] = [];
      acc[key].push(cls);
      return acc;
    }, {});
}


function StatusBadge({ cls }) {
  const current = (cls.studentIds || []).length;
  const capacity = cls.capacity || 0;
  const remain = capacity - current;

  if (capacity === 0) return null;

  // iOS-style vibrant pill colors
  const styles = {
    full: { bg: '#FF3B30', text: '#FFFFFF', label: '마감' },
    last1: { bg: '#FF9500', text: '#FFFFFF', label: '마지막 1자리!' },
    last2: { bg: '#FFCC00', text: '#000000', label: '마지막 2자리' },
    last3: { bg: '#34C759', text: '#FFFFFF', label: '마지막 3자리' },
    imminent: { bg: 'rgba(52, 199, 89, 0.15)', text: '#34C759', label: '마감 임박' },
    available: { bg: 'rgba(0, 122, 255, 0.1)', text: '#007AFF', label: '수강 가능' }
  };

  let type = 'available';
  if (remain <= 0) type = 'full';
  else if (remain === 1) type = 'last1';
  else if (remain === 2) type = 'last2';
  else if (remain === 3) type = 'last3';
  else if (remain <= 5) type = 'imminent';

  const config = styles[type];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: config.bg,
      color: config.text,
      padding: '4px 12px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '700',
      boxShadow: type === 'full' || type === 'last1' ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
      letterSpacing: '-0.3px'
    }}>
      {config.label}
    </span>
  );
}

function ClassRow({ cls, borderTop = true }) {
  const scheduleSlots = useMemo(() => parseSchedule(cls.schedule, cls), [cls.schedule, cls]);
  const current = (cls.studentIds || []).length;
  
  return (
    <tr style={{ 
      borderTop: borderTop ? '1px solid rgba(0,0,0,0.05)' : 'none',
      transition: 'background-color 0.2s ease',
      cursor: 'default'
    }} className="public-row-hover">
      <td style={{ padding: '16px 20px' }}>
        <StatusBadge cls={cls} />
      </td>
      <td style={{ padding: '16px 20px', fontWeight: 600, color: '#007AFF' }}>{cls.subject}</td>
      <td style={{ padding: '16px 20px', color: '#1d1d1f', fontWeight: 500 }}>{cls.grade || '-'}</td>
      <td style={{ padding: '16px 20px', fontWeight: 700, color: '#1d1d1f' }}>{stripClassPrefix(cls.className)}</td>
      <td style={{ padding: '16px 20px', fontSize: '13px', color: '#86868b', whiteSpace: 'pre-line', lineHeight: '1.4' }}>
        {scheduleSlots.map(s => `${s.day} ${s.start}-${s.end}`).join('\n')}
      </td>
      <td style={{ padding: '16px 20px', color: '#1d1d1f' }}>{cls.teacher || '-'}</td>
      <td style={{ padding: '16px 20px', color: '#1d1d1f' }}>{cls.classroom || '-'}</td>
      <td style={{ padding: '16px 20px', color: '#86868b', fontSize: '13px' }}>
        {cls.capacity ? `최대 ${cls.capacity}명` : '-'}
      </td>
    </tr>
  );
}

function DropdownFilter({ label, options, value, onChange, icon: Icon }) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
      {label && <label style={{ fontSize: '12px', fontWeight: '600', color: '#86868b', marginLeft: 4 }}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <select 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            appearance: 'none',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            borderRadius: '12px',
            padding: '10px 36px 10px 14px',
            fontSize: '14px',
            fontWeight: '600',
            color: '#1d1d1f',
            cursor: 'pointer',
            backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2386868b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
            backgroundSize: '16px',
            transition: 'all 0.2s ease',
            outline: 'none',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}
          onFocus={(e) => e.target.style.borderColor = '#007AFF'}
          onBlur={(e) => e.target.style.borderColor = 'rgba(0,0,0,0.1)'}
        >
          {options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {Icon && <Icon size={14} style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', color: '#86868b', pointerEvents: 'none' }} />}
      </div>
    </div>
  );
}

export default function PublicClassListView({ classes, onLogin }) {
  const [subjectFilter, setSubjectFilter] = useState('전체');

  const filteredClasses = useMemo(() => {
    return classes.filter(cls => {
      if (subjectFilter !== '전체' && cls.subject !== subjectFilter) return false;
      return true;
    });
  }, [classes, subjectFilter]);

  const groups = useMemo(() => buildNestedGroups(filteredClasses, 'grade'), [filteredClasses]);


  return (
    <div style={{ 
      backgroundColor: '#F5F5F7', 
      minHeight: '100vh', 
      paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
      color: '#1d1d1f'
    }}>
      {/* Search/Filter Bar - Apple Glassmorphism */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: 'rgba(245, 245, 247, 0.72)',
        backdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        padding: '20px 0'
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#1d1d1f' }}>과목 선택</span>
            <div style={{ 
              display: 'flex', 
              backgroundColor: 'rgba(0,0,0,0.05)', 
              padding: '4px', 
              borderRadius: '12px',
              gap: 4
            }}>
              {['전체', '영어', '수학'].map(opt => (
                <button
                  key={opt}
                  onClick={() => setSubjectFilter(opt)}
                  style={{
                    padding: '8px 20px',
                    fontSize: '15px',
                    fontWeight: '700',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: subjectFilter === opt ? '#FFFFFF' : 'transparent',
                    color: subjectFilter === opt ? '#000000' : '#86868b',
                    boxShadow: subjectFilter === opt ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <button 
            onClick={onLogin}
            style={{
              padding: '10px 24px',
              fontSize: '15px',
              fontWeight: '700',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              backgroundColor: '#007AFF',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(0, 122, 255, 0.2)',
              transition: 'all 0.2s ease',
            }}
          >
            직원 로그인
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', marginTop: 40 }}>
        <header style={{ marginBottom: 40 }}>
          <div style={{ textAlign: 'center' }}>
            <img src="/logo_tips.png" alt="TIPS Logo" style={{ width: 80, height: 80, marginBottom: 20, borderRadius: '18px', boxShadow: '0 8px 16px rgba(0,0,0,0.1)' }} />
            <h1 style={{ fontSize: '42px', fontWeight: '800', letterSpacing: '-1px', marginBottom: 24, color: '#1d1d1f' }}>팁스 영어 수업시간표</h1>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32, alignItems: 'center' }}>
            <a href="https://tipsedu.channel.io/home" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '16px', fontWeight: '700', color: '#1d1d1f', textDecoration: 'none' }}>
              ▶ 채널톡으로 문의하기
            </a>
          </div>
          
          <div style={{ textAlign: 'center', backgroundColor: '#FFFFFF', padding: '24px', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', maxWidth: 640, margin: '0 auto' }}>
            <p style={{ fontSize: '18px', fontWeight: '700', color: '#1d1d1f', marginBottom: 8, wordBreak: 'keep-all' }}>전화로 다시 문의하지 않아도 돼요!</p>
            <p style={{ fontSize: '18px', fontWeight: '700', color: '#1d1d1f', marginBottom: 24, wordBreak: 'keep-all', lineHeight: 1.5 }}>
              실시간으로 업데이트 되고 있는<br/>현재 진행 중인 수업의 <span style={{ backgroundColor: 'rgba(255, 204, 0, 0.3)', padding: '0 4px' }}>"정확한 시간표"</span>이니까요!
            </p>
            
            <p style={{ fontSize: '16px', fontWeight: '600', color: '#86868b', wordBreak: 'keep-all', lineHeight: 1.5 }}>
              "이제, 필요한 친구들에게 휴대폰으로<br/>
              <span style={{ backgroundColor: 'rgba(255, 59, 48, 0.1)', color: '#1d1d1f', padding: '0 4px' }}>팁스 학원 수업시간표를 공유해 줄 수 있어요!</span>"
            </p>
          </div>
        </header>

        <div style={{ 
          backgroundColor: '#FFFFFF', 
          borderRadius: '24px', 
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.05)'
        }}>
          <div style={{ padding: '24px 30px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              < GraduationCap size={24} color="#007AFF" />
              <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>전체 클래스 ({filteredClasses.length})</h2>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ position: 'sticky', top: 81, zIndex: 90 }}>
                <tr style={{ backgroundColor: '#FAFAFB', outline: '1px solid rgba(0,0,0,0.05)', outlineOffset: '-1px' }}>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>상태</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>과목</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>학년</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>수업명</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>시간표</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>선생님</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>강의실</th>
                  <th style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '700', color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>정원</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groups)
                  .sort(([a], [b]) => getGradeWeight(a) - getGradeWeight(b))
                  .map(([name, rows]) => (
                    <GroupSection key={name} name={name} rows={rows} />
                ))}
                {filteredClasses.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 80, textAlign: 'center' }}>
                      <div style={{ color: '#86868b', fontSize: '17px', fontWeight: '500' }}>
                        <Filter size={48} style={{ marginBottom: 16, opacity: 0.2 }} />
                        <br />검색 결과와 일치하는 수업이 없습니다.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        <footer style={{ marginTop: 60, textAlign: 'center', paddingBottom: 40 }}>
          <p style={{ color: '#86868b', fontSize: '14px', fontWeight: '500' }}>© 2026 TIPS Academy. Apple style Schedule View.</p>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 24 }}>
             <span style={{ fontSize: '14px', fontWeight: '600', color: '#007AFF', cursor: 'pointer' }}>학원 소개</span>
             <span style={{ fontSize: '14px', fontWeight: '600', color: '#007AFF', cursor: 'pointer' }}>오시는 길</span>
             <span style={{ fontSize: '14px', fontWeight: '600', color: '#007AFF', cursor: 'pointer' }} onClick={onLogin}>직원 로그인</span>
          </div>
        </footer>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .public-row-hover:hover {
          background-color: rgba(0, 122, 255, 0.02);
        }
        @media (max-width: 768px) {
          h1 { fontSize: 32px !important; }
        }
      `}} />
    </div>
  );
}

function GroupSection({ name, rows }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <tr
        style={{ backgroundColor: '#F2F2F7', cursor: 'pointer' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <td colSpan={8} style={{ padding: '12px 20px', fontWeight: '700', color: '#1d1d1f' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ color: '#86868b', transition: 'transform 0.2s ease', transform: collapsed ? 'rotate(-90deg)' : 'none' }}>
              <ChevronDown size={14} />
            </div>
            <span>{name}</span>
            <span style={{ fontWeight: '500', fontSize: '13px', color: '#86868b' }}>({rows.length})</span>
          </div>
        </td>
      </tr>
      {!collapsed && rows.map((cls, i) => (
        <ClassRow key={cls.id || i} cls={cls} borderTop={i > 0} />
      ))}
    </>
  );
}
