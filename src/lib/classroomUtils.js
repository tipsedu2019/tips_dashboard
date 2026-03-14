const ROOM_PREFIXES = {
  본: '본관',
  본관: '본관',
  별: '별관',
  별관: '별관',
};

const ROOM_ORDER = ['본관', '별관'];

function safeText(value) {
  return String(value || '').trim();
}

function collapseWhitespace(value) {
  return safeText(value).replace(/\s+/g, ' ');
}

function stripBrackets(value) {
  return safeText(value).replace(/^\[|\]$/g, '');
}

export function isClassroomAlias(value) {
  return /^\[?\s*(본관|별관|본|별)\s*\d+\s*(?:강)?\s*\]?$/.test(safeText(value));
}

export function normalizeSingleClassroomLabel(value) {
  const text = stripBrackets(collapseWhitespace(value));
  if (!text) {
    return '';
  }

  const match = text.match(/^(본관|별관|본|별)\s*(\d+)\s*(?:강)?$/);
  if (!match) {
    return text;
  }

  const prefix = ROOM_PREFIXES[match[1]];
  return prefix ? `${prefix} ${Number(match[2])}강` : text;
}

export function normalizeClassroomText(value) {
  const text = safeText(value);
  if (!text) {
    return '';
  }

  return text.replace(/\[?\s*(본관|별관|본|별)\s*\d+\s*(?:강)?\s*\]?/g, (match) => normalizeSingleClassroomLabel(match));
}

export function getClassroomCanonicalKey(value) {
  return normalizeSingleClassroomLabel(value)
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function sortClassroomLabels(labels) {
  return [...new Set((labels || []).filter(Boolean))]
    .sort((left, right) => {
      const leftMatch = normalizeSingleClassroomLabel(left).match(/^(본관|별관)\s+(\d+)강$/);
      const rightMatch = normalizeSingleClassroomLabel(right).match(/^(본관|별관)\s+(\d+)강$/);

      if (leftMatch && rightMatch) {
        const prefixDiff = ROOM_ORDER.indexOf(leftMatch[1]) - ROOM_ORDER.indexOf(rightMatch[1]);
        if (prefixDiff !== 0) {
          return prefixDiff;
        }
        return Number(leftMatch[2]) - Number(rightMatch[2]);
      }

      return normalizeSingleClassroomLabel(left).localeCompare(normalizeSingleClassroomLabel(right), 'ko');
    });
}

