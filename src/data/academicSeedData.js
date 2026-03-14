export const academicSchoolSeeds = [
  {
    id: 'school-our-academy',
    name: '우리 학원',
    category: 'high',
    color: '#f59e0b',
    sortOrder: 0,
    textbooks: {
      note: '학원 자체 일정과 시험 대비 일정을 함께 관리합니다.'
    }
  },
  {
    id: 'school-daegi',
    name: '대기고',
    category: 'high',
    color: '#2EC4B6',
    sortOrder: 10,
    textbooks: {
      g1: { supplement: '풍산자(기본서), 유형반복R', publisher: '' },
      g2: { supplement: '(대수) 유형만렙, (미적분1) 유형만렙', publisher: '(대수/미적분1) 비상' },
      g3: { supplement: '(확통2) 개념플러스 유형, (확통1) 수능특강(수1), (미적분) 수학중심, (심화수학) 어삼쉬사(수2), (경제수학) 어삼쉬사 실전모의고사', publisher: '' }
    }
  },
  {
    id: 'school-ohyeon',
    name: '오현고',
    category: 'high',
    color: '#E71D36',
    sortOrder: 20,
    textbooks: {
      g1: { supplement: '메가스터디N제', publisher: '천재(홍진곤)' },
      g2: { supplement: '(대수) 유형+내신 고쟁이', publisher: '(대수) 미래엔' },
      g3: { supplement: '(미적분) 수능특강, (심화수학) 수능특강(수1,수2)', publisher: '' }
    }
  },
  {
    id: 'school-shinseong',
    name: '신성여고',
    category: 'high',
    color: '#FF9F1C',
    sortOrder: 30,
    textbooks: {
      g1: { supplement: '올림포스 유형편', publisher: '' },
      g2: { supplement: '(대수) 자이스토리, (기하) RPM', publisher: '' },
      g3: { supplement: '(확통) 수능특강, 기출의미래, (미적분) 수능특강, 기출의미래', publisher: '(확통) 신사고, (미적분) 천재' }
    }
  },
  {
    id: 'school-jungang',
    name: '중앙여고',
    category: 'high',
    color: '#20639B',
    sortOrder: 40,
    textbooks: {
      g1: { supplement: '유인물', publisher: '비상' },
      g2: { supplement: '올림포스 전국연합학력평가 기출문제집', publisher: '(대수) 비상, (기하) 비상' },
      g3: { supplement: '(미적분) 수능특강, (경제수학) 수능특강(수1)', publisher: '(미적분) 미래엔' }
    }
  },
  {
    id: 'school-jeju',
    name: '제주여고',
    category: 'high',
    color: '#3CAEA3',
    sortOrder: 50,
    textbooks: {
      g1: { supplement: '개념+유형', publisher: '미래엔' },
      g2: { supplement: '(대수) 풍산자필수유형', publisher: '미래엔' },
      g3: { supplement: '', publisher: '' }
    }
  },
  {
    id: 'school-sadae',
    name: '사대부고',
    category: 'high',
    color: '#011627',
    sortOrder: 60,
    textbooks: {
      g1: { supplement: '마플시너지', publisher: '' },
      g2: { supplement: '(대수) 쎈', publisher: '(대수) 천재(전), (기하) 천재' },
      g3: { supplement: '', publisher: '' }
    }
  }
];

const schoolNameById = academicSchoolSeeds.reduce((result, school) => {
  result[school.id] = school.name;
  return result;
}, {});

const schoolColorById = academicSchoolSeeds.reduce((result, school) => {
  result[school.id] = school.color;
  return result;
}, {});

export const academicEventSeeds = [
  { id: 'daegi-e1', schoolId: 'school-daegi', type: '시험', title: '1학기 중간고사', start: '2026-04-28', end: '2026-05-01', note: '(고1) 4/29~5/1', grade: 'g1' },
  { id: 'daegi-e2', schoolId: 'school-daegi', type: '시험', title: '1학기 기말고사', start: '2026-06-30', end: '2026-07-03', note: '(고1) 7/1~7/3', grade: 'g1' },
  { id: 'daegi-e3', schoolId: 'school-daegi', type: '시험', title: '2학기 중간고사', start: '2026-10-12', end: '2026-10-15', note: '(고1) 10/13~10/15', grade: 'g1' },
  { id: 'daegi-e4', schoolId: 'school-daegi', type: '시험', title: '2학기 기말고사', start: '2026-12-15', end: '2026-12-18', note: '(고1) 12/16~12/18', grade: 'g1' },
  { id: 'daegi-t1', schoolId: 'school-daegi', type: '체험학습', title: '현장체험학습 (고1)', start: '2026-05-26', end: '2026-05-29', grade: 'g1' },
  { id: 'daegi-t2', schoolId: 'school-daegi', type: '체험학습', title: '남도체험학습 (고2)', start: '2026-05-27', end: '2026-05-29', grade: 'g2' },
  { id: 'daegi-v1', schoolId: 'school-daegi', type: '방학', title: '여름방학식', start: '2026-07-16', end: '2026-07-16', grade: 'all' },
  { id: 'daegi-v2', schoolId: 'school-daegi', type: '방학', title: '개학', start: '2026-08-12', end: '2026-08-12', grade: 'all' },
  { id: 'daegi-h1', schoolId: 'school-daegi', type: '휴업일', title: '개교기념일', start: '2026-11-23', end: '2026-11-23', grade: 'all' },
  { id: 'daegi-h2', schoolId: 'school-daegi', type: '휴업일', title: '재량휴업일', start: '2026-05-04', end: '2026-05-04', grade: 'all' },
  { id: 'oh-e1', schoolId: 'school-ohyeon', type: '시험', title: '1학기 중간고사', start: '2026-04-27', end: '2026-04-29', grade: 'all' },
  { id: 'oh-e2', schoolId: 'school-ohyeon', type: '시험', title: '1학기 기말고사', start: '2026-07-03', end: '2026-07-07', grade: 'all' },
  { id: 'oh-e3', schoolId: 'school-ohyeon', type: '시험', title: '2학기 중간고사', start: '2026-10-12', end: '2026-10-14', grade: 'all' },
  { id: 'oh-e4', schoolId: 'school-ohyeon', type: '시험', title: '2학기 기말고사', start: '2026-12-15', end: '2026-12-17', grade: 'all' },
  { id: 'oh-t1', schoolId: 'school-ohyeon', type: '체험학습', title: '현장체험학습 (고1,2)', start: '2026-05-13', end: '2026-05-15', grade: 'all' },
  { id: 'oh-t2', schoolId: 'school-ohyeon', type: '체험학습', title: '진로체험학습 (고1,2)', start: '2026-10-29', end: '2026-10-30', grade: 'all' },
  { id: 'oh-v1', schoolId: 'school-ohyeon', type: '방학', title: '여름방학식', start: '2026-07-21', end: '2026-07-21', grade: 'all' },
  { id: 'oh-v2', schoolId: 'school-ohyeon', type: '방학', title: '개학', start: '2026-08-18', end: '2026-08-18', grade: 'all' },
  { id: 'oh-h1', schoolId: 'school-ohyeon', type: '휴업일', title: '개교기념일', start: '2026-09-25', end: '2026-09-25', grade: 'all' },
  { id: 'oh-h2', schoolId: 'school-ohyeon', type: '휴업일', title: '재량휴업일', start: '2026-05-04', end: '2026-05-04', grade: 'all' },
  { id: 'ss-e1', schoolId: 'school-shinseong', type: '시험', title: '1학기 중간고사', start: '2026-04-29', end: '2026-05-01', grade: 'all' },
  { id: 'ss-e2', schoolId: 'school-shinseong', type: '시험', title: '1학기 기말고사', start: '2026-07-02', end: '2026-07-07', note: '(고1) 7/3~7/7', grade: 'all' },
  { id: 'ss-e3', schoolId: 'school-shinseong', type: '시험', title: '2학기 중간고사', start: '2026-10-06', end: '2026-10-08', grade: 'all' },
  { id: 'ss-e4', schoolId: 'school-shinseong', type: '시험', title: '2학기 기말고사', start: '2026-12-08', end: '2026-12-11', note: '(고1) 12/9~12/11', grade: 'all' },
  { id: 'ss-t1', schoolId: 'school-shinseong', type: '체험학습', title: '체험학습 (고1)', start: '2026-04-01', end: '2026-04-02', grade: 'g1' },
  { id: 'ss-t2', schoolId: 'school-shinseong', type: '체험학습', title: '수학여행 (고2)', start: '2026-03-31', end: '2026-04-02', grade: 'g2' },
  { id: 'ss-v1', schoolId: 'school-shinseong', type: '방학', title: '여름방학식', start: '2026-07-16', end: '2026-07-16', grade: 'all' },
  { id: 'ss-v2', schoolId: 'school-shinseong', type: '방학', title: '개학', start: '2026-08-10', end: '2026-08-10', grade: 'all' },
  { id: 'ss-h1', schoolId: 'school-shinseong', type: '휴업일', title: '재량휴업일', start: '2026-04-03', end: '2026-04-03', grade: 'all' },
  { id: 'ss-h2', schoolId: 'school-shinseong', type: '휴업일', title: '재량휴업일', start: '2026-05-04', end: '2026-05-04', grade: 'all' },
  { id: 'ja-e1', schoolId: 'school-jungang', type: '시험', title: '1학기 중간고사', start: '2026-04-27', end: '2026-04-30', note: '(고1) 4/28~4/30', grade: 'all' },
  { id: 'ja-e2', schoolId: 'school-jungang', type: '시험', title: '1학기 기말고사', start: '2026-07-02', end: '2026-07-07', note: '(고1) 7/3~7/7', grade: 'all' },
  { id: 'ja-e3', schoolId: 'school-jungang', type: '시험', title: '2학기 중간고사', start: '2026-10-13', end: '2026-10-16', note: '(고1) 10/14~10/16', grade: 'all' },
  { id: 'ja-e4', schoolId: 'school-jungang', type: '시험', title: '2학기 기말고사', start: '2026-12-14', end: '2026-12-17', note: '(고1) 12/15~12/17', grade: 'all' },
  { id: 'ja-t1', schoolId: 'school-jungang', type: '체험학습', title: '도외현장체험 (고1)', start: '2026-05-12', end: '2026-05-14', grade: 'g1' },
  { id: 'ja-t2', schoolId: 'school-jungang', type: '체험학습', title: '인성수련 (고2)', start: '2026-05-11', end: '2026-05-12', grade: 'g2' },
  { id: 'ja-t3', schoolId: 'school-jungang', type: '체험학습', title: '현장체험학습 (고3)', start: '2026-05-15', end: '2026-05-15', grade: 'g3' },
  { id: 'ja-v1', schoolId: 'school-jungang', type: '방학', title: '여름방학식', start: '2026-07-16', end: '2026-07-16', grade: 'all' },
  { id: 'ja-v2', schoolId: 'school-jungang', type: '방학', title: '개학', start: '2026-08-14', end: '2026-08-14', grade: 'all' },
  { id: 'ja-h1', schoolId: 'school-jungang', type: '휴업일', title: '개교기념일', start: '2026-11-21', end: '2026-11-21', grade: 'all' },
  { id: 'ja-h2', schoolId: 'school-jungang', type: '휴업일', title: '재량휴업일', start: '2026-11-19', end: '2026-11-20', grade: 'all' },
  { id: 'jj-e1', schoolId: 'school-jeju', type: '시험', title: '1학기 중간고사', start: '2026-04-27', end: '2026-04-30', note: '(고1) 4/28~4/30', grade: 'all' },
  { id: 'jj-e2', schoolId: 'school-jeju', type: '시험', title: '1학기 기말고사', start: '2026-07-02', end: '2026-07-07', note: '(고1) 7/3~7/7', grade: 'all' },
  { id: 'jj-e3', schoolId: 'school-jeju', type: '시험', title: '2학기 중간고사', start: '2026-10-12', end: '2026-10-15', note: '(고1) 10/13~10/15', grade: 'all' },
  { id: 'jj-e4', schoolId: 'school-jeju', type: '시험', title: '2학기 기말고사', start: '2026-12-14', end: '2026-12-17', note: '(고1) 12/15~12/17', grade: 'all' },
  { id: 'jj-t1', schoolId: 'school-jeju', type: '체험학습', title: '수학여행 (고1)', start: '2026-10-28', end: '2026-10-30', grade: 'g1' },
  { id: 'jj-v1', schoolId: 'school-jeju', type: '방학', title: '여름방학식', start: '2026-07-16', end: '2026-07-16', grade: 'all' },
  { id: 'jj-v2', schoolId: 'school-jeju', type: '방학', title: '개학', start: '2026-08-13', end: '2026-08-13', grade: 'all' },
  { id: 'jj-h1', schoolId: 'school-jeju', type: '휴업일', title: '개교기념일', start: '2026-09-25', end: '2026-09-25', grade: 'all' },
  { id: 'jj-h2', schoolId: 'school-jeju', type: '휴업일', title: '재량휴업일', start: '2026-05-01', end: '2026-05-01', grade: 'all' },
  { id: 'sd-e1', schoolId: 'school-sadae', type: '시험', title: '1학기 중간고사', start: '2026-04-29', end: '2026-05-01', grade: 'all' },
  { id: 'sd-e2', schoolId: 'school-sadae', type: '시험', title: '1학기 기말고사', start: '2026-07-02', end: '2026-07-07', grade: 'all' },
  { id: 'sd-e3', schoolId: 'school-sadae', type: '시험', title: '2학기 중간고사', start: '2026-10-06', end: '2026-10-08', grade: 'all' },
  { id: 'sd-e4', schoolId: 'school-sadae', type: '시험', title: '2학기 기말고사', start: '2026-12-08', end: '2026-12-11', grade: 'all' },
  { id: 'sd-t1', schoolId: 'school-sadae', type: '체험학습', title: '도외문화체험학습 (고1)', start: '2026-05-27', end: '2026-05-29', grade: 'g1' },
  { id: 'sd-t2', schoolId: 'school-sadae', type: '체험학습', title: '인성수련 (고2)', start: '2026-05-28', end: '2026-05-29', grade: 'g2' },
  { id: 'sd-v1', schoolId: 'school-sadae', type: '방학', title: '여름방학식', start: '2026-07-20', end: '2026-07-20', grade: 'all' },
  { id: 'sd-v2', schoolId: 'school-sadae', type: '방학', title: '개학', start: '2026-08-13', end: '2026-08-13', grade: 'all' },
  { id: 'sd-h1', schoolId: 'school-sadae', type: '휴업일', title: '개교기념일 (등교)', start: '2026-05-27', end: '2026-05-27', grade: 'all' },
  { id: 'sd-h2', schoolId: 'school-sadae', type: '휴업일', title: '재량휴업일', start: '2026-11-20', end: '2026-11-20', grade: 'all' }
].map((event) => ({
  ...event,
  school: schoolNameById[event.schoolId] || '',
  color: schoolColorById[event.schoolId] || '#6b7280'
}));

