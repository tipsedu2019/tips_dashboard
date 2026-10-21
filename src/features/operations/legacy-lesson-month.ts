type Period = Record<string, unknown>;
type Plan = Record<string, unknown>;
const periodsOf = (plan: Plan): Period[] => Array.isArray(plan.billingPeriods) ? plan.billingPeriods : [];
const dateKey = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
};

export function legacyLessonMonthRange(monthKey: string) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${monthKey}-01`, endDate: `${monthKey}-${lastDay}`, month, label: `${month}월` };
}

export function suggestedLegacyLessonMonth(plan: Plan, today: string) {
  const anchors = periodsOf(plan).flatMap(period => [dateKey(period.startDate), dateKey(period.endDate)])
    .filter(Boolean).sort();
  if (!anchors.length) return today.slice(0, 7);
  const last = anchors[anchors.length - 1];
  const [year, month] = last.slice(0, 7).split('-').map(Number);
  return `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
}

function monthExists(periods: Period[], monthKey: string) {
  const range = legacyLessonMonthRange(monthKey);
  if (!range) return false;
  return periods.some(period => {
    const start = dateKey(period.startDate), end = dateKey(period.endDate);
    // A billing cycle can begin in the preceding month. Keep its authored
    // billing month as well as its occupied date range when checking additions.
    const billingYear = (end || start).slice(0, 4);
    return (start && end && start <= range.endDate && end >= range.startDate)
      || (billingYear === monthKey.slice(0, 4) && Number(period.month) === range.month);
  });
}

export function prepareLegacyLessonMonth(plan: Plan, monthKey: string, id = '') {
  const range = legacyLessonMonthRange(monthKey);
  if (!range) return { error: '추가할 연월을 선택해 주세요.', period: null };
  if (monthExists(periodsOf(plan), monthKey)) return { error: `${monthKey.replace('-', '년 ')}월 일정이 이미 있습니다. 기존 구간을 확인해 주세요.`, period: null };
  const days = new Set((Array.isArray(plan.selectedDays) ? plan.selectedDays : []).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6));
  const dates: string[] = [];
  for (let day = 1; day <= Number(range.endDate.slice(-2)); day++) {
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    if (days.has(new Date(`${date}T00:00:00Z`).getUTCDay())) dates.push(date);
  }
  if (!dates.length) return { error: '수업 요일을 먼저 설정해 주세요.', period: null };
  return { error: '', period: { id, month: range.month, label: range.label, startDate: dates[0], endDate: dates[dates.length - 1] } };
}

// Apply only to newly added periods. Historical cross-month billing cycles and
// their labels remain editable under the existing contract.
export function newLegacyLessonMonthError(plan: Plan, baseline: Plan, selectedMonths?: ReadonlyMap<string, string>) {
  const savedIds = new Set(periodsOf(baseline).map(period => period.id));
  const periods = periodsOf(plan);
  for (const period of periods) {
    if (savedIds.has(period.id) || (selectedMonths && !selectedMonths.has(String(period.id)))) continue;
    const start = dateKey(period.startDate), end = dateKey(period.endDate);
    const monthKey = selectedMonths?.get(String(period.id)) || start.slice(0, 7), range = legacyLessonMonthRange(monthKey);
    if (!range || !start || !end || end < start || start.slice(0, 7) !== monthKey || end.slice(0, 7) !== monthKey || Number(period.month) !== range.month || period.label !== range.label) {
      return '신규 구간의 시작·종료일과 선택한 연월이 일치해야 합니다.';
    }
    if (monthExists(periods.filter(other => other !== period), monthKey)) return `${monthKey.replace('-', '년 ')}월 일정이 이미 있습니다. 기존 구간을 확인해 주세요.`;
  }
  return '';
}
