import { ACTIVE_CLASS_STATUS } from '../../lib/classStatus';
import { buildSchoolMaster } from '../../lib/schoolConfig';

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createE2EMockData() {
  const now = new Date();
  const currentYear = now.getFullYear();
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
      name: '테스트중학교',
      category: 'middle',
      color: '#1F6B5B',
      sortOrder: 0,
      textbooks: {},
    },
  ];

  const schoolMaster = buildSchoolMaster(academicSchools, []);
  const defaultSchool = schoolMaster[0] || {
    id: 'school-1',
    name: '테스트중학교',
    category: 'middle',
    color: '#1F6B5B',
    grades: ['중3'],
    sortOrder: 0,
  };
  const defaultGrade = '중3';

  const classes = [
    {
      id: 'class-1',
      name: '중등 영어 A',
      className: '중등 영어 A',
      subject: '영어',
      grade: defaultGrade,
      teacher: '이정민',
      classroom: '301',
      room: '301',
      roomRaw: '301',
      schedule: '월 16:00-17:30',
      status: ACTIVE_CLASS_STATUS,
      studentIds: ['student-1'],
      waitlistIds: [],
      capacity: 8,
      tuition: 250000,
    },
    {
      id: 'class-2',
      name: '중등 수학 B',
      className: '중등 수학 B',
      subject: '수학',
      grade: defaultGrade,
      teacher: '박서준',
      classroom: '302',
      room: '302',
      roomRaw: '302',
      schedule: '화 18:00-19:30',
      status: ACTIVE_CLASS_STATUS,
      studentIds: [],
      waitlistIds: [],
      capacity: 8,
      tuition: 250000,
    },
  ];

  const students = [
    {
      id: 'student-1',
      name: '테스트 학생',
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
    { id: 'teacher-1', name: '이정민', subjects: ['영어'], isVisible: true, sortOrder: 0 },
    { id: 'teacher-2', name: '박서준', subjects: ['수학'], isVisible: true, sortOrder: 1 },
  ];

  const classroomCatalogs = [
    { id: 'classroom-1', name: '301', subjects: ['영어'], isVisible: true, sortOrder: 0 },
    { id: 'classroom-2', name: '302', subjects: ['수학'], isVisible: true, sortOrder: 1 },
  ];

  return {
    classes,
    classTerms: [
      {
        id: 'term-1',
        name: '2026 1학기',
        startDate: formatDate(new Date(currentYear, 2, 1)),
        endDate: formatDate(new Date(currentYear, 5, 30)),
        sortOrder: 0,
      },
    ],
    students,
    textbooks: [
      { id: 'textbook-1', title: '중등 영어 기본서', publisher: 'TIPS', subject: '영어' },
      { id: 'textbook-2', title: '중등 수학 기본서', publisher: 'TIPS', subject: '수학' },
    ],
    progressLogs: [],
    academicEvents: [
      {
        id: 'event-assessment',
        title: '3월 시험기간',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '시험기간',
        start: formatDate(monthStart),
        end: formatDate(monthEnd),
        grade: defaultGrade,
        note: '',
        color: '#1F6B5B',
      },
      {
        id: 'event-english-exam',
        title: '영어 시험일',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '영어시험일',
        start: formatDate(monthStart),
        end: formatDate(monthStart),
        grade: defaultGrade,
        note: '',
        color: '#4f6fe8',
      },
      {
        id: 'event-math-exam',
        title: '수학 시험일',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '수학시험일',
        start: formatDate(monthEnd),
        end: formatDate(monthEnd),
        grade: defaultGrade,
        note: '',
        color: '#7a52d1',
      },
      {
        id: 'event-field-trip',
        title: '1차 체험학습',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '체험학습',
        start: formatDate(fieldTripStart),
        end: formatDate(fieldTripEnd),
        grade: defaultGrade,
        note: '',
        color: '#2f8f73',
      },
      {
        id: 'event-field-trip-2',
        title: '2차 체험학습',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '체험학습',
        start: formatDate(fieldTripSingle),
        end: formatDate(fieldTripSingle),
        grade: defaultGrade,
        note: '',
        color: '#2f8f73',
      },
      {
        id: 'event-vacation',
        title: '봄 방학',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '방학·휴일',
        start: formatDate(vacationDay),
        end: formatDate(vacationDay),
        grade: defaultGrade,
        note: '',
        color: '#d07a2b',
      },
      {
        id: 'event-misc',
        title: '기타 일정',
        schoolId: defaultSchool.id,
        school: defaultSchool.name,
        type: '기타',
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
        note: '초기 학교 메모',
        sortOrder: 0,
      },
    ],
    academicExamMaterialItems: [
      {
        id: 'school-plan-item-1',
        planId: 'school-plan-1',
        materialCategory: 'textbook',
        title: '중등 영어 기본서',
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
        periodLabel: '1학기 중간',
        scopeType: 'class',
        classId: 'class-1',
        note: '학원 진도 메모',
        sortOrder: 0,
      },
    ],
    academyCurriculumPeriodItems: [
      {
        id: 'academy-item-1',
        planId: 'academy-plan-1',
        materialCategory: 'textbook',
        textbookId: 'textbook-1',
        title: '중등 영어 기본서',
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
