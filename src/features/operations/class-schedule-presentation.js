// Counts are meaningful only after the current row's schedule source was accepted.
// Numbered list summaries deliberately omit that source; zero defaults are not evidence.
export function formatClassScheduleProgress({ completedSessions, sessionCount, state }) {
  const labels = { missing: '진도 미조회', loading: '진도 확인 중', error: '진도 조회 실패', forbidden: '조회 권한 없음', noPeriod: '선택 기간 없음' };
  if (state !== 'accepted') return { label: labels[state] || labels.missing, countLabel: null, percent: null };
  if (!Number.isInteger(completedSessions) || !Number.isInteger(sessionCount) || completedSessions < 0 || sessionCount < 0) {
    return { label: labels.missing, countLabel: null, percent: null };
  }
  if (sessionCount === 0) return { label: completedSessions === 0 ? '계획 없음' : '계획 회차 확인 필요', countLabel: completedSessions > 0 ? `${completedSessions}/0회` : null, percent: null };
  const percent = Math.round((completedSessions / sessionCount) * 100);
  return { label: `${percent}%`, countLabel: `${completedSessions}/${sessionCount}회`, percent };
}

export function getClassScheduleProgressState(classItem, requestState = 'accepted') {
  if (requestState !== 'accepted') return requestState;
  const plan = classItem?.schedule_plan ?? classItem?.schedulePlan;
  // An empty object or a summary-only row has not provided a session collection.
  if (!plan || !Array.isArray(plan.sessions)) return 'missing';
  if (!Array.isArray(plan.billingPeriods)) return 'missing';
  if (plan.billingPeriods.length === 0) return 'noPeriod';
  return 'accepted';
}
