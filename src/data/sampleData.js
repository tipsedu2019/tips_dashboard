// dataService에서 사용할 초기 샘플 데이터
export const sampleClasses = [
  { period: '2026년 1학기', startDate: '2026-03-01', endDate: '2026-06-30', subject: '영어', grade: '중2', className: '중2A', schedule: '화목 17:00-19:00 토 13:30-15:30', teacher: '오인환T', classroom: '별1', capacity: 8, textbook: '중학 영문법 3800제 2학년' },
  { period: '2026년 1학기', startDate: '2026-03-01', endDate: '2026-06-30', subject: '수학', grade: '중1', className: '중1B1', schedule: '월수 17:30-19:30', teacher: '이지오T', classroom: '달1', capacity: 10, textbook: '개념원리 중학수학 1-1' },
  { period: '2024-여름특강', startDate: '2024-07-15', endDate: '2024-08-16', subject: '국어', grade: '고1', className: '고1-특강', schedule: '일 10:00-13:00', teacher: '박상현T', classroom: '해1', capacity: 6, textbook: '매3비 (비문학)' },
  { period: '2026년 1학기', startDate: '2026-03-01', endDate: '2026-06-30', subject: '과학', grade: '초6', className: '초6심화', schedule: '화목 15:00-17:00', teacher: '김미영T', classroom: '별2', capacity: 12, textbook: '오투 과학 초등 6-1' },
];

export const sampleTextbooks = [
  {
    id: 'tb-101',
    title: '중학 영문법 3800제 2학년',
    publisher: '마더텅',
    totalChapters: 8,
    lessons: [
      { id: 'ch1', title: 'Chapter 1: 문장의 형식' },
      { id: 'ch2', title: 'Chapter 2: 시제' },
      { id: 'ch3', title: 'Chapter 3: 조동사' },
      { id: 'ch4', title: 'Chapter 4: 수동태' },
      { id: 'ch5', title: 'Chapter 5: 명사와 관사' },
      { id: 'ch6', title: 'Chapter 6: 대명사' },
      { id: 'ch7', title: 'Chapter 7: 부정사' },
      { id: 'ch8', title: 'Chapter 8: 동명사' },
    ]
  },
  {
    id: 'tb-102',
    title: '개념원리 중학수학 1-1',
    publisher: '개념원리',
    totalChapters: 4,
    lessons: [
      { id: 'math1', title: '1. 소인수분해' },
      { id: 'math2', title: '2. 정수와 유리수' },
      { id: 'math3', title: '3. 문자와 식' },
      { id: 'math4', title: '4. 좌표평면과 그래프' },
    ]
  }
];

export const sampleProgressLogs = [
  {
    id: 'log-1',
    classId: 'class-0', // 중2A 영어
    textbookId: 'tb-101',
    completedLessonIds: ['ch1', 'ch2', 'ch3'], 
    date: '2026-03-10',
    notes: '조동사까지 마무리. 학생들이 헷갈려해서 다음 시간에 복습 필요.'
  },
  {
    id: 'log-2',
    classId: 'class-1', // 중1B1 수학
    textbookId: 'tb-102',
    completedLessonIds: ['math1'], // math1만 완료, 진도 지연 상태 시뮬레이션
    date: '2026-03-09',
    notes: '소인수분해 기초 개념 이해도가 낮아 진도가 더딤.'
  }
];

export const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

export const CLASS_COLORS = [
  { bg: 'var(--color-1-bg)', border: 'var(--color-1-border)', text: 'var(--color-1-text)' },
  { bg: 'var(--color-2-bg)', border: 'var(--color-2-border)', text: 'var(--color-2-text)' },
  { bg: 'var(--color-3-bg)', border: 'var(--color-3-border)', text: 'var(--color-3-text)' },
  { bg: 'var(--color-4-bg)', border: 'var(--color-4-border)', text: 'var(--color-4-text)' },
  { bg: 'var(--color-5-bg)', border: 'var(--color-5-border)', text: 'var(--color-5-text)' },
  { bg: 'var(--color-6-bg)', border: 'var(--color-6-border)', text: 'var(--color-6-text)' },
];

// ───────────── 날짜 범위 파싱 헬퍼 ─────────────
function parseDateRange(marker) {
  const now = new Date();
  const year = now.getFullYear();
  const text = marker.replace(/\[|\]/g, '').trim();

  const monthRangeMatch = text.match(/^(\d+)월?~(\d+)월$/);
  if (monthRangeMatch) {
    const fromMonth = parseInt(monthRangeMatch[1]) - 1;
    const toMonth = parseInt(monthRangeMatch[2]) - 1;
    const to = new Date(year, toMonth + 1, 0);
    return { from: new Date(year, fromMonth, 1), to };
  }

  const fromDateMatch = text.match(/^(\d+)\/(\d+)~$/);
  if (fromDateMatch) {
    return { from: new Date(year, parseInt(fromDateMatch[1]) - 1, parseInt(fromDateMatch[2])), to: null };
  }

  const toDateMatch = text.match(/^~(\d+)\/(\d+)$/);
  if (toDateMatch) {
    return { from: null, to: new Date(year, parseInt(toDateMatch[1]) - 1, parseInt(toDateMatch[2])) };
  }

  const fullRangeMatch = text.match(/^(\d+)\/(\d+)~(\d+)\/(\d+)$/);
  if (fullRangeMatch) {
    return {
      from: new Date(year, parseInt(fullRangeMatch[1]) - 1, parseInt(fullRangeMatch[2])),
      to: new Date(year, parseInt(fullRangeMatch[3]) - 1, parseInt(fullRangeMatch[4])),
    };
  }

  return null;
}

function isDateInRange(range, date = new Date()) {
  if (!range) return true;
  if (range.from && date < range.from) return false;
  if (range.to) {
    const endOfDay = new Date(range.to);
    endOfDay.setHours(23, 59, 59, 999);
    if (date > endOfDay) return false;
  }
  return true;
}

function parseOneSectionSlots(text) {
  const slots = [];
  // 선택적으로 (강의실명) 캡처: 예) "월 21:30-23:00 (별5)"
  const regex = /([월화수목금토일]+)\s+([0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2})(?:\s*\(([^)]+)\))?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const daysStr = match[1];
    const [start, end] = match[2].split('-');
    const parenthesisContent = match[3] ? match[3].trim() : null; // (내용) 있으면 저장
    if (start && end) {
      for (let ch of daysStr) {
        if (DAY_LABELS.includes(ch)) {
          const slot = { day: ch, start: start.trim(), end: end.trim() };
          if (parenthesisContent) slot.override = parenthesisContent; // 원본 유지
          slots.push(slot);
        }
      }
    }
  }
  return slots;
}

export function parseScheduleMeta(scheduleStr) {
  if (!scheduleStr) return { activeSections: [], allSections: [], hasVariants: false, rawNote: '' };

  const normalized = scheduleStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const markerRegex = /(\[[^\]]+\])/g;
  const parts = normalized.split(markerRegex).filter(p => p.trim() !== '');

  const sections = [];
  let i = 0;

  if (parts.length > 0 && !parts[0].match(/^\[[^\]]+\]$/)) {
    const slots = parseOneSectionSlots(parts[0]);
    if (slots.length > 0) {
      sections.push({ label: null, dateRange: null, slots });
    }
    i = 1;
  }

  while (i < parts.length) {
    const part = parts[i];
    if (part.match(/^\[[^\]]+\]$/)) {
      const label = part.replace(/\[|\]/g, '').trim();
      const dateRange = parseDateRange(part);
      const bodyText = parts[i + 1] || '';
      const slots = parseOneSectionSlots(bodyText);
      if (slots.length > 0) {
        sections.push({ label, dateRange, slots });
      }
      i += 2;
    } else {
      i++;
    }
  }

  const now = new Date();
  const dateSections = sections.filter(s => s.dateRange !== null);
  const defaultSections = sections.filter(s => s.dateRange === null);

  let finalActive;
  if (dateSections.length > 0) {
    const activeDateSections = dateSections.filter(s => isDateInRange(s.dateRange, now));
    finalActive = activeDateSections.length > 0 ? activeDateSections : defaultSections;
  } else {
    finalActive = defaultSections;
  }

  return {
    activeSections: finalActive,
    allSections: sections,
    hasVariants: sections.length > 1,
    rawNote: scheduleStr.trim(),
  };
}

export function parseSchedule(scheduleStr, contextObj = null) {
  const meta = parseScheduleMeta(scheduleStr);
  let slots = [];
  for (const section of meta.activeSections) {
    for (const slot of section.slots) {
      slots.push({ ...slot });
    }
  }

  if (contextObj) {
    // contextObj: { teacher: "...", classroom: "..." }
    const teachers = (contextObj.teacher || '').split(/[,\/\n]+/).map(s => s.trim()).filter(Boolean);
    const rooms = (contextObj.classroom || '').split(/[,\/\n]+/).map(s => s.trim()).filter(Boolean);

    slots = slots.map(slot => {
      if (slot.override) {
        const parts = slot.override.split(/[,/]+/).map(s => s.trim()).filter(Boolean);
        
        let foundRoom = null;
        let foundTeacher = null;

        parts.forEach(part => {
          // 1. 교사 매칭
          const matchedTeacher = teachers.find(t => fuzzyMatch(t, part));
          if (matchedTeacher) foundTeacher = matchedTeacher;

          // 2. 강의실 매칭
          const matchedRoom = rooms.find(r => fuzzyMatch(r, part));
          if (matchedRoom) foundRoom = matchedRoom;
        });

        // 매칭된 결과가 있으면 슬롯 속성으로 할당
        if (foundRoom) slot.classroom = foundRoom;
        if (foundTeacher) slot.teacher = foundTeacher;
        
        // 만약 매칭에 실패했더라도 이전 호환성을 위해 override 내용을 classroom으로 임시 할당할 수도 있음
        // (사용자가 그냥 강의실 이름만 적었을 경우 대비)
        if (!foundRoom && !foundTeacher) {
          slot.classroom = slot.override;
        }
      }
      return slot;
    });
  } else {
    // contextObj가 없는 경우에도 기본적으로 override를 classroom으로 간주 (하위 호환)
    slots = slots.map(slot => {
      if (slot.override && !slot.classroom) slot.classroom = slot.override;
      return slot;
    });
  }

  return slots;
}

function fuzzyMatch(full, short) {
  if (!full || !short) return false;
  const f = full.replace(/\s+/g, '').toLowerCase();
  const s = short.replace(/\s+/g, '').toLowerCase();
  
  // 1. 단순 포함 또는 완전 일치 관계
  if (f === s || f.includes(s) || s.includes(f)) return true;
  
  // 2. 약어 매칭 (예: 별5 -> 별관 5강)
  // 문자와 숫자를 분리하여 각각 포함하는지 확인
  const shortAlpha = s.replace(/[^a-z가-힣]/g, '');
  const shortNum = s.replace(/[^0-9]/g, '');
  
  if (shortAlpha && shortNum) {
    // 문자와 숫자가 모두 포함되어 있다면 일치로 간주
    return f.includes(shortAlpha) && f.includes(shortNum);
  }
  
  return false;
}

export function generateTimeSlots(startHour = 9, endHour = 24) {
  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    const nextH = h + 1;
    slots.push(`${h.toString().padStart(2, '0')}:00-${h.toString().padStart(2, '0')}:30`);
    slots.push(`${h.toString().padStart(2, '0')}:30-${nextH.toString().padStart(2, '0')}:00`);
  }
  return slots;
}

export function timeToSlotIndex(timeStr, baseHour = 9) {
  const [h, m] = timeStr.split(':').map(Number);
  return (h - baseHour) * 2 + (m >= 30 ? 1 : 0);
}

export function stripClassPrefix(className) {
  if (!className) return '';
  // Removes "[Any Text] " or "[Any Text]" at the start
  return className.replace(/^\[.*?\]\s*/, '');
}

export function parseClassPrefix(className) {
  if (!className) return null;
  const match = className.match(/^\[(.*?)\]/);
  if (!match) return null;

  const inner = match[1].trim(); // e.g. "중1수 허승주"
  
  // Subject mapping
  const subjectMap = {
    '수': '수학',
    '영': '영어',
    '국': '국어',
    '과': '과학',
    '사': '사회',
    '논': '논술'
  };

  // Pattern detection: 
  // Usually starts with Grade (e.g. 중1, 고1, 초6) - 2-3 chars
  // Then Subject shorthand - 1 char
  // Then a space
  // Then Teacher Name
  
  // Regex: ([초중고][1-6][가-힣]?) + ([가-힣]) + \s + (.+)
  // Grade: 초1~6, 중1~3, 고1~3
  const regex = /^([초중고][1-6])([가-힣])\s+(.+)$/;
  const metaMatch = inner.match(regex);
  
  if (metaMatch) {
    const rawSubject = metaMatch[2];
    return {
      grade: metaMatch[1],
      subject: subjectMap[rawSubject] || rawSubject,
      teacher: metaMatch[3].trim()
    };
  }

  return null;
}
export function computeWeeklyMinutes(scheduleStr, contextObj = null) {
  const slots = parseSchedule(scheduleStr, contextObj);
  let minutes = 0;
  slots.forEach(sch => {
    const [sh, sm] = sch.start.split(':').map(Number);
    const [eh, em] = sch.end.split(':').map(Number);
    minutes += (eh * 60 + em) - (sh * 60 + sm);
  });
  return minutes;
}

export function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
