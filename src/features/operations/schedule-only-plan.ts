type Plan = Record<string, unknown>;
type Session = Record<string, unknown>;
const contentFields = ["textbookEntries", "rangeStart", "rangeEnd", "rangeLabel", "progressStatus", "publicNote", "teacherNote"] as const;
const sessionKey = (row: Session) => String(row.sessionKey || row.session_key || row.id || "");

// The scheduling editor owns dates and schedule states only. Historical learning
// content remains untouched when the legacy schedule is regenerated and saved.
export function preserveScheduleLearningContent(plan: Plan, savedPlan: Plan): Plan {
  const savedSessions = Array.isArray(savedPlan.sessions) ? savedPlan.sessions as Session[] : [];
  const saved = new Map(savedSessions.map(row => [sessionKey(row), row]));
  const byDate = new Map<string, Session[]>();
  for (const row of savedSessions) {
    const date = String(row.date || row.session_date || "");
    if (date) byDate.set(date, [...(byDate.get(date) || []), row]);
  }
  return {
    ...plan,
    textbooks: Array.isArray(savedPlan.textbooks) ? savedPlan.textbooks : [],
    sessions: (Array.isArray(plan.sessions) ? plan.sessions as Session[] : []).map(row => {
      // Legacy IDs include state and sequence, so a holiday toggle can change
      // the key of an otherwise identical lesson. Only use an unambiguous date.
      const dateMatches = byDate.get(String(row.date || row.session_date || "")) || [];
      const previous = saved.get(sessionKey(row)) || (dateMatches.length === 1 ? dateMatches[0] : undefined);
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
