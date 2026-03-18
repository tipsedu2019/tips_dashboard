import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Printer, Save, Trash2, X } from 'lucide-react';
import ConfirmDialog from './ui/ConfirmDialog';
import StatusBanner from './ui/StatusBanner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';
import { dataService as sharedDataService } from '../services/dataService';

const DEFAULT_SUBJECT_OPTIONS = ['영어', '수학'];
const GRADE_ORDER = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const SCHOOL_CATEGORY_OPTIONS = [
  { value: 'all', label: '전체 구분' },
  { value: 'elementary', label: '초등' },
  { value: 'middle', label: '중등' },
  { value: 'high', label: '고등' },
];
const FIXED_PERIODS = [
  { code: 'S1_MID', label: '1학기 중간', sortOrder: 1, periodType: 'fixed' },
  { code: 'S1_FINAL', label: '1학기 기말', sortOrder: 2, periodType: 'fixed' },
  { code: 'S2_MID', label: '2학기 중간', sortOrder: 3, periodType: 'fixed' },
  { code: 'S2_FINAL', label: '2학기 기말', sortOrder: 4, periodType: 'fixed' },
];
const MATERIAL_SECTIONS = [
  { key: 'textbook', label: '교과서' },
  { key: 'supplement', label: '부교재' },
  { key: 'other', label: '기타' },
];

const ALL_SCHOOLS = 'all-schools';
const ALL_GRADES = 'all-grades';
const ALL_PERIODS = 'all-periods';
const ALL_ACADEMY_GRADES = 'all-academy-grades';
const ALL_CLASSES = 'all-classes';

function createId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function text(value) {
  return String(value || '').trim();
}

function schoolKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function gradeSort(value) {
  const index = GRADE_ORDER.indexOf(text(value));
  return index < 0 ? GRADE_ORDER.length + 99 : index;
}

function normalizeSchoolCategory(category, fallback = 'high') {
  return SCHOOL_CATEGORY_OPTIONS.some((option) => option.value === category) ? category : fallback;
}

function inferSchoolCategoryFromName(name) {
  const normalized = text(name);
  if (!normalized) return 'high';
  if (/(?:초등학교|초[1-6]|초$)/u.test(normalized)) return 'elementary';
  if (/(?:중학교|중[1-3]|중$)/u.test(normalized)) return 'middle';
  return 'high';
}

function gradeGroupFromGrade(grade) {
  const normalized = text(grade);
  if (normalized.startsWith('초')) return 'elementary';
  if (normalized.startsWith('중')) return 'middle';
  return 'high';
}

function getGradesForGroup(group) {
  if (group === 'elementary') return GRADE_ORDER.filter((grade) => grade.startsWith('초'));
  if (group === 'middle') return GRADE_ORDER.filter((grade) => grade.startsWith('중'));
  return GRADE_ORDER.filter((grade) => grade.startsWith('고'));
}

function mergeGradeLists(...collections) {
  return [...new Set(collections.flat().map((value) => text(value)).filter(Boolean))]
    .sort((left, right) => gradeSort(left) - gradeSort(right) || left.localeCompare(right, 'ko'));
}

function normalizeAcademyGradeLabel(value) {
  const normalized = text(value);
  if (normalized === 'elementary') return '초등';
  if (normalized === 'middle') return '중등';
  if (normalized === 'high') return '고등';
  return normalized;
}

function buildSubjectOptions(data = {}) {
  const values = new Set(DEFAULT_SUBJECT_OPTIONS);
  [
    ...(data.classes || []),
    ...(data.academicCurriculumProfiles || []),
    ...(data.academicExamMaterialPlans || []),
    ...(data.academyCurriculumPlans || []),
    ...(data.academyCurriculumPeriodPlans || []),
    ...(data.academyCurriculumPeriodCatalogs || []),
  ].forEach((row) => {
    const subject = text(row?.subject);
    if (subject) values.add(subject);
  });
  return [...values];
}

function buildYearOptions(data = {}) {
  const values = new Set([new Date().getFullYear()]);
  [
    ...(data.academicExamMaterialPlans || []),
    ...(data.academyCurriculumPeriodPlans || []),
    ...(data.academyCurriculumPeriodCatalogs || []),
    ...(data.academicCurriculumProfiles || []),
    ...(data.academyCurriculumPlans || []),
    ...(data.classTerms || []),
  ].forEach((row) => {
    const year = Number(row?.academicYear || row?.academic_year || 0);
    if (year) values.add(year);
  });
  return [...values].sort((left, right) => right - left);
}

function buildSchoolCatalog(students = [], academicSchools = []) {
  const buckets = new Map();

  const ensureSchool = (input = {}) => {
    const name = text(input.name);
    if (!name) return null;
    const key = schoolKey(name);
    const explicitCategory = text(input.category);
    const nextCategory = normalizeSchoolCategory(
      explicitCategory || gradeGroupFromGrade(input.grade),
      inferSchoolCategoryFromName(name)
    );

    if (!buckets.has(key)) {
      buckets.set(key, {
        id: input.id || '',
        name,
        color: input.color || '#216e4e',
        category: nextCategory,
        grades: new Set(),
      });
    }

    const target = buckets.get(key);
    target.id = input.id || target.id || '';
    target.name = name;
    target.color = input.color || target.color || '#216e4e';
    target.category = explicitCategory
      ? normalizeSchoolCategory(explicitCategory, target.category || nextCategory)
      : target.category || nextCategory;
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

  (students || []).forEach((student) => {
    ensureSchool({
      name: student.school,
      grade: student.grade,
    });
  });

  return [...buckets.values()]
    .map((school) => ({
      ...school,
      category: normalizeSchoolCategory(school.category, inferSchoolCategoryFromName(school.name)),
      grades: mergeGradeLists(
        getGradesForGroup(normalizeSchoolCategory(school.category, inferSchoolCategoryFromName(school.name))),
        [...school.grades]
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function buildEditorAnchor(rect) {
  const width = Math.min(480, Math.max(360, rect.width + 64));
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 960;
  let left = rect.left;
  let top = rect.bottom + 12;
  if (left + width > viewportWidth - 24) {
    left = Math.max(24, viewportWidth - width - 24);
  }
  if (top + 520 > viewportHeight - 24) {
    top = Math.max(24, rect.top - 520 - 12);
  }
  return { left, top, width };
}

function createEmptyMaterial(category) {
  return {
    id: createId(),
    materialCategory: category,
    title: '',
    publisher: '',
    detail: '',
    note: '',
  };
}

function buildDraftRows(items = [], detailField) {
  const grouped = {
    textbook: [],
    supplement: [],
    other: [],
  };

  (items || []).forEach((item) => {
    const category = MATERIAL_SECTIONS.some((section) => section.key === item.materialCategory)
      ? item.materialCategory
      : 'other';
    grouped[category].push({
      id: item.id || createId(),
      materialCategory: category,
      title: text(item.title),
      publisher: text(item.publisher),
      detail: text(item[detailField]),
      note: text(item.note),
      textbookId: text(item.textbookId),
    });
  });

  MATERIAL_SECTIONS.forEach((section) => {
    if (grouped[section.key].length === 0) {
      grouped[section.key] = [createEmptyMaterial(section.key)];
    }
  });

  return grouped;
}

function flattenDraftRows(rowsByCategory = {}) {
  return MATERIAL_SECTIONS.flatMap((section) =>
    (rowsByCategory[section.key] || []).map((item, index) => ({
      id: item.id || createId(),
      materialCategory: section.key,
      textbookId: text(item.textbookId),
      title: text(item.title),
      publisher: text(item.publisher),
      detail: text(item.detail),
      note: text(item.note),
      sortOrder: index,
    }))
  ).filter((item) => item.title || item.publisher || item.detail || item.note);
}

function groupItemsByCategory(items = [], detailField) {
  const buckets = {
    textbook: [],
    supplement: [],
    other: [],
  };

  (items || []).forEach((item) => {
    const key = MATERIAL_SECTIONS.some((section) => section.key === item.materialCategory)
      ? item.materialCategory
      : 'other';
    buckets[key].push({
      ...item,
      detail: text(item[detailField]),
    });
  });

  return buckets;
}

function formatItemLabel(item) {
  const parts = [text(item.title), text(item.publisher)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '입력 없음';
}

function buildPrintHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #162338; font-family: "Noto Sans KR", "Apple SD Gothic Neo", sans-serif; }
      .roadmap-print-wrap { padding: 16px; }
      .roadmap-print-wrap h1 { margin: 0 0 12px; font-size: 20px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #cfd8e6; vertical-align: top; padding: 8px; }
      th { background: #eef4fb; font-size: 12px; text-align: left; }
      td { font-size: 11px; }
      .roadmap-cell-stack { display: flex; flex-direction: column; gap: 8px; }
      .roadmap-cell-block { border: 1px solid #d8e2ef; border-radius: 10px; padding: 6px 8px; background: #fff; }
      .roadmap-cell-block-label { display: block; margin-bottom: 4px; color: #4b5a73; font-size: 10px; font-weight: 700; }
      .roadmap-cell-line { margin: 0; }
      .roadmap-cell-line + .roadmap-cell-line { margin-top: 4px; }
      .roadmap-cell-detail { color: #4f5e75; white-space: pre-wrap; }
      .roadmap-print-empty { color: #7a879b; }
    </style>
  </head>
  <body>
    <div class="roadmap-print-wrap">
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

function MaterialRowsEditor({ rows = [], detailLabel, titleSuggestions = [], onChangeRow, onAddRow, onRemoveRow }) {
  return (
    <div className="roadmap-editor-section-rows">
      {rows.map((row, index) => (
        <div key={row.id} className="roadmap-editor-row">
          <input
            className="styled-input"
            list="roadmap-textbook-suggestions"
            value={row.title}
            onChange={(event) => onChangeRow(index, { title: event.target.value })}
            placeholder="교재명"
          />
          <input
            className="styled-input"
            value={row.publisher}
            onChange={(event) => onChangeRow(index, { publisher: event.target.value })}
            placeholder="출판사"
          />
          <textarea
            className="styled-input"
            value={row.detail}
            onChange={(event) => onChangeRow(index, { detail: event.target.value })}
            placeholder={detailLabel}
            style={{ minHeight: 74, resize: 'vertical' }}
          />
          <input
            className="styled-input"
            value={row.note}
            onChange={(event) => onChangeRow(index, { note: event.target.value })}
            placeholder="메모"
          />
          <button type="button" className="action-chip roadmap-editor-remove" onClick={() => onRemoveRow(index)} aria-label="행 삭제">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="action-chip roadmap-editor-add" onClick={onAddRow}>
        <Plus size={14} />
        줄 추가
      </button>
      <datalist id="roadmap-textbook-suggestions">
        {titleSuggestions.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
    </div>
  );
}

function RoadmapCellEditor({
  activeEditor,
  editorDraft,
  textbookSuggestions,
  isSaving,
  onClose,
  onChangeNote,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  onSave,
}) {
  if (!activeEditor || !editorDraft) {
    return null;
  }

  return (
    <div
      className="roadmap-cell-editor"
      style={{
        position: 'fixed',
        left: activeEditor.anchor.left,
        top: activeEditor.anchor.top,
        width: activeEditor.anchor.width,
      }}
    >
      <div className="roadmap-cell-editor-head">
        <div>
          <div className="roadmap-cell-editor-eyebrow">{activeEditor.eyebrow}</div>
          <h3>{activeEditor.title}</h3>
          <p>{activeEditor.subtitle}</p>
        </div>
        <button type="button" className="academic-icon-button" onClick={onClose} aria-label="닫기">
          <X size={16} />
        </button>
      </div>

      <div className="roadmap-cell-editor-body">
        {MATERIAL_SECTIONS.map((section) => (
          <section key={section.key} className="roadmap-editor-section">
            <div className="roadmap-editor-section-title">{section.label}</div>
            <MaterialRowsEditor
              rows={editorDraft.rowsByCategory[section.key]}
              detailLabel={activeEditor.detailLabel}
              titleSuggestions={textbookSuggestions}
              onChangeRow={(rowIndex, patch) => onChangeRow(section.key, rowIndex, patch)}
              onAddRow={() => onAddRow(section.key)}
              onRemoveRow={(rowIndex) => onRemoveRow(section.key, rowIndex)}
            />
          </section>
        ))}

        <label className="academic-field roadmap-editor-note">
          <span>{activeEditor.noteLabel}</span>
          <textarea
            className="styled-input"
            value={editorDraft.note}
            onChange={(event) => onChangeNote(event.target.value)}
            placeholder="추가 메모가 있으면 적어 주세요."
            style={{ minHeight: 88, resize: 'vertical' }}
          />
        </label>
      </div>

      <div className="roadmap-cell-editor-actions">
        <button type="button" className="action-chip" onClick={onClose}>
          취소
        </button>
        <button type="button" className="action-pill" onClick={onSave} disabled={isSaving}>
          <Save size={16} />
          {isSaving ? '저장 중...' : '셀 저장'}
        </button>
      </div>
    </div>
  );
}

function RoadmapCell({ cell, onClick }) {
  const blocks = MATERIAL_SECTIONS.map((section) => ({
    ...section,
    items: cell.itemsByCategory[section.key] || [],
  })).filter((section) => section.items.length > 0);

  return (
    <button type="button" className="roadmap-cell-button" onClick={onClick}>
      <div className="roadmap-cell-stack">
        {blocks.length === 0 ? (
          <div className="roadmap-cell-empty">클릭해서 입력</div>
        ) : (
          blocks.map((section) => (
            <div key={section.key} className="roadmap-cell-block">
              <span className="roadmap-cell-block-label">{section.label}</span>
              {section.items.map((item) => (
                <div key={item.id} className="roadmap-cell-line">
                  <strong>{formatItemLabel(item)}</strong>
                  {text(item.detail) ? <div className="roadmap-cell-detail">{item.detail}</div> : null}
                </div>
              ))}
            </div>
          ))
        )}
        {text(cell.note) ? <div className="roadmap-cell-note">{cell.note}</div> : null}
      </div>
    </button>
  );
}

export default function CurriculumRoadmapView({
  data = {},
  dataService = sharedDataService,
  navigationIntent = null,
}) {
  const toast = useToast();
  const { isStaff, isTeacher } = useAuth();
  const { confirm, dialogProps } = useConfirmDialog();
  const canEdit = isStaff || isTeacher;
  const reportRef = useRef(null);
  const editorRef = useRef(null);
  const migrationAttemptedRef = useRef(false);

  const yearOptions = useMemo(() => buildYearOptions(data), [data]);
  const subjectOptions = useMemo(() => buildSubjectOptions(data), [data]);
  const schoolCatalog = useMemo(
    () => buildSchoolCatalog(data.students || [], data.academicSchools || []),
    [data.students, data.academicSchools]
  );

  const [activeTab, setActiveTab] = useState('school');
  const [selectedYear, setSelectedYear] = useState(yearOptions[0] || new Date().getFullYear());
  const [selectedSubject, setSelectedSubject] = useState(subjectOptions[0] || DEFAULT_SUBJECT_OPTIONS[0]);
  const [selectedSchoolCategory, setSelectedSchoolCategory] = useState('all');
  const [selectedSchoolKey, setSelectedSchoolKey] = useState(ALL_SCHOOLS);
  const [selectedSchoolGrade, setSelectedSchoolGrade] = useState(ALL_GRADES);
  const [selectedSchoolPeriod, setSelectedSchoolPeriod] = useState(ALL_PERIODS);
  const [selectedAcademyGrade, setSelectedAcademyGrade] = useState(ALL_ACADEMY_GRADES);
  const [selectedAcademyClass, setSelectedAcademyClass] = useState(ALL_CLASSES);
  const [selectedAcademyPeriod, setSelectedAcademyPeriod] = useState(ALL_PERIODS);
  const [academyScopeMode, setAcademyScopeMode] = useState('priority');
  const [customPeriodLabel, setCustomPeriodLabel] = useState('');
  const [roadmapSupport, setRoadmapSupport] = useState({ ready: true, missingTables: [] });
  const [isCheckingSupport, setIsCheckingSupport] = useState(true);
  const [activeEditor, setActiveEditor] = useState(null);
  const [editorDraft, setEditorDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsCheckingSupport(true);
    dataService.getCurriculumRoadmapSupport()
      .then((support) => {
        if (!cancelled) {
          setRoadmapSupport(support);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRoadmapSupport({
            ready: false,
            missingTables: ['교재·진도 테이블 확인 실패'],
            error,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingSupport(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataService]);

  useEffect(() => {
    if (!roadmapSupport.ready || migrationAttemptedRef.current) {
      return;
    }

    migrationAttemptedRef.current = true;
    dataService.migrateLegacyCurriculumRoadmap(data)
      .then((result) => {
        if (result?.migrated) {
          toast.success('기존 교재 정보를 시기별 교재·진도 표로 옮겼습니다.');
        }
      })
      .catch((error) => {
        toast.error(`기존 교재 데이터 이관에 실패했습니다: ${getUserFriendlyDataError(error)}`);
      });
  }, [data, dataService, roadmapSupport.ready, toast]);

  useEffect(() => {
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0] || new Date().getFullYear());
    }
  }, [selectedYear, yearOptions]);

  useEffect(() => {
    if (!subjectOptions.includes(selectedSubject)) {
      setSelectedSubject(subjectOptions[0] || DEFAULT_SUBJECT_OPTIONS[0]);
    }
  }, [selectedSubject, subjectOptions]);

  useEffect(() => {
    if (selectedSchoolKey !== ALL_SCHOOLS && !schoolOptions.some((school) => schoolKey(school.name) === selectedSchoolKey)) {
      setSelectedSchoolKey(ALL_SCHOOLS);
    }
  }, [schoolOptions, selectedSchoolKey]);

  useEffect(() => {
    if (selectedSchoolGrade !== ALL_GRADES && !schoolGradeOptions.includes(selectedSchoolGrade)) {
      setSelectedSchoolGrade(ALL_GRADES);
    }
  }, [schoolGradeOptions, selectedSchoolGrade]);

  useEffect(() => {
    if (selectedAcademyGrade !== ALL_ACADEMY_GRADES && !academyGradeOptions.includes(selectedAcademyGrade)) {
      setSelectedAcademyGrade(ALL_ACADEMY_GRADES);
    }
  }, [academyGradeOptions, selectedAcademyGrade]);

  useEffect(() => {
    if (selectedAcademyClass !== ALL_CLASSES && !academyClassOptions.some((item) => item.id === selectedAcademyClass)) {
      setSelectedAcademyClass(ALL_CLASSES);
    }
  }, [academyClassOptions, selectedAcademyClass]);

  useEffect(() => {
    if (!navigationIntent) {
      return;
    }

    if (navigationIntent.tab) {
      setActiveTab(navigationIntent.tab);
    }
    if (navigationIntent.academicYear) {
      setSelectedYear(Number(navigationIntent.academicYear));
    }
    if (navigationIntent.subject) {
      setSelectedSubject(navigationIntent.subject);
    }
    if (navigationIntent.schoolCategory) {
      setSelectedSchoolCategory(navigationIntent.schoolCategory);
    }
    if (navigationIntent.schoolKey) {
      setSelectedSchoolKey(navigationIntent.schoolKey);
    } else if (navigationIntent.schoolId) {
      const matchedSchool = schoolCatalog.find((school) => school.id === navigationIntent.schoolId);
      if (matchedSchool) {
        setSelectedSchoolKey(schoolKey(matchedSchool.name));
      }
    } else if (navigationIntent.schoolName) {
      setSelectedSchoolKey(schoolKey(navigationIntent.schoolName));
    }
    if (navigationIntent.grade) {
      setSelectedSchoolGrade(navigationIntent.grade);
      setSelectedAcademyGrade(navigationIntent.grade);
    }
    if (navigationIntent.periodCode) {
      setSelectedSchoolPeriod(navigationIntent.periodCode);
      setSelectedAcademyPeriod(navigationIntent.periodCode);
    }
    if (navigationIntent.classId) {
      setSelectedAcademyClass(navigationIntent.classId);
    }
  }, [navigationIntent, schoolCatalog]);

  const textbookSuggestions = useMemo(
    () => [...new Set((data.textbooks || []).map((item) => text(item.title)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ko')),
    [data.textbooks]
  );

  const schoolOptions = useMemo(() => (
    schoolCatalog.filter((school) => selectedSchoolCategory === 'all' || school.category === selectedSchoolCategory)
  ), [schoolCatalog, selectedSchoolCategory]);

  const selectedSchool = useMemo(
    () => schoolOptions.find((school) => schoolKey(school.name) === selectedSchoolKey) || null,
    [schoolOptions, selectedSchoolKey]
  );

  const schoolGradeOptions = useMemo(() => {
    if (selectedSchool) {
      return selectedSchool.grades;
    }
    if (selectedSchoolCategory === 'all') {
      return GRADE_ORDER;
    }
    return getGradesForGroup(selectedSchoolCategory);
  }, [selectedSchool, selectedSchoolCategory]);

  const schoolPeriodOptions = useMemo(() => {
    if (selectedSchoolPeriod === ALL_PERIODS) {
      return FIXED_PERIODS;
    }
    return FIXED_PERIODS.filter((period) => period.code === selectedSchoolPeriod);
  }, [selectedSchoolPeriod]);

  const schoolRows = useMemo(() => {
    const rows = [];
    const baseSchools = selectedSchool ? [selectedSchool] : schoolOptions;
    baseSchools.forEach((school) => {
      const grades = selectedSchoolGrade === ALL_GRADES
        ? (school.grades.length > 0 ? school.grades : getGradesForGroup(school.category))
        : [selectedSchoolGrade];
      grades.forEach((grade) => {
        if (text(grade)) {
          rows.push({
            id: `${school.id || schoolKey(school.name)}::${grade}`,
            school,
            grade,
          });
        }
      });
    });
    return rows;
  }, [schoolOptions, selectedSchool, selectedSchoolGrade]);

  const schoolPlans = useMemo(() => (
    (data.academicExamMaterialPlans || []).filter(
      (plan) => Number(plan.academicYear) === Number(selectedYear) && text(plan.subject) === selectedSubject
    )
  ), [data.academicExamMaterialPlans, selectedSubject, selectedYear]);

  const schoolPlanByKey = useMemo(() => {
    const map = new Map();
    schoolPlans.forEach((plan) => {
      map.set(`${plan.schoolId}::${plan.grade}::${plan.examPeriodCode}`, plan);
    });
    return map;
  }, [schoolPlans]);

  const schoolItemsByPlanId = useMemo(() => {
    const map = new Map();
    (data.academicExamMaterialItems || []).forEach((item) => {
      if (!map.has(item.planId)) {
        map.set(item.planId, []);
      }
      map.get(item.planId).push(item);
    });
    map.forEach((items) => items.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)));
    return map;
  }, [data.academicExamMaterialItems]);

  const academyGradeOptions = useMemo(() => mergeGradeLists(
    (data.classes || []).map((item) => text(item.grade)),
    (data.academyCurriculumPeriodPlans || []).map((item) => item.academyGrade),
    (data.academyCurriculumPeriodCatalogs || []).map((item) => item.academyGrade),
    (data.academyCurriculumPlans || []).map((item) => normalizeAcademyGradeLabel(item.academyGrade))
  ), [data.classes, data.academyCurriculumPeriodPlans, data.academyCurriculumPeriodCatalogs, data.academyCurriculumPlans]);

  const academyClassOptions = useMemo(() => (
    (data.classes || [])
      .filter((item) => text(item.subject) === selectedSubject)
      .filter((item) => selectedAcademyGrade === ALL_ACADEMY_GRADES || text(item.grade) === selectedAcademyGrade)
      .map((item) => ({
        id: item.id,
        label: item.className || item.name || '이름 없는 수업',
        grade: text(item.grade),
      }))
      .sort((left, right) => gradeSort(left.grade) - gradeSort(right.grade) || left.label.localeCompare(right.label, 'ko'))
  ), [data.classes, selectedAcademyGrade, selectedSubject]);

  const academyCatalogs = useMemo(() => (
    (data.academyCurriculumPeriodCatalogs || []).filter(
      (item) =>
        Number(item.academicYear) === Number(selectedYear) &&
        text(item.subject) === selectedSubject &&
        (selectedAcademyGrade === ALL_ACADEMY_GRADES || item.academyGrade === selectedAcademyGrade)
    )
  ), [data.academyCurriculumPeriodCatalogs, selectedAcademyGrade, selectedSubject, selectedYear]);

  const academyPlans = useMemo(() => (
    (data.academyCurriculumPeriodPlans || []).filter(
      (item) =>
        Number(item.academicYear) === Number(selectedYear) &&
        text(item.subject) === selectedSubject &&
        (selectedAcademyGrade === ALL_ACADEMY_GRADES || item.academyGrade === selectedAcademyGrade)
    )
  ), [data.academyCurriculumPeriodPlans, selectedAcademyGrade, selectedSubject, selectedYear]);

  const academyPlanByKey = useMemo(() => {
    const map = new Map();
    academyPlans.forEach((plan) => {
      map.set(`${plan.academyGrade}::${plan.scopeType}::${plan.classId || ''}::${plan.periodCode}`, plan);
    });
    return map;
  }, [academyPlans]);

  const academyItemsByPlanId = useMemo(() => {
    const map = new Map();
    (data.academyCurriculumPeriodItems || []).forEach((item) => {
      if (!map.has(item.planId)) {
        map.set(item.planId, []);
      }
      map.get(item.planId).push(item);
    });
    map.forEach((items) => items.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)));
    return map;
  }, [data.academyCurriculumPeriodItems]);

  const academyPeriodOptions = useMemo(() => {
    const customMap = new Map();
    academyCatalogs.forEach((catalog) => {
      customMap.set(catalog.periodCode, {
        code: catalog.periodCode,
        label: catalog.periodLabel,
        sortOrder: 100 + (catalog.sortOrder ?? 0),
        periodType: 'custom',
        catalogId: catalog.id,
      });
    });
    academyPlans.filter((plan) => plan.periodType === 'custom').forEach((plan) => {
      if (!customMap.has(plan.periodCode)) {
        customMap.set(plan.periodCode, {
          code: plan.periodCode,
          label: plan.periodLabel,
          sortOrder: 100 + (plan.sortOrder ?? 0),
          periodType: 'custom',
          catalogId: plan.catalogId || '',
        });
      }
    });

    const merged = [
      ...FIXED_PERIODS,
      ...[...customMap.values()].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.label.localeCompare(right.label, 'ko')),
    ];
    if (selectedAcademyPeriod === ALL_PERIODS) {
      return merged;
    }
    return merged.filter((period) => period.code === selectedAcademyPeriod);
  }, [academyCatalogs, academyPlans, selectedAcademyPeriod]);

  const academyRows = useMemo(() => {
    if (selectedAcademyClass !== ALL_CLASSES) {
      const matchedClass = academyClassOptions.find((item) => item.id === selectedAcademyClass);
      return matchedClass ? [{
        id: `class::${matchedClass.id}`,
        label: matchedClass.label,
        academyGrade: matchedClass.grade,
        scopeType: 'class',
        classId: matchedClass.id,
      }] : [];
    }

    if (academyScopeMode === 'template') {
      const grades = selectedAcademyGrade === ALL_ACADEMY_GRADES ? academyGradeOptions : [selectedAcademyGrade];
      return grades.filter(Boolean).map((grade) => ({
        id: `template::${grade}`,
        label: `${grade} 기본 운영안`,
        academyGrade: grade,
        scopeType: 'template',
        classId: '',
      }));
    }

    const classRows = academyClassOptions.map((item) => ({
      id: `class::${item.id}`,
      label: item.label,
      academyGrade: item.grade,
      scopeType: 'class',
      classId: item.id,
    }));

    if (academyScopeMode === 'class') {
      return classRows;
    }

    const templateGrades = new Set(
      academyPlans
        .filter((plan) => plan.scopeType === 'template')
        .map((plan) => plan.academyGrade)
    );

    const rows = [...classRows];
    if (rows.length === 0) {
      templateGrades.forEach((grade) => {
        rows.push({
          id: `template::${grade}`,
          label: `${grade} 기본 운영안`,
          academyGrade: grade,
          scopeType: 'template',
          classId: '',
        });
      });
    }
    return rows;
  }, [academyClassOptions, academyGradeOptions, academyPlans, academyScopeMode, selectedAcademyClass, selectedAcademyGrade]);

  const ensureSchoolRecord = async (school) => {
    if (school?.id) {
      return school;
    }
    const savedSchools = await dataService.upsertAcademicSchools([
      {
        id: school?.id || createId(),
        name: school?.name,
        category: school?.category || 'high',
        color: school?.color || '#216e4e',
        sortOrder: 0,
      },
    ]);
    return savedSchools[0] || school;
  };

  const closeEditor = () => {
    setActiveEditor(null);
    setEditorDraft(null);
  };

  useEffect(() => {
    if (!activeEditor) {
      return undefined;
    }

    const handlePointer = (event) => {
      if (editorRef.current?.contains(event.target)) {
        return;
      }
      closeEditor();
    };

    document.addEventListener('mousedown', handlePointer, true);
    return () => document.removeEventListener('mousedown', handlePointer, true);
  }, [activeEditor]);

  const openSchoolEditor = (row, period, target) => {
    const plan = row.school.id ? schoolPlanByKey.get(`${row.school.id}::${row.grade}::${period.code}`) : null;
    const items = plan ? schoolItemsByPlanId.get(plan.id) || [] : [];
    setActiveEditor({
      tab: 'school',
      school: row.school,
      grade: row.grade,
      period,
      planId: plan?.id || '',
      eyebrow: '학교 기준',
      title: `${row.school.name} · ${row.grade}`,
      subtitle: `${selectedYear}년 ${selectedSubject} · ${period.label}`,
      detailLabel: '시험범위',
      noteLabel: '셀 메모',
      anchor: buildEditorAnchor(target.getBoundingClientRect()),
    });
    setEditorDraft({
      note: plan?.note || '',
      rowsByCategory: buildDraftRows(items, 'scopeDetail'),
    });
  };

  const openAcademyEditor = (row, period, target) => {
    const plan = academyPlanByKey.get(`${row.academyGrade}::${row.scopeType}::${row.classId || ''}::${period.code}`) || null;
    const items = plan ? academyItemsByPlanId.get(plan.id) || [] : [];
    setActiveEditor({
      tab: 'academy',
      row,
      period,
      planId: plan?.id || '',
      eyebrow: row.scopeType === 'class' ? '학원 기준 · 실반' : '학원 기준 · 템플릿',
      title: row.label,
      subtitle: `${selectedYear}년 ${selectedSubject} · ${period.label}`,
      detailLabel: '수업계획(진도)',
      noteLabel: '운영 메모',
      anchor: buildEditorAnchor(target.getBoundingClientRect()),
    });
    setEditorDraft({
      note: plan?.note || '',
      rowsByCategory: buildDraftRows(items, 'planDetail'),
    });
  };

  const updateEditorRow = (sectionKey, rowIndex, patch) => {
    setEditorDraft((current) => ({
      ...current,
      rowsByCategory: {
        ...current.rowsByCategory,
        [sectionKey]: current.rowsByCategory[sectionKey].map((row, index) => (
          index === rowIndex ? { ...row, ...patch } : row
        )),
      },
    }));
  };

  const addEditorRow = (sectionKey) => {
    setEditorDraft((current) => ({
      ...current,
      rowsByCategory: {
        ...current.rowsByCategory,
        [sectionKey]: [...current.rowsByCategory[sectionKey], createEmptyMaterial(sectionKey)],
      },
    }));
  };

  const removeEditorRow = (sectionKey, rowIndex) => {
    setEditorDraft((current) => {
      const nextRows = current.rowsByCategory[sectionKey].filter((_, index) => index !== rowIndex);
      return {
        ...current,
        rowsByCategory: {
          ...current.rowsByCategory,
          [sectionKey]: nextRows.length > 0 ? nextRows : [createEmptyMaterial(sectionKey)],
        },
      };
    });
  };

  const saveActiveEditor = async () => {
    if (!activeEditor || !editorDraft) {
      return;
    }

    setIsSaving(true);
    try {
      const rows = flattenDraftRows(editorDraft.rowsByCategory);
      const hasPayload = rows.length > 0 || text(editorDraft.note);

      if (activeEditor.tab === 'school') {
        if (!hasPayload) {
          if (activeEditor.planId) {
            await dataService.deleteAcademicExamMaterialPlan(activeEditor.planId);
          }
        } else {
          const savedSchool = await ensureSchoolRecord(activeEditor.school);
          const [savedPlan] = await dataService.bulkUpsertAcademicExamMaterialPlans([{
            id: activeEditor.planId || createId(),
            academicYear: selectedYear,
            subject: selectedSubject,
            schoolId: savedSchool.id,
            grade: activeEditor.grade,
            examPeriodCode: activeEditor.period.code,
            note: editorDraft.note,
            sortOrder: activeEditor.period.sortOrder,
          }]);
          await dataService.replaceAcademicExamMaterialItems(savedPlan.id, rows.map((item) => ({
            id: item.id,
            materialCategory: item.materialCategory,
            title: item.title,
            publisher: item.publisher,
            scopeDetail: item.detail,
            note: item.note,
            sortOrder: item.sortOrder,
          })));
        }
      } else {
        if (!hasPayload) {
          if (activeEditor.planId) {
            await dataService.deleteAcademyCurriculumPeriodPlan(activeEditor.planId);
          }
        } else {
          const textbookByTitle = new Map((data.textbooks || []).map((item) => [text(item.title), item]));
          const [savedPlan] = await dataService.bulkUpsertAcademyCurriculumPeriodPlans([{
            id: activeEditor.planId || createId(),
            academicYear: selectedYear,
            subject: selectedSubject,
            academyGrade: activeEditor.row.academyGrade,
            catalogId: activeEditor.period.catalogId || null,
            periodType: activeEditor.period.periodType || 'fixed',
            periodCode: activeEditor.period.code,
            periodLabel: activeEditor.period.label,
            scopeType: activeEditor.row.scopeType,
            classId: activeEditor.row.classId || null,
            note: editorDraft.note,
            sortOrder: activeEditor.period.sortOrder,
          }]);
          await dataService.replaceAcademyCurriculumPeriodItems(savedPlan.id, rows.map((item) => ({
            id: item.id,
            materialCategory: item.materialCategory,
            textbookId: textbookByTitle.get(item.title)?.id || null,
            title: item.title,
            publisher: item.publisher,
            planDetail: item.detail,
            note: item.note,
            sortOrder: item.sortOrder,
          })));
        }
      }

      toast.success('교재·진도 셀을 저장했습니다.');
      closeEditor();
    } catch (error) {
      toast.error(`교재·진도 저장에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const addCustomPeriod = async () => {
    if (!text(customPeriodLabel)) {
      toast.error('추가할 시기 이름을 입력해 주세요.');
      return;
    }
    if (selectedAcademyGrade === ALL_ACADEMY_GRADES) {
      toast.error('사용자 시기를 추가하려면 학원 학년을 먼저 선택해 주세요.');
      return;
    }

    try {
      await dataService.upsertAcademyCurriculumPeriodCatalogs([{
        id: createId(),
        academicYear: selectedYear,
        subject: selectedSubject,
        academyGrade: selectedAcademyGrade,
        periodCode: `custom-${Date.now()}`,
        periodLabel: text(customPeriodLabel),
        sortOrder: academyCatalogs.length + 10,
      }]);
      setCustomPeriodLabel('');
      toast.success('사용자 시기를 추가했습니다.');
    } catch (error) {
      toast.error(`시기 추가에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const renameCustomPeriod = async (period) => {
    const nextLabel = window.prompt('새 시기 이름을 입력해 주세요.', period.label);
    if (!nextLabel || text(nextLabel) === text(period.label)) {
      return;
    }
    try {
      await dataService.upsertAcademyCurriculumPeriodCatalogs([{
        id: period.catalogId,
        academicYear: selectedYear,
        subject: selectedSubject,
        academyGrade: selectedAcademyGrade,
        periodCode: period.code,
        periodLabel: text(nextLabel),
        sortOrder: period.sortOrder ?? 0,
      }]);
      const relatedPlans = academyPlans.filter((plan) => plan.catalogId === period.catalogId);
      if (relatedPlans.length > 0) {
        await dataService.bulkUpsertAcademyCurriculumPeriodPlans(
          relatedPlans.map((plan) => ({ ...plan, periodLabel: text(nextLabel) }))
        );
      }
      toast.success('사용자 시기 이름을 바꿨습니다.');
    } catch (error) {
      toast.error(`시기 이름 변경에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const deleteCustomPeriod = async (period) => {
    const approved = await confirm({
      title: '사용자 시기를 삭제할까요?',
      description: '연결된 학원 교재·진도 셀도 함께 삭제됩니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger',
    });
    if (!approved) {
      return;
    }
    try {
      await dataService.deleteAcademyCurriculumPeriodCatalog(period.catalogId);
      toast.success('사용자 시기를 삭제했습니다.');
    } catch (error) {
      toast.error(`시기 삭제에 실패했습니다: ${getUserFriendlyDataError(error)}`);
    }
  };

  const printReport = () => {
    if (!reportRef.current) {
      return;
    }
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1280,height=900');
    if (!popup) {
      toast.error('인쇄 창을 열 수 없습니다. 팝업 차단을 확인해 주세요.');
      return;
    }
    popup.document.write(buildPrintHtml('교재·진도', reportRef.current.innerHTML));
    popup.document.close();
    popup.focus();
    popup.onload = () => {
      popup.print();
    };
  };

  const supportBanner = !isCheckingSupport && !roadmapSupport.ready ? (
    <StatusBanner
      variant="warning"
      title="교재·진도 테이블 준비 필요"
      message={`Supabase에서 새 시기별 교재·진도 테이블을 아직 찾지 못했습니다. 누락: ${(roadmapSupport.missingTables || []).join(', ')}`}
    />
  ) : null;

  return (
    <div className="view-container roadmap-view">
      <section className="workspace-surface roadmap-workspace">
        {supportBanner}

        <div className="roadmap-header">
          <div>
            <div className="roadmap-eyebrow">교재·진도 워크스페이스</div>
            <h2>시기별 학교·학원 교재 로드맵</h2>
            <p>학교 시험범위와 학원 수업계획을 한 표에서 관리하고, 그대로 A4로 출력할 수 있습니다.</p>
          </div>
          <div className="roadmap-header-actions">
            <button type="button" className="action-pill" onClick={printReport}>
              <Printer size={16} />
              A4 인쇄 / PDF
            </button>
          </div>
        </div>

        <div className="workspace-tabs">
          {[
            { id: 'school', label: '학교 기준' },
            { id: 'academy', label: '학원 기준' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`h-segment-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="roadmap-filter-grid">
          <label className="curriculum-filter-field">
            <span>연도</span>
            <select className="styled-input" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </label>
          <label className="curriculum-filter-field">
            <span>과목</span>
            <select className="styled-input" value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>
              {subjectOptions.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </label>

          {activeTab === 'school' ? (
            <>
              <label className="curriculum-filter-field">
                <span>학교 구분</span>
                <select className="styled-input" value={selectedSchoolCategory} onChange={(event) => { setSelectedSchoolCategory(event.target.value); setSelectedSchoolKey(ALL_SCHOOLS); }}>
                  {SCHOOL_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>학교</span>
                <select className="styled-input" value={selectedSchoolKey} onChange={(event) => setSelectedSchoolKey(event.target.value)}>
                  <option value={ALL_SCHOOLS}>전체 학교</option>
                  {schoolOptions.map((school) => (
                    <option key={schoolKey(school.name)} value={schoolKey(school.name)}>{school.name}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>학년</span>
                <select className="styled-input" value={selectedSchoolGrade} onChange={(event) => setSelectedSchoolGrade(event.target.value)}>
                  <option value={ALL_GRADES}>전체 학년</option>
                  {schoolGradeOptions.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>시기</span>
                <select className="styled-input" value={selectedSchoolPeriod} onChange={(event) => setSelectedSchoolPeriod(event.target.value)}>
                  <option value={ALL_PERIODS}>전체 시기</option>
                  {FIXED_PERIODS.map((period) => (
                    <option key={period.code} value={period.code}>{period.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="curriculum-filter-field">
                <span>학원 학년</span>
                <select className="styled-input" value={selectedAcademyGrade} onChange={(event) => { setSelectedAcademyGrade(event.target.value); setSelectedAcademyClass(ALL_CLASSES); }}>
                  <option value={ALL_ACADEMY_GRADES}>전체 학년</option>
                  {academyGradeOptions.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>실반</span>
                <select className="styled-input" value={selectedAcademyClass} onChange={(event) => setSelectedAcademyClass(event.target.value)}>
                  <option value={ALL_CLASSES}>전체 수업</option>
                  {academyClassOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>시기</span>
                <select className="styled-input" value={selectedAcademyPeriod} onChange={(event) => setSelectedAcademyPeriod(event.target.value)}>
                  <option value={ALL_PERIODS}>전체 시기</option>
                  {academyPeriodOptions.map((period) => (
                    <option key={period.code} value={period.code}>{period.label}</option>
                  ))}
                </select>
              </label>
              <label className="curriculum-filter-field">
                <span>표시 기준</span>
                <select className="styled-input" value={academyScopeMode} onChange={(event) => setAcademyScopeMode(event.target.value)}>
                  <option value="priority">실반 우선</option>
                  <option value="class">실반만</option>
                  <option value="template">템플릿만</option>
                </select>
              </label>
            </>
          )}
        </div>

        {activeTab === 'academy' ? (
          <div className="roadmap-custom-period-row">
            <label className="curriculum-filter-field roadmap-custom-period-field">
              <span>사용자 시기</span>
              <input
                className="styled-input"
                value={customPeriodLabel}
                onChange={(event) => setCustomPeriodLabel(event.target.value)}
                placeholder="예: 여름방학 특강"
                disabled={!canEdit}
              />
            </label>
            <button type="button" className="action-chip" onClick={addCustomPeriod} disabled={!canEdit}>
              <Plus size={14} />
              시기 추가
            </button>
            <div className="roadmap-inline-banner">
              학원 기준은 고정 4시기 외에 사용자 시기를 더 만들어 운영안과 실반 진도를 함께 관리할 수 있습니다.
            </div>
          </div>
        ) : (
          <div className="roadmap-inline-banner">
            학교 기준 표는 시험 시기별 교과서·부교재·기타 자료와 시험범위를 한 셀에서 함께 관리합니다.
          </div>
        )}

        <div className="roadmap-report-scroll">
          <div ref={reportRef} className="roadmap-report-sheet">
            {activeTab === 'school' ? (
              <table className="roadmap-table">
                <thead>
                  <tr>
                    <th className="roadmap-sticky-col">학교 / 학년</th>
                    {schoolPeriodOptions.map((period) => (
                      <th key={period.code}>
                        <div className="roadmap-period-header">
                          <span>{period.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schoolRows.length === 0 ? (
                    <tr>
                      <td colSpan={schoolPeriodOptions.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학교 기준 로드맵이 없습니다.</td>
                    </tr>
                  ) : schoolRows.map((row) => (
                    <tr key={row.id}>
                      <th className="roadmap-sticky-cell">
                        <strong>{row.school.name}</strong>
                        <span>{row.grade}</span>
                      </th>
                      {schoolPeriodOptions.map((period) => {
                        const plan = row.school.id ? schoolPlanByKey.get(`${row.school.id}::${row.grade}::${period.code}`) : null;
                        const items = plan ? schoolItemsByPlanId.get(plan.id) || [] : [];
                        const cell = {
                          note: plan?.note || '',
                          itemsByCategory: groupItemsByCategory(items, 'scopeDetail'),
                        };
                        return (
                          <td key={period.code} className="roadmap-cell">
                            <RoadmapCell cell={cell} onClick={(event) => openSchoolEditor(row, period, event.currentTarget)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="roadmap-table">
                <thead>
                  <tr>
                    <th className="roadmap-sticky-col">학년 / 수업</th>
                    {academyPeriodOptions.map((period) => (
                      <th key={period.code}>
                        <div className="roadmap-period-header">
                          <span>{period.label}</span>
                          {period.periodType === 'custom' && canEdit && selectedAcademyGrade !== ALL_ACADEMY_GRADES ? (
                            <div className="roadmap-period-header-actions">
                              <button type="button" className="roadmap-period-header-action" onClick={() => renameCustomPeriod(period)} aria-label="시기 이름 수정">
                                <Pencil size={13} />
                              </button>
                              <button type="button" className="roadmap-period-header-action" onClick={() => deleteCustomPeriod(period)} aria-label="시기 삭제">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {academyRows.length === 0 ? (
                    <tr>
                      <td colSpan={academyPeriodOptions.length + 1} className="roadmap-print-empty">현재 필터에 맞는 학원 기준 로드맵이 없습니다.</td>
                    </tr>
                  ) : academyRows.map((row) => (
                    <tr key={row.id}>
                      <th className="roadmap-sticky-cell">
                        <strong>{row.label}</strong>
                        <span>{row.academyGrade} · {row.scopeType === 'class' ? '실반' : '템플릿'}</span>
                      </th>
                      {academyPeriodOptions.map((period) => {
                        const plan = academyPlanByKey.get(`${row.academyGrade}::${row.scopeType}::${row.classId || ''}::${period.code}`) || null;
                        const items = plan ? academyItemsByPlanId.get(plan.id) || [] : [];
                        const cell = {
                          note: plan?.note || '',
                          itemsByCategory: groupItemsByCategory(items, 'planDetail'),
                        };
                        return (
                          <td key={period.code} className="roadmap-cell">
                            <RoadmapCell cell={cell} onClick={(event) => openAcademyEditor(row, period, event.currentTarget)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <div ref={editorRef}>
        <RoadmapCellEditor
          activeEditor={activeEditor}
          editorDraft={editorDraft}
          textbookSuggestions={textbookSuggestions}
          isSaving={isSaving}
          onClose={closeEditor}
          onChangeNote={(value) => setEditorDraft((current) => ({ ...current, note: value }))}
          onChangeRow={updateEditorRow}
          onAddRow={addEditorRow}
          onRemoveRow={removeEditorRow}
          onSave={saveActiveEditor}
        />
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
