export const subjectCatalog = {
  academicSchools: [], classrooms: [], subjects: ['영어', '수학', '과학'],
  teachers: [
    { id: 'synthetic-en', name: '가상 교사', subjects: ['영어팀'], isVisible: true },
    { id: 'synthetic-math', name: '가상 수학 교사', subjects: ['수학'], isVisible: true },
    { id: 'synthetic-science', name: '가상 과학 교사', subjects: ['과학'], isVisible: true },
    { id: 'synthetic-multiple', name: '가상 복수 교사', subjects: ['영어', '수학팀'], isVisible: true },
    { id: 'synthetic-hidden', name: '가상 비표시 교사', subjects: ['영어'], isVisible: false },
  ],
};
export function subjectClassNames(subject) {
  return subject === '수학' ? ['가상 수학 교사'] : subject === '과학' ? ['가상 과학 교사'] : ['가상 교사', '가상 카탈로그 외 교사'];
}
export function subjectScopeResponse(request) {
  const subject = request.args.p_filters.subject, names = subjectClassNames(subject);
  const row = {
    id: 'ef000000-0000-4000-8000-000000000001', title: '가상 수업', fullTitle: '가상 수업', subject, subjectAreaKey: '', grade: '중2', term: '',
    teacherNames: [names[0]], teacherSummary: names[0], classroomNames: [], classroomSummary: '', schedule: '', status: '수강', statusFilter: '수강',
    classGroupIds: [], classGroupNames: [], classGroupLabel: '미분류', textbookCount: 0, textbookCatalog: [], textbookTitles: [], textbookSummary: '', textbookOverflowCount: 0, textbookScopeLabels: [],
    totalSessions: 0, completedSessions: 0, updatedSessions: 0, delayedSessions: 0, plannedSessions: 0, progressTargetSessions: 0, delayedProgressSessions: 0, plannedProgressSessions: 0, progressPercent: 0, progressTargetPercent: 0,
    lastUpdatedAt: '', stateLabel: '회차 미생성', latestNoteSummary: '', latestNoteSessionLabel: '', pendingSessionLabels: [], nextSession: null, sessionSummaries: [], searchText: '가상 수업',
  };
  return { page: 1, pageSize: 15, totalCount: 16, resolvedPeriodId: null,
    rows: Array.from({ length: 15 }, (_, i) => ({ ...row, id: `ef000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` })),
    stats: { total: 16, managedClassCount: 0, totalSessions: 0, completedSessions: 0, pendingSessions: 0, linkedTextbooks: 0, unlinkedClassCount: 0, noScheduleClassCount: 16, updateNeededClassCount: 0, completedClassCount: 0, viewModeCounts: { all: 16, unlinked: 0, unscheduled: 16, update: 0, done: 0 } },
    filterOptions: { periods: [], statuses: ['수강'], subjects: [subject], grades: ['중2'], teachers: names, classrooms: [] },
  };
}
