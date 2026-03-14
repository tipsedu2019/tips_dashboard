import { useEffect, useMemo, useRef, useState } from 'react';

function readStoredValue(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function serializeExternalState(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.join(' ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value || '').trim();
}

function toComparableValue(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'number') {
    return value;
  }

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return asDate.getTime();
  }

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && String(value).trim() !== '') {
    return asNumber;
  }

  return normalizeText(value).toLowerCase();
}

function defaultFilterValue(column) {
  switch (column.filterKind) {
    case 'number-range':
    case 'date-range':
      return { min: '', max: '' };
    case 'multi-select':
      return [];
    case 'single-select':
    case 'text':
    default:
      return '';
  }
}

function getColumnValue(column, item) {
  if (column.getValue) {
    return column.getValue(item);
  }

  return item?.[column.key];
}

function uniqueOptions(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ko'));
}

function resolveFilterOptions(column, data) {
  if (typeof column.filterOptions === 'function') {
    return column.filterOptions(data);
  }

  if (Array.isArray(column.filterOptions)) {
    return column.filterOptions;
  }

  if (!column.filterKind || column.filterKind === 'text' || column.filterKind === 'number-range' || column.filterKind === 'date-range') {
    return [];
  }

  const values = data.flatMap((item) => {
    const value = getColumnValue(column, item);
    return Array.isArray(value) ? value : [value];
  });

  return uniqueOptions(values);
}

function matchesColumnFilter(column, item, filterValue) {
  if (column.filterKind === 'single-select') {
    if (!filterValue) {
      return true;
    }

    return normalizeText(getColumnValue(column, item)) === filterValue;
  }

  if (column.filterKind === 'multi-select') {
    if (!Array.isArray(filterValue) || filterValue.length === 0) {
      return true;
    }

    const rawValue = getColumnValue(column, item);
    const values = Array.isArray(rawValue) ? rawValue.map((value) => normalizeText(value)) : [normalizeText(rawValue)];
    return filterValue.some((selected) => values.includes(selected));
  }

  if (column.filterKind === 'number-range') {
    const numericValue = Number(getColumnValue(column, item) || 0);
    const min = filterValue?.min === '' ? null : Number(filterValue?.min);
    const max = filterValue?.max === '' ? null : Number(filterValue?.max);

    if (min !== null && numericValue < min) {
      return false;
    }
    if (max !== null && numericValue > max) {
      return false;
    }
    return true;
  }

  if (column.filterKind === 'date-range') {
    const rawValue = getColumnValue(column, item);
    if (!rawValue) {
      return !filterValue?.min && !filterValue?.max;
    }

    if (filterValue?.min && rawValue < filterValue.min) {
      return false;
    }
    if (filterValue?.max && rawValue > filterValue.max) {
      return false;
    }
    return true;
  }

  if (column.filterKind === 'text') {
    const query = String(filterValue || '').trim().toLowerCase();
    if (!query) {
      return true;
    }

    return normalizeText(getColumnValue(column, item)).toLowerCase().includes(query);
  }

  return true;
}

function normalizeColumnOrder(storedOrder, columns) {
  const columnKeys = columns.map((column) => column.key);
  const nextOrder = [...new Set([...(storedOrder || []), ...columnKeys])].filter((key) => columnKeys.includes(key));
  return nextOrder.length > 0 ? nextOrder : columnKeys;
}

function normalizeGrouping(storedGrouping, columns) {
  const columnKeys = new Set(columns.map((column) => column.key));
  const nextGrouping = Array.isArray(storedGrouping) ? storedGrouping.slice(0, 2) : ['', ''];
  while (nextGrouping.length < 2) {
    nextGrouping.push('');
  }

  return nextGrouping.map((key, index) => {
    if (!key || !columnKeys.has(key)) {
      return '';
    }

    return nextGrouping.findIndex((value) => value === key) === index ? key : '';
  });
}

function getGroupValue(column, item) {
  const value = getColumnValue(column, item);
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ') || '미분류';
  }

  return normalizeText(value) || '미분류';
}

function buildGroupedRows(data, columns, grouping) {
  const activeGrouping = grouping.filter(Boolean);
  if (activeGrouping.length === 0) {
    return data.map((item) => ({
      type: 'item',
      key: `item:${item.id}`,
      item,
      depth: 0,
    }));
  }

  const columnMap = new Map(columns.map((column) => [column.key, column]));

  const flattenGroup = (items, depth, parentKeys) => {
    const groupKey = activeGrouping[depth];
    const column = columnMap.get(groupKey);

    if (!column) {
      return items.map((item) => ({
        type: 'item',
        key: `item:${item.id}`,
        item,
        depth,
      }));
    }

    const buckets = new Map();
    items.forEach((item) => {
      const value = getGroupValue(column, item);
      const bucketKey = `${groupKey}:${value}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { value, items: [] });
      }
      buckets.get(bucketKey).items.push(item);
    });

    return [...buckets.values()]
      .sort((left, right) => {
        const leftValue = toComparableValue(left.value);
        const rightValue = toComparableValue(right.value);

        if (leftValue === rightValue) {
          return 0;
        }

        return leftValue > rightValue ? 1 : -1;
      })
      .flatMap((bucket) => {
        const nextParentKeys = [...parentKeys, `${groupKey}:${bucket.value}`];
        const children = depth === activeGrouping.length - 1
          ? bucket.items.map((item) => ({
            type: 'item',
            key: `item:${item.id}`,
            item,
            depth: depth + 1,
          }))
          : flattenGroup(bucket.items, depth + 1, nextParentKeys);

        return [
          {
            type: 'group',
            key: `group:${nextParentKeys.join('|')}`,
            depth,
            column,
            value: bucket.value,
            count: bucket.items.length,
          },
          ...children,
        ];
      });
  };

  return flattenGroup(data, 0, []);
}

export function useDataTableControls({
  storageKey,
  data,
  columns,
  searchAccessor,
  defaultSortKey,
  externalState = null,
  onStateChange = null,
}) {
  const initialVisibility = useMemo(
    () => columns.reduce((result, column) => {
      result[column.key] = column.visibleByDefault !== false;
      return result;
    }, {}),
    [columns]
  );
  const defaultColumnOrder = useMemo(() => columns.map((column) => column.key), [columns]);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [visibleMap, setVisibleMap] = useState(() => externalState?.visibleMap || readStoredValue(`${storageKey}:columns`, initialVisibility));
  const [sortState, setSortState] = useState(() => externalState?.sortState || readStoredValue(`${storageKey}:sort`, {
    key: defaultSortKey || columns.find((column) => column.sortable !== false)?.key || columns[0]?.key,
    direction: 'asc'
  }));
  const [filters, setFilters] = useState(() => columns.reduce((result, column) => {
    result[column.key] = defaultFilterValue(column);
    return result;
  }, {}));
  const [columnOrder, setColumnOrder] = useState(() => externalState?.columnOrder || readStoredValue(`${storageKey}:column-order`, defaultColumnOrder));
  const [grouping, setGrouping] = useState(() => externalState?.grouping || readStoredValue(`${storageKey}:grouping`, ['', '']));
  const lastExternalSignatureRef = useRef('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!externalState) {
      return;
    }

    const signature = serializeExternalState(externalState);
    if (signature === lastExternalSignatureRef.current) {
      return;
    }

    if (externalState.visibleMap) {
      setVisibleMap({ ...initialVisibility, ...externalState.visibleMap });
    }

    if (externalState.sortState?.key) {
      setSortState((current) => ({
        ...current,
        ...externalState.sortState,
      }));
    }

    if (externalState.columnOrder) {
      setColumnOrder(normalizeColumnOrder(externalState.columnOrder, columns));
    }

    if (externalState.grouping) {
      setGrouping(normalizeGrouping(externalState.grouping, columns));
    }

    lastExternalSignatureRef.current = signature;
  }, [columns, externalState, initialVisibility]);

  useEffect(() => {
    setVisibleMap((current) => {
      const nextValue = { ...initialVisibility, ...current };
      const hasChanged = Object.keys(nextValue).some((key) => nextValue[key] !== current[key]);
      if (!hasChanged) {
        return current;
      }
      writeStoredValue(`${storageKey}:columns`, nextValue);
      return nextValue;
    });
  }, [initialVisibility, storageKey]);

  useEffect(() => {
    writeStoredValue(`${storageKey}:columns`, visibleMap);
  }, [storageKey, visibleMap]);

  useEffect(() => {
    writeStoredValue(`${storageKey}:sort`, sortState);
  }, [storageKey, sortState]);

  useEffect(() => {
    setColumnOrder((current) => {
      const nextValue = normalizeColumnOrder(current, columns);
      if (JSON.stringify(nextValue) === JSON.stringify(current)) {
        return current;
      }
      writeStoredValue(`${storageKey}:column-order`, nextValue);
      return nextValue;
    });
  }, [columns, storageKey]);

  useEffect(() => {
    writeStoredValue(`${storageKey}:column-order`, columnOrder);
  }, [columnOrder, storageKey]);

  useEffect(() => {
    setGrouping((current) => {
      const nextValue = normalizeGrouping(current, columns);
      if (JSON.stringify(nextValue) === JSON.stringify(current)) {
        return current;
      }
      writeStoredValue(`${storageKey}:grouping`, nextValue);
      return nextValue;
    });
  }, [columns, storageKey]);

  useEffect(() => {
    writeStoredValue(`${storageKey}:grouping`, grouping);
  }, [grouping, storageKey]);

  useEffect(() => {
    onStateChange?.({
      visibleMap,
      sortState,
      columnOrder,
      grouping,
    });
  }, [columnOrder, grouping, onStateChange, sortState, visibleMap]);

  const orderedColumns = useMemo(() => {
    const columnMap = new Map(columns.map((column) => [column.key, column]));
    return normalizeColumnOrder(columnOrder, columns)
      .map((key) => columnMap.get(key))
      .filter(Boolean);
  }, [columnOrder, columns]);

  const filterOptions = useMemo(
    () => orderedColumns.reduce((result, column) => {
      result[column.key] = resolveFilterOptions(column, data);
      return result;
    }, {}),
    [data, orderedColumns]
  );

  const filteredData = useMemo(() => {
    const searchValue = debouncedSearchQuery.trim().toLowerCase();

    const matched = (data || []).filter((item) => {
      const matchesSearch = !searchValue || searchAccessor(item).includes(searchValue);
      if (!matchesSearch) {
        return false;
      }

      return orderedColumns.every((column) => matchesColumnFilter(column, item, filters[column.key]));
    });

    const sortColumn = orderedColumns.find((column) => column.key === sortState.key);
    if (!sortColumn) {
      return matched;
    }

    return [...matched].sort((left, right) => {
      const leftValue = toComparableValue(sortColumn.sortAccessor ? sortColumn.sortAccessor(left) : getColumnValue(sortColumn, left));
      const rightValue = toComparableValue(sortColumn.sortAccessor ? sortColumn.sortAccessor(right) : getColumnValue(sortColumn, right));

      if (leftValue === rightValue) {
        return 0;
      }

      if (sortState.direction === 'asc') {
        return leftValue > rightValue ? 1 : -1;
      }

      return leftValue < rightValue ? 1 : -1;
    });
  }, [data, debouncedSearchQuery, filters, orderedColumns, searchAccessor, sortState]);

  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => visibleMap[column.key] !== false),
    [orderedColumns, visibleMap]
  );

  const rowModels = useMemo(
    () => buildGroupedRows(filteredData, orderedColumns, grouping),
    [filteredData, grouping, orderedColumns]
  );

  const currentIds = useMemo(() => filteredData.map((item) => item.id), [filteredData]);

  const toggleColumnVisibility = (columnKey) => {
    setVisibleMap((current) => ({
      ...current,
      [columnKey]: !current[columnKey]
    }));
  };

  const moveColumn = (columnKey, direction) => {
    setColumnOrder((current) => {
      const nextOrder = normalizeColumnOrder(current, columns);
      const currentIndex = nextOrder.indexOf(columnKey);
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= nextOrder.length) {
        return nextOrder;
      }

      const reordered = [...nextOrder];
      [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
      return reordered;
    });
  };

  const resetColumnOrder = () => {
    setColumnOrder(defaultColumnOrder);
  };

  const setFilterValue = (columnKey, value) => {
    setFilters((current) => ({
      ...current,
      [columnKey]: value
    }));
  };

  const clearAllFilters = () => {
    setFilters(orderedColumns.reduce((result, column) => {
      result[column.key] = defaultFilterValue(column);
      return result;
    }, {}));
  };

  const setSort = (columnKey, direction = 'asc') => {
    setSortState({ key: columnKey, direction });
  };

  const toggleSort = (columnKey) => {
    setSortState((current) => {
      if (current.key === columnKey) {
        return {
          key: columnKey,
          direction: current.direction === 'asc' ? 'desc' : 'asc'
        };
      }

      return {
        key: columnKey,
        direction: 'asc'
      };
    });
  };

  const setGroupingLevel = (index, nextKey) => {
    setGrouping((current) => {
      const nextGrouping = normalizeGrouping(current, columns);
      const safeKey = nextKey || '';
      const otherIndex = index === 0 ? 1 : 0;

      if (safeKey && nextGrouping[otherIndex] === safeKey) {
        nextGrouping[otherIndex] = '';
      }

      nextGrouping[index] = safeKey;

      if (!nextGrouping[0] && nextGrouping[1]) {
        nextGrouping[0] = nextGrouping[1];
        nextGrouping[1] = '';
      }

      return nextGrouping;
    });
  };

  const clearGrouping = () => {
    setGrouping(['', '']);
  };

  return {
    searchQuery,
    setSearchQuery,
    visibleMap,
    visibleColumns,
    columnOrder,
    toggleColumnVisibility,
    moveColumn,
    resetColumnOrder,
    sortState,
    setSort,
    toggleSort,
    filters,
    setFilterValue,
    clearAllFilters,
    filterOptions,
    filteredData,
    rowModels,
    currentIds,
    columns: orderedColumns,
    grouping,
    setGroupingLevel,
    clearGrouping,
  };
}
