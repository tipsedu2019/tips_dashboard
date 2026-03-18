import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImageDown, Plus, Printer, Save, Upload } from 'lucide-react';
import StatusBanner from './ui/StatusBanner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { exportElementAsImage } from '../lib/exportAsImage';

const SUBJECT_OPTIONS = ['영어', '수학'];
const GRADE_ORDER = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const SCHOOL_CATEGORY_OPTIONS = [
  { value: 'elementary', label: '초등' },
  { value: 'middle', label: '중등' },
  { value: 'high', label: '고등' },
];
const ALL_SCHOOLS = 'all-schools';
const ALL_GRADES = 'all-grades';
const DEFAULT_COLOR = '#216e4e';

const text = (value) => String(value || '').trim();
const schoolKey = (value) => text(value).replace(/\s+/g, '').toLowerCase();
const gradeSort = (value) => {
  const index = GRADE_ORDER.indexOf(text(value));
  return index < 0 ? GRADE_ORDER.length : index;
};
const createId = () => (typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

function inferSchoolCategoryFromName(name) {
  const normalized = text(name);

  if (/(?:\uCD08\uB4F1\uD559\uAD50|\uCD08\d|\uCD08)$/u.test(normalized)) {
    return 'elementary';
  }

  if (/(?:\uC911\uD559\uAD50|\uC911\d|\uC911)$/u.test(normalized)) {
    return 'middle';
  }

  if (/(?:\uACE0\uB4F1\uD559\uAD50|\uACE0\d|\uACE0)$/u.test(normalized)) {
    return 'high';
  }

  return '';
}

function normalizeSchoolCategory(category, fallback = 'high') {
  return SCHOOL_CATEGORY_OPTIONS.some((option) => option.value === category) ? category : fallback;
}

function gradeGroupFromGrade(grade) {
  const normalized = text(grade);
  if (normalized.startsWith('\uCD08')) return 'elementary';
  if (normalized.startsWith('\uC911')) return 'middle';
  if (normalized.startsWith('\uACE0')) return 'high';
  return 'high';
}

function getGradesForGroup(group) {
  if (group === 'elementary') return GRADE_ORDER.filter((grade) => grade.startsWith('\uCD08'));
  if (group === 'middle') return GRADE_ORDER.filter((grade) => grade.startsWith('\uC911'));
  return GRADE_ORDER.filter((grade) => grade.startsWith('\uACE0'));
}

function mergeGradeLists(...collections) {
  return [...new Set(collections.flat().map((value) => text(value)).filter(Boolean))]
    .sort((left, right) => gradeSort(left) - gradeSort(right));
}

function buildYearOptions(data = {}) {
  const values = new Set([new Date().getFullYear()]);
  (data.classTerms || []).forEach((term) => values.add(Number(term.academicYear || term.academic_year || new Date().getFullYear())));
  (data.academicCurriculumProfiles || []).forEach((row) => values.add(Number(row.academicYear || row.academic_year || new Date().getFullYear())));
  (data.academyCurriculumPlans || []).forEach((row) => values.add(Number(row.academicYear || row.academic_year || new Date().getFullYear())));
  return [...values].filter(Boolean).sort((left, right) => right - left);
}

function buildSchoolCatalog(students = [], academicSchools = [], customSchools = []) {
  const buckets = new Map();

  const ensureSchool = (input = {}) => {
    const name = text(input.name);
    if (!name) {
      return null;
    }

    const key = schoolKey(name);
    const explicitCategory = text(input.category);
    const nextCategory = normalizeSchoolCategory(
      explicitCategory || gradeGroupFromGrade(input.grade),
      inferSchoolCategoryFromName(name) || 'high'
    );

    if (!buckets.has(key)) {
      buckets.set(key, {
        id: input.id || '',
        name,
        color: input.color || DEFAULT_COLOR,
        category: nextCategory,
        grades: new Set(),
      });
    }

    const target = buckets.get(key);
    target.id = input.id || target.id || '';
    target.name = name;
    target.color = input.color || target.color || DEFAULT_COLOR;
    if (explicitCategory) {
      target.category = normalizeSchoolCategory(explicitCategory, target.category || nextCategory);
    } else if (!target.category) {
      target.category = nextCategory;
    }

    if (input.grade) {
      target.grades.add(text(input.grade));
    }

    return target;
  };

  (academicSchools || []).forEach((school) => {
    ensureSchool({
      id: school.id,
      name: school.name,
      color: school.color,
      category: school.category,
    });
  });

  (customSchools || []).forEach((school) => ensureSchool(school));

  (students || []).forEach((student) => {
    ensureSchool({
      name: student.school,
      grade: student.grade,
    });
  });

  return [...buckets.values()]
    .map((school) => ({
      ...school,
      category: normalizeSchoolCategory(school.category, inferSchoolCategoryFromName(school.name) || 'high'),
      grades: mergeGradeLists(
        getGradesForGroup(normalizeSchoolCategory(school.category, inferSchoolCategoryFromName(school.name) || 'high')),
        [...school.grades]
      ),
    }))
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

function formatSupplementEditorText(items) {
  return (items || [])
    .filter((item) => text(item.title) || text(item.publisher))
    .map((item) => [text(item.title), text(item.publisher)].filter(Boolean).join(' | '))
    .join('\n');
}

function parseSupplementEditorText(value) {
  return String(value || '')
    .split(/\n+/)
    .map((line, index) => {
      const [titlePart, ...publisherParts] = line.split('|');
      const title = text(titlePart);
      const publisher = text(publisherParts.join('|'));
      if (!title && !publisher) {
        return null;
      }

      return {
        id: createId(),
        title,
        publisher,
        note: '',
        sortOrder: index,
      };
    })
    .filter(Boolean);
}

function MaterialEditor({ items, onChange, addLabel }) {
  const update = (id, field, value) => onChange(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));

  return (
    <div className="curriculum-material-list">
      {items.map((item) => (
        <div key={item.id} className="curriculum-material-card">
          <input className="styled-input" value={item.title} placeholder={"\uAD50\uACFC\uC11C\uBA85"} onChange={(event) => update(item.id, 'title', event.target.value)} />
          <input className="styled-input" value={item.publisher} placeholder={"\uCD9C\uD310\uC0AC"} onChange={(event) => update(item.id, 'publisher', event.target.value)} />
          <button type="button" className="action-chip" onClick={() => onChange(items.filter((row) => row.id !== item.id))}>{"\uC0AD\uC81C"}</button>
          <textarea className="styled-input" value={item.note} placeholder="硫붾え" onChange={(event) => update(item.id, 'note', event.target.value)} style={{ gridColumn: '1 / -1', minHeight: 78, resize: 'vertical' }} />
        </div>
      ))}

      <button
        type="button"
        className="action-pill"
        onClick={() => onChange([...items, { id: createId(), title: '', publisher: '', note: '', sortOrder: items.length }])}
      >
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
  const [selectedYear, setSelectedYear] = useState(yearOptions[0] || new Date().getFullYear());
  const [selectedSubject, setSelectedSubject] = useState(SUBJECT_OPTIONS[0]);
  const [selectedGradeGroup, setSelectedGradeGroup] = useState('high');
  const [selectedSchoolKey, setSelectedSchoolKey] = useState(ALL_SCHOOLS);
  const [selectedGrade, setSelectedGrade] = useState(ALL_GRADES);
  const [customSchools, setCustomSchools] = useState([]);
  const [pendingSchoolName, setPendingSchoolName] = useState('');
  const [schoolMetaDraft, setSchoolMetaDraft] = useState({ id: '', name: '', category: 'high', color: DEFAULT_COLOR });
  const [schoolDraft, setSchoolDraft] = useState({ id: '', schoolId: '', mainTextbookTitle: '', mainTextbookPublisher: '', note: '' });
  const [schoolMaterials, setSchoolMaterials] = useState([]);
  const [academyDraft, setAcademyDraft] = useState({ id: '', classId: '', mainTextbookId: '', note: '' });
  const [academyMaterials, setAcademyMaterials] = useState([]);
  const [inlineSchoolEditor, setInlineSchoolEditor] = useState(null);
  const [inlineSupplementText, setInlineSupplementText] = useState('');
  const [isSavingSchoolMeta, setIsSavingSchoolMeta] = useState(false);
  const [isSavingSchool, setIsSavingSchool] = useState(false);
  const [isSavingAcademy, setIsSavingAcademy] = useState(false);

  const schoolCatalog = useMemo(
    () => buildSchoolCatalog(data.students, data.academicSchools, customSchools),
    [customSchools, data.academicSchools, data.students]
  );
  const schoolProfiles = data.academicCurriculumProfiles || [];
  const supplementMaterials = data.academicSupplementMaterials || [];
  const academyPlans = data.academyCurriculumPlans || [];
  const academyPlanMaterials = data.academyCurriculumMaterials || [];
  const groupGrades = useMemo(() => getGradesForGroup(selectedGradeGroup), [selectedGradeGroup]);
  const schoolOptions = useMemo(
    () => schoolCatalog.filter((school) => school.category === selectedGradeGroup || school.grades.some((grade) => groupGrades.includes(grade))),
    [groupGrades, schoolCatalog, selectedGradeGroup]
  );
  const selectedSchool = useMemo(
    () => schoolOptions.find((school) => schoolKey(school.name) === selectedSchoolKey) || null,
    [schoolOptions, selectedSchoolKey]
  );
  const gradeOptions = useMemo(
    () => mergeGradeLists(groupGrades, selectedSchool?.grades || []),
    [groupGrades, selectedSchool]
  );

  useEffect(() => {
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0] || new Date().getFullYear());
    }
  }, [selectedYear, yearOptions]);

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

  useEffect(() => {
    setSchoolMetaDraft({
      id: selectedSchool?.id || '',
      name: selectedSchool?.name || '',
      category: selectedSchool?.category || selectedGradeGroup,
      color: selectedSchool?.color || DEFAULT_COLOR,
    });
  }, [selectedGradeGroup, selectedSchool]);

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
        .map((item) => ({
          id: item.id,
          title: item.title || '',
          publisher: item.publisher || '',
          note: item.note || '',
          sortOrder: item.sortOrder ?? 0,
        }))
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
        .map((item) => ({
          id: item.id,
          title: item.title || '',
          publisher: item.publisher || '',
          note: item.note || '',
          textbookId: item.textbookId || '',
          sortOrder: item.sortOrder ?? 0,
        }))
    );
  }, [academyPlanMaterials, currentAcademyPlan]);

  useEffect(() => {
    if (inlineSchoolEditor?.section === 'supplements') {
      setInlineSupplementText(formatSupplementEditorText(schoolMaterials));
    }
  }, [inlineSchoolEditor, schoolMaterials]);

  const textbookOptions = useMemo(
    () => (data.textbooks || []).map((item) => ({ id: item.id, title: item.title || item.name || '' })).filter((item) => item.title),
    [data.textbooks]
  );
  const classOptions = useMemo(
    () => (data.classes || []).filter((item) => item.subject === selectedSubject).map((item) => ({ id: item.id, label: item.className })),
    [data.classes, selectedSubject]
  );
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
      const materials = supplementMaterials
        .filter((item) => item.profileId === profile?.id)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));

      return {
        grade,
        main: formatMainTextbook(profile),
        supplements: materials.map(formatSupplement).filter(Boolean),
      };
    }),
  }));
  const reportTableRows = reportRows.flatMap((row) => ([
    { key: `${row.school.name}-supplement`, label: '보충교재', section: 'supplements', rowSpan: 2, row },
    { key: `${row.school.name}-main`, label: '교과서(출판사)', section: 'main', rowSpan: 0, row },
  ]));

  const comparisonRows = {
    school: [
      schoolDraft.mainTextbookTitle ? { label: '학교 메인 교재', value: formatMainTextbook(schoolDraft) } : null,
      ...schoolMaterials.filter((item) => text(item.title)).map((item) => ({ label: '학교 보충교재', value: formatSupplement(item) })),
    ].filter(Boolean),
    academy: [
      textbookOptions.find((item) => item.id === academyDraft.mainTextbookId)?.title
        ? { label: '학원 메인 교재', value: textbookOptions.find((item) => item.id === academyDraft.mainTextbookId)?.title }
        : null,
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

  const syncSchoolLocally = (savedSchool, previousName = savedSchool?.name || '') => {
    if (!savedSchool?.name) {
      return;
    }

    const previousKey = schoolKey(previousName);
    const nextKey = schoolKey(savedSchool.name);
    const nextCategory = savedSchool.category || selectedGradeGroup;
    const nextGrades = mergeGradeLists(getGradesForGroup(nextCategory), savedSchool.grades || []);

    setCustomSchools((current) => [
      ...current.filter((school) => {
        const key = schoolKey(school.name);
        return key !== previousKey && key !== nextKey;
      }),
      {
        ...savedSchool,
        category: nextCategory,
        grades: nextGrades,
      },
    ]);
    setSelectedGradeGroup(nextCategory);
    setSelectedSchoolKey(nextKey);
    if (selectedGrade !== ALL_GRADES && !nextGrades.includes(selectedGrade)) {
      setSelectedGrade(nextGrades[0] || ALL_GRADES);
    }
  };

  const persistSelectedSchool = async (targetSchool) => {
    const existingSchoolRecord = (data.academicSchools || []).find((school) => (
      String(school.id || '') === String(targetSchool.id || '') ||
      schoolKey(school.name) === schoolKey(targetSchool.name)
    ));

    const [savedSchool] = await dataService.upsertAcademicSchools([
      {
        id: targetSchool.id || createId(),
        name: targetSchool.name,
        category: targetSchool.category || selectedGradeGroup,
        color: targetSchool.color || DEFAULT_COLOR,
        textbooks: targetSchool.textbooks || existingSchoolRecord?.textbooks || {},
        sortOrder: targetSchool.sortOrder ?? existingSchoolRecord?.sortOrder ?? schoolCatalog.length,
      },
    ]);

    return {
      ...targetSchool,
      id: savedSchool?.id || '',
      name: savedSchool?.name || targetSchool.name,
      category: savedSchool?.category || targetSchool.category || selectedGradeGroup,
      color: savedSchool?.color || targetSchool.color || DEFAULT_COLOR,
      sortOrder: savedSchool?.sortOrder ?? targetSchool.sortOrder ?? schoolCatalog.length,
    };
  };

  const saveSchoolMetadata = async () => {
    if (!canEdit) {
      toast.info('현재 계정은 학교 정보를 수정할 수 없습니다.');
      return;
    }

    const nextName = text(schoolMetaDraft.name);
    if (!nextName) {
      toast.info('학교 이름을 입력해 주세요.');
      return;
    }

    const duplicateSchool = schoolCatalog.find((school) => (
      schoolKey(school.name) === schoolKey(nextName) &&
      String(school.id || '') !== String(selectedSchool?.id || '')
    ));

    if (duplicateSchool) {
      toast.info('같은 이름의 학교가 이미 있습니다. 기존 학교를 선택해서 사용해 주세요.');
      return;
    }

    setIsSavingSchoolMeta(true);
    try {
      const savedSchool = await persistSelectedSchool({
        ...(selectedSchool || {}),
        ...schoolMetaDraft,
        name: nextName,
        category: schoolMetaDraft.category || selectedGradeGroup,
      });

      syncSchoolLocally(savedSchool, selectedSchool?.name || nextName);
      toast.success('학교 정보를 저장했습니다.');
    } catch (error) {
      toast.error(`학교 정보 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSavingSchoolMeta(false);
    }
  };

  const saveSchoolCurriculum = async ({
    draft = schoolDraft,
    materials = schoolMaterials,
    targetSchool = selectedSchool,
    targetGrade = selectedGrade,
  } = {}) => {
    if (!canEdit) {
      toast.info('현재 계정은 학교 교재 정보를 수정할 수 없습니다.');
      return false;
    }

    if (!targetSchool || targetGrade === ALL_GRADES) {
      toast.info('학교와 학년을 하나씩 선택한 뒤 저장해 주세요.');
      return false;
    }

    setIsSavingSchool(true);
    try {
      const persistedSchool = await persistSelectedSchool(targetSchool);
      if (!persistedSchool.id) {
        throw new Error('학교 정보를 저장할 수 없습니다.');
      }

      const [savedProfile] = await dataService.bulkUpsertAcademicCurriculumProfiles([
        {
          id: draft.id || '',
          academicYear: selectedYear,
          schoolId: persistedSchool.id,
          grade: targetGrade,
          subject: selectedSubject,
          mainTextbookTitle: draft.mainTextbookTitle,
          mainTextbookPublisher: draft.mainTextbookPublisher,
          note: draft.note,
        },
      ]);

      if (!savedProfile?.id) {
        throw new Error('학교 교재 기본 정보를 저장할 수 없습니다.');
      }

      await dataService.replaceAcademicSupplementMaterials(
        savedProfile.id,
        (materials || []).map((item, index) => ({ ...item, sortOrder: index }))
      );

      syncSchoolLocally(persistedSchool, targetSchool?.name || persistedSchool.name);
      toast.success('학교 교재 정보를 저장했습니다.');
      return true;
    } catch (error) {
      toast.error(`학교 교재 정보 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
      return false;
    } finally {
      setIsSavingSchool(false);
    }
  };

  const saveAcademyCurriculum = async () => {
    if (!canEdit) {
      toast.info('현재 계정은 학원 커리큘럼을 수정할 수 없습니다.');
      return;
    }

    setIsSavingAcademy(true);
    try {
      const [savedPlan] = await dataService.bulkUpsertAcademyCurriculumPlans([
        {
          id: academyDraft.id || '',
          academicYear: selectedYear,
          academyGrade: selectedGradeGroup,
          subject: selectedSubject,
          classId: academyDraft.classId || null,
          mainTextbookId: academyDraft.mainTextbookId || null,
          note: academyDraft.note,
          sortOrder: 0,
        },
      ]);

      if (!savedPlan?.id) {
        throw new Error('학원 메인 커리큘럼을 저장할 수 없습니다.');
      }

      await dataService.replaceAcademyCurriculumMaterials(
        savedPlan.id,
        academyMaterials.map((item, index) => ({ ...item, sortOrder: index }))
      );

      toast.success('학원 커리큘럼을 저장했습니다.');
    } catch (error) {
      toast.error(`학원 커리큘럼 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSavingAcademy(false);
    }
  };

  const addSchoolOption = () => {
    const nextName = text(pendingSchoolName);
    if (!nextName) {
      toast.info('추가할 학교 이름을 입력해 주세요.');
      return;
    }

    const nextKey = schoolKey(nextName);
    const existing = schoolCatalog.find((school) => schoolKey(school.name) === nextKey);
    if (existing) {
      setSelectedGradeGroup(existing.category || selectedGradeGroup);
      setSelectedSchoolKey(nextKey);
      setSelectedGrade(getGradesForGroup(existing.category || selectedGradeGroup)[0] || ALL_GRADES);
      setPendingSchoolName('');
      toast.info('이미 등록된 학교입니다. 해당 학교로 바로 이동했습니다.');
      return;
    }

    setCustomSchools((current) => [
      ...current.filter((school) => schoolKey(school.name) !== nextKey),
      {
        id: '',
        name: nextName,
        color: DEFAULT_COLOR,
        category: selectedGradeGroup,
        grades: getGradesForGroup(selectedGradeGroup),
      },
    ]);
    setSelectedSchoolKey(nextKey);
    setSelectedGrade(getGradesForGroup(selectedGradeGroup)[0] || ALL_GRADES);
    setPendingSchoolName('');
  };

  const openSchoolCellEditor = (targetSchool, grade, section) => {
    const nextGroup = targetSchool.category || gradeGroupFromGrade(grade);
    setSelectedGradeGroup(nextGroup);
    setSelectedSchoolKey(schoolKey(targetSchool.name));
    setSelectedGrade(grade);
    setInlineSchoolEditor({
      schoolKey: schoolKey(targetSchool.name),
      grade,
      section,
    });
  };

  const closeSchoolCellEditor = () => {
    setInlineSchoolEditor(null);
  };

  const isInlineCellActive = (targetSchool, grade, section) => (
    inlineSchoolEditor?.schoolKey === schoolKey(targetSchool.name) &&
    inlineSchoolEditor?.grade === grade &&
    inlineSchoolEditor?.section === section
  );

  return (
    <div className="view-container">
      <section className="workspace-surface" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="action-chip" onClick={() => toast.info('교재 템플릿 다운로드는 다음 단계에서 연결할 예정입니다.')}><Download size={16} />템플릿 다운로드</button>
          <button type="button" className="action-chip" onClick={() => toast.info('교재 데이터 업로드는 다음 단계에서 연결할 예정입니다.')}><Upload size={16} />데이터 업로드</button>
        </div>

        <div className="card-custom curriculum-filter-grid">
          <label className="curriculum-filter-field"><span>{"\uD559\uB144\uB3C4"}</span><select className="styled-input" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{yearOptions.map((year) => <option key={year} value={year}>{year}{"\uB144"}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>{"\uACFC\uBAA9"}</span><select className="styled-input" value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>{SUBJECT_OPTIONS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>{"\uD559\uAD50 \uAD6C\uBD84"}</span><select className="styled-input" value={selectedGradeGroup} onChange={(event) => setSelectedGradeGroup(event.target.value)}>{SCHOOL_CATEGORY_OPTIONS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>{"\uD559\uAD50"}</span><select className="styled-input" value={selectedSchoolKey} onChange={(event) => setSelectedSchoolKey(event.target.value)}><option value={ALL_SCHOOLS}>{"\uC804\uCCB4 \uD559\uAD50"}</option>{schoolOptions.map((school) => <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>)}</select></label>
          <label className="curriculum-filter-field"><span>{"\uD559\uB144"}</span><select className="styled-input" value={selectedGrade} onChange={(event) => setSelectedGrade(event.target.value)}><option value={ALL_GRADES}>{"\uC804\uCCB4 \uD559\uB144"}</option>{gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>

          {canEdit ? (
            <div className="curriculum-school-add">
              <div className="curriculum-school-add-copy">
                <strong>학교 직접 추가</strong>
                <span>학생 정보에 없는 학교도 바로 선택해서 학교 교재를 저장할 수 있습니다.</span>
              </div>
              <div className="curriculum-school-add-controls">
                <input className="styled-input" value={pendingSchoolName} placeholder="학교 이름 입력" onChange={(event) => setPendingSchoolName(event.target.value)} />
                <button type="button" className="action-chip" onClick={addSchoolOption}><Plus size={16} />학교 추가</button>
              </div>
            </div>
          ) : null}

          {canEdit && selectedSchool ? (
            <div className="curriculum-school-editor">
              <div className="curriculum-school-add-copy">
                <strong>학교 정보 수정</strong>
                <span>선택한 학교의 이름과 학교 구분을 바로 조정할 수 있습니다.</span>
              </div>
              <div className="curriculum-school-editor-grid">
                <input
                  className="styled-input"
                  value={schoolMetaDraft.name}
                  placeholder="학교 이름"
                  onChange={(event) => setSchoolMetaDraft((current) => ({ ...current, name: event.target.value }))}
                />
                <select
                  className="styled-input"
                  value={schoolMetaDraft.category}
                  onChange={(event) => setSchoolMetaDraft((current) => ({ ...current, category: event.target.value }))}
                >
                  {SCHOOL_CATEGORY_OPTIONS.map((group) => (
                    <option key={group.value} value={group.value}>{group.label}</option>
                  ))}
                </select>
                <button type="button" className="action-chip" onClick={saveSchoolMetadata} disabled={isSavingSchoolMeta}>
                  <Save size={16} />
                  {isSavingSchoolMeta ? '\uC800\uC7A5 \uC911...' : '\uD559\uAD50 \uC815\uBCF4 \uC800\uC7A5'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="curriculum-edit-grid">
          <section className="card-custom curriculum-section">
            <div className="curriculum-section-header">
              <div><h3>학교 교재</h3><p>필터 바로 아래에서 학교 교과서와 보충교재를 바로 입력하고 저장합니다.</p></div>
              <button type="button" className="action-pill" onClick={() => saveSchoolCurriculum()} disabled={isSavingSchool || !selectedSchool || selectedGrade === ALL_GRADES}><Save size={16} />{isSavingSchool ? '\uC800\uC7A5 \uC911...' : '\uD559\uAD50 \uAD50\uC7AC \uC800\uC7A5'}</button>
            </div>
            {!selectedSchool || selectedGrade === ALL_GRADES ? <StatusBanner variant="info" title="학교 교재 저장 대상 선택" message="학교와 학년을 하나씩 선택하면 학교 교재를 바로 저장할 수 있습니다." /> : null}
            <div className="curriculum-form-grid">
              <input className="styled-input" value={schoolDraft.mainTextbookTitle} placeholder="교과서명" onChange={(event) => setSchoolDraft((current) => ({ ...current, mainTextbookTitle: event.target.value }))} />
              <input className="styled-input" value={schoolDraft.mainTextbookPublisher} placeholder={"\uAD50\uACFC\uC11C \uCD9C\uD310\uC0AC"} onChange={(event) => setSchoolDraft((current) => ({ ...current, mainTextbookPublisher: event.target.value }))} />
              <textarea className="styled-input" value={schoolDraft.note} placeholder="학교 기준 메모" onChange={(event) => setSchoolDraft((current) => ({ ...current, note: event.target.value }))} style={{ minHeight: 96, resize: 'vertical', gridColumn: '1 / -1' }} />
            </div>
            <MaterialEditor items={schoolMaterials} onChange={setSchoolMaterials} addLabel="학교 보충교재 추가" />
          </section>

          <section className="card-custom curriculum-section">
            <div className="curriculum-section-header">
              <div><h3>학원 커리큘럼</h3><p>선택한 학년도·과목·학교 구분 기준으로 메인 교재와 보조 교재를 정리합니다.</p></div>
              <button type="button" className="action-pill" onClick={saveAcademyCurriculum} disabled={isSavingAcademy}><Save size={16} />{isSavingAcademy ? '\uC800\uC7A5 \uC911...' : '\uD559\uC6D0 \uCEE4\uB9AC\uD058\uB7FC \uC800\uC7A5'}</button>
            </div>
            <div className="curriculum-form-grid">
              <label className="curriculum-filter-field"><span>{"\uC5F0\uACB0 \uBC18"}</span><select className="styled-input" value={academyDraft.classId} onChange={(event) => setAcademyDraft((current) => ({ ...current, classId: event.target.value }))}><option value="">{"\uBC18 \uBBF8\uC5F0\uACB0"}</option>{classOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label className="curriculum-filter-field"><span>{"\uBA54\uC778 \uAD50\uC7AC"}</span><select className="styled-input" value={academyDraft.mainTextbookId} onChange={(event) => setAcademyDraft((current) => ({ ...current, mainTextbookId: event.target.value }))}><option value="">{"\uC120\uD0DD \uC548 \uD568"}</option>{textbookOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <textarea className="styled-input" value={academyDraft.note} placeholder="학원 운영 메모" onChange={(event) => setAcademyDraft((current) => ({ ...current, note: event.target.value }))} style={{ minHeight: 96, resize: 'vertical', gridColumn: '1 / -1' }} />
            </div>
            <MaterialEditor items={academyMaterials} onChange={setAcademyMaterials} addLabel="학원 보조 교재 추가" />
          </section>
        </div>

        <section className="card-custom curriculum-section">
          <div className="curriculum-section-header"><div><h3>학교 기준 / 학원 기준 비교</h3><p>같은 연도·과목·학교 구분 기준으로 두 기준을 나란히 비교합니다.</p></div></div>
          <div className="curriculum-compare-grid">
            <div className="card-custom curriculum-compare-card"><div className="curriculum-compare-card-title">학교 기준</div>{comparisonRows.school.length ? comparisonRows.school.map((row, index) => <div key={`${row.label}-${index}`} className="curriculum-compare-row"><span>{row.label}</span><strong>{row.value}</strong></div>) : <div className="curriculum-compare-empty">아직 등록된 학교 교재가 없습니다.</div>}</div>
            <div className="card-custom curriculum-compare-card"><div className="curriculum-compare-card-title">학원 기준</div>{comparisonRows.academy.length ? comparisonRows.academy.map((row, index) => <div key={`${row.label}-${index}`} className="curriculum-compare-row"><span>{row.label}</span><strong>{row.value}</strong></div>) : <div className="curriculum-compare-empty">아직 등록된 학원 커리큘럼이 없습니다.</div>}</div>
          </div>
        </section>

        <section className="card-custom curriculum-section">
          <div className="curriculum-section-header">
            <div><h3>{"\uD559\uAD50 \uAD50\uC7AC\uD45C"}</h3><p>{"\uBE48 \uCE78\uC5D0\uC11C\uB3C4 \uBC14\uB85C \uC785\uB825\uD558\uACE0, \uC544\uB798 \uBC84\uD2BC\uC73C\uB85C \uCD9C\uB825 \uD615\uC2DD\uAE4C\uC9C0 \uC774\uC5B4\uC11C \uCC98\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}</p></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="action-chip" onClick={exportReportImage}><ImageDown size={16} />{"\uC774\uBBF8\uC9C0 \uC800\uC7A5"}</button><button type="button" className="action-pill" onClick={printReport}><Printer size={16} />{"A4 \uC778\uC1C4 / PDF \uC800\uC7A5"}</button></div>
          </div>
          <div className="curriculum-report-scroll">
            <div ref={reportRef} className="curriculum-report-sheet">
              <div className="curriculum-report-header">
                <div className="curriculum-report-eyebrow">{"\uD559\uAD50 \uAE30\uC900 1\uB144 \uAD50\uC7AC\uD45C"}</div>
                <h3>{selectedYear}년 {selectedSubject} 학교 교재 현황</h3>
                <p>{SCHOOL_CATEGORY_OPTIONS.find((group) => group.value === selectedGradeGroup)?.label} · {selectedSchool ? selectedSchool.name : '전체 학교'} · {selectedGrade === ALL_GRADES ? '전체 학년' : selectedGrade}</p>
              </div>
              <table className="curriculum-report-table">
                <thead><tr><th className="curriculum-report-school-col">학교</th><th className="curriculum-report-type-col">구분</th>{reportGrades.map((grade) => <th key={grade}>{grade}</th>)}</tr></thead>
                <tbody>
                  {reportRows.length === 0 ? <tr><td colSpan={reportGrades.length + 2} className="curriculum-report-empty-cell">현재 필터 기준으로 표시할 학교 교재 정보가 없습니다.</td></tr> : reportTableRows.map((rowBlock) => (
                    <tr key={rowBlock.key}>
                      {rowBlock.rowSpan ? <td rowSpan={rowBlock.rowSpan} className="curriculum-report-school-name">{rowBlock.row.school.name}</td> : null}
                      <td className="curriculum-report-row-label">{rowBlock.label}</td>
                      {rowBlock.row.cells.map((cell) => {
                        const isMainCell = rowBlock.section === 'main';
                        const isActive = isInlineCellActive(rowBlock.row.school, cell.grade, rowBlock.section);
                        const cellLines = isMainCell ? [cell.main] : cell.supplements;

                        return (
                          <td key={`${rowBlock.row.school.name}-${cell.grade}-${rowBlock.section}`} className={`curriculum-report-editable-cell ${isActive ? 'is-active' : ''}`}>
                            <button type="button" className="curriculum-report-cell-button" onClick={() => openSchoolCellEditor(rowBlock.row.school, cell.grade, rowBlock.section)}>
                              <div className="curriculum-report-cell-lines">
                                {cellLines.length > 0 && cellLines.some(Boolean) ? cellLines.map((line, index) => <span key={`${rowBlock.key}-${cell.grade}-${index}`}>{line}</span>) : <span className="curriculum-report-empty">-</span>}
                              </div>
                              {canEdit ? <span className="curriculum-report-cell-hint">{cellLines.length > 0 && cellLines.some(Boolean) ? '셀에서 수정' : '여기에 입력'}</span> : null}
                            </button>

                            {canEdit && isActive ? (
                              <div className="curriculum-report-inline-editor">
                                {isMainCell ? (
                                  <>
                                    <input className="styled-input" value={schoolDraft.mainTextbookTitle} placeholder="교과서명" onChange={(event) => setSchoolDraft((current) => ({ ...current, mainTextbookTitle: event.target.value }))} />
                                    <input className="styled-input" value={schoolDraft.mainTextbookPublisher} placeholder={"\uCD9C\uD310\uC0AC"} onChange={(event) => setSchoolDraft((current) => ({ ...current, mainTextbookPublisher: event.target.value }))} />
                                  </>
                                ) : (
                                   <textarea className="styled-input" value={inlineSupplementText} placeholder={"\uD55C \uC904\uC5D0 \uD55C \uAD50\uC7AC\uC529 \uC785\uB825\uD558\uC138\uC694. \uAD50\uC7AC\uBA85 | \uCD9C\uD310\uC0AC"} onChange={(event) => setInlineSupplementText(event.target.value)} style={{ minHeight: 110, resize: 'vertical' }} />
                                )}
                                <div className="curriculum-inline-actions">
                                  <button type="button" className="action-chip" onClick={closeSchoolCellEditor}>닫기</button>
                                  <button type="button" className="action-pill" onClick={async () => { const saved = await saveSchoolCurriculum({ materials: isMainCell ? schoolMaterials : parseSupplementEditorText(inlineSupplementText) }); if (saved) closeSchoolCellEditor(); }} disabled={isSavingSchool}><Save size={14} />{isSavingSchool ? '\uC800\uC7A5 \uC911...' : '\uBC14\uB85C \uC800\uC7A5'}</button>
                                </div>
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}


