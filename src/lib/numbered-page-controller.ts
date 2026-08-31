import { normalizePage, validatePageSize, type DataTablePageSize, type NumberedPage } from "./numbered-pagination.ts";

export type NumberedPageRequest = { scope: string; page: number; pageSize: DataTablePageSize };
export type NumberedPageSnapshot<T> = {
  scope: string | null;
  requestedPage: number;
  page: number;
  pageSize: DataTablePageSize;
  totalCount: number | null;
  rows: T[];
  loading: boolean;
  error: unknown;
};

export function createNumberedPageController<T>({ loadPage, onChange }: {
  loadPage: (request: NumberedPageRequest & { signal: AbortSignal }) => Promise<NumberedPage<T>>;
  onChange: (snapshot: NumberedPageSnapshot<T>) => void;
}) {
  let snapshot: NumberedPageSnapshot<T> = {
    scope: null, requestedPage: 1, page: 1, pageSize: 10,
    totalCount: null, rows: [], loading: false, error: null,
  };
  let requested: NumberedPageRequest | null = null;
  let active: AbortController | null = null;
  let disposed = false;
  const publish = (next: NumberedPageSnapshot<T>) => { snapshot = next; onChange(next); };

  async function load(request: NumberedPageRequest) {
    if (disposed) return;
    requested = { ...request, page: normalizePage(request.page), pageSize: validatePageSize(request.pageSize) };
    const target = requested;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const current = () => !disposed && active === controller && !controller.signal.aborted;
    publish({ ...snapshot, requestedPage: target.page, loading: true, error: null });
    try {
      let page = await loadPage({ ...target, signal: controller.signal });
      if (!current()) return;
      const lastPage = Math.max(1, Math.ceil(page.totalCount / target.pageSize));
      if (page.rows.length === 0 && target.page > lastPage) {
        page = await loadPage({ ...target, page: lastPage, signal: controller.signal });
        if (!current()) return;
        if (page.rows.length === 0 && page.page > Math.max(1, Math.ceil(page.totalCount / target.pageSize))) {
          throw new Error("Page range changed again; retry the request.");
        }
      }
      requested = { ...target, page: page.page };
      publish({ ...page, scope: target.scope, requestedPage: page.page, loading: false, error: null });
    } catch (error) {
      if (current()) publish({ ...snapshot, loading: false, error });
    }
  }

  return {
    load,
    retry: () => requested ? load(requested) : Promise.resolve(),
    dispose() { disposed = true; active?.abort(); },
  };
}
