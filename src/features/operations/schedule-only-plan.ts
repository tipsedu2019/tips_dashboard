type Plan = Record<string, unknown>;
type Session = Record<string, unknown>;
const contentFields = ["textbookEntries", "rangeStart", "rangeEnd", "rangeLabel", "progressStatus", "publicNote", "teacherNote"] as const;
const sessionKey = (row: Session) => String(row.sessionKey || row.session_key || row.id || "");

// The scheduling editor owns dates and schedule states only. Historical learning
// content remains untouched when the legacy schedule is regenerated and saved.
export function preserveScheduleLearningContent(plan: Plan, savedPlan: Plan): Plan {
  const saved = new Map((Array.isArray(savedPlan.sessions) ? savedPlan.sessions as Session[] : []).map(row => [sessionKey(row), row]));
  return {
    ...plan,
    textbooks: Array.isArray(savedPlan.textbooks) ? savedPlan.textbooks : [],
    sessions: (Array.isArray(plan.sessions) ? plan.sessions as Session[] : []).map(row => {
      const previous = saved.get(sessionKey(row));
      const result = { ...row };
      for (const field of contentFields) {
        if (previous && Object.prototype.hasOwnProperty.call(previous, field)) result[field] = previous[field];
        else delete result[field];
      }
      return result;
    }),
  };
}

export function scheduleOnlyDraft(plan: Plan): Plan {
  return {
    ...plan,
    textbooks: [],
    sessions: (Array.isArray(plan.sessions) ? plan.sessions as Session[] : []).map(row => {
      const result = { ...row };
      for (const field of contentFields) delete result[field];
      return result;
    }),
  };
}
