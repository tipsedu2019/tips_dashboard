import { buildAcademicCalendarMovePatch } from './academic-calendar-move.js';

const INVALID_SOURCE = 'academic_move_source_invalid';

async function noteFingerprint(rawNote) {
  if (rawNote === null) return null;
  if (typeof rawNote !== 'string') throw new Error(INVALID_SOURCE);
  // TextEncoder replaces unpaired UTF-16 surrogates. Reject malformed client
  // text instead of computing a fingerprint for different stored UTF-8 bytes.
  for (let index = 0; index < rawNote.length; index += 1) {
    const code = rawNote.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = rawNote.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(INVALID_SOURCE);
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(INVALID_SOURCE);
    }
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNote));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareAcademicCalendarMoveRequest(detail, originalEvent, nextEvent) {
  try {
    const move = buildAcademicCalendarMovePatch(detail, originalEvent, nextEvent);
    const expectedEnd = detail.endsAt;
    const end = nextEvent.endDate || nextEvent.date;
    const nextEnd = `${String(end.getFullYear()).padStart(4, '0')}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const nextNote = Object.hasOwn(move.patch, 'note') ? move.patch.note : move.storedNote;
    // Capture both notes and dates from the same validated detail before either
    // asynchronous digest. The UI must recheck its owner before sending.
    const expectedFingerprint = await noteFingerprint(move.storedNote);
    const nextFingerprint = await noteFingerprint(nextNote);
    return {
      params: {
        p_event_id: move.id,
        p_expected_date: move.originalDate,
        p_expected_end_date: expectedEnd,
        p_expected_note_sha256: expectedFingerprint,
        p_next_date: move.patch.date,
        p_next_end_date: nextEnd,
      },
      expectedReceipt: { id: move.id, date: move.patch.date, endsAt: nextEnd, noteSha256: nextFingerprint },
    };
  } catch {
    // Do not expose parser, crypto, or source values in an error or its cause.
    throw new Error(INVALID_SOURCE);
  }
}

export function writeAcademicCalendarMove(client, params) {
  return client.rpc('move_academic_event_dates_v1', params)
    .abortSignal(AbortSignal.timeout(8_000)).retry(false);
}

export function isConfirmedAcademicCalendarMove(result, expected) {
  const receipt = result?.data;
  return !result?.error && receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt)
    && Object.keys(receipt).length === 4
    && ['id', 'date', 'endsAt', 'noteSha256'].every(key => Object.hasOwn(receipt, key))
    && receipt.id === expected.id && receipt.date === expected.date
    && receipt.endsAt === expected.endsAt && receipt.noteSha256 === expected.noteSha256;
}
