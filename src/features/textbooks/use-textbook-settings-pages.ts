"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";
import {
  normalizePage,
  type DataTablePageSize,
  type DataTablePageSizePreference,
  type NumberedPage,
} from "@/lib/numbered-pagination";

import {
  getTextbookPublisherSettingDetail,
  listTextbookPublisherPage,
  listTextbookSupplierPage,
  listTextbookSupplierSettingPickerPage,
} from "./textbook-owner-settings-service";
import { listTextbookSubSubjectPage } from "./textbook-subsubject-service";
import type {
  OwnerDraft,
  OwnerSettingsPage,
  PublisherSettingRow,
  SettingPageRequest,
  SubSubjectDraft,
  SupplierSettingOption,
  SupplierSettingRow,
  TextbookSettingsSubject,
  TextbookSubSubjectSettingsPage,
} from "./textbook-settings-types";

export type TextbookSettingsSection = "publishers" | "suppliers" | "subSubjects";

type PageEnvelope<T> = NumberedPage<T>;
type PageReader<C, P extends PageEnvelope<unknown>> = (
  context: C,
  page: number,
  pageSize: DataTablePageSize,
  signal: AbortSignal,
) => Promise<P>;

type PageDisplay<P> = {
  actorScope: string | null;
  acceptedKey: string | null;
  page: P | null;
  loading: boolean;
  error: unknown;
};

export type TextbookSettingsPageResource<T, P extends PageEnvelope<T>> = {
  rows: T[];
  accepted: P | null;
  page: number;
  requestedPage: number;
  pageSize: DataTablePageSize;
  totalCount: number | null;
  loading: boolean;
  error: unknown;
  current: boolean;
  goToPage: (page: number) => void;
  retry: () => void;
  refresh: () => void;
  pageSizeMode: "auto" | "manual";
  setPageSizePreference?: (preference: DataTablePageSizePreference) => void;
};

const emptyDisplay = <P,>(): PageDisplay<P> => ({
  actorScope: null,
  acceptedKey: null,
  page: null,
  loading: false,
  error: null,
});

function useSettingsPage<C, T, P extends PageEnvelope<T>>({
  actorScope,
  enabled,
  tableId,
  context,
  contextKey,
  reloadVersion,
  readPage,
  fixedPageSize,
}: {
  actorScope: string | null;
  enabled: boolean;
  tableId: string;
  context: C;
  contextKey: string;
  reloadVersion: number;
  readPage: PageReader<C, P>;
  fixedPageSize?: DataTablePageSize;
}): TextbookSettingsPageResource<T, P> {
  const preference = useDataTablePageSize(tableId);
  const pageSize = fixedPageSize || preference.pageSize;
  const [requestedPage, setRequestedPage] = useState(1);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [display, setDisplay] = useState<PageDisplay<P>>(emptyDisplay);
  const requestGeneration = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const requestKey = JSON.stringify({ actorScope, tableId, contextKey, reloadVersion, pageSize, requestedPage });

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!actorScope || !enabled || !preference.ready) return;
    const generation = ++requestGeneration.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    // The loading snapshot is the external request lifecycle, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplay((current) => current.actorScope === actorScope
      ? { ...current, loading: true, error: null }
      : { ...emptyDisplay<P>(), actorScope, loading: true });

    void readPage(context, requestedPage, pageSize, abort.signal).then((result) => {
      if (!alive.current || abort.signal.aborted || generation !== requestGeneration.current) return;
      const lastPage = Math.max(1, Math.ceil(result.totalCount / pageSize));
      if (result.rows.length === 0 && requestedPage > lastPage) {
        setRequestedPage(lastPage);
        return;
      }
      setDisplay({ actorScope, acceptedKey: requestKey, page: result, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!alive.current || abort.signal.aborted || generation !== requestGeneration.current) return;
      setDisplay((current) => current.actorScope === actorScope
        ? { ...current, loading: false, error }
        : { ...emptyDisplay<P>(), actorScope, error });
    });
    return () => abort.abort();
  }, [actorScope, context, enabled, pageSize, preference.ready, readPage, reloadVersion, requestKey, requestedPage, retryGeneration]);

  const goToPage = useCallback((page: number) => setRequestedPage(normalizePage(page)), []);
  const retry = useCallback(() => setRetryGeneration((value) => value + 1), []);
  const refresh = retry;
  const setPageSizePreference = useCallback((value: DataTablePageSizePreference) => {
    setRequestedPage(1);
    preference.setPreference(value);
  }, [preference]);
  const visible = display.actorScope === actorScope ? display : emptyDisplay<P>();
  const accepted = visible.page;

  return {
    rows: accepted?.rows || [],
    accepted,
    page: accepted?.page || requestedPage,
    requestedPage,
    pageSize: accepted?.pageSize || pageSize,
    totalCount: accepted?.totalCount ?? null,
    loading: Boolean(actorScope && enabled && (!preference.ready || visible.loading)),
    error: visible.error,
    current: visible.acceptedKey === requestKey,
    goToPage,
    retry,
    refresh,
    pageSizeMode: fixedPageSize ? "manual" : preference.mode,
    setPageSizePreference: fixedPageSize ? undefined : setPageSizePreference,
  };
}

type OwnerPageContext = { search: string; draft: OwnerDraft | null };
type SubSubjectPageContext = {
  subject: TextbookSettingsSubject;
  search: string;
  draft: SubSubjectDraft | null;
};

const readPublisherPage: PageReader<OwnerPageContext, OwnerSettingsPage<PublisherSettingRow>> = (
  context,
  page,
  pageSize,
  signal,
) => listTextbookPublisherPage({
  filters: { search: context.search },
  draft: context.draft,
  sort: "name",
  page,
  pageSize,
}, { signal });

const readSupplierPage: PageReader<OwnerPageContext, OwnerSettingsPage<SupplierSettingRow>> = (
  context,
  page,
  pageSize,
  signal,
) => listTextbookSupplierPage({
  filters: { search: context.search },
  draft: context.draft,
  sort: "name",
  page,
  pageSize,
}, { signal });

const readSubSubjectPage: PageReader<SubSubjectPageContext, TextbookSubSubjectSettingsPage> = (
  context,
  page,
  pageSize,
  signal,
) => listTextbookSubSubjectPage({
  filters: { subject: context.subject, search: context.search },
  draft: context.draft,
  page,
  pageSize,
}, { signal });

const readSupplierPickerPage: PageReader<OwnerPageContext, OwnerSettingsPage<SupplierSettingOption>> = (
  context,
  page,
  pageSize,
  signal,
) => listTextbookSupplierSettingPickerPage({
  filters: { search: context.search },
  draft: context.draft,
  sort: "name",
  page,
  pageSize,
}, { signal });

type PublisherDetailDisplay = {
  actorScope: string | null;
  key: string | null;
  row: PublisherSettingRow | null;
  loading: boolean;
  error: unknown;
};

function usePublisherSupplierPicker(
  actorScope: string | null,
  ownerDraft: OwnerDraft | null,
  reloadVersion: number,
) {
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [search, setSearchValue] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [detail, setDetail] = useState<PublisherDetailDisplay>({
    actorScope: null,
    key: null,
    row: null,
    loading: false,
    error: null,
  });
  const detailAbort = useRef<AbortController | null>(null);
  const detailGeneration = useRef(0);
  const ownerDraftKey = JSON.stringify(ownerDraft);
  const pickerContext = useMemo<OwnerPageContext>(() => ({ search, draft: ownerDraft }), [ownerDraft, search]);
  const pickerContextKey = JSON.stringify({ search, ownerDraftKey, publisherId });
  const picker = useSettingsPage<OwnerPageContext, SupplierSettingOption, OwnerSettingsPage<SupplierSettingOption>>({
    actorScope,
    enabled: Boolean(publisherId),
    tableId: "textbooks:supplier-picker",
    context: pickerContext,
    contextKey: pickerContextKey,
    reloadVersion,
    readPage: readSupplierPickerPage,
    fixedPageSize: 10,
  });
  const detailKey = JSON.stringify({ actorScope, publisherId, ownerDraftKey, reloadVersion });

  useEffect(() => {
    detailAbort.current?.abort();
    const generation = ++detailGeneration.current;
    if (!actorScope || !publisherId) {
      return;
    }
    const abort = new AbortController();
    detailAbort.current = abort;
    // The loading snapshot tracks an external detail request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail((current) => current.actorScope === actorScope && current.row?.id === publisherId
      ? { ...current, loading: true, error: null }
      : { actorScope, key: null, row: null, loading: true, error: null });
    void getTextbookPublisherSettingDetail({ id: publisherId, draft: ownerDraft }, { signal: abort.signal })
      .then((result) => {
        if (abort.signal.aborted || generation !== detailGeneration.current) return;
        setDetail({ actorScope, key: detailKey, row: result.row, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || generation !== detailGeneration.current) return;
        setDetail((current) => ({ ...current, loading: false, error }));
      });
    return () => abort.abort();
  }, [actorScope, detailKey, detailRetry, ownerDraft, publisherId, reloadVersion]);

  const open = useCallback((id: string) => {
    picker.goToPage(1);
    setSearchValue("");
    setPublisherId(id);
  }, [picker]);
  const close = useCallback(() => setPublisherId(null), []);
  const setSearch = useCallback((value: string) => {
    picker.goToPage(1);
    setSearchValue(value);
  }, [picker]);
  const retryDetail = useCallback(() => setDetailRetry((value) => value + 1), []);
  const visibleDetail = detail.actorScope === actorScope && detail.row?.id === publisherId ? detail : null;

  return {
    publisherId,
    search,
    open,
    close,
    setSearch,
    page: picker,
    detail: visibleDetail?.row || null,
    detailCurrent: visibleDetail?.key === detailKey,
    detailLoading: Boolean(publisherId && (!visibleDetail || visibleDetail.loading)),
    detailError: visibleDetail?.error || null,
    retryDetail,
  };
}

export function useTextbookSettingsPages({
  actorScope,
  activeSection,
  activeSubject,
  search,
  ownerDraft,
  subSubjectDraft,
  publisherBaselineOnly = false,
  supplierBaselineOnly = false,
  subSubjectBaselineOnly = false,
  reloadVersion = 0,
}: {
  actorScope: string | null;
  activeSection: TextbookSettingsSection;
  activeSubject: TextbookSettingsSubject;
  search: string;
  ownerDraft: OwnerDraft | null;
  subSubjectDraft: SubSubjectDraft | null;
  publisherBaselineOnly?: boolean;
  supplierBaselineOnly?: boolean;
  subSubjectBaselineOnly?: boolean;
  reloadVersion?: number;
}) {
  const publisherDraft = publisherBaselineOnly ? null : ownerDraft;
  const supplierDraft = supplierBaselineOnly ? null : ownerDraft;
  const effectiveSubSubjectDraft = subSubjectBaselineOnly ? null : subSubjectDraft;
  const publisherContext = useMemo<OwnerPageContext>(() => ({
    search,
    draft: publisherDraft,
  }), [publisherDraft, search]);
  const publisherContextKey = JSON.stringify(publisherContext);
  const supplierContext = useMemo<OwnerPageContext>(() => ({
    search,
    draft: supplierDraft,
  }), [search, supplierDraft]);
  const supplierContextKey = JSON.stringify(supplierContext);
  const subSubjectContext = useMemo<SubSubjectPageContext>(() => ({
    subject: activeSubject,
    search,
    draft: effectiveSubSubjectDraft,
  }), [activeSubject, effectiveSubSubjectDraft, search]);
  const subSubjectContextKey = JSON.stringify(subSubjectContext);

  const publishers = useSettingsPage<OwnerPageContext, PublisherSettingRow, OwnerSettingsPage<PublisherSettingRow>>({
    actorScope,
    enabled: activeSection === "publishers",
    tableId: "textbooks:publishers",
    context: publisherContext,
    contextKey: publisherContextKey,
    reloadVersion,
    readPage: readPublisherPage,
  });
  const suppliers = useSettingsPage<OwnerPageContext, SupplierSettingRow, OwnerSettingsPage<SupplierSettingRow>>({
    actorScope,
    enabled: activeSection === "suppliers",
    tableId: "textbooks:suppliers",
    context: supplierContext,
    contextKey: supplierContextKey,
    reloadVersion,
    readPage: readSupplierPage,
  });
  const subSubjects = useSettingsPage<SubSubjectPageContext, import("./textbook-settings-types").TextbookSubSubjectSettingRow, TextbookSubSubjectSettingsPage>({
    actorScope,
    enabled: activeSection === "subSubjects",
    tableId: "textbooks:subsubjects",
    context: subSubjectContext,
    contextKey: subSubjectContextKey,
    reloadVersion,
    readPage: readSubSubjectPage,
  });
  const supplierPicker = usePublisherSupplierPicker(actorScope, ownerDraft, reloadVersion);

  return { publishers, suppliers, subSubjects, supplierPicker };
}

export function textbookOwnerPageRequest(
  search: string,
  draft: OwnerDraft | null,
  page: number,
  pageSize: DataTablePageSize,
): SettingPageRequest {
  return { filters: { search }, draft, sort: "name", page, pageSize };
}
