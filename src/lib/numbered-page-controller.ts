import { normalizePage, validatePageSize, type DataTablePageSize, type NumberedPage } from "./numbered-pagination.ts";

export type NumberedPageRequest = { scope: string; page: number; pageSize: DataTablePageSize };
export type NumberedPageLoadRequest = NumberedPageRequest & {
  signal: AbortSignal;
  // Pins a resolved scope for this active read, retry and clamp without
  // relabeling the previous successful snapshot. False after this read settles.
  canonicalizeScope: (scope: string) => boolean;
};
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
  loadPage: (request: NumberedPageLoadRequest) => Promise<NumberedPage<T>>;
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
    let invocation = 0;
    const loadRequest = (page: number): NumberedPageLoadRequest => {
      const call = ++invocation;
      return { ...target, page, signal: controller.signal, canonicalizeScope(scope) {
        if (!current() || call !== invocation) return false;
        target.scope = scope;
        return true;
      } };
    };
    publish({ ...snapshot, requestedPage: target.page, loading: true, error: null });
    try {
      let page = await loadPage(loadRequest(target.page));
      invocation++;
      if (!current()) return;
      const lastPage = Math.max(1, Math.ceil(page.totalCount / target.pageSize));
      if (page.rows.length === 0 && target.page > lastPage) {
        page = await loadPage(loadRequest(lastPage));
        invocation++;
        if (!current()) return;
        if (page.rows.length === 0 && page.page > Math.max(1, Math.ceil(page.totalCount / target.pageSize))) {
          throw new Error("Page range changed again; retry the request.");
        }
      }
      requested = { ...target, page: page.page };
      publish({ ...page, scope: target.scope, requestedPage: page.page, loading: false, error: null });
    } catch (error) {
      invocation++;
      if (current()) publish({ ...snapshot, loading: false, error });
    }
  }

  return {
    load,
    retry: () => requested ? load(requested) : Promise.resolve(),
    dispose() { disposed = true; active?.abort(); },
  };
}
