type ClassGroupPageRow = {
  id?: unknown;
};

type ClassGroupPageResult<Row, QueryError> =
  | { data: Row[]; error: null }
  | { data: null; error: QueryError | Error };

function text(value: unknown) {
  return String(value || "").trim();
}

export function sortClassGroupRows(rows: Record<string, unknown>[], includeSortOrder: boolean) {
  return [...rows].sort((left, right) => {
    if (includeSortOrder) {
      const leftOrder = text(left.sort_order) ? Number(left.sort_order) : Number.MAX_SAFE_INTEGER;
      const rightOrder = text(right.sort_order) ? Number(right.sort_order) : Number.MAX_SAFE_INTEGER;
      const normalizedLeftOrder = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
      const normalizedRightOrder = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
      if (normalizedLeftOrder !== normalizedRightOrder) return normalizedLeftOrder - normalizedRightOrder;
    }

    const nameComparison = text(left.name).localeCompare(text(right.name), "ko");
    if (nameComparison !== 0) return nameComparison;
    return text(left.id).localeCompare(text(right.id));
  });
}

export async function collectClassGroupPages<Row extends ClassGroupPageRow, QueryError>(
  fetchPage: (afterId: string | null) => PromiseLike<{ data: Row[] | null; error: QueryError | null }>,
  pageSize: number,
): Promise<ClassGroupPageResult<Row, QueryError>> {
  const rows: Row[] = [];
  let afterId: string | null = null;

  while (true) {
    const { data, error } = await fetchPage(afterId);
    if (error) return { data: null, error };

    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };

    const nextAfterId = String(page[page.length - 1]?.id || "").trim();
    if (!nextAfterId || nextAfterId === afterId) {
      return { data: null, error: new Error("수업그룹 페이지 기준값을 확인하지 못했습니다.") };
    }
    afterId = nextAfterId;
  }
}
