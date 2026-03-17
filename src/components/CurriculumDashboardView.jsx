import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Download, ImageDown, Plus, Printer, Save, Upload } from 'lucide-react';
import ViewHeader from './ui/ViewHeader';
import StatusBanner from './ui/StatusBanner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { exportElementAsImage } from '../lib/exportAsImage';

const SUBJECT_OPTIONS = ['영어', '수학'];
const GRADE_ORDER = ['초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const GRADE_GROUPS = [
  { value: 'elementary', label: '초등' },
  { value: 'middle', label: '중등' },
  { value: 'high', label: '고등' },
];
const ALL_SCHOOLS = 'all-schools';
const ALL_GRADES = 'all-grades';
const DEFAULT_COLOR = '#216e4e';

const text = (value) => String(value || '').trim();
const schoolKey = (value) => text(value).replace(/\s+/g, '').toLowerCase();
const gradeSort = (value) => Math.max(0, GRADE_ORDER.indexOf(text(value)));
const gradeGroupFromGrade = (grade) => (String(grade).startsWith('초') ? 'elementary' : String(grade).startsWith('중') ? 'middle' : 'high');
const createId = () => (typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

function getGradesForGroup(group) {
  if (group === 'elementary') return GRADE_ORDER.filter((grade) => grade.startsWith('초'));
  if (group === 'middle') return GRADE_ORDER.filter((grade) => grade.startsWith('중'));
  return GRADE_ORDER.filter((grade) => grade.startsWith('고'));
}

function buildYearOptions(data = {}) {
  const values = new Set([new Date().getFullYear()]);
  (data.classTerms || []).forEach((term) => values.add(Number(term.academicYear || term.academic_year || new Date().getFullYear())));
  (data.academicCurriculumProfiles || []).forEach((row) => values.add(Number(row.academicYear || row.academic_year || new Date().getFullYear())));
  (data.academyCurriculumPlans || []).forEach((row) => values.add(Number(row.academicYear || row.academic_year || new Date().getFullYear())));
  return [...values].filter(Boolean).sort((left, right) => right - left);
}

function buildSchoolCatalog(students = [], academicSchools = []) {
  const matched = new Map((academicSchools || []).map((school) => [schoolKey(school.name), school]));
  const buckets = new Map();
  (students || []).forEach((student) => {
    const name = text(student.school);
    if (!name) return;
    const key = schoolKey(name);
    if (!buckets.has(key)) {
      const school = matched.get(key);
      buckets.set(key, {
        id: school?.id || '',
        name,
        color: school?.color || DEFAULT_COLOR,
        category: school?.category || gradeGroupFromGrade(student.grade),
        grades: new Set(),
      });
    }
    if (student.grade) buckets.get(key).grades.add(text(student.grade));
  });
  return [...buckets.values()]
    .map((school) => ({ ...school, grades: [...school.grades].sort((left, right) => gradeSort(left) - gradeSort(right)) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function formatMainTextbook(profile) {
  const title = text(profile?.mainTextbookTitle);
  const publisher = text(profile?.mainTextbookPublisher);
  if (!title && !publisher) return '';
  if (!publisher) return title;
  if (!title) return publisher;
  return `${title} (${publisher})`;
}

function formatSupplement(item) {
  const title = text(item?.title);
  const publisher = text(item?.publisher);
  if (!title && !publisher) return '';
  if (!publisher) return title;
  if (!title) return publisher;
  return `${title} (${publisher})`;
}

function MaterialEditor({ items, onChange, addLabel }) {
  const update = (id, field, value) => onChange(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  return (
    <div className="curriculum-material-list">
      {items.map((item) => (
        <div key={item.id} className="curriculum-material-card">
          <input className="styled-input" value={item.title} placeholder="교재명" onChange={(event) => update(item.id, 'title', event.target.value)} />
          <input className="styled-input" value={item.publisher} placeholder="출판사" onChange={(event) => update(item.id, 'publisher', event.target.value)} />
          <button type="button" className="action-chip" onClick={() => onChange(items.filter((row) => row.id !== item.id))}>삭제</button>
          <textarea className="styled-input" value={item.note} placeholder="메모" onChange={(event) => update(item.id, 'note', event.target.value)} style={{ gridColumn: '1 / -1', minHeight: 78, resize: 'vertical' }} />
        </div>
      ))}
      <button type="button" className="action-pill" onClick={() => onChange([...items, { id: createId(), title: '', publisher: '', note: '', sortOrder: items.length }])}>
        <Plus size={16} />
        {addLabel}
      </button>
    </div>
  );
}

export default function CurriculumDashboardView({ data, dataService }) {
  const toast = useToast();
  const { isStaff, isTeacher } = useAuth();
  const canEdit = isStaff || isTeacher;
  const reportRef = useRef(null);

  const yearOptions = useMemo(() => buildYearOptions(data), [data]);
  const schoolCatalog = useMemo(() => buildSchoolCatalog(data.students, data.academicSchools), [data.academicSchools, data.students]);
  const [selectedYear, setSelectedYear] = useState(yearOptions[0] || new Date().getFullYear());
  const [selectedSubject, setSelectedSubject] = useState(SUBJECT_OPTIONS[0]);
  const [selectedGradeGroup, setSelectedGradeGroup] = useState('high');
  const [selectedSchoolKey, setSelectedSchoolKey] = useState(ALL_SCHOOLS);
  const [selectedGrade, setSelectedGrade] = useState(ALL_GRADES);
  const [schoolDraft, setSchoolDraft] = useState({ id: '', schoolId: '', mainTextbookTitle: '', mainTextbookPublisher: '', note: '' });
  const [schoolMaterials, setSchoolMaterials] = useState([]);
  const [academyDraft, setAcademyDraft] = useState({ id: '', classId: '', mainTextbookId: '', note: '' });
  const [academyMaterials, setAcademyMaterials] = useState([]);
  const [isSavingSchool, setIsSavingSchool] = useState(false);
  const [isSavingAcademy, setIsSavingAcademy] = useState(false);

  const schoolProfiles = data.academicCurriculumProfiles || [];
  const supplementMaterials = data.academicSupplementMaterials || [];
  const academyPlans = data.academyCurriculumPlans || [];
  const academyPlanMaterials = data.academyCurriculumMaterials || [];
  const groupGrades = useMemo(() => getGradesForGroup(selectedGradeGroup), [selectedGradeGroup]);
  const schoolOptions = useMemo(
    () => schoolCatalog.filter((school) => school.grades.some((grade) => groupGrades.includes(grade))),
    [groupGrades, schoolCatalog]
  );
  const selectedSchool = useMemo(() => schoolOptions.find((school) => schoolKey(school.name) === selectedSchoolKey) || null, [schoolOptions, selectedSchoolKey]);
  const gradeOptions = useMemo(() => (selectedSchool ? selectedSchool.grades.filter((grade) => groupGrades.includes(grade)) : groupGrades), [groupGrades, selectedSchool]);

  useEffect(() => {
    if (selectedSchoolKey !== ALL_SCHOOLS && !schoolOptions.some((school) => schoolKey(school.name) === selectedSchoolKey)) {
      setSelectedSchoolKey(ALL_SCHOOLS);
    }
  }, [schoolOptions, selectedSchoolKey]);

  useEffect(() => {
    if (selectedGrade !== ALL_GRADES && !gradeOptions.includes(selectedGrade)) {
      setSelectedGrade(ALL_GRADES);
    }
  }, [gradeOptions, selectedGrade]);

  const currentSchoolProfile = useMemo(() => {
    if (!selectedSchool || selectedGrade === ALL_GRADES) return null;
    return schoolProfiles.find((profile) => (
      String(profile.schoolId || '') === String(selectedSchool.id || '') &&
      Number(profile.academicYear || profile.academic_year || new Date().getFullYear()) === Number(selectedYear) &&
      String(profile.subject || '') === String(selectedSubject) &&
      String(profile.grade || '') === String(selectedGrade)
    )) || null;
  }, [schoolProfiles, selectedGrade, selectedSchool, selectedSubject, selectedYear]);

  const currentAcademyPlan = useMemo(() => (
    academyPlans.find((plan) => (
      Number(plan.academicYear || plan.academic_year || new Date().getFullYear()) === Number(selectedYear) &&
      String(plan.academyGrade || '') === String(selectedGradeGroup) &&
      String(plan.subject || '') === String(selectedSubject)
    )) || null
  ), [academyPlans, selectedGradeGroup, selectedSubject, selectedYear]);

  useEffect(() => {
    setSchoolDraft({
      id: currentSchoolProfile?.id || '',
      schoolId: currentSchoolProfile?.schoolId || selectedSchool?.id || '',
      mainTextbookTitle: currentSchoolProfile?.mainTextbookTitle || '',
      mainTextbookPublisher: currentSchoolProfile?.mainTextbookPublisher || '',
      note: currentSchoolProfile?.note || '',
    });
    setSchoolMaterials(
      supplementMaterials
        .filter((item) => item.profileId === currentSchoolProfile?.id)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((item) => ({ id: item.id, title: item.title || '', publisher: item.publisher || '', note: item.note || '', sortOrder: item.sortOrder ?? 0 }))
    );
  }, [currentSchoolProfile, selectedSchool, supplementMaterials]);

  useEffect(() => {
    setAcademyDraft({
      id: currentAcademyPlan?.id || '',
      classId: currentAcademyPlan?.classId || '',
      mainTextbookId: currentAcademyPlan?.mainTextbookId || '',
      note: currentAcademyPlan?.note || '',
    });
    setAcademyMaterials(
      academyPlanMaterials
        .filter((item) => item.planId === currentAcademyPlan?.id)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((item) => ({ id: item.id, title: item.title || '', publisher: item.publisher || '', note: item.note || '', textbookId: item.textbookId || '', sortOrder: item.sortOrder ?? 0 }))
    );
  }, [academyPlanMaterials, currentAcademyPlan]);

  const textbookOptions = useMemo(() => (data.textbooks || []).map((item) => ({ id: item.id, title: item.title })), [data.textbooks]);
  const classOptions = useMemo(() => (data.classes || []).filter((item) => item.subject === selectedSubject).map((item) => ({ id: item.id, label: item.className })), [data.classes, selectedSubject]);
  const reportGrades = selectedGrade === ALL_GRADES ? gradeOptions : gradeOptions.filter((grade) => grade === selectedGrade);
  const reportSchools = selectedSchool ? [selectedSchool] : schoolOptions;
  const reportRows = reportSchools.map((school) => ({
    school,
    cells: reportGrades.map((grade) => {
      const profile = schoolProfiles.find((item) => (
        String(item.schoolId || '') === String(school.id || '') &&
        Number(item.academicYear || item.academic_year || new Date().getFullYear()) === Number(selectedYear) &&
        String(item.subject || '') === String(selectedSubject) &&
        String(item.grade || '') === String(grade)
      ));
      const materials = supplementMaterials.filter((item) => item.profileId === profile?.id).sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
      return { grade, main: formatMainTextbook(profile), supplements: materials.map(formatSupplement).filter(Boolean) };
    }),
  }));
  const reportTableRows = reportRows.flatMap((row) => ([
    (
      <tr key={`${row.school.name}-supplement`}>
        <td rowSpan={2} className="curriculum-report-school-name">{row.school.name}</td>
        <td className="curriculum-report-row-label">보충교재</td>
        {row.cells.map((cell) => <td key={`${row.school.name}-${cell.grade}-supplement`}><div className="curriculum-report-cell-lines">{cell.supplements.length ? cell.supplements.map((line, index) => <span key={`${cell.grade}-supplement-${index}`}>{line}</span>) : <span className="curriculum-report-empty">-</span>}</div></td>)}
      </tr>
    ),
    (
      <tr key={`${row.school.name}-main`}>
        <td className="curriculum-report-row-label">교과서(출판사)</td>
        {row.cells.map((cell) => <td key={`${row.school.name}-${cell.grade}-main`}><div className="curriculum-report-cell-lines">{cell.main ? <span>{cell.main}</span> : <span className="curriculum-report-empty">-</span>}</div></td>)}
      </tr>
    ),
  ]));

  const comparisonRows = {
    school: [
      schoolDraft.mainTextbookTitle ? { label: '학교 메인 교재', value: formatMainTextbook(schoolDraft) } : null,
      ...schoolMaterials.filter((item) => text(item.title)).map((item) => ({ label: '학교 보충교재', value: formatSupplement(item) })),
    ].filter(Boolean),
    academy: [
      textbookOptions.find((item) => item.id === academyDraft.mainTextbookId)?.title ? { label: '학원 메인 교재', value: textbookOptions.find((item) => item.id === academyDraft.mainTextbookId)?.title } : null,
      ...academyMaterials.filter((item) => text(item.title)).map((item) => ({ label: '학원 보조 교재', value: formatSupplement(item) })),
    ].filter(Boolean),
  };

  const exportReportImage = async () => {
    if (!reportRef.current) return;
    try {
      await exportElementAsImage(reportRef.current, `커리큘럼-${selectedYear}-${selectedSubject}.png`, { width: 1123, padding: 16, scale: 2.5, backgroundColor: '#ffffff' });
      toast.success('학교 교재표를 이미지로 저장했습니다.');
    } catch (error) {
      toast.error(`이미지 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const printReport = () => {
    if (!reportRef.current) return;
    const popup = window.open('', '_blank', 'width=1400,height=900');
    if (!popup) {
      toast.error('팝업 차단 때문에 인쇄 창을 열 수 없습니다.');
      return;
    }
    popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8" /><title>학교 교재표</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;margin:0;color:#12202f}.curriculum-report-sheet{width:100%}.curriculum-report-table{width:100%;border-collapse:collapse;table-layout:fixed}.curriculum-report-table th,.curriculum-report-table td{border:1px solid #16202f;padding:8px;vertical-align:top;word-break:keep-all}.curriculum-report-table thead th{background:#ab1820;color:#fff;font-size:13px;font-weight:800}.curriculum-report-school-name,.curriculum-report-school-col{text-align:center;font-weight:800}.curriculum-report-row-label,.curriculum-report-type-col{background:#f7f8fa;text-align:center;font-weight:700}.curriculum-report-cell-lines{display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:1.5}.curriculum-report-empty{color:#84909c}</style></head><body>${reportRef.current.outerHTML}<script>window.onload=function(){window.print()}</script></body></html>`);
    popup.document.close();
  };

  const saveSchoolCurriculum = async () => {
    if (!canEdit) return toast.info('현재 계정은 학교 교재 정보를 수정할 수 없습니다.');
    if (!selectedSchool || selectedGrade === ALL_GRADES) return toast.info('학교와 학년을 하나씩 선택한 뒤 저장해 주세요.');
    setIsSavingSchool(true);
    try {
      let schoolId = selectedSchool.id;
      if (!schoolId) {
        const [savedSchool] = await dataService.upsertAcademicSchools([{ id: createId(), name: selectedSchool.name, category: selectedSchool.category || gradeGroupFromGrade(selectedGrade), color: selectedSchool.color || DEFAULT_COLOR, sortOrder: 0 }]);
        schoolId = savedSchool?.id || '';
      }
      const [savedProfile] = await dataService.bulkUpsertAcademicCurriculumProfiles([{ id: schoolDraft.id || '', academicYear: selectedYear, schoolId, grade: selectedGrade, subject: selectedSubject, mainTextbookTitle: schoolDraft.mainTextbookTitle, mainTextbookPublisher: schoolDraft.mainTextbookPublisher, note: schoolDraft.note }]);
      await dataService.replaceAcademicSupplementMaterials(savedProfile.id, schoolMaterials.map((item, index) => ({ ...item, sortOrder: index })));
      toast.success('학교 교재 정보를 저장했습니다.');
    } catch (error) {
      toast.error(`학교 교재 정보 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSavingSchool(false);
    }
  };

  const saveAcademyCurriculum = async () => {
    if (!canEdit) return toast.info('현재 계정은 학원 커리큘럼을 수정할 수 없습니다.');
    setIsSavingAcademy(true);
    try {
      const [savedPlan] = await dataService.bulkUpsertAcademyCurriculumPlans([{ id: academyDraft.id || '', academicYear: selectedYear, academyGrade: selectedGradeGroup, subject: selectedSubject, classId: academyDraft.classId || null, mainTextbookId: academyDraft.mainTextbookId || null, note: academyDraft.note, sortOrder: 0 }]);
      await dataService.replaceAcademyCurriculumMaterials(savedPlan.id, academyMaterials.map((item, index) => ({ ...item, sortOrder: index })));
      toast.success('학원 커리큘럼을 저장했습니다.');
    } catch (error) {
      toast.error(`학원 커리큘럼 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSavingAcademy(false);
    }
  };

  return (
    <div className="view-container">
      <section className="workspace-surface" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ViewHeader
          icon={<BookOpen size={22} />}
          eyebrow="교재 정보"
          title="커리큘럼 대시보드"
          description="학교 기준 1년 교재와 학원 기준 1년 운영 커리큘럼을 같은 화면에서 비교하고 정리합니다."
          actions={<><button type="button" className="action-chip" onClick={() => toast.info('교재 템플릿 다운로드는 다음 단계에서 연결할 예정입니다.')}><Download size={16} />템플릿 다운로드</button><button type="button" className="action-chip" onClick={() => toast.info('교재 데이터 업로드는 다음 단계에서 연결할 예정입니다.')}><Upload size={16} />데이터 업로드</button></>}
        />

        {!(data.academicCurriculumProfiles && data.academyCurriculumPlans !== undefined) ? <StatusBanner variant="warning" title="커리큘럼 저장용 테이블이 아직 준비되지 않았습니다." message="Supabase migration을 먼저 반영하면 학교 교재와 학원 커리큘럼을 연도 기준으로 저장할 수 있습니다." /> : null}

        <div className="card-custom curriculum-filter-grid">
          <label className="curriculum-filter-field"><span>학년도</span><select className="styled-input" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{yearOptions.map((year) => <option key={year} value={year}>{year}년</option>)}</select></label>
          <label className="curriculum-filter-field"><span>과목</span><select className="styled-input" value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>{SUBJECT_OPTIONS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>학년군</span><select className="styled-input" value={selectedGradeGroup} onChange={(event) => setSelectedGradeGroup(event.target.value)}>{GRADE_GROUPS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>학교</span><select className="styled-input" value={selectedSchoolKey} onChange={(event) => setSelectedSchoolKey(event.target.value)}><option value={ALL_SCHOOLS}>전체 학교</option>{schoolOptions.map((school) => <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>학년</span><select className="styled-input" value={selectedGrade} onChange={(event) => setSelectedGrade(event.target.value)}><option value={ALL_GRADES}>전체 학년</option>{gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
        </div>

        <section className="card-custom curriculum-section">
          <div className="curriculum-section-header">
            <div><h3>학교 교재표</h3><p>학년도별, 학교별, 학년별 교과서와 보충교재를 한눈에 보고 A4 가로 기준으로 인쇄하거나 이미지로 저장할 수 있습니다.</p></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="action-chip" onClick={exportReportImage}><ImageDown size={16} />이미지 저장</button><button type="button" className="action-pill" onClick={printReport}><Printer size={16} />A4 인쇄 / PDF 저장</button></div>
          </div>
          <div className="curriculum-report-scroll">
            <div ref={reportRef} className="curriculum-report-sheet">
              <div className="curriculum-report-header">
                <div className="curriculum-report-eyebrow">학교 기준 1년 교재표</div>
                <h3>{selectedYear}년 {selectedSubject} 학교 교재 현황</h3>
                <p>{GRADE_GROUPS.find((group) => group.value === selectedGradeGroup)?.label} · {selectedSchool ? selectedSchool.name : '전체 학교'} · {selectedGrade === ALL_GRADES ? '전체 학년' : selectedGrade}</p>
              </div>
              <table className="curriculum-report-table">
                <thead><tr><th className="curriculum-report-school-col">학교</th><th className="curriculum-report-type-col">구분</th>{reportGrades.map((grade) => <th key={grade}>{grade}</th>)}</tr></thead>
                <tbody>
                  {reportRows.length === 0 ? <tr><td colSpan={reportGrades.length + 2} className="curriculum-report-empty-cell">현재 필터 기준으로 표시할 학교 교재 정보가 없습니다.</td></tr> : reportTableRows}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="curriculum-edit-grid">
          <section className="card-custom curriculum-section">
            <div className="curriculum-section-header"><div><h3>학교 교재</h3><p>선택한 학년도·과목·학교·학년 기준으로 교과서와 보충교재를 저장합니다.</p></div><button type="button" className="action-pill" onClick={saveSchoolCurriculum} disabled={isSavingSchool || !selectedSchool || selectedGrade === ALL_GRADES}><Save size={16} />{isSavingSchool ? '저장 중...' : '학교 교재 저장'}</button></div>
            {!selectedSchool || selectedGrade === ALL_GRADES ? <StatusBanner variant="info" title="학교 교재 저장 대상 선택" message="학교와 학년을 하나씩 선택하면 학교 교재를 바로 저장할 수 있습니다." /> : null}
            <div className="curriculum-form-grid">
              <input className="styled-input" value={schoolDraft.mainTextbookTitle} placeholder="교과서명" onChange={(event) => setSchoolDraft((current) => ({ ...current, mainTextbookTitle: event.target.value }))} />
              <input className="styled-input" value={schoolDraft.mainTextbookPublisher} placeholder="교과서 출판사" onChange={(event) => setSchoolDraft((current) => ({ ...current, mainTextbookPublisher: event.target.value }))} />
              <textarea className="styled-input" value={schoolDraft.note} placeholder="학교 기준 메모" onChange={(event) => setSchoolDraft((current) => ({ ...current, note: event.target.value }))} style={{ minHeight: 96, resize: 'vertical', gridColumn: '1 / -1' }} />
            </div>
            <MaterialEditor items={schoolMaterials} onChange={setSchoolMaterials} addLabel="학교 보충교재 추가" />
          </section>

          <section className="card-custom curriculum-section">
            <div className="curriculum-section-header"><div><h3>학원 커리큘럼</h3><p>선택한 학년도·과목·학년군 기준으로 메인 교재와 보조 교재를 정리합니다.</p></div><button type="button" className="action-pill" onClick={saveAcademyCurriculum} disabled={isSavingAcademy}><Save size={16} />{isSavingAcademy ? '저장 중...' : '학원 커리큘럼 저장'}</button></div>
            <div className="curriculum-form-grid">
              <label className="curriculum-filter-field"><span>연결 반</span><select className="styled-input" value={academyDraft.classId} onChange={(event) => setAcademyDraft((current) => ({ ...current, classId: event.target.value }))}><option value="">반 미연결</option>{classOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label className="curriculum-filter-field"><span>메인 교재</span><select className="styled-input" value={academyDraft.mainTextbookId} onChange={(event) => setAcademyDraft((current) => ({ ...current, mainTextbookId: event.target.value }))}><option value="">선택 안 함</option>{textbookOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <textarea className="styled-input" value={academyDraft.note} placeholder="학원 운영 메모" onChange={(event) => setAcademyDraft((current) => ({ ...current, note: event.target.value }))} style={{ minHeight: 96, resize: 'vertical', gridColumn: '1 / -1' }} />
            </div>
            <MaterialEditor items={academyMaterials} onChange={setAcademyMaterials} addLabel="학원 보조 교재 추가" />
          </section>
        </div>

        <section className="card-custom curriculum-section">
          <div className="curriculum-section-header"><div><h3>학교 기준 / 학원 기준 비교</h3><p>같은 연도·과목·학년군 기준으로 두 기준을 나란히 비교합니다.</p></div></div>
          <div className="curriculum-compare-grid">
            <div className="card-custom curriculum-compare-card"><div className="curriculum-compare-card-title">학교 기준</div>{comparisonRows.school.length ? comparisonRows.school.map((row, index) => <div key={`${row.label}-${index}`} className="curriculum-compare-row"><span>{row.label}</span><strong>{row.value}</strong></div>) : <div className="curriculum-compare-empty">아직 등록된 학교 교재가 없습니다.</div>}</div>
            <div className="card-custom curriculum-compare-card"><div className="curriculum-compare-card-title">학원 기준</div>{comparisonRows.academy.length ? comparisonRows.academy.map((row, index) => <div key={`${row.label}-${index}`} className="curriculum-compare-row"><span>{row.label}</span><strong>{row.value}</strong></div>) : <div className="curriculum-compare-empty">아직 등록된 학원 커리큘럼이 없습니다.</div>}</div>
          </div>
        </section>
      </section>
    </div>
  );
}
