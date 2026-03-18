export const SCHOOL_CATEGORY_OPTIONS = [
  { value: 'elementary', label: '초등' },
  { value: 'middle', label: '중등' },
  { value: 'high', label: '고등' },
];

export const SCHOOL_CATEGORY_FILTER_OPTIONS = [
  { value: 'all', label: '전체' },
  ...SCHOOL_CATEGORY_OPTIONS,
];

export const FIXED_GRADES_BY_CATEGORY = {
  elementary: ['초4', '초5', '초6'],
  middle: ['중1', '중2', '중3'],
  high: ['고1', '고2', '고3'],
};

export const MANAGED_GRADE_ORDER = [
  ...FIXED_GRADES_BY_CATEGORY.elementary,
  ...FIXED_GRADES_BY_CATEGORY.middle,
  ...FIXED_GRADES_BY_CATEGORY.high,
];

const CATEGORY_ORDER = SCHOOL_CATEGORY_OPTIONS.map((option) => option.value);

export function text(value) {
  return String(value || '').trim();
}

export function schoolKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

export function normalizeSchoolCategory(category, fallback = 'high') {
  return SCHOOL_CATEGORY_OPTIONS.some((option) => option.value === category)
    ? category
    : fallback;
}

export function getSchoolCategoryLabel(category, fallback = '미분류') {
  return SCHOOL_CATEGORY_OPTIONS.find((option) => option.value === category)?.label || fallback;
}

export function getGradesForSchoolCategory(category) {
  return [
    ...(FIXED_GRADES_BY_CATEGORY[normalizeSchoolCategory(category)] || FIXED_GRADES_BY_CATEGORY.high),
  ];
}

export function getAllManagedGrades() {
  return [...MANAGED_GRADE_ORDER];
}

export function getGradeSortValue(grade) {
  const index = MANAGED_GRADE_ORDER.indexOf(text(grade));
  return index >= 0 ? index : MANAGED_GRADE_ORDER.length + 99;
}

export function inferSchoolCategoryFromGrade(grade, fallback = 'high') {
  const normalized = text(grade);
  if (normalized.startsWith('초')) return 'elementary';
  if (normalized.startsWith('중')) return 'middle';
  if (normalized.startsWith('고')) return 'high';
  return normalizeSchoolCategory(fallback, 'high');
}

export function inferSchoolCategoryFromName(name, fallback = 'high') {
  const normalized = text(name);
  if (!normalized) return normalizeSchoolCategory(fallback, 'high');
  if (/(?:초등학교|초등|초[4-6])/u.test(normalized)) return 'elementary';
  if (/(?:중학교|중등|중[1-3])/u.test(normalized)) return 'middle';
  if (/(?:고등학교|고등|고[1-3])/u.test(normalized)) return 'high';
  return normalizeSchoolCategory(fallback, 'high');
}

export function buildSchoolMaster(academicSchools = [], students = []) {
  const buckets = new Map();

  const ensureSchool = (input = {}, fallbackIndex = 0) => {
    const name = text(input.name);
    if (!name) {
      return null;
    }

    const key = schoolKey(name);
    const fallbackCategory = inferSchoolCategoryFromGrade(
      input.grade,
      inferSchoolCategoryFromName(name, 'high')
    );
    const category = normalizeSchoolCategory(text(input.category), fallbackCategory);

    if (!buckets.has(key)) {
      buckets.set(key, {
        id: input.id || '',
        name,
        category,
        color: input.color || '#216e4e',
        sortOrder: Number.isFinite(Number(input.sortOrder))
          ? Number(input.sortOrder)
          : fallbackIndex,
        source: input.source || 'master',
      });
    }

    const current = buckets.get(key);
    current.id = input.id || current.id || '';
    current.name = name;
    current.category = normalizeSchoolCategory(text(input.category), current.category || category);
    current.color = input.color || current.color || '#216e4e';
    current.sortOrder = Number.isFinite(Number(input.sortOrder))
      ? Number(input.sortOrder)
      : current.sortOrder;
    current.source = current.source === 'master' || input.source !== 'fallback'
      ? current.source
      : input.source;
    return current;
  };

  (academicSchools || []).forEach((school, index) => {
    ensureSchool(
      {
        id: school.id,
        name: school.name,
        category: school.category,
        color: school.color,
        sortOrder: school.sortOrder ?? school.sort_order ?? index,
        source: 'master',
      },
      index
    );
  });

  if (buckets.size === 0) {
    (students || []).forEach((student, index) => {
      ensureSchool(
        {
          name: student.school,
          grade: student.grade,
          source: 'fallback',
          sortOrder: index,
        },
        index
      );
    });
  }

  return [...buckets.values()]
    .map((school) => ({
      ...school,
      category: normalizeSchoolCategory(
        school.category,
        inferSchoolCategoryFromName(school.name, 'high')
      ),
      grades: getGradesForSchoolCategory(school.category),
    }))
    .sort((left, right) => {
      const categoryGap = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
      if (categoryGap !== 0) {
        return categoryGap;
      }
      const orderGap = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
      if (orderGap !== 0) {
        return orderGap;
      }
      return left.name.localeCompare(right.name, 'ko');
    });
}

export function getSchoolOptionsByCategory(schools = [], category = 'all') {
  if (category === 'all') {
    return schools;
  }
  return schools.filter((school) => school.category === category);
}

export function getGradeOptionsForSelection(category = 'all', school = null) {
  if (school?.category) {
    return getGradesForSchoolCategory(school.category);
  }
  if (category === 'all') {
    return getAllManagedGrades();
  }
  return getGradesForSchoolCategory(category);
}

export function sortSchoolsForManagement(schools = []) {
  return [...schools].sort((left, right) => {
    const categoryGap = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    if (categoryGap !== 0) {
      return categoryGap;
    }
    const orderGap = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (orderGap !== 0) {
      return orderGap;
    }
    return text(left.name).localeCompare(text(right.name), 'ko');
  });
}
