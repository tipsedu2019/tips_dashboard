# Dashboard Query Surface Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무·학생·수업·교재·학사·공개수업 화면의 최초 조회 비용이 전체 데이터량에 비례하지 않도록 목록 30건, 선택 상세, 범위 조회, 명시적 projection으로 바꾼다.

**Architecture:** 모든 목록은 `(sort_value, id)` keyset cursor와 별도 aggregate를 사용한다. 댓글·첨부·이벤트·이력·수업계획·교재 진도는 선택한 entity의 detail loader만 읽는다. operations/academic loader는 화면 mode와 날짜 범위로 분리하고, 공개수업 summary는 10분 last-good cache와 정적 snapshot fallback을 사용한다.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Supabase JS/PostgREST, PostgreSQL 17, Node test runner, pgTAP, ESLint.

## Global Constraints

- 승인 기준은 `docs/superpowers/specs/2026-08-13-supabase-free-tier-dashboard-notification-optimization-design.md`다.
- 구현은 실행 시점 최신 `origin/main` 기반 새 worktree에서 한다. 계획 작성 기준 `fad56ae5`의 이미 적용된 8월 8~9일 read/RLS 개선을 되돌리거나 중복 구현하지 않는다.
- `2026-08-13-dashboard-home-statistics-lazy-loading.md`를 먼저 완료한 동일 branch 위에서 이 계획을 순차 실행한다. 시작 전에 최신 `origin/main`과 그 계획 결과를 rebase하고 path/symbol/test map을 다시 확인한다.
- 한 번에 한 surface만 구현·검증·커밋한다. 순서는 업무 → 관리 → operations → academic → public이다.
- 신규 목록의 고정 page size는 30이고 server는 31건을 읽어 `hasMore`를 계산한다. `OFFSET` pagination을 사용하지 않는다.
- 달력·시간표처럼 선택한 visible date range 전체가 업무 의미상 완전해야 하는 화면은 임의의 30행으로 잘라 누락시키지 않는다. 대신 허용 range를 제한하고 그 범위의 모든 projection row를 반환한다. 30건 cursor는 task/management/class/curriculum 같은 실제 목록에만 적용한다.
- calendar/timetable range RPC의 hard row budget은 각각 2,000이다. 초과하면 부분 rows를 반환하지 않고 `visible_range_too_dense`와 suggested range 7일을 반환한다. UI는 기존 성공 화면을 유지하며 7일 범위로 다시 조회하는 `한 주 보기` 행동을 제공한다.
- 목록은 명시적 projection, server filter, deterministic order, limit를 모두 가져야 한다. 신규 목록 `select('*')`는 금지한다.
- 목록에서 comments, attachments, events, audit, history, `classes.schedule_plan`, `textbooks.lessons`를 읽지 않는다.
- 많은 ID를 `.in("task_id", taskIds)`에 넣는 목록 경로를 제거한다. detail에서는 정확한 `.eq("task_id", taskId)`만 허용한다.
- 30건만 보고 만든 count/비율/충돌/진도 합계를 전역 통계로 표시하지 않는다. 전역/범위 합계는 별도 aggregate RPC가 권위다.
- 모든 GET/RPC는 실제 `.abortSignal(AbortSignal.timeout(8_000)).retry(false)`를 사용한다. `Promise.race`만으로 timeout을 흉내 내지 않는다.
- 저장 뒤 전체 workspace `refresh()`를 금지한다. exact entity re-read, 현재 page patch, 관련 aggregate invalidation만 한다.
- 관련 list aggregate는 현재 화면에서 invalidate하지만 중앙 통계 화면의 actor별 10분 cache는 cross-actor write fan-out을 피하기 위해 자동 invalidate하지 않는다. 통계 계획의 bounded staleness/manual refresh 계약을 따른다.
- RLS 우회를 위해 service role 또는 넓은 `security definer`를 추가하지 않는다. 신규 read RPC는 기본적으로 `security invoker`, fixed `search_path`, authenticated-only다.
- 공개 `/api/public-classes`의 full payload는 외부 consumer가 불명확하므로 즉시 깨지 않는다. 내부 `/classes`의 기존 summary 경로에 server cache를 추가하고 legacy full contract 제거는 관찰 후 별도 승인한다.
- 이 계획은 source 구현까지만 승인한다. 운영 migration, `main` push, Vercel 배포, 캐시 전환은 별도 승인 단계다.

## Shared Contracts

```ts
export type KeysetCursor = {
  sortValues: Array<string | number | null>
  id: string
  scopeHash: string
}

export type PageResult<Row, Cursor = KeysetCursor> = {
  rows: Row[]
  nextCursor: Cursor | null
  hasMore: boolean
}

export type ListWithStats<Row, Stats> = {
  page: PageResult<Row>
  stats: Stats
}

export type OpsTaskListBase = {
  id: string
  title: string
  type: OpsTaskType
  studentName: string
  subject: string
  status: string
  priority: OpsTaskPriority
  requestedById: string | null
  requestedByLabel: string
  requestedTeam: string
  assigneeId: string | null
  assigneeLabel: string
  assigneeTeam: string
  secondaryAssigneeId: string | null
  secondaryAssigneeLabel: string
  startAt: string | null
  dueAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  summaryFlags: string[]
}

export type OpsGeneralTaskListRow = OpsTaskListBase & {
  type: "general" | "textbook"
}

export type OpsRegistrationTaskListRow = OpsTaskListBase & {
  type: "registration"
  registrationTracks: OpsRegistrationObservationTrackSummary[]
}

export type OpsWithdrawalTaskListRow = OpsTaskListBase & {
  type: "withdrawal"
  displayValues: Record<WithdrawalSortableColumnKey, string>
  inlineState: {
    makeeduWithdrawalDone: boolean
    feeProcessed: boolean
    textbookFeeProcessed: boolean
  }
}

export type OpsTransferTaskListRow = OpsTaskListBase & {
  type: "transfer"
  displayValues: Record<TransferSortableColumnKey, string>
  inlineState: {
    makeeduTransferDone: boolean
    feeProcessed: boolean
    textbookFeeProcessed: boolean
  }
}

export type OpsWordRetestTaskListRow = OpsTaskListBase & {
  type: "word_retest"
  displayValues: Record<WordRetestSortableColumnKey, string>
  inlineState: {
    branch: string
    teacherId: string | null
    retestStatus: string
    firstScore: string | null
    secondScore: string | null
    thirdScore: string | null
    totalQuestionCount: string | null
    cutoffQuestionCount: string | null
    expectedRetestAt: string | null
    retryOfTaskId: string | null
    retryTaskId: string | null
  }
}

export type OpsTaskListRow =
  | OpsGeneralTaskListRow
  | OpsRegistrationTaskListRow
  | OpsWithdrawalTaskListRow
  | OpsTransferTaskListRow
  | OpsWordRetestTaskListRow

export type OpsTaskPageResponse = {
  page: PageResult<OpsTaskListRow>
  stats: { total: number; byStatus: Record<string, number> }
  registrationRuntime: RegistrationRuntimeState | null
}

export type WithdrawalSortableColumnKey =
  | "status" | "subject" | "teacher" | "className" | "student"
  | "withdrawalDate" | "withdrawalSession" | "completedLessonHours"
  | "fourWeekLessonHours" | "progress" | "customerReason" | "teacherOpinion"
  | "undistributedTextbooks" | "operationsChecklist"

export type TransferSortableColumnKey =
  | "status" | "subject" | "fromTeacher" | "fromClassName" | "student"
  | "transferReason" | "fromUndistributedTextbooks" | "fromClassEndDate"
  | "fromClassEndSession" | "toTeacher" | "toClassName" | "toClassStartDate"
  | "toClassStartSession" | "toUndistributedTextbooks" | "operationsChecklist"

export type WordRetestSortableColumnKey =
  | "status" | "testAt" | "expectedRetestAt" | "teacher" | "class"
  | "student" | "textbook" | "unit" | "note" | "total" | "cutoff"
  | "score" | "result"

export type OpsTaskPageFilters =
  | {
      taskType: "general"
      search: string
      statuses: string[]
      queue: "inbox" | "sent" | "completed"
      requestedById: string | null
      requestedTeam: string | null
      assigneeId: string | null
      assigneeTeam: string | null
      focus: "none" | "today" | "overdue" | "mine" | "unassigned" | "confirmation"
      sort: "status" | "priority" | "due"
    }
  | {
      taskType: "registration"
      search: string
      statuses: string[]
      view: RegistrationWorkspaceViewKey
      consultationOwnerId: string | null
    }
  | {
      taskType: "withdrawal"
      search: string
      statuses: string[]
      view: "applicant" | "operations" | "closed"
      subject: string | null
      teacher: string | null
      period: "all" | "today" | "week" | "month" | "custom"
      dateFrom: string | null
      dateTo: string | null
      filterColumn: WithdrawalSortableColumnKey | null
      sortColumn: WithdrawalSortableColumnKey | null
      sortDirection: "asc" | "desc" | null
    }
  | {
      taskType: "transfer"
      search: string
      statuses: string[]
      view: "applicant" | "operations" | "closed"
      subject: string | null
      teacher: string | null
      period: "all" | "today" | "week" | "month" | "custom"
      dateFrom: string | null
      dateTo: string | null
      filterColumn: TransferSortableColumnKey | null
      sortColumn: TransferSortableColumnKey | null
      sortDirection: "asc" | "desc" | null
    }
  | {
      taskType: "word_retest"
      search: string
      statuses: string[]
      queue: "assistant" | "teacher"
      branch: string | null
      period: "all" | "today" | "week" | "month" | "custom"
      dateFrom: string | null
      dateTo: string | null
      teacherId: string | null
      classId: string | null
      includeClosed: boolean
      tableSortColumn: WordRetestSortableColumnKey | null
      tableSortDirection: "asc" | "desc" | null
    }

export type ManagementListRow = {
  kind: "students"
  id: string
  name: string
  grade: string | null
  school: string | null
  status: string
  sortKey: string
  updatedAt: string
} | {
  kind: "classes"
  id: string
  name: string
  subject: string
  teacherName: string | null
  status: string
  studentCount: number
  sortKey: string
  updatedAt: string
} | {
  kind: "textbooks"
  id: string
  title: string
  subject: string
  publisher: string | null
  status: string
  activeClassCount: number
  sortKey: string
  updatedAt: string
}

export type ManagementKind = "students" | "classes" | "textbooks"
export type ManagementListFilters =
  | {
      kind: "students"
      search: string
      status: string | null
      schoolCategory: string | null
      school: string | null
      grade: string | null
    }
  | {
      kind: "classes"
      search: string
      periodId: string | null
      status: string | null
      subject: string | null
      grade: string | null
      teacher: string | null
      classroom: string | null
    }
  | {
      kind: "textbooks"
      search: string
      status: string | null
      subject: string | null
      publisher: string | null
    }

export type ManagementRelationKind =
  | "enrollments"
  | "lifecycle_history"
  | "class_picker"
  | "registered_students"
  | "waitlisted_students"
  | "active_classes"
  | "purchase_history"

export type ManagementRelationCursor = {
  v: 1
  kind: ManagementKind
  entityId: string
  relationKind: ManagementRelationKind
  sortValue: string
  id: string
}

export type ManagementStudentEnrollmentRow = { classId: string; status: string; startedOn: string | null; endedOn: string | null }
export type ManagementStudentLifecycleRow = { id: string; eventType: string; occurredAt: string; safeSummary: string }
export type ManagementClassPickerRow = { id: string; name: string; subject: string; grade: string; status: string }
export type ManagementClassRosterRow = { id: string; name: string; school: string; grade: string; status: string; recentIssue: string | null }
export type ManagementActiveClassRow = { id: string; name: string; subject: string; teacherName: string | null }
export type ManagementPurchaseHistoryRow = { id: string; status: string; quantity: number; requestedAt: string }

export type ManagementStudentDetail = {
  kind: "students"
  record: {
    id: string
    name: string
    status: string
    uid: string | null
    schoolCategory: string | null
    school: string | null
    grade: string | null
    contact: string | null
    parentContact: string | null
    enrollDate: string | null
    counselingNote: string | null
    recentIssue: string | null
    updatedAt: string
  }
  enrollments: PageResult<ManagementStudentEnrollmentRow, ManagementRelationCursor>
  lifecycleHistory: PageResult<ManagementStudentLifecycleRow, ManagementRelationCursor>
  classPicker: PageResult<ManagementClassPickerRow, ManagementRelationCursor>
}

export type ManagementClassDetail = {
  kind: "classes"
  record: {
    id: string
    name: string
    status: string
    classType: string
    subject: string
    subjectAreaKey: string | null
    grade: string
    teacher: string
    schedule: string
    classroom: string
    capacity: number | null
    fee: number | null
    updatedAt: string
  }
  schedule: {
    plan: { timezone: string; effectiveFrom: string | null; effectiveTo: string | null; version: number } | null
    slots: Array<{ id: string; dayOfWeek: string; startsAt: string; endsAt: string; teacher: string; classroom: string }>
  }
  registeredStudents: PageResult<ManagementClassRosterRow, ManagementRelationCursor>
  waitlistedStudents: PageResult<ManagementClassRosterRow, ManagementRelationCursor>
  textbooks: Array<{ id: string; title: string; publisher: string | null }>
  groups: Array<{ id: string; name: string; subject: string }>
  formReferences: {
    teacherCatalogs: Array<{ id: string; name: string; subjects: string[]; profileId: string | null }>
    classroomCatalogs: Array<{ id: string; name: string; campus: string; subjects: string[] }>
    scienceSubjectAreas: Array<{ id: string; name: string; sortOrder: number }>
  }
}

export type ManagementTextbookDetail = {
  kind: "textbooks"
  record: {
    id: string
    title: string
    subject: string
    publisher: string | null
    price: number | null
    tags: string[]
    status: string
    updatedAt: string
  }
  taxonomy: { schoolLevels: string[]; gradeLevels: string[]; subSubject: string | null }
  activeClasses: PageResult<ManagementActiveClassRow, ManagementRelationCursor>
  progressSummary: { assignedClasses: number; updatedSessions: number; lastUpdatedAt: string | null }
  purchaseHistory: PageResult<ManagementPurchaseHistoryRow, ManagementRelationCursor>
}

export type ManagementDetailResponse =
  | ManagementStudentDetail
  | ManagementClassDetail
  | ManagementTextbookDetail

export type ManagementRelationPageResponse =
  | { kind: "students"; relationKind: "enrollments"; page: PageResult<ManagementStudentEnrollmentRow, ManagementRelationCursor> }
  | { kind: "students"; relationKind: "lifecycle_history"; page: PageResult<ManagementStudentLifecycleRow, ManagementRelationCursor> }
  | { kind: "students"; relationKind: "class_picker"; page: PageResult<ManagementClassPickerRow, ManagementRelationCursor> }
  | { kind: "classes"; relationKind: "registered_students" | "waitlisted_students"; page: PageResult<ManagementClassRosterRow, ManagementRelationCursor> }
  | { kind: "textbooks"; relationKind: "active_classes"; page: PageResult<ManagementActiveClassRow, ManagementRelationCursor> }
  | { kind: "textbooks"; relationKind: "purchase_history"; page: PageResult<ManagementPurchaseHistoryRow, ManagementRelationCursor> }

export type OperationsWorkspaceRequest =
  | { mode: "calendar"; dateFrom: string; dateTo: string }
  | { mode: "annual"; academicYear: number }
  | {
      mode: "class_schedule"
      termId: string | null
      search: string
      subject: string | null
      grade: string | null
      teacher: string | null
      syncGroupId: string | null
      cursor: KeysetCursor | null
    }

export type AcademicWorkspaceRequest =
  | {
      mode: "timetable"
      dateFrom: string
      dateTo: string
      filters: { classGroupId: string | null; status: string | null; subject: string | null }
    }
  | {
      mode: "curriculum"
      periodId: string | null
      search: string
      status: string | null
      subject: string | null
      grade: string | null
      teacher: string | null
      classroom: string | null
      viewMode: "all" | "unlinked" | "unscheduled" | "update" | "done"
      cursor: KeysetCursor | null
    }

export type VisibleRangeResult<Row> =
  | {
      ok: true
      range: { dateFrom: string; dateTo: string }
      rows: Row[]
      complete: true
    }
  | {
      ok: false
      code: "visible_range_too_dense"
      range: { dateFrom: string; dateTo: string }
      rows: []
      observedRowsAtLeast: 2001
      suggestedDays: 7
    }

export type CalendarEventRow = {
  id: string
  sourceId: string
  sourceKind: string
  title: string
  startsAt: string
  endsAt: string | null
  timeLabel: string
  durationLabel: string
  eventType: "meeting" | "event" | "personal" | "task" | "reminder"
  typeLabel: string | null
  attendees: string[]
  subject: string | null
  place: string | null
  color: string
  description: string | null
  schoolId: string | null
  schoolName: string | null
  category: string | null
  grade: string | null
  examTerm: string | null
  scopeSummary: string | null
  scienceAreaKey: string | null
  scienceAreaLabel: string | null
  notePreview: string | null
  status: string
  revision: number
}

export type AcademicAnnualBoardEntry = {
  id: string
  title: string
  type: "시험기간" | "영어시험일" | "수학시험일" | "과학시험일" | "체험학습" | "방학·휴일·기타" | "팁스"
  start: string
  end: string
  dateLabel: string
  schoolId: string | null
  schoolName: string | null
  grade: string | null
  gradeBadges: string[]
  examTerm: string | null
  examDateLabel: string | null
  linkedScheduleLabel: string | null
  scopeSummary: string | null
  scienceAreaKey: string | null
  scienceAreaLabel: string | null
  textbookScopes: Array<{ name: string; publisher: string; scope: string }>
  subtextbookScopes: Array<{ name: string; publisher: string; scope: string }>
  metaBadges: string[]
  displaySections: Array<{ label: string; items: string[] }>
  notePreview: string | null
  color: string | null
  revision: number
}

export type AcademicAnnualBoardRow = {
  id: string
  schoolId: string | null
  schoolName: string
  category: string
  grade: string
  gradeValues: string[]
  gradeBadges: string[]
  totalEvents: number
  typeBuckets: Record<AcademicAnnualBoardEntry["type"], AcademicAnnualBoardEntry[]>
}

export type AnnualBoardResult = {
  academicYear: number
  selectedSemester: "all" | "first" | "second"
  yearOptions: number[]
  rows: AcademicAnnualBoardRow[]
  summary: { schoolCount: number; eventCount: number; activeTypeCount: number }
}

export type AcademicEventDetail = CalendarEventRow & {
  note: string | null
  embeddedNoteMeta: Record<string, unknown> | null
  textbookScopes: Array<{ name: string; publisher: string; scope: string }>
  subtextbookScopes: Array<{ name: string; publisher: string; scope: string }>
  materialSections: Array<{ label: string; items: string[] }>
}

export type ClassScheduleListRow = {
  id: string
  name: string
  subject: string
  teacherName: string | null
  termName: string | null
  status: string
  updatedAt: string
}

export type ClassScheduleStats = { total: number; active: number; draft: number }

export type TimetableClassSummary = {
  classId: string
  className: string
  fullTitle: string
  academicYear: string
  subject: string
  subjectAreaKey: string | null
  grade: string
  teacherName: string | null
  classroomName: string | null
  termId: string | null
  termName: string | null
  schedule: string
  status: string
  statusFilter: string
  classGroupIds: string[]
  classGroupNames: string[]
}

export type TimetableRow = {
  id: string
  classId: string
  title: string
  fullTitle: string
  academicYear: string
  subject: string
  subjectAreaKey: string
  grade: string
  teacher: string
  classroom: string
  term: string
  schedule: string
  status: string
  statusFilter: string
  classGroupIds: string[]
  classGroupNames: string[]
  classGroupLabel: string
  day: string
  dayIndex: number
  start: string
  end: string
  startMinutes: number
  endMinutes: number
  durationMinutes: number
  searchText: string
}

export type TimetableResult =
  | {
      ok: true
      range: { dateFrom: string; dateTo: string }
      rows: TimetableRow[]
      complete: true
      classSummaries: TimetableClassSummary[]
      classTerms: Array<{ id: string; name: string; startsOn: string; endsOn: string }>
      classGroups: Array<{ id: string; name: string; subject: string }>
      classGroupMembers: Array<{ groupId: string; classId: string }>
      teacherCatalogs: Array<{ id: string; name: string; profileId: string | null; subjects: string[] }>
      classroomCatalogs: Array<{ id: string; name: string; campus: string; subjects: string[] }>
      filterOptions: { statuses: string[]; subjects: string[] }
    }
  | {
      ok: false
      code: "visible_range_too_dense"
      range: { dateFrom: string; dateTo: string }
      rows: []
      observedRowsAtLeast: 2001
      suggestedDays: 7
    }
  | {
      ok: false
      code: "timetable_collection_too_dense"
      range: { dateFrom: string; dateTo: string }
      rows: []
      collection: "class_summaries" | "class_terms" | "class_groups" | "class_group_members" | "teacher_catalogs" | "classroom_catalogs"
      observedItemsAtLeast: 501
      action: "narrow_filters"
    }

export type CurriculumListRow = {
  classId: string
  className: string
  subject: string
  teacherName: string | null
  progressPercent: number
  textbookCount: number
  sessionCount: number
  updatedAt: string
}

export type CurriculumStats = {
  totalClasses: number
  averageProgressPercent: number
  classesWithoutTextbook: number
}
```

단순한 `updated_at desc,id asc` surface의 mixed-direction cursor predicate는 다음 shape를 사용한다. 다른 sort는 아래에 정의한 tuple의 direction/null semantics를 같은 방식으로 전개하며, 단순 row-value `<` 비교로 축약하지 않는다.

```sql
where p_cursor_sort_values is null
   or row.updated_at < ((p_cursor_sort_values ->> 0)::timestamptz)
   or (
     row.updated_at = ((p_cursor_sort_values ->> 0)::timestamptz)
     and row.id > p_cursor_id
   )
order by row.updated_at desc, row.id asc
limit 31
```

사용자가 요청한 한국어 숫자 정렬은 앞선 home/statistics 계획의 `dashboard_statistics_sources` migration이 설치한 `dashboard_private.ko_numeric` ICU collation(`locale='ko-u-kn-true'`, deterministic)을 재사용한다. management migration은 catalog definition을 검사해 absent/drift면 fail-closed하고 재생성하지 않는다. 아래 exact expression을 사용한다.

```sql
pg_catalog.coalesce(
  pg_catalog.nullif(
    pg_catalog.regexp_replace(pg_catalog.btrim(display_name), '[[:space:]]+', ' ', 'g'),
    ''
  ),
  U&'\FFFF'
) collate dashboard_private.ko_numeric
```

RPC는 동일 normalized text를 `sort_key`로 반환하고 predicate/order 모두 같은 collation을 사용한다. collation 생성 또는 parity fixture가 실패하면 `C` collation으로 silently fallback하지 않는다. client가 30행을 다시 정렬해 cursor 의미를 깨지 않는다.

## Fixed Runtime Commands

```bash
export TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export TASK_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
export TASK_SUPABASE=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
export TASK_REQUEST_ID=$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')
```

각 task를 시작할 때 같은 shell에서 위 네 줄을 실행하고 모든 `Run:` block을 그 shell에서 실행한다. 새 shell이면 네 줄을 모두 다시 실행한다. local DB command는 `--request-id "$TASK_REQUEST_ID"`를 사용한다. bare `node`, `npm`, `npx`를 사용하지 않는다.

## File and Responsibility Map

### Database additions

- `supabase migration new ops_task_page_reads`가 생성한 exact migration path
  - task type/status/filter별 30건 목록과 aggregate RPC, 필요한 실제 query index만 추가한다.
- `supabase migration new management_page_reads`가 생성한 exact migration path
  - students/classes/textbooks page, global stats, exact detail RPC를 추가한다.
- `supabase migration new operations_scoped_reads`가 생성한 exact migration path
  - calendar month, annual year, class schedule list scope별 read RPC를 추가한다.
- `supabase migration new academic_scoped_reads`가 생성한 exact migration path
  - timetable/curriculum scope를 Task 5의 별도 forward migration으로 추가한다.
- `supabase/tests/ops_task_page_reads_test.sql`
- `supabase/tests/management_page_reads_test.sql`
- `supabase/tests/operations_academic_scoped_reads_test.sql`
- `supabase/tests/academic_scoped_reads_test.sql`

### Core source surfaces

- `src/features/tasks/ops-task-service.ts`
- `src/features/tasks/ops-task-workspace.tsx`
- `src/features/tasks/registration-track-service.ts`
- `src/features/management/use-management-records.ts`
- `src/features/management/management-page.tsx`
- `src/features/management/management-service.js`
- `src/features/operations/use-operations-workspace-data.ts`
- `src/features/operations/academic-calendar-workspace.tsx`
- `src/features/operations/academic-annual-board-workspace.tsx`
- `src/features/operations/class-schedule-workspace.tsx`
- `src/features/academic/use-academic-workspace-data.ts`
- `src/features/academic/timetable-workspace.tsx`
- `src/features/academic/curriculum-workspace.tsx`
- `src/server/public-classes-payload.js`
- `src/server/public-classes-api.js`
- `src/lib/public-classes-server.js`
- `src/app/api/public-classes/route.ts`

---

### Task 1: 공통 query budget 회귀 가드

**Files:**
- Create: `tests/query-surface-budget.test.mjs`
- Create: `src/lib/query-surface-budget.js`
- Create: `scripts/verify-query-surface-budget.mjs`
- Create: `src/lib/keyset-pagination.ts`
- Create: `tests/keyset-pagination.test.mjs`

- [ ] **Step 1: 신규 위반을 드러내는 RED fixture test를 작성한다**

  임시 fixture source에 다음 위반을 하나씩 넣고 verifier가 exact file/symbol/reason과 함께 거부하는지 검사한다.

  - list path의 `select("*")`
  - `.limit(31)` 또는 RPC의 `p_limit <= 30`
  - abortSignal 또는 retry(false) 누락
  - list path의 `.in("task_id", taskIds)` 없음
  - cursor encode/decode가 malformed/base64/unknown version을 거부

- [ ] **Step 2: 현재 위반은 exact debt manifest로 고정한다**

  debt manifest는 이 계획에서 수정할 exact file, symbol, surface, violation code, baseline SHA를 가진다. wildcard path나 regex-only 예외를 금지한다. verifier는 `--surface tasks|management|operations|academic|public|all`을 요구한다. Task 2~6에서 완료한 surface row만 같은 commit에서 제거한다.

- [ ] **Step 3: verifier와 cursor parser를 최소 구현한다**

  공개 list cursor는 `{v:1,s:(string|number|null)[],id:uuid,scope:string}` JSON을 base64url로 인코딩하고 길이 1024자를 제한한다. `scope`는 surface + actor-visible role + canonical server filter/sort JSON의 SHA-256이며 filter/role/surface/sort가 달라지면 DB call 전에 `cursor_scope_mismatch`로 거부한다. DB parameter에는 decode·arity/type 검증된 sort tuple/id만 전달한다. management relation cursor는 위 별도 `{v,kind,entityId,relationKind,sortValue,id}` envelope를 사용한다.

  `scripts/verify-query-surface-budget.mjs`는 `verifyQuerySurfaceBudget({ surface, baseSha, headSha?, includeWorktree })` export 하나만 호출하는 thin CLI다. CI mode는 `--surface <tasks|management|operations|academic|public|all> --base <sha> --head <sha>`, local pre-commit mode는 `--surface <...> --base HEAD --worktree`를 요구한다. worktree mode는 base 이후 committed/index/unstaged additions를 모두 검사한다. mode arguments/surface 누락과 unknown surface는 fail-closed한다.

- [ ] **Step 4: GREEN을 확인하고 커밋한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/query-surface-budget.test.mjs tests/keyset-pagination.test.mjs`

  Expected: synthetic 신규 위반은 거부되고, 현재 legacy debt만 exact manifest로 인식되어 PASS.

  Commit: `test: define dashboard query budgets`

---

### Task 2: 업무 목록과 선택 상세 분리

**Files:**
- Create via CLI: generated `ops_task_page_reads` migration
- Create: `supabase/tests/ops_task_page_reads_test.sql`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/ops-task-service-loading.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

- [ ] **Step 1: 30+1 cursor와 zero-child-read RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new ops_task_page_reads`를 실행하고 exact path를 공용 `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`의 `orderedNewMigrations`에 `status:"draft",sha256:null`로 기록한다. SQL+RED source test가 준비되면 DB test 직전에 current SHA-256의 `candidate`로 바꾸고, pgTAP/EXPLAIN이 GREEN이면 commit 직전에 같은 hash의 `final`로 승격한다. SQL 수정은 새 candidate hash와 DB test 재실행을 요구한다. 첫 페이지가 31행 중 30행만 반환하고 `nextCursor`를 만들며, 목록을 열 때 comments/attachments/events/subtype detail fake query count가 0인지 검증한다. deep link ID가 현재 page 밖이면 exact-ID loader가 호출되어야 한다.

- [ ] **Step 2: list/aggregate SQL 계약 RED를 작성한다**

  `list_ops_task_page_v1(p_type text,p_filters jsonb,p_cursor_sort_values jsonb,p_cursor_id uuid,p_limit integer)`와 `get_ops_task_list_stats_v1(p_type text,p_filters jsonb)`를 검사한다. `p_filters`는 위 task subtype별 exact keys만 허용하고 unknown/missing/cross-subtype key를 거부한다. cursor tuple은 아래 selected subtype/sort contract의 exact arity/type만 허용한다. 두 함수는 명시적 columns, `security invoker`, max 30, authenticated-only여야 한다.

- [ ] **Step 3: RPC와 query-driven index를 구현한다**

  목록 projection은 위 discriminated `OpsTaskListRow`를 exact 반환한다. base에는 일반 업무 카드/표가 실제 렌더링·정렬하는 priority, 요청자 ID/label/team, 담당자·보조담당자 ID/label/team, subject, start/due/completed/created/updated timestamps까지 포함한다. withdrawal/transfer/word-retest는 30-row query 안에서 자기 detail table만 1:1 join해 전 sortable union의 `displayValues`와 inline checklist/score/retry state를 반환한다. 이 compact row만으로 현재 list cell과 inline control을 그려야 하며 행마다 detail loader를 부르거나 comments/attachments/events를 join하면 실패다. registration branch는 같은 page row에 기존 `OpsRegistrationObservationTrackSummary`의 track/observation summary를 포함하고 page response 최상위에 기존 `RegistrationRuntimeState`를 정확히 한 번 포함한다. list RPC가 maintenance/legacy/ready를 임의 boolean으로 축약하지 않는다. fixture는 general/textbook의 현재 card/table renderer가 읽는 property set을 AST로 추출해 base type/SQL projection에 빠진 field가 0인지, 각 subtype row의 `displayValues`와 inline state만으로 현재 first-page DOM/cell text와 enabled action state가 legacy full `OpsTask` fixture와 exact 같은지 검증한다.

  visible sort를 그대로 SQL tuple로 고정한다. 모든 enum rank/date fallback은 DB helper와 `ops-task-model.js` parity fixture가 exact 일치해야 하며 최종 tie-breaker는 항상 `id asc`다.

  - general completed: `(coalesce(completed_at,updated_at,created_at) desc,id asc)`
  - general due: `(date_bucket asc,primary_date asc nulls last,priority_rank asc,coalesce(created_at,updated_at) desc,id asc)`
  - general status: `(workflow_status_rank asc,date_bucket asc,primary_date asc nulls last,priority_rank asc,coalesce(created_at,updated_at) desc,id asc)`
  - general priority: `(priority_rank asc,date_bucket asc,primary_date asc nulls last,coalesce(created_at,updated_at) desc,id asc)`
  - registration/withdrawal/transfer default: `(updated_at desc,id asc)`; withdrawal/transfer table header sort가 선택되면 해당 `WithdrawalSortableColumnKey|TransferSortableColumnKey`의 normalized display text `asc|desc`, 그 다음 `(updated_at desc,id asc)`
  - word-retest default: `(coalesce(test_at,due_at,start_at) asc nulls last,coalesce(created_at,updated_at) asc,id asc)`; header sort가 선택되면 해당 `WordRetestSortableColumnKey`의 normalized display text `asc|desc`, 그 다음 default tuple

  header sort는 dynamic SQL이나 임의 column name을 사용하지 않는다. RPC의 allowlisted `CASE` projection이 아래 exact display contract를 `text not null collate dashboard_private.ko_numeric`으로 만든다. `text(fallback)`은 `btrim` 뒤 빈 값을 fallback으로 바꾸고, `decimal(fallback)`은 JS `String(Number(value))`와 같은 trailing-zero 없는 decimal text 또는 지정 fallback, `date("-")`는 KST `YYYY-MM-DD` 또는 `-`, `datetime("")`은 KST `YYYY-MM-DDTHH:MM` 또는 빈 문자열이다. 따라서 header sort에는 SQL NULL이 없고 별도 `NULLS FIRST|LAST`를 적용하지 않는다.

  - withdrawal: `status=workflow status Korean CASE`, `subject=text("-")`, `teacher=withdrawal.teacher_name→"미지정"`, `className=task.class_name→"-"`, `student=task.student_name→"-"`, `withdrawalDate=date("-")`, `withdrawalSession=text("-")`, `completedLessonHours=decimal("-")`, `fourWeekLessonHours=decimal("-")`, `progress=total>0 ? least(100,round(completed/total))||'%' : '-'`, `customerReason|teacherOpinion|undistributedTextbooks=text("-")`, `operationsChecklist=checked count||'/3 · '||ordered pending labels 또는 '3/3 · 처리 확인 완료'`.
  - transfer: `status=workflow status Korean CASE`, `subject=text("-")`, `fromTeacher|toTeacher=detail teacher→"미지정"`, `fromClassName=text("-")`, `toClassName=detail.to_class_name→task.class_name→"-"`, `student=text("-")`, `transferReason|fromUndistributedTextbooks|fromClassEndSession|toClassStartSession|toUndistributedTextbooks=text("-")`, `fromClassEndDate|toClassStartDate=date("-")`, `operationsChecklist`는 withdrawal과 같은 count/pending 형식과 transfer label 순서를 쓴다.
  - word-retest: `status`는 `statusValue=coalesce(nullif(btrim(retest_status),''),'not_started')`, 유효 numeric cutoff, 유효 numeric score 배열로 먼저 `scoreResult=passed|failed|null`을 만든다. task status가 `review_requested|done`이면 `statusValue=absent→미응시`, `scoreResult=passed→완료: 합격`, `failed→미완료: 불합격`, `statusValue in(done,in_progress)→완료` 순서로 판정한다. 남은 값은 `not_started→시작 전`, `in_progress→진행 중`, `absent→미응시`, `done→완료`, unknown→`시작 전`이다. `testAt=KST YYYY-MM-DD 또는 ''`, `expectedRetestAt=datetime("")`, `teacher=detail.teacher_name→assignee label→requester label→'미지정'`, `class=task.class_name→detail.class_name→'미지정'`, `student=task.student_name→detail.student_name→'미지정'`, `textbook=task.textbook_title→detail.textbook_name→'미지정'`, `unit=text("미지정")`, `note=detail.request_note→task.memo→''`, `total|cutoff=decimal("")`, `score=max(유효 numeric first/second/third score)의 decimal("")`이다. `result`는 `statusValue=absent→미응시`; absent가 아니면 cutoff와 유효 score가 모두 있을 때만 하나라도 score>=cutoff면 `통과`, 아니면 `재시험`; cutoff 또는 유효 score가 없으면 `미정`이다.

  `action`과 word-retest `select`는 request schema부터 거부한다. header cursor tuple arity는 withdrawal/transfer `[displayText,updatedAt]`, word-retest `[displayText,effectiveTestAt,effectiveCreatedAt]`; default tuple은 각각 `[updatedAt]`, `[effectiveTestAt,effectiveCreatedAt]`이다. `sortDirection` 없이 `sortColumn`만 있거나 그 반대인 요청도 거부한다. asc predicate는 `displayText > cursor`, desc predicate는 `<`를 쓰고 동률이면 뒤 tuple을 각자의 선언된 direction/null 규칙으로 전개한다. 마지막 tie-breaker `id asc`는 항상 `id > cursorId`다.

  RPC는 selected contract tuple을 response `sortValues`에 그대로 반환하고 next predicate는 같은 direction/null semantics의 lexicographic comparison을 사용한다. header sort column/direction도 `OpsTaskPageFilters`와 scope hash에 포함한다. client는 page를 다시 정렬하지 않는다. index 후보는 실제 filter/sort/EXPLAIN 뒤 task type + dominant date/status/priority expression의 작은 partial index만 선택하고 operations plan의 DDL budget을 지킨다; index 없이는 30-row bounded sort가 허용될 수 있지만 full table projection은 금지한다. fixture는 위 세 union의 모든 member를 열거해 현재 `getWithdrawalTableValue`, `getTransferTableValue`, `getWordRetestTableValue` + `localeCompare("ko",{numeric:true})` 결과와 SQL display/order를 양방향으로 비교하고 `action|select|unknown` 거부를 확인한다. 각 sort의 같은 값/빈 값/31·32번째 boundary/insertion-between-pages에서 중복·누락 0과 JS visible order parity도 검증한다.

- [ ] **Step 4: service 계약을 page/detail로 나눈다**

  ```ts
  type OpsTaskPageLoadOptions = {
    filters: OpsTaskPageFilters
    cursor: KeysetCursor | null
    limit: 30
    viewerId: string
  }
  ```

  기존 `OpsTaskWorkspaceLoadOptions`의 `force`, `taskType`, `viewerId`, option-loading flags를 깨지 않는다. 새 `OpsTaskPageLoadOptions`를 별도로 추가하고 existing workspace options가 현재 subtype UI state를 위 discriminated `OpsTaskPageFilters`로 exact 조립한다. list/stats RPC는 `(taskType, canonical filters JSON)`의 allowed keys/types/date ranges를 fail-closed 검증하고 search/status/requester/team/assignee/queue/focus/branch/period/subject/teacher/class filters를 SQL `WHERE`에 모두 적용한 뒤 order/31 limit을 적용한다. stats와 bounded filter-option catalogs도 같은 canonical filter family를 사용하되 cursor/limit은 제외한다. client-side filter로 30행을 다시 줄이지 않는다. `readOpsTaskWorkspaceData()`의 generic 7개 child fan-out을 제거하되 registration은 `readOpsRegistrationParentWorkspaceData()`의 `OpsRegistrationObservationTrackSummary[]`와 `RegistrationRuntimeState`를 위 `OpsTaskPageResponse`에 보존한다. option catalog는 editor를 열 때 기존 option-loading flag로 별도 로드하며 page payload에 섞지 않는다. `loadOpsTaskById()`는 task 한 건과 `.eq("task_id", taskId)` child projections만 읽고 profile도 필요한 ID만 조회한다. pgTAP/source fixtures는 각 subtype filter가 31/32번째 경계 row를 포함·제외할 때 page와 stats가 동일 semantics이고 cursor scope가 filter 변경 시 거부되는지 검증한다.

- [ ] **Step 5: workspace를 append/patch 방식으로 바꾼다**

  `loadMore()`는 ID dedupe append, filter 변경은 page-one replace, mutation은 affected row patch/remove/prepend를 한다. 목록 끝에 `다음 30건` button과 loading/hasMore/end state를 둔다. deep link는 list presence와 무관하게 exact detail을 연다. registration parent list의 track summary, observation/runtime readiness, fixture first-page cache parity를 별도 tests로 고정한다.

- [ ] **Step 6: 집중 회귀와 pgTAP을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/ops-task-service-loading.test.mjs \
    tests/ops-task-workspace.test.mjs \
    tests/registration-track-service.test.mjs \
    tests/registration-track-workspace.test.mjs \
    tests/query-surface-budget.test.mjs
  "$TASK_NODE" scripts/verify-query-surface-budget.mjs --surface tasks --base HEAD --worktree
  "$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/ops_task_page_reads_test.sql
  ```

- [ ] **Step 7: 커밋한다**

  Commit: `perf: page task lists and defer task details`

---

### Task 3: 학생·수업·교재 목록과 상세 분리

**Files:**
- Create via CLI: generated `management_page_reads` migration
- Create: `supabase/tests/management_page_reads_test.sql`
- Modify: `src/features/management/use-management-records.ts`
- Modify: `src/features/management/management-page.tsx`
- Modify: `src/features/management/management-service.js`
- Modify: `tests/management-progressive-loading.test.mjs`
- Modify: `tests/management-students-toolbar.test.mjs`
- Modify: `tests/management-class-student-roster.test.mjs`
- Modify: `tests/management-student-detail-selects.test.mjs`
- Modify: `tests/management-student-lifecycle-history.test.mjs`
- Modify: `tests/management-service-schema-fallback.test.mjs`

- [ ] **Step 1: list projection/global stats/detail RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new management_page_reads`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED source test 뒤 DB test 직전에 current SHA-256의 `candidate`, 모든 relation pagination pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격하며 SQL 수정 시 candidate와 DB evidence를 다시 만든다. 30행 list에는 편집용 catalog, audit, 수강 이력, schedule_plan, lessons가 없어야 한다. 전체 count/합계는 30행 length가 아니라 별도 stats RPC 값이어야 한다. 선택 전 enrichment query는 0이다.

- [ ] **Step 2: Korean sort cursor 계약을 RED로 고정한다**

  위 `dashboard_private.ko_numeric` collation과 exact normalized expression을 source contract로 검사한다. 동일 이름, `수학 2`/`수학 10`, null/공백, 페이지 경계 insert가 있어도 중복/누락 없는 fixture를 pgTAP에 넣는다. DB predicate/order/반환 cursor가 같은 expression과 collation을 사용해야 한다.

- [ ] **Step 3: page/stats/detail RPC를 구현한다**

  `list_management_page_v1(p_kind text,p_filters jsonb,p_cursor_sort_key text,p_cursor_id uuid,p_limit integer)`, `get_management_stats_v1(p_kind text,p_filters jsonb)`, `list_management_filter_options_v1(p_kind text,p_filters jsonb)`, `get_management_detail_v1(p_kind,p_id)`, `list_management_detail_relation_page_v1(p_kind,p_id,p_relation_kind,p_cursor_sort_key default null,p_cursor_id default null,p_limit default 30)`를 추가한다. list filters는 위 `ManagementListFilters` branch와 exact keys/types만 허용한다. 학생의 search/status/schoolCategory/school/grade, 수업의 search/period/status/subject/grade/teacher/classroom, 교재의 search/status/subject/publisher를 list/stats SQL `WHERE`, canonical scope hash, cursor/cache key에 모두 넣고 server filter 뒤 31건을 읽는다. option RPC도 같은 current filter family를 사용하되 자기 field만 제외하는 faceted semantics와 collection별 hard limit 500을 고정한다. client가 first 30 rows에서 options/count를 만들거나 다시 filter하지 않는다. 각 kind visible filter에서 matching row가 31/32번째 경계에 있는 list/stats/options parity와 filter 변경 cursor rejection을 검증한다. kind는 `students|classes|textbooks` 외 값을 거부한다. detail RPC는 요청 kind와 같은 위 `ManagementDetailResponse` branch만 반환하고 각 paged relation의 first server 31/read 30 page를 담는다. 후속 page는 relation RPC 하나만 사용하고 `(kind,relation_kind)`를 exact allowlist `students:enrollments|lifecycle_history|class_picker`, `classes:registered_students|waitlisted_students`, `textbooks:active_classes|purchase_history`로 검증한 뒤 같은 `ManagementRelationPageResponse` branch 하나만 반환한다. opaque relation cursor envelope는 `{v:1,kind,entityId,relationKind,sortValue,id}`를 base64url encode하고 route가 signed request의 kind/ID/relation과 exact match를 검사한 뒤에만 sort/id를 RPC에 전달한다. mismatch/malformed/unknown version은 DB call 0과 `relation_cursor_mismatch`다. pgTAP은 decoded fields의 allowlist/order를, route test는 학생 lifecycle cursor를 class roster나 다른 student ID에 재사용하면 거부되는지 고정한다. 학생은 editable record/enrollments/lifecycle/class picker, 수업은 editable record/schedule/registered+waitlisted roster/textbooks/groups/form references, 교재는 editable record/taxonomy/active class/progress/purchase history만 읽는다. 다른 kind relation, audit full row, unrelated catalog, full workspace arrays는 반환하지 않는다.

- [ ] **Step 4: 실제 abort가 있는 service로 교체한다**

  `readOptionalTable(..., "*")`, timer-only `withTableTimeout`, 전체 `listStudents/listClasses`를 list path에서 제거한다. relation picker는 검색어가 있을 때 명시적 projection으로 30건만 조회한다.

- [ ] **Step 5: UI를 selection-driven detail로 변경한다**

  `openRow()`가 exact detail을 가져온 뒤 drawer/editor를 연다. URL deep link는 현재 page에 row가 없어도 exact detail을 조회한다. 저장 뒤 해당 ID만 re-read하고 page/stats cache만 필요한 범위로 무효화한다. 세 management 화면 모두 `다음 30건`, loading, retry, end state와 cursor filter reset을 제공한다.

- [ ] **Step 6: 집중 회귀를 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/management-progressive-loading.test.mjs \
    tests/management-students-toolbar.test.mjs \
    tests/management-class-student-roster.test.mjs \
    tests/management-student-detail-selects.test.mjs \
    tests/management-student-lifecycle-history.test.mjs \
    tests/management-service-schema-fallback.test.mjs
  "$TASK_NODE" scripts/verify-query-surface-budget.mjs --surface management --base HEAD --worktree
  "$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/management_page_reads_test.sql
  ```

- [ ] **Step 7: 커밋한다**

  Commit: `perf: page management lists and lazy load records`

---

### Task 4: operations 화면을 mode와 날짜 범위로 분리

**Files:**
- Create via CLI: generated `operations_scoped_reads` migration
- Create: `supabase/tests/operations_academic_scoped_reads_test.sql`
- Modify: `src/features/operations/use-operations-workspace-data.ts`
- Modify: `src/features/operations/academic-calendar-workspace.tsx`
- Modify: `src/features/operations/academic-annual-board-workspace.tsx`
- Modify: `src/features/operations/class-schedule-workspace.tsx`
- Modify: `tests/academic-calendar-ui.test.mjs`
- Modify: `tests/academic-annual-board.test.mjs`
- Modify: `tests/class-schedule-planner-calendar-toggle.test.mjs`
- Modify: `tests/continuous-class-schedule-consumer-parity.test.mjs`

- [ ] **Step 1: 17-table fan-out 제거 RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new operations_scoped_reads`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED source test 뒤 DB test 직전에 current SHA-256의 `candidate`, calendar/annual/detail pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격하며 SQL 수정 시 candidate와 DB evidence를 다시 만든다. calendar mode가 annual/schedule tables를, annual mode가 calendar 밖 연도를, schedule list가 schedule_plan/detail을 조회하지 않는지 fake query recorder로 검증한다.

- [ ] **Step 2: 세 scope RPC 계약을 작성한다**

  - calendar: 최대 42일 visible grid의 위 `CalendarEventRow` projection 전체, hard limit 2,000
  - annual: 선택 연도의 위 `AcademicAnnualBoardRow`/entry projection 전체와 summary. entry 총합 hard limit 4,000, serialized payload 400KiB
  - class schedule list: 선택 term/filter의 30-row summary

  class schedule list RPC/stats는 `termId/search/subject/grade/teacher/syncGroupId`를 모두 server `WHERE`와 같은 canonical scope hash에 포함하고 filter-option catalogs만 bounded distinct projection으로 반환한다. client가 30행 뒤에서 다시 filter하지 않는다. 날짜/연도 범위 guard, explicit columns, ACL을 검사한다. calendar 2,001개 fixture는 `VisibleRangeResult`의 error branch, rows 0, suggestedDays 7을 반환해야 한다. annual board list에는 full note/embedded JSON/raw curriculum rows를 넣지 않고 hover/display에 필요한 bounded scope/display section만 넣는다. 편집 drawer는 `get_academic_event_detail_v1(p_event_id)`로 위 `AcademicEventDetail` 한 건을 읽는다. annual 4,001 entry 또는 400KiB 초과는 partial board 대신 `annual_board_too_dense`를 반환하고 기존 성공 board를 유지한다. class schedule은 각 visible filter에서 matching row가 31번째 경계에 있을 때 first/second page와 stats가 같은 semantics이고 filter 변경 cursor가 거부되는 fixture를 둔다.

- [ ] **Step 3: RPC와 mode-specific service를 구현한다**

  `useOperationsWorkspaceData(request: OperationsWorkspaceRequest)`는 해당 mode query만 시작한다. calendar는 `VisibleRangeResult<CalendarEventRow>`, annual은 `{ok:true,data:AnnualBoardResult}|{ok:false,code:"annual_board_too_dense"}`, class_schedule은 `ListWithStats<ClassScheduleListRow, ClassScheduleStats>`와 bounded term/subject/grade/teacher/sync-group filter options를 반환하는 discriminated union이다. request의 모든 class-schedule filter와 canonical scope hash를 cursor/cache key에 넣고 변경 시 page one으로 reset한다. event edit/hover full detail은 selection 전 query 0, selection 뒤 exact ID 1이다. 작은 teacher/classroom/subject catalog는 사용자·role scope 메모리에서 30분 보관한다.

- [ ] **Step 4: 선택 수업 detail 경계를 보존한다**

  기존 `get_class_schedule_v1(classId,dateFrom,dateTo)`를 계속 사용하고, class list에서는 절대 `schedule_plan`을 읽지 않는다. 저장 뒤 선택 수업과 visible date range만 갱신한다.

- [ ] **Step 5: mode별 continuation을 구현한다**

  calendar는 42일 visible grid 전체를 한 번 표시하고 pagination이 없다. 2,000-row guard 초과 시 이전 성공 grid를 유지하고 `한 주 보기`로 7일을 다시 조회한다. annual은 선택 연도 aggregate라 pagination이 없다. class schedule list만 `다음 30건`, ID dedupe append, filter/term 변경 시 cursor reset, loading/retry/end state를 제공한다.

- [ ] **Step 6: 집중 회귀와 커밋을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/academic-calendar-ui.test.mjs \
    tests/academic-annual-board.test.mjs \
    tests/class-schedule-planner-calendar-toggle.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs
  "$TASK_NODE" scripts/verify-query-surface-budget.mjs --surface operations --base HEAD --worktree
  "$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/operations_academic_scoped_reads_test.sql
  ```

  Commit: `perf: scope operations reads by workspace`

---

### Task 5: academic 시간표·커리큘럼 source 분리

**Files:**
- Create via CLI: generated `academic_scoped_reads` migration
- Create: `supabase/tests/academic_scoped_reads_test.sql`
- Modify: `src/features/academic/use-academic-workspace-data.ts`
- Modify: `src/features/academic/timetable-workspace.tsx`
- Modify: `src/features/academic/curriculum-workspace.tsx`
- Modify: `tests/timetable-layout.test.mjs`
- Modify: `tests/curriculum-filter-panel.test.mjs`
- Modify: `tests/continuous-class-schedule-consumer-parity.test.mjs`

- [ ] **Step 1: mode-specific zero-query RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new academic_scoped_reads`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED source test 뒤 DB test 직전에 current SHA-256의 `candidate`, timetable collection/visible-range와 curriculum pagination pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격하며 SQL 수정 시 candidate와 DB evidence를 다시 만든다. timetable이 curriculum progress/textbook source를 읽지 않고, curriculum list가 모든 class detail과 session을 읽지 않는지 검증한다. timetable은 최대 14일 visible range의 projection 전체를 반환하고, curriculum list만 현재 client 40-row batch를 server 30-page contract로 바꾸는 assertion을 추가한다.

- [ ] **Step 2: timetable/curriculum RPC branch를 추가한다**

  timetable은 최대 14일 visible range의 schedule rows와 현재 model/filter가 소비하는 `classSummaries`, terms, groups, memberships, referenced teacher/classroom catalogs, status/subject filter options를 누락 없이 반환한다. `TimetableRow`는 현재 `createTimetableRow()` 결과의 `id/title/fullTitle/academicYear/subject/subjectAreaKey/grade/teacher/classroom/term/schedule/status/statusFilter/classGroupIds/classGroupNames/classGroupLabel/day/dayIndex/start/end/startMinutes/endMinutes/durationMinutes/searchText`와 exact 1:1이다. RPC normalizer가 이 shape를 만들고 `buildTimetableWorkspaceModel()`은 optional `precomputedRows`를 받도록 refactor하여 있으면 schedule parse/create 단계를 건너뛰되 existing filtering/options/load/summary 계산은 같은 함수로 수행한다. legacy classes input과 precomputed rows fixture가 row/model/grid block deep equality인지 고정한다. schedule row hard limit 2,000 초과는 partial rows 없이 `visible_range_too_dense`/suggestedDays 7을 반환한다. 여섯 supporting collection 중 하나가 500을 넘으면 거짓 `observedRowsAtLeast:2001`을 쓰지 않고 exact collection과 `observedItemsAtLeast:501`의 `timetable_collection_too_dense`를 반환한다. curriculum list RPC/stats는 `periodId/search/status/subject/grade/teacher/classroom/viewMode`를 모두 server-side 적용하고 canonical scope hash/cursor/cache key에 넣은 뒤 31건을 읽어 30건을 반환한다. filter options는 bounded distinct projection이며 client-side post-filter를 금지한다. 선택 detail만 bounded schedule/progress/textbook rows를 읽고, 각 filter에서 matching row가 31번째 경계에 있는 page/stats parity fixture를 둔다.

- [ ] **Step 3: hook과 UI를 page/detail로 연결한다**

  `useAcademicWorkspaceData(request: AcademicWorkspaceRequest)`는 timetable에 위 `TimetableResult`, curriculum에 `ListWithStats<CurriculumListRow, CurriculumStats>`를 반환한다. timetable request는 `classGroupId/status/subject` filters를 server에 전달하고, success에는 visible rows와 filter-compatible class summaries 및 bounded terms/groups/members/referenced teacher/classroom catalogs가 포함되며 textbooks/progress는 포함하지 않는다. each supporting collection hard limit은 500이고 초과 시 `timetable_collection_too_dense`; schedule rows 2,000 초과만 `visible_range_too_dense`다. timetable은 cursor가 없고 어떤 `ok:false` branch에서도 이전 성공 결과를 유지한다. visible-range 오류는 `한 주 보기`, collection 오류는 더 좁은 period/status/subject 선택 행동을 제공한다. curriculum은 filter/term을 cursor cache key에 포함하고 `다음 30건`, ID dedupe append, filter/term cursor reset, loading/retry/end state를 제공한다. 전체 합계를 visible 30행에서 계산하지 않는다. mutation 뒤 current entity와 aggregate만 갱신한다.

- [ ] **Step 4: 집중 회귀와 커밋을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/timetable-layout.test.mjs \
    tests/curriculum-filter-panel.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/query-surface-budget.test.mjs
  "$TASK_NODE" scripts/verify-query-surface-budget.mjs --surface academic --base HEAD --worktree
  "$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/academic_scoped_reads_test.sql
  ```

  Commit: `perf: page academic workspaces by active mode`

---

### Task 6: 공개수업 10분 last-good summary cache

**Files:**
- Create: `src/server/public-classes-cache.js`
- Create: `src/server/public-classes-cache.d.ts`
- Create: `tests/public-classes-cache.test.mjs`
- Create: `tests/public-classes-cache.integration.test.mjs`
- Create: `tests/fixtures/public-classes-cache-next-app/**`
- Create: `src/server/public-classes-cache-invalidation.js`
- Create: `src/app/api/public-classes/cache/invalidate/route.ts`
- Create: `tests/public-classes-cache-invalidation.test.mjs`
- Modify: `src/server/public-classes-payload.js`
- Modify: `src/server/public-classes-api.js`
- Modify: `src/lib/public-classes-server.js`
- Modify: `src/app/api/public-classes/route.ts`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/management/management-service.js`
- Modify: `src/features/textbooks/textbook-service.ts`
- Modify: `src/features/operations/class-schedule-workspace.tsx`
- Modify: `tests/public-classes-summary-loading.test.mjs`

- [ ] **Step 1: unit contract와 실제 Next process cache RED 테스트를 작성한다**

  injectable loader unit test로 600초 fresh, concurrent dedupe, warm entry의 background revalidation 실패 시 이전 success 유지, cold failure 시 static snapshot, fallback-empty 미저장, generation-safe refresh를 검증한다. 별도 `tests/fixtures/public-classes-cache-next-app`은 production cache module을 import하고 local-only counter adapter를 쓰는 최소 Next App이다. integration test는 한 번 build한 뒤 reserved loopback port에서 process A를 시작해 같은 key를 두 번 요청하고 loader count 1을 확인한다. process A를 정상 종료한 뒤 같은 build/cache directory로 process B를 시작해 다시 요청하고 count가 그대로 1인지 확인해 persistent Data Cache의 process 간 reuse를 증명한다. tag invalidation 뒤에는 count 2, failed revalidation 뒤에는 last-good response 유지도 HTTP로 확인한다. fixture temp/cache/counter는 validated `/private/tmp/tips-public-cache-$TASK_REQUEST_ID` 아래만 사용하고 finally 정리한다. module-memory Map만으로는 GREEN이 될 수 없다.

- [ ] **Step 2: 기존 summary fallback 순서를 RED로 고정한다**

  internal page 순서는 `fresh Next Data Cache/live summary → warm stale entry during failed revalidation → public/data/public-classes.json을 summary로 normalize → empty unavailable`이다. public full `/api/public-classes`는 response shape를 유지하되 성공 header를 `public, max-age=0, s-maxage=600, stale-while-revalidate=3600`, fallback은 `no-store`로 고정한다.

- [ ] **Step 3: cache와 explicit full projection을 구현한다**

  internal `/classes`는 기존 summary contract를 유지한다. `unstable_cache(loadSuccessfulPublicClassSummary, ["public-classes-summary-v1"], { revalidate: 600, tags: ["public-classes-summary-v1"] })`를 사용해 Next Data Cache에 성공 결과만 저장한다. loader는 cookies/headers를 읽지 않고 public source arguments만 받는다. live fallback/empty를 throw로 바꿔 cache value가 되지 않게 한다. warm stale revalidation이 실패하면 Next Data Cache의 기존 success를 유지하고, cold throw만 caller가 `public/data/public-classes.json` snapshot으로 fallback한다. legacy full builder도 classes/textbooks/progress_logs의 `select("*")`를 명시적 compatibility projection으로 바꾼다. 별도 `summary-v2` response type을 만들지 않고 `cacheComponents` 전역 설정도 이 task에서 켜지 않는다.

- [ ] **Step 4: targeted invalidation을 연결한다**

  admin/staff session만 허용하는 `POST /api/public-classes/cache/invalidate` route는 reason enum `class|textbook|progress|schedule`과 UUID request ID만 받고 `revalidateTag("public-classes-summary-v1", "max")`와 `revalidatePath("/api/public-classes")`를 각각 한 번 호출한다. body에 record data/PII는 받지 않는다. classes/textbooks/progress 및 schedule을 바꾸는 확인된 mutation boundary—`ops-task-service.ts`, `management-service.js`, `textbook-service.ts`, `class-schedule-workspace.tsx`와 formal schedule-save RPC caller—에서 DB commit 성공 뒤 이 route를 호출한다. 실패/rollback은 호출하지 않고 unrelated mutation은 broad flush하지 않는다. invalidation route 실패는 이미 성공한 업무 저장을 rollback하지 않되 UI에 cache refresh pending을 남긴다.

- [ ] **Step 5: legacy API compatibility를 유지한다**

  `/api/public-classes` full response shape는 이 task에서 삭제하지 않는다. internal server summary path만 shared-cache에 연결하고 external full consumer가 없다는 운영 관찰 전에는 default를 바꾸지 않는다.

- [ ] **Step 6: 회귀와 커밋을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/public-classes-cache.test.mjs \
    tests/public-classes-cache.integration.test.mjs \
    tests/public-classes-cache-invalidation.test.mjs \
    tests/public-classes-summary-loading.test.mjs \
    tests/dashboard-snapshot-cache.test.mjs
  "$TASK_NODE" scripts/verify-query-surface-budget.mjs --surface public --base HEAD --worktree
  ```

  Commit: `perf: cache last good public class summaries`

---

### Task 7: 전체 검증과 source 완료 경계

**Files:**
- Verify: all changed files

- [ ] **Step 1: query budget 전체 GREEN을 확인한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/query-surface-budget.test.mjs`

  Expected: 대상 목록에 wildcard, unbounded task-ID IN, timer-only timeout이 없고 모든 page limit이 30/31이다.

- [ ] **Step 2: 전체 검증을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types tests/*.test.mjs tests/*.node.ts
  "$TASK_PNPM" exec tsc --noEmit --pretty false
  "$TASK_PNPM" eslint src tests middleware.ts next.config.ts
  "$TASK_PNPM" build
  git diff --check
  git status --short
  ```

- [ ] **Step 3: local query 증거를 남긴다**

  합성 DB에서 각 주요 list의 첫/다음 page와 exact detail에 대해 query count, response bytes, `EXPLAIN (ANALYZE, BUFFERS)`를 기록한다. 운영 데이터나 실사용자 PII를 fixture에 복사하지 않는다.

- [ ] **Step 4: source 구현 완료를 보고하고 멈춘다**

  Commit: `test: verify bounded dashboard query surfaces`

## Separately Authorized Rollout Gates

1. 운영 read-only baseline과 query plan 비교
2. migration 4개를 한 번에 하나씩 적용하고 ACL/row parity 확인
3. 최신 `main` 통합과 GitHub push
4. Vercel Production SHA/`READY` 확인
5. 실제 브라우저에서 list 30, load-more, deep link exact detail 확인
6. public summary cache hit과 Supabase query zero 확인
7. 외부 full API consumer 7일 관찰 뒤 default contract 변경 여부 별도 결정
