function toComparableTime(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function buildSessionStepKey(groupKey, session = {}) {
  return [
    groupKey,
    session.date || "",
    session.originalDate || "base",
    session.sessionNumber || "na",
  ].join("::");
}

export function hasSessionDetailContent(session = {}) {
  return Boolean(
    session.memo ||
      (session.state === "exception" && session.makeupDate) ||
      (session.state === "makeup" && session.originalDate),
  );
}

export function buildSessionTimeline(sessionGroups = []) {
  return (sessionGroups || [])
    .flatMap((group, groupIndex) =>
      (group.sessions || []).map((session, sessionIndex) => ({
        groupKey: group.key,
        session,
        sessionKey: buildSessionStepKey(group.key, session),
        groupIndex,
        sessionIndex,
      })),
    )
    .sort((left, right) => {
      const timeDiff =
        toComparableTime(left.session?.date) - toComparableTime(right.session?.date);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      const sessionNumberDiff =
        Number(left.session?.sessionNumber || 0) -
        Number(right.session?.sessionNumber || 0);
      if (sessionNumberDiff !== 0) {
        return sessionNumberDiff;
      }

      const groupIndexDiff = left.groupIndex - right.groupIndex;
      if (groupIndexDiff !== 0) {
        return groupIndexDiff;
      }

      return left.sessionIndex - right.sessionIndex;
    });
}

export function buildSessionStepStateMap(
  sessionGroups = [],
  referenceDate = new Date(),
) {
  const timeline = buildSessionTimeline(sessionGroups);
  const comparisonDate = new Date(referenceDate);
  comparisonDate.setHours(0, 0, 0, 0);

  let activeTimelineIndex = -1;
  timeline.forEach((entry, index) => {
    if (toComparableTime(entry.session?.date) <= comparisonDate.getTime()) {
      activeTimelineIndex = index;
    }
  });

  const stepStates = new Map(
    timeline.map((entry, index) => [
      entry.sessionKey,
      index < activeTimelineIndex
        ? "done"
        : index === activeTimelineIndex
          ? "active"
          : "pending",
    ]),
  );

  return {
    activeSessionKey:
      activeTimelineIndex >= 0
        ? timeline[activeTimelineIndex].sessionKey
        : null,
    stepStates,
    timeline,
  };
}
