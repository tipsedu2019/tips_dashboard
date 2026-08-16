function sameFilterState(left, right) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return [...keys].every((key) => String(left?.[key] || "") === String(right?.[key] || ""));
}

export function reconcilePendingManagementFilters({ current, requested, pending }) {
  if (!pending) {
    return { filters: requested, pending: null };
  }

  if (sameFilterState(requested, pending)) {
    return { filters: requested, pending: null };
  }

  return { filters: current, pending };
}

export function shouldRenderManagementInitialLoading(loading, rowCount) {
  return Boolean(loading && rowCount === 0);
}

export function replaceManagementListUrl(history, nextHref) {
  history.replaceState(null, "", nextHref);
}

const STUDENT_SCHOOL_CATEGORY_LABELS = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

export function formatStudentSchoolCategoryLabel(value) {
  const normalized = String(value || "").trim();
  return STUDENT_SCHOOL_CATEGORY_LABELS[normalized.toLowerCase()] || normalized;
}

export function sortStudentSchoolCategoryValues(values) {
  const preferredOrder = ["초등", "중등", "고등"];
  return [...values].sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(formatStudentSchoolCategoryLabel(left));
    const rightIndex = preferredOrder.indexOf(formatStudentSchoolCategoryLabel(right));
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return String(left).localeCompare(String(right), "ko", { numeric: true });
  });
}
