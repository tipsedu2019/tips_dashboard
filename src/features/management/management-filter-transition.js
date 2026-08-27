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

function normalizeSearchValue(value) {
  return String(value || "").trim();
}

function nullableSearchParam(params, key) {
  return normalizeSearchValue(params.get(key)) || null;
}

export function serializeManagementListFilters(kind, searchParamString) {
  const params = new URLSearchParams(String(searchParamString || ""));
  if (kind === "students") {
    return JSON.stringify({
      kind,
      search: normalizeSearchValue(params.get("q")),
      status: nullableSearchParam(params, "status"),
      schoolCategory: nullableSearchParam(params, "schoolCategory"),
      school: nullableSearchParam(params, "school"),
      grade: nullableSearchParam(params, "grade"),
    });
  }
  if (kind === "classes") {
    return JSON.stringify({
      kind,
      search: normalizeSearchValue(params.get("q")),
      periodId: nullableSearchParam(params, "period"),
      status: nullableSearchParam(params, "status") || "수강",
      subject: nullableSearchParam(params, "subject"),
      grade: nullableSearchParam(params, "grade"),
      teacher: nullableSearchParam(params, "teacher"),
      classroom: nullableSearchParam(params, "classroom"),
    });
  }
  return JSON.stringify({
    kind,
    search: normalizeSearchValue(params.get("q")),
    status: nullableSearchParam(params, "status"),
    subject: nullableSearchParam(params, "subject"),
    publisher: nullableSearchParam(params, "publisher"),
  });
}

export function reconcilePendingManagementSearch({
  pendingSearch,
  currentInput,
  debouncedInput,
  requestedSearch,
  composing,
}) {
  if (pendingSearch === null || pendingSearch === undefined) {
    return { shouldSyncUrl: false, pendingSearch: null };
  }

  const pending = normalizeSearchValue(pendingSearch);
  const current = normalizeSearchValue(currentInput);
  const debounced = normalizeSearchValue(debouncedInput);
  const requested = normalizeSearchValue(requestedSearch);

  if (composing || current !== pending || debounced !== pending) {
    return { shouldSyncUrl: false, pendingSearch: pending };
  }

  if (requested === debounced) {
    return { shouldSyncUrl: false, pendingSearch: null };
  }

  return { shouldSyncUrl: true, pendingSearch: pending };
}

export function withRequestedDefaultClassPeriod(requested, defaultPeriod) {
  return {
    ...(requested || {}),
    period: String(defaultPeriod || "").trim(),
  };
}

export function resolveManagementPeriodFilterValue(options, value, fallback) {
  const availableOptions = Array.isArray(options) ? options : [];
  const requestedValue = String(value || "").trim();
  const fallbackValue = String(fallback || "").trim();
  const findOption = (candidate) => {
    if (!candidate) {
      return undefined;
    }

    return availableOptions.find((option) => {
      const optionValue = String(option?.value || "").trim();
      const aliases = Array.isArray(option?.aliases)
        ? option.aliases.map((alias) => String(alias || "").trim())
        : [];
      return optionValue === candidate || aliases.includes(candidate);
    });
  };

  if (requestedValue) {
    return requestedValue;
  }

  const fallbackOption = findOption(fallbackValue);
  return (
    String(fallbackOption?.value || "").trim() ||
    fallbackValue ||
    String(availableOptions[0]?.value || "").trim()
  );
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
