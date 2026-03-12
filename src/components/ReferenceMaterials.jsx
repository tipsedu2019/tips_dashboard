import { useMemo } from 'react';
import { FileText, Book, Calendar, Download, ExternalLink, Info } from 'lucide-react';

const RESOURCES = [
  {
    id: 'hs-materials',
    title: '2026년 고등학교 보충교재, 교과서, 학사일정',
    description: '고등학교 학사 일정 및 과목별 보충교재, 사용 교과서 상세 목록입니다.',
    type: 'excel',
    fileName: '2026년 고등학교 보충교재, 교과서, 학사일정.xlsx',
    icon: Book,
    color: '#10b981' // Green (Excel-like)
  },
  {
    id: 'ms-calendar',
    title: '2026년 중학교 학사일정',
    description: '중학교 1, 2, 3학년별 주요 학사 일정(시험, 방학 등) 안내 파일입니다.',
    type: 'pdf',
    fileName: '2026년_중학교_학사일정.pdf',
    icon: Calendar,
    color: '#3b82f6' // Blue (PDF-like)
  }
];

export default function ReferenceMaterials({ data }) {
  const dynamicResources = useMemo(() => {
    if (data?.referenceMaterials?.length > 0) return data.referenceMaterials;
    return RESOURCES; // Fallback to hardcoded constants if DB is empty
  }, [data?.referenceMaterials]);

  const handleOpen = (fileName) => {
    window.open(`/${fileName}`, '_blank');
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={28} /> 수업 참고 자료 및 학사 일정
          </h1>
          <p>2026년 수업 계획 및 학생 상담에 필요한 주요 참고 자료들을 확인합니다.</p>
        </div>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 24, background: 'var(--accent-light)', border: '1px solid var(--accent-color)', opacity: 0.9 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Info size={20} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <strong>선생님께 드리는 안내:</strong> 아래 자료들은 2026년 신규 학사 일정 및 교재 정보입니다. 
            수업 계획표(Lesson Plan) 작성 시 해당 파일의 일정을 참고하여 시험 대비 및 보충 수업 일정을 조율해 주세요.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        {dynamicResources.map((res) => {
          const Icon = res.icon === 'Calendar' ? Calendar : res.icon === 'Book' ? Book : res.icon || Book;
          const color = res.color || (res.type === 'pdf' ? '#3b82f6' : '#10b981');
          return (
            <div key={res.id} className="card-custom" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100%', transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <div style={{ 
                  width: 52, 
                  height: 52, 
                  borderRadius: 14, 
                  background: `${color}15`, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: color
                }}>
                  <Icon size={28} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{res.title}</h3>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 700, 
                    color: color, 
                    textTransform: 'uppercase',
                    background: `${color}10`,
                    padding: '2px 8px',
                    borderRadius: 4,
                    marginTop: 4,
                    display: 'inline-block'
                  }}>
                    {res.type}
                  </span>
                </div>
              </div>
              
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24, flex: 1 }}>
                {res.description}
              </p>

              <div style={{ display: 'flex', gap: 12 }}>
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleOpen(res.fileName)}
                  style={{ flex: 1, height: 44, borderRadius: 10, gap: 8 }}
                >
                  <ExternalLink size={16} /> 바로보기
                </button>
                <a 
                  href={`/${res.fileName}`} 
                  download 
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, padding: 0, borderRadius: 10 }}
                  title="다운로드"
                >
                  <Download size={18} />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 40, padding: 32, textAlign: 'center', background: 'var(--bg-surface-hover)', borderRadius: 20, border: '1px dashed var(--border-color)' }}>
        <Book size={40} style={{ opacity: 0.2, marginBottom: 16 }} />
        <h4 style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)' }}>추가 자료가 필요하신가요?</h4>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
          필요한 자료가 목록에 없는 경우 행정실 또는 담당 관리자에게 요청해 주세요.
        </p>
      </div>
    </div>
  );
}
