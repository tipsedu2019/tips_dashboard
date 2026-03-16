function text(value) {
  return String(value || '').replace(/\r/g, '\n').trim();
}

function compactText(value) {
  return text(value).replace(/\s+/g, '');
}

function schoolKey(value) {
  return compactText(value).toLowerCase();
}

function toDateString(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function splitMultiline(value) {
  return text(value)
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitOutsideParentheses(value) {
  const results = [];
  let depth = 0;
  let buffer = '';

  for (const character of String(value || '')) {
    if (character === '(') {
      depth += 1;
      buffer += character;
      continue;
    }

    if (character === ')') {
      depth = Math.max(0, depth - 1);
      buffer += character;
      continue;
    }

    if ((character === ',' || character === ';') && depth === 0) {
      const nextValue = text(buffer);
      if (nextValue) {
        results.push(nextValue);
      }
      buffer = '';
      continue;
    }

    buffer += character;
  }

  const lastValue = text(buffer);
  if (lastValue) {
    results.push(lastValue);
  }

  return results;
}

function expandGrades(rawGrade, fallback = 'all') {
  const normalized = compactText(rawGrade);
  if (!normalized) {
    return [fallback];
  }

  const explicit = [...normalized.matchAll(/고([123])/g)].map((match) => `고${match[1]}`);
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }

  const grouped = normalized.match(/^고?([123](?:,[123])*)$/);
  if (grouped) {
    return [...new Set(grouped[1].split(',').map((grade) => `고${grade}`))];
  }

  return [fallback];
}

function inferWorkbookYear(rows) {
  const firstRows = rows.slice(0, 5).flat().map((cell) => text(cell));
  const matched = firstRows.join(' ').match(/20\d{2}/);
  return matched ? Number(matched[0]) : new Date().getFullYear();
}

function parseRangeOrSingleDate(fragment, year) {
  const normalized = text(fragment).replace(/\s+/g, ' ');
  const rangeMatch = normalized.match(/(\d{1,2})\/(\d{1,2})(?:\([^)]+\))?\s*~\s*(\d{1,2})\/(\d{1,2})(?:\([^)]+\))?/);
  if (rangeMatch) {
    return {
      start: toDateString(year, Number(rangeMatch[1]), Number(rangeMatch[2])),
      end: toDateString(year, Number(rangeMatch[3]), Number(rangeMatch[4])),
    };
  }

  const singleMatch = normalized.match(/(\d{1,2})\/(\d{1,2})(?:\([^)]+\))?/);
  if (singleMatch) {
    const date = toDateString(year, Number(singleMatch[1]), Number(singleMatch[2]));
    return { start: date, end: date };
  }

  return null;
}

function parseExamEntries(value, year, title) {
  const normalized = text(value).replace(/\n/g, ' ');
  const pattern = /\((고?[123](?:,\d+)*)\)\s*(\d{1,2})\/(\d{1,2})(?:\([^)]+\))?\s*~\s*(\d{1,2})\/(\d{1,2})(?:\([^)]+\))?/g;
  const results = [];
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const [, rawGrade, startMonth, startDay, endMonth, endDay] = match;
    expandGrades(rawGrade).forEach((grade) => {
      results.push({
        grade,
        type: '시험',
        title,
        start: toDateString(year, Number(startMonth), Number(startDay)),
        end: toDateString(year, Number(endMonth), Number(endDay)),
        note: normalized,
      });
    });
  }

  return results;
}

function parseTripEntries(value, year) {
  return splitMultiline(value)
    .map((line) => {
      const match = line.match(/^(고?[123](?:,\d+)*)?(?:\(([^)]+)\))?\s*(.*)$/);
      if (!match) {
        return [];
      }

      const [, rawGrade, rawLabel, rest] = match;
      const range = parseRangeOrSingleDate(rest, year);
      if (!range) {
        return [];
      }

      return expandGrades(rawGrade, 'all').map((grade) => ({
        grade,
        type: '체험학습',
        title: text(rawLabel) || '수학여행',
        start: range.start,
        end: range.end,
        note: line,
      }));
    })
    .flat();
}

function parseOtherEntries(value, year) {
  return splitMultiline(value)
    .map((line) => {
      const labelMatch = line.match(/^\(([^)]+)\)\s*(.*)$/);
      const label = text(labelMatch?.[1]);
      const rest = text(labelMatch?.[2] || line);
      const range = parseRangeOrSingleDate(rest, year);
      if (!range) {
        return null;
      }

      let type = '기타일정';
      let title = label || '기타 일정';
      if (/방학/.test(label)) {
        type = '방학';
        title = label || '방학';
      } else if (/개학/.test(label)) {
        type = '기타일정';
        title = label || '개학';
      } else if (/개교기념일/.test(label)) {
        title = label;
      } else if (/재량휴업일/.test(label)) {
        title = label;
      }

      return {
        grade: 'all',
        type,
        title,
        start: range.start,
        end: range.end,
        note: line,
      };
    })
    .filter(Boolean);
}

function splitSupplementTitles(value) {
  const lines = splitMultiline(value);
  if (lines.length > 0) {
    return lines.flatMap((line) => splitOutsideParentheses(line));
  }

  return splitOutsideParentheses(value);
}

export function detectAcademicWorkbookFormat(XLSX, workbook) {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    return 'unknown';
  }

  if (workbook.SheetNames.includes('학교목록') && workbook.SheetNames.includes('교과정보')) {
    return 'template';
  }

  const cellRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
  const headerTokens = cellRows
    .slice(0, 8)
    .flat()
    .map((cell) => compactText(cell));

  const required = ['학교', '고1', '고2', '고3', '시험기간', '수학여행', '방학/기타일정'];
  return required.every((token) => headerTokens.includes(token)) ? 'matrix-high-school' : 'unknown';
}

export function parseHighSchoolMatrixWorkbook(XLSX, workbook) {
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const year = inferWorkbookYear(rows);
  const headerRowIndex = rows.findIndex((row) => row.some((cell) => compactText(cell) === '학교'));

  if (headerRowIndex === -1) {
    throw new Error('지원하는 고등학교 원본 시트 형식을 찾지 못했습니다.');
  }

  const headers = rows[headerRowIndex].map((cell) => compactText(cell));
  const schoolIndex = headers.findIndex((cell) => cell === '학교');
  const gradeColumns = [
    { grade: '고1', index: headers.findIndex((cell) => cell === '고1') },
    { grade: '고2', index: headers.findIndex((cell) => cell === '고2') },
    { grade: '고3', index: headers.findIndex((cell) => cell === '고3') },
  ].filter((entry) => entry.index !== -1);
  const examIndex = headers.findIndex((cell) => cell === '시험기간');
  const tripIndex = headers.findIndex((cell) => cell === '수학여행');
  const otherIndex = headers.findIndex((cell) => cell === '방학/기타일정');

  if (schoolIndex === -1 || examIndex === -1 || gradeColumns.length === 0) {
    throw new Error('학교, 학년, 시험기간 열을 찾지 못했습니다.');
  }

  const schools = [];
  const profiles = [];
  const materials = [];
  const events = [];
  const seenSchools = new Set();
  const seenProfiles = new Set();
  const examTitles = ['1학기 중간고사', '1학기 기말고사', '2학기 중간고사', '2학기 기말고사'];

  let currentSchool = '';

  for (let index = headerRowIndex + 1; index < rows.length; index += 4) {
    const block = rows.slice(index, index + 4);
    if (block.length === 0) {
      continue;
    }

    currentSchool = text(block[0]?.[schoolIndex]) || currentSchool;
    if (!currentSchool) {
      continue;
    }

    const schoolIdentifier = schoolKey(currentSchool);
    if (!seenSchools.has(schoolIdentifier)) {
      seenSchools.add(schoolIdentifier);
      schools.push({
        name: currentSchool,
        category: 'high',
      });
    }

    const supplementRow = block[0] || [];
    const publisherRow = block[2] || [];

    gradeColumns.forEach(({ grade, index: gradeIndex }) => {
      const profileKey = [schoolIdentifier, grade, '수학'].join('::');
      if (!seenProfiles.has(profileKey)) {
        seenProfiles.add(profileKey);
        profiles.push({
          schoolName: currentSchool,
          grade,
          subject: '수학',
          mainTextbookTitle: '',
          mainTextbookPublisher: text(publisherRow[gradeIndex]),
          note: '',
        });
      }

      splitSupplementTitles(supplementRow[gradeIndex]).forEach((title, materialIndex) => {
        materials.push({
          schoolName: currentSchool,
          grade,
          subject: '수학',
          title,
          publisher: '',
          note: '',
          sortOrder: materialIndex,
        });
      });
    });

    block.forEach((row, rowOffset) => {
      const examCell = row?.[examIndex];
      if (!examCell) {
        return;
      }

      parseExamEntries(examCell, year, examTitles[rowOffset] || '시험').forEach((event) => {
        events.push({
          schoolName: currentSchool,
          ...event,
        });
      });
    });

    if (tripIndex !== -1) {
      parseTripEntries(block[0]?.[tripIndex], year).forEach((event) => {
        events.push({
          schoolName: currentSchool,
          ...event,
        });
      });
    }

    if (otherIndex !== -1) {
      parseOtherEntries(block[0]?.[otherIndex], year).forEach((event) => {
        events.push({
          schoolName: currentSchool,
          ...event,
        });
      });
    }
  }

  return {
    schools,
    profiles,
    materials,
    scopes: [],
    examDays: [],
    events,
    summary: {
      schoolCount: schools.length,
      profileCount: profiles.length,
      materialCount: materials.length,
      eventCount: events.length,
      format: 'matrix-high-school',
      year,
    },
  };
}
