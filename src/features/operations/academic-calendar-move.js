import { getPersistedAcademicEventId } from './academic-event-utils.js';

const MARKER = '[[TIPS_META]]';
const CONFLICT = '일정이 변경되었거나 이동할 날짜를 확인할 수 없습니다. 일정을 다시 불러온 뒤 이동해 주세요.';

function dayNumber(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith('0000-')) return null;
  const date = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) return null;
  return Math.floor(date.getTime() / 86_400_000);
}

function localDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// JSON.parse validates the document, but re-serializing it would change unknown
// values and formatting. Locate only a top-level value's original token instead.
function rangeEndToken(json) {
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(json[cursor] || '') && cursor < json.length) cursor += 1; };
  const stringEnd = (start) => {
    let index = start + 1;
    while (index < json.length) {
      if (json[index] === '\\') index += 2;
      else if (json[index++] === '"') return index;
    }
    throw new Error(CONFLICT);
  };
  whitespace();
  cursor += 1; // validated opening object brace
  let token = null;
  while (cursor < json.length) {
    whitespace();
    if (json[cursor] === '}') break;
    const keyEnd = stringEnd(cursor);
    const key = JSON.parse(json.slice(cursor, keyEnd));
    cursor = keyEnd;
    whitespace();
    cursor += 1; // colon
    whitespace();
    const start = cursor;
    let depth = 0;
    while (cursor < json.length) {
      const char = json[cursor];
      if (char === '"') { cursor = stringEnd(cursor); continue; }
      if (depth === 0 && (char === ',' || char === '}')) break;
      if (char === '[' || char === '{') depth += 1;
      if (char === ']' || char === '}') depth -= 1;
      cursor += 1;
    }
    let end = cursor;
    while (/\s/.test(json[end - 1] || '') && end > start) end -= 1;
    if (key === 'rangeEnd') {
      if (token) throw new Error(CONFLICT);
      token = { start, end };
    }
    if (json[cursor] === '}') break;
    cursor += 1;
  }
  return token;
}

export function buildAcademicCalendarMovePatch(detail, originalEvent, nextEvent) {
  const id = getPersistedAcademicEventId(originalEvent.sourceId || originalEvent.id);
  const originalDate = localDayKey(originalEvent.date);
  const originalEnd = localDayKey(originalEvent.endDate || originalEvent.date);
  const nextDate = localDayKey(nextEvent.date);
  const nextEnd = localDayKey(nextEvent.endDate || nextEvent.date);
  const days = [originalDate, originalEnd, nextDate, nextEnd].map(dayNumber);
  if (!id || detail?.id !== id || getPersistedAcademicEventId(nextEvent.sourceId || nextEvent.id) !== id
    || detail.startsAt !== originalDate || detail.endsAt !== originalEnd
    || days.some(day => day === null) || days[1] < days[0] || days[3] < days[2]
    || days[1] - days[0] !== days[3] - days[2]
    || !Object.hasOwn(detail, 'storedNote')
    || (detail.storedNote !== null && typeof detail.storedNote !== 'string')) {
    throw new Error(CONFLICT);
  }

  const storedNote = detail.storedNote;
  /** @type {{ date: string, note?: string }} */
  const patch = { date: nextDate };
  const markerIndex = typeof storedNote === 'string' ? storedNote.indexOf(MARKER) : -1;
  let rangeEnd = null;
  if (markerIndex >= 0) {
    const jsonStart = markerIndex + MARKER.length;
    const json = storedNote.slice(jsonStart);
    // SQL and the JS detail adapter split repeated markers differently.
    if (json.includes(MARKER)) throw new Error(CONFLICT);
    let metadata;
    try { metadata = JSON.parse(json); } catch { metadata = null; }
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const token = rangeEndToken(json);
      rangeEnd = dayNumber(metadata.rangeEnd);
      if (token && rangeEnd !== null) {
        // Even an old rangeEnd before the start must move: otherwise a backward
        // single-day drag could accidentally become a multi-day event.
        patch.note = storedNote.slice(0, jsonStart + token.start)
          + JSON.stringify(nextEnd) + storedNote.slice(jsonStart + token.end);
      }
    }
  }
  if (Math.max(days[0], rangeEnd ?? days[0]) !== days[1]) throw new Error(CONFLICT);
  return { id, originalDate, storedNote, patch };
}
