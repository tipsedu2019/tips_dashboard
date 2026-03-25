import { ACTIVE_CLASS_STATUS } from '../../lib/classStatus.js';
import { buildSchoolMaster } from '../../lib/schoolConfig.js';

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createWeeklySchedulePlan({
  startDate,
  endDate,
  textbookId,
  billingId,
  billingLabel,
  sessionCount = 4,
}) {
  return {
    version: 2,
    selectedDays: [1],
    globalSessionCount: sessionCount,
    billingPeriods: [
      {
        id: billingId,
        month: Number(String(startDate).slice(5, 7)),
        startDate,
        endDate,
        label: billingLabel,
      },
    ],
    textbooks: [
      {
        textbookId,
        order: 0,
        role: 'main',
      },
    ],
  };
}

export function createE2EMockData() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const classPlanStart = formatDate(new Date(currentYear, now.getMonth(), 3));
  const classPlanEnd = formatDate(new Date(currentYear, now.getMonth(), 31));
  const monthStart = new Date(currentYear, now.getMonth(), 10);
  const monthEnd = new Date(currentYear, now.getMonth(), 12);
  const fieldTripStart = new Date(currentYear, now.getMonth(), 15);
  const fieldTripEnd = new Date(currentYear, now.getMonth(), 16);
  const fieldTripSingle = new Date(currentYear, now.getMonth(), 18);
  const vacationDay = new Date(currentYear, now.getMonth(), 20);
  const miscDay = new Date(currentYear, now.getMonth(), 24);

  const academicSchools = [
    {
      id: 'school-1',
      name: 'Tips Middle School',
      category: 'middle',
      color: '#1F6B5B',
      sortOrder: 0,
      textbooks: {},
    },
  ];

  const schoolMaster = buildSchoolMaster(academicSchools, []);
  const defaultSchool = schoolMaster[0] || {
    id: 'school-1',
    name: 'Tips Middle School',
    category: 'middle',
    color: '#1F6B5B',
    grades: ['Middle'],
    sortOrder: 0,
  };
  const defaultGrade = 'Middle';

  const textbooks = [
    { id: 'textbook-1', title: 'Middle English Core', publisher: 'TIPS', subject: '영어' },
    { id: 'textbook-2', title: 'Middle Math Core', publisher: 'TIPS', subject: '수학' },
  ];

  const classes = [
    {
      id: 'class-1',
      name: 'Middle English A',
      className: 'Middle English A',
      subject: '영어',
      grade: defaultGrade,
      teacher: 'Lee Teacher',
      classroom: '301',
      room: '301',
      roomRaw: '301',
      schedule: 'Mon 16:00-17:30',
      status: ACTIVE_CLASS_STATUS,
      studentIds: ['student-1'],
      waitlistIds: [],
      textbookIds: ['textbook-1'],
      termId: 'term-1',
      startDate: classPlanStart,
      endDate: classPlanEnd,
      schedulePlan: createWeeklySchedulePlan({
        startDate: classPlanStart,
        endDate: classPlanEnd,
        textbookId: 'textbook-1',
        billingId: 'billing-english-a',
        billingLabel: 'English A Month',
      }),
      capacity: 8,
      tuition: 250000,
    },
    {
      id: 'class-2',
      name: 'Middle Math B',
      className: 'Middle Math B',
      subject: '수학',
      grade: defaultGrade,
      teacher: 'Park Teacher',
      classroom: '302',
      room: '302',
      roomRaw: '302',
      schedule: 'Wed 18:00-19:30',
      status: ACTIVE_CLASS_STATUS,
      studentIds: [],
      waitlistIds: [],
      textbookIds: ['textbook-2'],
      termId: 'term-1',
      startDate: classPlanStart,
      endDate: classPlanEnd,
      schedulePlan: createWeeklySchedulePlan({
        startDate: classPlanStart,
        endDate: classPlanEnd,
        textbookId: 'textbook-2',
        billingId: 'billing-math-b',
        billingLabel: 'Math Month',
      }),
      capacity: 8,
      tuition: 250000,
    },
    {
      id: 'class-3',
      name: 'Middle English B',
      className: 'Middle English B',
      subject: '영어',
      grade: defaultGrade,
      teacher: 'Lee Teacher',
      classroom: '303',
      room: '303',
      roomRaw: '303',
      schedule: 'Mon 18:00-19:30',
      status: ACTIVE_CLASS_STATUS,
      studentIds: [],
      waitlistIds: [],
      textbookIds: ['textbook-1'],
      termId: 'term-1',
      startDate: classPlanStart,
      endDate: classPlanEnd,
      schedulePlan: createWeeklySchedulePlan({
        startDate: classPlanStart,
        endDate: classPlanEnd,
        textbookId: 'textbook-1',
        billingId: 'billing-english-b',
        billingLabel: 'English B Month',
      }),
      capacity: 8,
      tuition: 250000,
    },
  ];

  const students = [
    {
      id: 'student-1',
      name: 'Kim Student',
      uid: 'S-001',
      school: defaultSchool.name,
      grade: defaultGrade,
      classIds: ['class-1'],
      waitlistClassIds: [],
      contact: '010-1111-2222',
      parentContact: '010-3333-4444',
      enrollDate: formatDate(new Date(currentYear, 0, 5)),
    },
  ];

  const teacherCatalogs = [
    { id: 'teacher-1', name: 'Lee Teacher', subjects: ['영어'], isVisible: true, sortOrder: 0 },
    { id: 'teacher-2', name: 'Park Teacher', subjects: ['수학'], isVisible: true, sortOrder: 1 },
  ];

  const classroomCatalogs = [
    { id: 'classroom-1', name: '301', subjects: ['영어'], isVisible: true, sortOrder: 0 },
    { id: 'classroom-2', name: '302', subjects: ['수학'], isVisible: true, sortOrder: 1 },
    { id: 'classroom-3', name: '303', subjects: ['영어'], isVisible: true, sortOrder: 2 },
  ];

  return {
    classes,
    classTerms: [
      {
        id: 'term-1',
        name: `${currentYear} Spring`,
        startDate: formatDate(new Date(currentYear, 2, 1)),
        endDate: formatDate(new Date(currentYear, 5, 30)),
        sortOrder: 0,
      },
    ],
    students,
    textbooks,
    progressLogs: [
      {
        id: 'progress-class-1-session-1',
        classId: 'class-1',
        textbookId: 'textbook-1',
        progressKey: 'class-1:session-1:textbook-1',
        sessionId: 'session-1',
        sessionOrder: 1,
        status: 'done',
        rangeLabel: 'Lesson 1',
        publicNote: 'Started as planned',
        updatedAt: `${classPlanStart}T10:00:00.000Z`,
      },
      {
        id: 'progress-class-3-session-1',
        classId: 'class-3',
        textbookId: 'textbook-1',
        progressKey: 'class-3:session-1:textbook-1',
        sessionId: 'session-1',
        sessionOrder: 1,
        status: 'done',
        rangeLabel: 'Lesson 1',
        updatedAt: `${classPlanStart}T11:00:00.000Z`,
      },
      {
        id: 'progress-class-3-session-2',
        classId: 'class-3',
        textbookId: 'textbook-1',
        progressKey: 'class-3:session-2:textbook-1',
        sessionId: 'session-2',
        sessionOrder: 2,
        status: 'done',
        rangeLabel: 'Lesson 2',
        updatedAt: `${classPlanStart}T12:00:00.000Z`,
      },
      {
        id: 'progress-class-2-session-1',
        classId: 'class-2',
        textbookId: 'textbook-2',
        progressKey: 'class-2:session-1:textbook-2',
        sessionId: 'session-1',
        sessionOrder: 1,
        status: 'partial',
        rangeLabel: 'Chapter 1',
        teacherNote: 'Need one more worksheet',
        updatedAt: `${classPlanStart}T13:00:00.000Z`,
      },
    ],
    classScheduleSyncGroups: [
      {
        id: 'sync-group-1',
        termId: 'term-1',
        name: 'English Sync Group',
        subject: '영어',
        color: '#3182f6',
        note: '',
      },
    ],
    classScheduleSyncGroupMembers: [
      {
        id: 'sync-member-1',
        groupId: 'sync-group-1',
        classId: 'class-1',
        sortOrder: 0,
      },
      {
        id: 'sync-member-2',
        groupId: 'sync-group-1',
        classId: 'class-3',
        sortOrder: 1,
      },
    ],
    academicEvents: [
      {
        id: 'event-assessment',
        title: 'March Assessment Window',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'Assessment',
        start: formatDate(monthStart),
        end: formatDate(monthEnd),
        grade: defaultGrade,
        note: '',
        color: '#1F6B5B',
      },
      {
        id: 'event-english-exam',
        title: 'English Exam',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'English Exam',
        start: formatDate(monthStart),
        end: formatDate(monthStart),
        grade: defaultGrade,
        note: '',
        color: '#4f6fe8',
      },
      {
        id: 'event-math-exam',
        title: 'Math Exam',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'Math Exam',
        start: formatDate(monthEnd),
        end: formatDate(monthEnd),
        grade: defaultGrade,
        note: '',
        color: '#7a52d1',
      },
      {
        id: 'event-field-trip',
        title: 'Field Trip 1',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'Field Trip',
        start: formatDate(fieldTripStart),
        end: formatDate(fieldTripEnd),
        grade: defaultGrade,
        note: '',
        color: '#2f8f73',
      },
      {
        id: 'event-field-trip-2',
        title: 'Field Trip 2',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'Field Trip',
        start: formatDate(fieldTripSingle),
        end: formatDate(fieldTripSingle),
        grade: defaultGrade,
        note: '',
        color: '#2f8f73',
      },
      {
        id: 'event-vacation',
        title: 'Vacation Day',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'Holiday',
        start: formatDate(vacationDay),
        end: formatDate(vacationDay),
        grade: defaultGrade,
        note: '',
        color: '#d07a2b',
      },
      {
        id: 'event-misc',
        title: 'Misc Schedule',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: 'Misc',
        start: formatDate(miscDay),
        end: formatDate(miscDay),
        grade: defaultGrade,
        note: '',
        color: '#64748b',
      },
    ],
    academicSchools: academicSchools.map((school) => ({
      ...school,
      grades: defaultSchool.grades,
    })),
    teacherCatalogs,
    classroomCatalogs,
    academicCurriculumProfiles: [],
    academicSupplementMaterials: [],
    academicExamScopes: [],
    academicExamDays: [],
    academicEventExamDetails: [],
    academyCurriculumPlans: [],
    academyCurriculumMaterials: [],
    academicExamMaterialPlans: [
      {
        id: 'school-plan-1',
        academicYear: currentYear,
        subject: '영어',
        schoolId: defaultSchool.id,
        grade: defaultGrade,
        examPeriodCode: 'S1_MID',
        note: 'Initial school memo',
        sortOrder: 0,
      },
    ],
    academicExamMaterialItems: [
      {
        id: 'school-plan-item-1',
        planId: 'school-plan-1',
        materialCategory: 'textbook',
        title: 'Middle English Core',
        publisher: 'TIPS',
        scopeDetail: 'Unit 1-2',
        note: '',
        sortOrder: 0,
      },
    ],
    academyCurriculumPeriodCatalogs: [],
    academyCurriculumPeriodPlans: [
      {
        id: 'academy-plan-1',
        academicYear: currentYear,
        subject: '영어',
        academyGrade: defaultGrade,
        catalogId: null,
        periodType: 'fixed',
        periodCode: 'S1_MID',
        periodLabel: 'Midterm',
        scopeType: 'class',
        classId: 'class-1',
        note: 'Academy roadmap memo',
        sortOrder: 0,
      },
    ],
    academyCurriculumPeriodItems: [
      {
        id: 'academy-item-1',
        planId: 'academy-plan-1',
        materialCategory: 'textbook',
        textbookId: 'textbook-1',
        title: 'Middle English Core',
        publisher: 'TIPS',
        planDetail: 'Chapter 1',
        note: '',
        sortOrder: 0,
      },
    ],
    isConnected: true,
    isLoading: false,
    lastUpdated: null,
    error: null,
  };
}
