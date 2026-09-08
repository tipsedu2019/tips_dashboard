export const classRow = (id, name = `수업 ${id}`) => ({
  kind: "classes", id, title: name, subtitle: "영어", badge: "영어", badgeValue: "영어",
  status: "수강", statusValue: "수강", metaSummary: "", searchText: name, metrics: {},
  raw: { id, name, subject: "영어", grade: "중1", schedule: "월 16:00-18:00", teacher: "영어교사", classroom: "본관 2강", schedule_storage_mode: "normalized", student_ids: [], waitlist_ids: [], textbook_ids: [] },
});

export const defaultsFor = (startTime = "17:00", scheduleRevision = 1) => ({
  authoritativeSource: "normalized", scheduleRevision, schedulePlanHash: "fixture-plan",
  slots: [{ id: "slot-1", weekday: 1, startTime, endTime: "20:00", teacherCatalogId: "teacher-1", teacherName: "영어교사", classroomCatalogId: "room-1", classroomName: "본관 2강", sortOrder: 0 }],
});

export function createManagementDetailFixture() {
  const requests = [];
  const pending = (type, input) => {
    const deferred = Promise.withResolvers();
    requests.push({ type, input, ...deferred });
    return deferred.promise;
  };
  const rows = [classRow("a", "A 영어반"), classRow("b", "B 영어반")];
  const fixture = {
    requests, rows, deferDetail: false,
    auth: { user: { id: "staff-a" }, role: "admin", canManageAll: true, loading: false },
    records: {
      rows, stats: [], loading: false, error: null,
      classFormReferences: {
        teacherCatalogs: [{ id: "teacher-1", name: "영어교사", subject: "영어" }],
        classroomCatalogs: [{ id: "room-1", name: "본관 2강", subject: "영어" }], scienceSubjectAreas: [],
      },
      filterOptions: {}, effectiveClassPeriodId: "", page: 1, pageSize: 10, totalCount: 2, sort: [{ id: "title", desc: false }], scope: "fixture",
      goToPage() {}, setSort() {}, refresh: async () => undefined,
      loadDetail: id => fixture.deferDetail ? pending("detail", id) : Promise.resolve(rows.find(row => row.id === id) ?? classRow(id)),
      loadRelationPage: async () => null, loadClassRosterPreview: async () => null,
      loadClassTextbookCandidatePage: async () => ({ rows: [], nextCursor: null, hasMore: false }),
    },
    service: {
      getClassScheduleDefaults: id => pending("defaults", id),
      saveClassScheduleDefaults: input => pending("save", input),
      updateClass: async input => ({ ...input }), replaceClassGroupMemberships: async () => undefined,
    },
  };
  return fixture;
}
