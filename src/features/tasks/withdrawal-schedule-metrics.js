/**
 * @typedef {Record<string, unknown>} WithdrawalRawRecord
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   color: string,
 *   startDate: string,
 *   endDate: string,
 * }} WithdrawalBillingPeriod
 *
 * @typedef {{
 *   sessionId: string,
 *   sourceIndex: number,
 *   dateKey: string,
 *   label: string,
 *   state: string,
 *   sessionNumber: number,
 *   lessonHours?: number,
 *   billingId: string,
 *   billingLabel: string,
 *   billingColor: string,
 * }} WithdrawalScheduleItem
 *
 * @typedef {WithdrawalScheduleItem & { source: WithdrawalRawRecord }} NormalizedWithdrawalScheduleItem
 */

const COUNTED_WITHDRAWAL_STATES = new Set(["active", "normal", "makeup"]);
const MAX_LEGACY_CYCLE_GAP_DAYS = 62;

/** @param {unknown} value */
function text(value) {
  return value == null ? "" : String(value).trim();
}

/** @param {unknown} value */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {WithdrawalRawRecord} */ (value)
    : null;
}

/** @param {unknown} value */
function dateKey(value) {
  const match = text(value).match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

/** @param {unknown} value */
export function isCountedWithdrawalScheduleState(value) {
  const state = text(value).toLowerCase() || "active";
  return COUNTED_WITHDRAWAL_STATES.has(state);
}

/** @param {WithdrawalRawRecord | undefined | null} session */
export function getWithdrawalSessionNumber(session) {
  const value = Number(session?.sessionNumber ?? session?.session_number);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** @param {WithdrawalRawRecord} schedulePlan */
function normalizeWithdrawalBillingPeriods(schedulePlan) {
  const rawPeriods = Array.isArray(schedulePlan.billingPeriods)
    ? schedulePlan.billingPeriods
    : Array.isArray(schedulePlan.billing_periods)
      ? schedulePlan.billing_periods
      : [];

  return rawPeriods.flatMap((entry) => {
    const period = record(entry);
    if (!period) return [];
    return [{
      id: text(period.id || period.billingId || period.billing_id || period.periodId || period.period_id),
      label: text(period.label || period.billingLabel || period.billing_label || period.periodLabel || period.period_label),
      color: text(period.color || period.billingColor || period.billing_color || period.periodColor || period.period_color),
      startDate: dateKey(period.startDate || period.start_date),
      endDate: dateKey(period.endDate || period.end_date),
    }];
  });
}

/**
 * @param {WithdrawalBillingPeriod[]} periods
 * @param {string} sessionDate
 * @param {string} billingId
 * @param {string} billingLabel
 */
function resolveWithdrawalBillingPeriod(periods, sessionDate, billingId, billingLabel) {
  if (billingId) {
    const exactId = periods.find((period) => period.id === billingId);
    if (exactId) return exactId;
  }

  const dateMatches = periods.filter((period) => (
    period.startDate &&
    period.endDate &&
    period.startDate <= sessionDate &&
    sessionDate <= period.endDate
  ));
  if (billingLabel) {
    const labelMatches = dateMatches.filter((period) => period.label === billingLabel);
    if (labelMatches.length === 1) return labelMatches[0];
  }
  return dateMatches.length === 1 ? dateMatches[0] : null;
}

/**
 * Normalize the saved schedule-plan boundary without mutating it. Explicit
 * session IDs are the only deduplication key; same-date sessions are valid.
 *
 * @param {unknown} rawSchedulePlan
 * @returns {NormalizedWithdrawalScheduleItem[]}
 */
export function normalizeWithdrawalScheduleSessions(rawSchedulePlan) {
  const schedulePlan = record(rawSchedulePlan) || {};
  const rawSessions = Array.isArray(schedulePlan.sessions)
    ? schedulePlan.sessions
    : Array.isArray(schedulePlan.session_list)
      ? schedulePlan.session_list
      : [];
  const periods = normalizeWithdrawalBillingPeriods(schedulePlan);
  const seenExplicitIds = new Set();

  return rawSessions.flatMap((entry, sourceIndex) => {
    const session = record(entry);
    if (!session) return [];

    const sessionDate = dateKey(session.date || session.session_date || session.dateValue || session.date_value);
    if (!sessionDate) return [];

    const explicitId = text(
      session.id || session.sessionId || session.session_id || session.sessionKey || session.session_key,
    );
    if (explicitId && seenExplicitIds.has(explicitId)) return [];
    if (explicitId) seenExplicitIds.add(explicitId);

    const sessionNumber = getWithdrawalSessionNumber(session);
    const state = text(session.scheduleState || session.schedule_state || session.state).toLowerCase() || "active";
    const rawBillingId = text(
      session.billingId ||
      session.billing_id ||
      session.periodId ||
      session.period_id ||
      session.legacyBillingId ||
      session.legacy_billing_id,
    );
    const rawBillingLabel = text(
      session.billingLabel ||
      session.billing_label ||
      session.periodLabel ||
      session.period_label ||
      session.legacyBillingLabel ||
      session.legacy_billing_label,
    );
    const period = resolveWithdrawalBillingPeriod(periods, sessionDate, rawBillingId, rawBillingLabel);

    return [{
      sessionId: explicitId || `source-index:${sourceIndex}`,
      sourceIndex,
      source: session,
      dateKey: sessionDate,
      label: sessionNumber > 0 ? `${sessionNumber}회차` : "수업",
      state,
      sessionNumber,
      billingId: rawBillingId || period?.id || "",
      billingLabel: rawBillingLabel || period?.label || "",
      billingColor: text(
        session.billingColor ||
        session.billing_color ||
        session.periodColor ||
        session.period_color ||
        session.legacyBillingColor ||
        session.legacy_billing_color ||
        period?.color,
      ),
    }];
  }).sort((left, right) => {
    const dateOrder = left.dateKey.localeCompare(right.dateKey);
    if (dateOrder !== 0) return dateOrder;
    const leftSessionOrder = left.sessionNumber > 0 ? left.sessionNumber : Number.MAX_SAFE_INTEGER;
    const rightSessionOrder = right.sessionNumber > 0 ? right.sessionNumber : Number.MAX_SAFE_INTEGER;
    return leftSessionOrder - rightSessionOrder || left.sourceIndex - right.sourceIndex;
  });
}

/**
 * A withdrawal date is an end-of-day cutoff. When more than one counted lesson
 * exists on that date, the final schedule item is the selected session.
 *
 * @template {WithdrawalScheduleItem} T
 * @param {T[]} items
 * @param {string} selectedDateKey
 * @returns {T | undefined}
 */
export function getWithdrawalDateSelectionItem(items, selectedDateKey) {
  const sameDateItems = items.filter((item) => item.dateKey === selectedDateKey);
  const countedItems = sameDateItems.filter((item) => isCountedWithdrawalScheduleState(item.state));
  return countedItems.at(-1) || sameDateItems.at(-1);
}

/**
 * @param {WithdrawalScheduleItem | undefined} left
 * @param {WithdrawalScheduleItem | undefined} right
 */
function isSameWithdrawalScheduleItem(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.sessionId && right.sessionId) return left.sessionId === right.sessionId;
  return left.sourceIndex === right.sourceIndex && left.dateKey === right.dateKey;
}

/** @param {string} leftDate @param {string} rightDate */
function withdrawalDateGapDays(leftDate, rightDate) {
  const leftTime = Date.parse(`${leftDate}T00:00:00Z`);
  const rightTime = Date.parse(`${rightDate}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(rightTime - leftTime) / 86_400_000;
}

/**
 * @param {WithdrawalScheduleItem} previous
 * @param {WithdrawalScheduleItem} current
 */
function isWithdrawalSessionSequenceBoundary(previous, current) {
  if (withdrawalDateGapDays(previous.dateKey, current.dateKey) > MAX_LEGACY_CYCLE_GAP_DAYS) return true;
  if (current.sessionNumber === 1) return true;
  return previous.sessionNumber > 0 &&
    current.sessionNumber > 0 &&
    previous.sessionNumber >= current.sessionNumber;
}

/**
 * @template {WithdrawalScheduleItem} T
 * @param {T[]} countedItems
 * @param {number} selectedIndex
 * @param {(item: T) => boolean} belongsToCycle
 * @param {boolean} useCalendarMonthForMissingNumbers
 * @returns {T[]}
 */
function getContiguousWithdrawalCycleItems(
  countedItems,
  selectedIndex,
  belongsToCycle,
  useCalendarMonthForMissingNumbers,
) {
  let cycleStartIndex = selectedIndex;
  while (cycleStartIndex > 0) {
    const current = countedItems[cycleStartIndex];
    const previous = countedItems[cycleStartIndex - 1];
    if (!belongsToCycle(previous) || isWithdrawalSessionSequenceBoundary(previous, current)) break;
    if (
      useCalendarMonthForMissingNumbers &&
      (!previous.sessionNumber || !current.sessionNumber) &&
      previous.dateKey.slice(0, 7) !== current.dateKey.slice(0, 7)
    ) break;
    cycleStartIndex -= 1;
  }
  return countedItems.slice(cycleStartIndex, selectedIndex + 1);
}

/**
 * Resolve the selected billing cycle in descending confidence order:
 * exact/range-restored billing ID, contiguous legacy label, then session order.
 * If all legacy metadata and session numbers are absent, the conservative
 * fallback remains within the selected calendar month.
 *
 * @template {WithdrawalScheduleItem} T
 * @param {T[]} items
 * @param {T | undefined} selectedItem
 * @returns {T[]}
 */
export function getWithdrawalBillingCycleItems(items, selectedItem) {
  if (!selectedItem || !isCountedWithdrawalScheduleState(selectedItem.state)) return [];

  const countedItems = items.filter((item) => isCountedWithdrawalScheduleState(item.state));
  const selectedIndex = countedItems.findIndex((item) => isSameWithdrawalScheduleItem(item, selectedItem));
  if (selectedIndex < 0) return [];

  const selectedBillingId = text(selectedItem.billingId);
  if (selectedBillingId) {
    return countedItems
      .slice(0, selectedIndex + 1)
      .filter((item) => text(item.billingId) === selectedBillingId);
  }

  const selectedBillingLabel = text(selectedItem.billingLabel);
  if (selectedBillingLabel) {
    return getContiguousWithdrawalCycleItems(
      countedItems,
      selectedIndex,
      (item) => !text(item.billingId) && text(item.billingLabel) === selectedBillingLabel,
      false,
    );
  }

  return getContiguousWithdrawalCycleItems(
    countedItems,
    selectedIndex,
    (item) => !text(item.billingId) && !text(item.billingLabel),
    true,
  );
}
