import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT, 'public', '2026년 고등학교 보충교재, 교과서, 학사일정.xlsx');
const OUTPUT_DIR = path.join(ROOT, 'tmp');
const SQL_OUTPUT_PATH = path.join(OUTPUT_DIR, 'academic-highschool-import.sql');
const REPORT_OUTPUT_PATH = path.join(OUTPUT_DIR, 'academic-highschool-import-report.json');

const SHEET_NAME = 'Sheet2';
const SCHOOL_CATEGORY = 'high';
const SUBJECT = '수학';
const GRADES = ['고1', '고2', '고3'];
const IMPORT_NOTE = '고등학교 원본 엑셀 1회 import';
const EVENT_TYPE_MAP = {
  여름방학: '방학',
  겨울방학: '방학',
  방학: '방학',
  개학: '개학',
  개교기념일: '개교기념일',
  재량휴업일: '재량휴업일',
  재랑휴업일: '재량휴업일',
};

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function createDeterministicUuid(...parts) {
  const hash = crypto.createHash('md5').update(parts.join('::')).digest('hex').split('');
  hash[12] = '4';
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseMonthDayToken(token) {
  const match = String(token || '').match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) {
    return null;
  }

  const [, month, day] = match;
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateSpans(text) {
  const matches = [];
  const regex = /(\d{1,2}\/\d{1,2}\([^)]+\))(?:\s*~\s*(\d{1,2}\/\d{1,2}\([^)]+\)))?/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const start = parseMonthDayToken(match[1]);
    const end = parseMonthDayToken(match[2] || match[1]);
    if (start && end) {
      matches.push({ start, end });
    }
  }

  return matches;
}

function parseTargetGrades(text) {
  const gradeSet = new Set();
  const regex = /고\s*([123](?:\s*,\s*[123])*)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    match[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => gradeSet.add(`고${value}`));
  }

  return gradeSet.size > 0 ? [...gradeSet] : [...GRADES];
}

function parseListCell(text) {
  return normalizeText(text)
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((item) => compactText(item))
    .filter(Boolean);
}

function normalizeEventLabel(rawLabel) {
  const label = compactText(rawLabel).replace(/[()]/g, '');
  return EVENT_TYPE_MAP[label] ? label : label || '기타일정';
}

function normalizeOtherEventType(label) {
  if (EVENT_TYPE_MAP[label]) {
    return EVENT_TYPE_MAP[label];
  }

  if (label.includes('방학')) {
    return '방학';
  }

  if (label.includes('개학')) {
    return '개학';
  }

  return '기타일정';
}

function createSchoolRecord(name, sortOrder) {
  return {
    id: createDeterministicUuid('school', name),
    name,
    category: SCHOOL_CATEGORY,
    color: null,
    sortOrder,
  };
}

function createProfileRecord(schoolId, schoolName, grade) {
  return {
    key: `${schoolName}::${grade}::${SUBJECT}`,
    schoolId,
    schoolName,
    grade,
    subject: SUBJECT,
    publisherLines: [],
    supplements: [],
  };
}

function pushUniqueValue(target, value) {
  if (!value || target.includes(value)) {
    return;
  }

  target.push(value);
}

function addSupplements(profile, cellText) {
  parseListCell(cellText).forEach((item) => {
    const normalized = compactText(item);
    if (!profile.supplements.some((existing) => compactText(existing.title) === normalized)) {
      profile.supplements.push({
        title: item,
        publisher: null,
        note: null,
      });
    }
  });
}

function addPublishers(profile, cellText) {
  parseListCell(cellText).forEach((item) => pushUniqueValue(profile.publisherLines, item));
}

function buildExamEvents(school, cellText, sequenceState) {
  const lines = normalizeText(cellText).split('\n').map((line) => compactText(line)).filter(Boolean);
  const events = [];

  lines.forEach((line) => {
    const spanRegex = /(?:\((고[123](?:\s*,\s*[123])*)\)\s*)?(\d{1,2}\/\d{1,2}\([^)]+\)\s*~\s*\d{1,2}\/\d{1,2}\([^)]+\))/g;
    const segments = [];
    let match;

    while ((match = spanRegex.exec(line)) !== null) {
      segments.push({
        grades: match[1] ? parseTargetGrades(match[1]) : [...GRADES],
        spans: extractDateSpans(match[2]),
      });
    }

    if (segments.length === 0) {
      segments.push({
        grades: parseTargetGrades(line),
        spans: extractDateSpans(line),
      });
    }

    segments.forEach((segment) => {
      segment.spans.forEach((span) => {
        const sequence = (sequenceState.get(school.name) || 0) + 1;
        sequenceState.set(school.name, sequence);

        segment.grades.forEach((grade) => {
          events.push({
            id: createDeterministicUuid('event', school.name, grade, '시험', `시험기간 ${sequence}`, span.start, span.end),
            schoolId: school.id,
            schoolName: school.name,
            grade,
            title: `시험기간 ${sequence}`,
            type: '시험',
            start: span.start,
            end: span.end,
            note: IMPORT_NOTE,
          });
        });
      });
    });
  });

  return events;
}

function buildTripEvents(school, cellText) {
  const lines = normalizeText(cellText).split('\n').map((line) => compactText(line)).filter(Boolean);
  const events = [];

  lines.forEach((line) => {
    const grades = parseTargetGrades(line);
    const labelMatch = line.match(/(?:고[123](?:\s*,\s*[123])*)?\s*\(([^)]+)\)/);
    const label = labelMatch ? compactText(labelMatch[1]) : '체험학습';
    const spans = extractDateSpans(line);

    spans.forEach((span) => {
      grades.forEach((grade) => {
        events.push({
          id: createDeterministicUuid('event', school.name, grade, '체험학습', label, span.start, span.end),
          schoolId: school.id,
          schoolName: school.name,
          grade,
          title: label,
          type: '체험학습',
          start: span.start,
          end: span.end,
          note: IMPORT_NOTE,
        });
      });
    });
  });

  return events;
}

function buildOtherEvents(school, cellText) {
  const lines = normalizeText(cellText).split('\n').map((line) => compactText(line)).filter(Boolean);
  const events = [];

  lines.forEach((line) => {
    const labelMatch = line.match(/^\(([^)]+)\)/);
    const rawLabel = labelMatch ? labelMatch[1] : '기타일정';
    const label = normalizeEventLabel(rawLabel);
    const type = normalizeOtherEventType(label);
    const spans = extractDateSpans(line);

    spans.forEach((span, index) => {
      events.push({
        id: createDeterministicUuid('event', school.name, 'all', type, label, span.start, span.end, String(index)),
        schoolId: school.id,
        schoolName: school.name,
        grade: 'all',
        title: label,
        type,
        start: span.start,
        end: span.end,
        note: IMPORT_NOTE,
      });
    });
  });

  return events;
}

function buildSql({ schools, profiles, events }) {
  const affectedSchoolNames = schools.map((school) => school.name);
  const profileKeyClauses = profiles.map((profile) => (
    `(school_id = (select id from public.academic_schools where name = ${sqlLiteral(profile.schoolName)} limit 1) and grade = ${sqlLiteral(profile.grade)} and subject = ${sqlLiteral(profile.subject)})`
  ));

  const schoolValues = schools.map((school) => (
    `  (${sqlLiteral(school.id)}, ${sqlLiteral(school.name)}, ${sqlLiteral(school.category)}, null, ${school.sortOrder}, '{}'::jsonb)`
  )).join(',\n');

  const profileValues = profiles.map((profile) => (
    `  (${sqlLiteral(createDeterministicUuid('profile', profile.schoolName, profile.grade, profile.subject))}, (select id from public.academic_schools where name = ${sqlLiteral(profile.schoolName)} limit 1), ${sqlLiteral(profile.grade)}, ${sqlLiteral(profile.subject)}, null, ${sqlLiteral(profile.publisherLines.join(' / ') || null)}, ${sqlLiteral(IMPORT_NOTE)})`
  )).join(',\n');

  const supplementRows = profiles.flatMap((profile) => (
    profile.supplements.map((item, index) => (
      `  (${sqlLiteral(createDeterministicUuid('supplement', profile.schoolName, profile.grade, profile.subject, item.title, String(index)))}, (select acp.id from public.academic_curriculum_profiles acp join public.academic_schools s on s.id = acp.school_id where s.name = ${sqlLiteral(profile.schoolName)} and acp.grade = ${sqlLiteral(profile.grade)} and acp.subject = ${sqlLiteral(profile.subject)} limit 1), ${sqlLiteral(item.title)}, ${sqlLiteral(item.publisher)}, ${sqlLiteral(item.note)}, ${index})`
    ))
  ));

  const eventValues = events.map((event) => (
    `  (${sqlLiteral(event.id)}, ${sqlLiteral(event.title)}, ${sqlLiteral(event.schoolName)}, (select id from public.academic_schools where name = ${sqlLiteral(event.schoolName)} limit 1), ${sqlLiteral(event.type)}, ${sqlLiteral(event.start)}, ${sqlLiteral(event.end)}, null, ${sqlLiteral(event.grade)}, ${sqlLiteral(event.note)})`
  )).join(',\n');

  return [
    '-- Generated by scripts/import-highschool-workbook.mjs',
    `-- Source: ${path.relative(ROOT, INPUT_PATH)}`,
    'begin;',
    '',
    'alter table public.academic_events add column if not exists school text;',
    'alter table public.academic_events add column if not exists school_id uuid references public.academic_schools(id) on delete set null;',
    'alter table public.academic_events add column if not exists type text;',
    'alter table public.academic_events add column if not exists "start" date;',
    'alter table public.academic_events add column if not exists "end" date;',
    'alter table public.academic_events add column if not exists color text;',
    'alter table public.academic_events add column if not exists grade text default \'all\';',
    'alter table public.academic_events add column if not exists note text;',
    '',
    'insert into public.academic_schools (id, name, category, color, sort_order, textbooks)',
    'values',
    schoolValues,
    'on conflict (name) do update',
    'set name = excluded.name,',
    '    category = excluded.category,',
    '    color = excluded.color,',
    '    sort_order = excluded.sort_order;',
    '',
    profileKeyClauses.length > 0
      ? [
        'delete from public.academic_supplement_materials asm',
        'using public.academic_curriculum_profiles acp',
        'where asm.profile_id = acp.id',
        `  and (${profileKeyClauses.join('\n   or ')});`,
      ].join('\n')
      : '-- no supplement material targets',
    '',
    'insert into public.academic_curriculum_profiles (id, school_id, grade, subject, main_textbook_title, main_textbook_publisher, note)',
    'values',
    profileValues,
    'on conflict (school_id, grade, subject) do update',
    'set main_textbook_title = excluded.main_textbook_title,',
    '    main_textbook_publisher = excluded.main_textbook_publisher,',
    '    note = excluded.note;',
    '',
    supplementRows.length > 0
      ? [
        'insert into public.academic_supplement_materials (id, profile_id, title, publisher, note, sort_order)',
        'values',
        supplementRows.join(',\n'),
        'on conflict (id) do update',
        'set title = excluded.title,',
        '    publisher = excluded.publisher,',
        '    note = excluded.note,',
        '    sort_order = excluded.sort_order;',
      ].join('\n')
      : '-- no supplement materials detected',
    '',
    affectedSchoolNames.length > 0
      ? `delete from public.academic_events where note = ${sqlLiteral(IMPORT_NOTE)} and school_id in (select id from public.academic_schools where name in (${affectedSchoolNames.map(sqlLiteral).join(', ')}));`
      : '-- no academic event targets',
    '',
    events.length > 0
      ? [
        'insert into public.academic_events (id, title, school, school_id, type, "start", "end", color, grade, note)',
        'values',
        eventValues,
        'on conflict (id) do update',
        'set title = excluded.title,',
        '    school = excluded.school,',
        '    school_id = excluded.school_id,',
        '    type = excluded.type,',
        '    "start" = excluded."start",',
        '    "end" = excluded."end",',
        '    color = excluded.color,',
        '    grade = excluded.grade,',
        '    note = excluded.note;',
      ].join('\n')
      : '-- no academic events detected',
    '',
    'commit;',
    '',
  ].join('\n');
}

async function main() {
  const workbook = XLSX.readFile(INPUT_PATH);
  const worksheet = workbook.Sheets[SHEET_NAME];
  if (!worksheet) {
    throw new Error(`${SHEET_NAME} 시트를 찾을 수 없습니다.`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const schools = new Map();
  const profiles = new Map();
  const events = new Map();
  const examSequenceState = new Map();

  let currentSchool = null;
  let currentType = '';

  rows.slice(3).forEach((row) => {
    const schoolName = compactText(row[0]);
    const typeCell = compactText(row[1]);

    if (schoolName) {
      currentSchool = schoolName;
      currentType = typeCell || '';
      if (!schools.has(schoolName)) {
        schools.set(schoolName, createSchoolRecord(schoolName, schools.size));
      }
    } else if (typeCell) {
      currentType = typeCell;
    }

    if (!currentSchool) {
      return;
    }

    const school = schools.get(currentSchool);

    GRADES.forEach((grade, index) => {
      const cellText = normalizeText(row[index + 2]);
      if (!cellText) {
        return;
      }

      const profileKey = `${currentSchool}::${grade}::${SUBJECT}`;
      if (!profiles.has(profileKey)) {
        profiles.set(profileKey, createProfileRecord(school.id, currentSchool, grade));
      }

      const profile = profiles.get(profileKey);
      if (currentType.includes('보충교재')) {
        addSupplements(profile, cellText);
      } else if (currentType.includes('교과서')) {
        addPublishers(profile, cellText);
      }
    });

    buildExamEvents(school, row[5], examSequenceState).forEach((event) => events.set(event.id, event));
    buildTripEvents(school, row[6]).forEach((event) => events.set(event.id, event));
    buildOtherEvents(school, row[7]).forEach((event) => events.set(event.id, event));
  });

  const schoolList = [...schools.values()];
  const profileList = [...profiles.values()];
  const eventList = [...events.values()].sort((left, right) => (
    left.schoolName.localeCompare(right.schoolName, 'ko') ||
    left.grade.localeCompare(right.grade, 'ko') ||
    left.start.localeCompare(right.start, 'ko')
  ));

  const sql = buildSql({
    schools: schoolList,
    profiles: profileList,
    events: eventList,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, INPUT_PATH),
    sheetName: SHEET_NAME,
    assumptions: {
      subject: SUBJECT,
      category: SCHOOL_CATEGORY,
      examDaysImported: false,
    },
    counts: {
      schools: schoolList.length,
      profiles: profileList.length,
      supplementMaterials: profileList.reduce((total, profile) => total + profile.supplements.length, 0),
      academicEvents: eventList.length,
    },
    schools: schoolList.map((school) => ({
      name: school.name,
      grades: GRADES.filter((grade) => profiles.has(`${school.name}::${grade}::${SUBJECT}`)),
      supplementMaterials: profileList
        .filter((profile) => profile.schoolName === school.name)
        .reduce((total, profile) => total + profile.supplements.length, 0),
      academicEvents: eventList.filter((event) => event.schoolName === school.name).length,
    })),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(SQL_OUTPUT_PATH, sql, 'utf8');
  await fs.writeFile(REPORT_OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Created ${path.relative(ROOT, SQL_OUTPUT_PATH)}`);
  console.log(`Created ${path.relative(ROOT, REPORT_OUTPUT_PATH)}`);
  console.log(JSON.stringify(report.counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
