// Synthetic transport fixtures. Never use production identities or contact details.
export const FIXED_NOW = '2026-09-15T05:30:00.000Z';
export const fixtureDefinitions = {
  A: '10 synthetic students; missing contact values',
  B: '18-character student names; 30-character schools; long schedule titles',
  C: 'Successful empty students and daily schedule',
  D: '20 source students; unmatched search returns zero and clearing restores rows',
  E: 'Three daily schedule types with distinct subject, time and place (registration track matrix pending)',
  F: '2.5-second initial delay, then success; refresh failure and reversed requests are separate follow-up coverage',
  G: 'Anonymous session redirects to sign-in; unauthorized authenticated role is separate coverage',
};
export function studentsFor(id) {
  if (id === 'C') return [];
  return Array.from({ length: id === 'D' ? 20 : 10 }, (_, i) => ({
    kind: 'students', id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: id === 'B' ? '합성긴이름학생구분용가나다라마바' + String(i).padStart(2, '0') : `합성학생${String(i + 1).padStart(2, '0')}`,
    status: 'active', sortKey: String(i).padStart(2, '0'), updatedAt: FIXED_NOW,
    grade: i % 2 ? '고1' : '중3', school: id === 'B' ? '합성학교'.repeat(7) + '학교' : '합성중고등학교',
    contact: i % 3 === 0 ? null : '01000000000', parentContact: i % 4 === 0 ? null : '01000000000',
  }));
}
export function dailyBriefFor(id) {
  const empty = id === 'C';
  return { localDate: '2026-09-15', generatedAt: FIXED_NOW,
    counts: { levelTests: empty ? 0 : 1, visitConsultations: empty ? 0 : 1, observationClasses: empty ? 0 : 1, openTasks: 0 },
    upcoming: empty ? [] : ['level_test', 'visit_consultation', 'observation_class'].map((sourceKind, i) => ({
      sourceKind, sourceId: `synthetic-event-${i}`, scheduledAt: `2026-09-15T0${6+i}:00:00.000Z`,
      title: id === 'B' ? '합성긴수업명'.repeat(12) : `합성학생0${i+1} ${['레벨테스트', '방문상담', '청강'][i]}`,
      subjectLabels: [['영어'], ['수학'], ['과학']][i], placeLabel: ['본관 101호', '별관 상담실', '본관 202호'][i],
      href: `/admin/registration?caseId=synthetic-case-${i}`,
    })),
  };
}
export function numberedPage(rows, args) {
  const page = args.p_page ?? 1, pageSize = args.p_page_size ?? 10;
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalCount: rows.length };
}
export function resolveFixtureRequest(path, args, id) {
  if (path.endsWith('/get_dashboard_daily_brief_v1')) return dailyBriefFor(id);
  if (path.endsWith('/list_management_numbered_page_v1')) {
    const search = args.p_filters?.search || '';
    const rows = studentsFor(id).filter(row => row.name.includes(search));
    return numberedPage(args.p_kind === 'students' ? rows : [], args);
  }
  if (path.endsWith('/get_management_stats_v1')) return { total: studentsFor(id).length, active: studentsFor(id).length };
  if (path.endsWith('/list_management_filter_options_v1')) return { schools: ['합성중고등학교'], grades: ['중3', '고1'] };
  if (path.endsWith('/registration_subject_tracks_runtime_version') || path.endsWith('/registration_observation_runtime_version')) return 1;
  if (path.endsWith('/list_registration_subject_capabilities_v1')) return ['영어', '수학', '과학'].map((subject, i) => ({ subject, is_active: true, registration_create_enabled: true, grade_levels: ['중3', '고1'], sort_order: (i+1)*10, default_director_profile_id: null }));
  if (path.endsWith('/get_ops_task_list_stats_v1')) return { total: 0, byStatus: {}, byView: {}, metrics: {}, facets: {} };
  if (path.endsWith('/list_ops_task_numbered_page_v1')) return numberedPage([], args);
  if (path.endsWith('/list_operations_catalogs_v1')) return { academicSchools: [], teacherCatalogs: [], classroomCatalogs: [], classTerms: [], classGroups: [] };
  if (path.endsWith('/get_operations_class_schedule_numbered_page_v1')) return { ...numberedPage([], args), stats: { total: 0, active: 0, draft: 0 }, filterOptions: { terms: [], subjects: [], grades: [], teachers: [], syncGroups: [] }, syncGroupCounts: [] };
  if (path === '/api/dashboard/statistics') return { ok: true, contractVersion: 'dashboard-statistics-v1', tab: 'overview', generatedAt: FIXED_NOW, expiresAt: '2026-09-15T05:35:00.000Z', cacheStatus: 'miss', data: { summary: { uniqueRegisteredStudentCount: id === 'C' ? 0 : 10, registeredEnrollmentCount: id === 'C' ? 0 : 15, activeClassesCount: id === 'C' ? 0 : 3, uniqueWaitlistStudentCount: 0, weeklyHoursLabel: '6시간' } } };
  if (path.endsWith('/get_textbook_master_options_v1')) {
    const keys = ['publisherOptions', 'subSubjectOptions', 'categoryOptions', 'bulkCategoryOptions', 'scienceSubjectAreas'];
    return { ...Object.fromEntries(keys.map(key => [key, []])), counts: Object.fromEntries(keys.map(key => [key, 0])), complete: true };
  }
  if (path.endsWith('/get_textbook_operations_summary_v1')) return Object.fromEntries(['requestCount', 'unregisteredRequestCount', 'orderNeededCount', 'receivingBacklogCount', 'partialReceiptCount', 'issueWaitingCount', 'stockRiskCount'].map(key => [key, 0]));
  if (path.endsWith('/list_textbook_master_page_v1')) return numberedPage(id === 'C' ? [] : [textbookFor(id)], args);
  if (path.endsWith('/get_textbook_master_summary_v1')) {
    const totalCount = id === 'C' ? 0 : 1;
    return { totalCount, totalQuantity: 0, studentQuantity: 0, teacherQuantity: 0, stockValue: 0, salePriceTotal: totalCount * 12000, locationQuantities: {}, subjectTotals: totalCount ? [{ subject: 'english', totalCount, totalQuantity: 0, salePriceTotal: 12000, stockValue: 0 }] : [],
      qualityCounts: Object.fromEntries(['all', 'attention', 'duplicate', 'missingCode', 'missingPublisher', 'missingCategory', 'missingPrice', 'subjectMismatch', 'inactive'].map(key => [key, key === 'all' ? totalCount : 0])),
      inventoryCounts: Object.fromEntries(['all', 'shortage', 'surplus', 'unused', 'negative'].map(key => [key, key === 'all' ? totalCount : 0])), subSubjectOptions: [], locations: [] };
  }
  return undefined;
}

function textbookFor(id) {
  const title = id === 'B' ? '합성교재제목'.repeat(16) + '구분가나' : '합성 영어 독해 교재';
  return { id: '00000000-0000-4000-8000-000000000050', title, name: title, status: 'active', school_level: '고등', grade_level: '고1', sub_subject: '독해', subject: '영어', publisher: '합성출판사', category: '독해', isbn13: null, barcode: null, subject_area_key: null, price: 12000, sale_price: 12000, list_price: 12000, salePrice: 12000, publisher_id: null, default_supplier_id: null, school_levels: ['고등'], grade_levels: ['고1'], is_returnable: true, locationQuantities: {}, studentLocationQuantities: {}, teacherLocationQuantities: {}, totalQuantity: 0, studentQuantity: 0, teacherQuantity: 0, stockValue: 0, locationSummary: [], qualityIssues: Object.fromEntries(['duplicate', 'missingCode', 'missingPublisher', 'missingCategory', 'missingPrice', 'subjectMismatch', 'inactive'].map(key => [key, false])), qualityScore: 0 };
}
