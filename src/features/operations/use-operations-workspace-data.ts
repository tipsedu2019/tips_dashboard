"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/error-message";
import { createNumberedPageController } from "@/lib/numbered-page-controller";
import { normalizePage, type DataTablePageSize, type DataTablePageSizePreference } from "@/lib/numbered-pagination";
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";
import { useAuth } from "@/providers/auth-provider";
import { createOperationsReadService, invalidateOperationsCatalogCache } from "./operations-read-service.js";

export type OperationsKeysetCursor = {
  sortValues: [string];
  id: string;
  scopeHash: string;
};

export type OperationsWorkspaceRequest =
  | { mode: "calendar"; dateFrom: string; dateTo: string }
  | { mode: "annual"; academicYear: number }
  | {
      mode: "class_schedule";
      termId: string | null;
      search: string;
      subject: string | null;
      grade: string | null;
      teacher: string | null;
      syncGroupId: string | null;
      page?: number;
      navigationKey?: string;
      cursor: OperationsKeysetCursor | null;
    };

type DenseResult =
  | {
      ok: false;
      code: "visible_range_too_dense";
      range: { dateFrom: string; dateTo: string };
      rows: [];
      observedRowsAtLeast: 2001;
      suggestedDays: 7;
    }
  | { ok: false; code: "annual_board_too_dense" };

type OperationsResult = Record<string, unknown>;

function isDenseResult(value: unknown): value is DenseResult {
  return Boolean(
    value && typeof value === "object" && (value as { ok?: boolean }).ok === false
      && ["visible_range_too_dense", "annual_board_too_dense"].includes(
        String((value as { code?: string }).code || ""),
      ),
  );
}

type NumberedResult = import("./operations-read-service.js").ClassScheduleNumberedPage;
type PageState = import("@/lib/numbered-page-controller").NumberedPageSnapshot<NumberedResult["rows"][number]> & Partial<NumberedResult>;

export function useOperationsWorkspaceData(request: OperationsWorkspaceRequest) {
  const { user, role, loading: authLoading } = useAuth();
  const actorScope = !authLoading && user?.id && role ? `${user.id}:${role}` : null;
  const service = useMemo(() => supabase && actorScope
    ? createOperationsReadService({ supabase, actorScope }) : null, [actorScope]);
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const size = useDataTablePageSize("operations:class-schedule");
  const isNumbered = request.mode === "class_schedule";
  const sourceRequest = isNumbered ? { ...request, page: undefined, navigationKey: undefined, cursor: null } : request;
  const fingerprint = JSON.stringify(sourceRequest);
  const stableRequest = useMemo(() => JSON.parse(fingerprint) as OperationsWorkspaceRequest, [fingerprint]);
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const navigationKey = isNumbered ? `${request.navigationKey || ""}:${normalizePage(request.page)}` : "";
  const restoredPage = isNumbered ? normalizePage(request.page) : 1;
  const [accepted, setAccepted] = useState<{ service: typeof service; snapshot: PageState } | null>(null);
  const [range, setRange] = useState<{ service: typeof service; data: OperationsResult; request: OperationsWorkspaceRequest } | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [densityError, setDensityError] = useState<{ service: typeof service; fingerprint: string; value: DenseResult } | null>(null);
  const rangeRevision = useRef(0);
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const pageScopeAdoption = useRef(false);
  const desired = useRef<{ service: typeof service; fingerprint: string; navigationKey: string; scope: string; pageSize: DataTablePageSize; preferenceRevision: number } | null>(null);
  const controller = useRef<ReturnType<typeof createNumberedPageController<NumberedResult["rows"][number]>> | null>(null);
  useEffect(() => {
    serviceRef.current = service;
    const instance = createNumberedPageController<NumberedResult["rows"][number]>({
      async loadPage({ scope, page, pageSize, signal }) {
        if (!service || serviceRef.current !== service) throw new Error("stale_actor");
        const current = JSON.parse(scope) as Extract<OperationsWorkspaceRequest, { mode: "class_schedule" }>;
        const filters = { termId: current.termId, search: current.search, subject: current.subject, grade: current.grade,
          teacher: current.teacher, syncGroupId: current.syncGroupId };
        const result = await service.readClassScheduleNumberedPage({
          filters, page, pageSize, signal,
        });
        return result;
      },
      onChange(snapshot) {
        if (service && serviceRef.current === service) setAccepted({ service, snapshot: snapshot as PageState });
      },
    });
    controller.current = instance;
    desired.current = null;
    setAccepted(null); setRange(null); setRangeError(null); setDensityError(null); setRangeLoading(false);
    return () => {
      instance.dispose();
      if (controller.current === instance) controller.current = null;
      if (serviceRef.current === service) serviceRef.current = null;
    };
  }, [service]);
  useEffect(() => {
    const acknowledgingPageScope = pageScopeAdoption.current;
    pageScopeAdoption.current = false;
    if (!service || !isNumbered || !size.ready) return;
    const previous = desired.current;
    const restored = !previous || previous.service !== service || previous.navigationKey !== navigationKey;
    const scopeChanged = !previous || previous.fingerprint !== fingerprint;
    // A pager action already loaded this scope. Adopting its accepted controls
    // is an acknowledgement, not a second page-1 request.
    if (acknowledgingPageScope && !restored && !scopeChanged && previous.pageSize === size.pageSize && previous.preferenceRevision === preferenceRevision) return;
    const scope = !restored && !scopeChanged ? previous.scope : fingerprint;
    desired.current = { service, fingerprint, navigationKey, scope, pageSize: size.pageSize, preferenceRevision };
    void controller.current?.load({ scope, page: restored ? restoredPage : 1, pageSize: size.pageSize });
  }, [controller, fingerprint, isNumbered, navigationKey, preferenceRevision, restoredPage, service, size.pageSize, size.ready]);

  const loadRange = useCallback(async () => {
    if (!service || isNumbered || serviceRef.current !== service) return;
    const revision = ++rangeRevision.current;
    setRangeLoading(true); setRangeError(null);
    try {
      const next = await service.load(stableRequest) as OperationsResult;
      if (serviceRef.current !== service || revision !== rangeRevision.current || fingerprintRef.current !== fingerprint) return;
      if (isDenseResult(next)) { setDensityError({ service, fingerprint, value: next }); return; }
      setRange({ service, data: next, request: stableRequest }); setDensityError(null);
    } catch (error) {
      if (serviceRef.current === service && revision === rangeRevision.current && fingerprintRef.current === fingerprint)
        setRangeError(getErrorMessage(error, "운영 데이터를 불러오지 못했습니다."));
    } finally {
      if (serviceRef.current === service && revision === rangeRevision.current) setRangeLoading(false);
    }
  }, [fingerprint, isNumbered, service, stableRequest]);
  useEffect(() => {
    void loadRange();
    const revision = rangeRevision.current;
    return () => { if (rangeRevision.current === revision) rangeRevision.current = revision + 1; };
  }, [loadRange]);

  const [catalogs, setCatalogs] = useState<{ service: typeof service; value: unknown } | null>(null);
  const [catalogError, setCatalogError] = useState<{ service: typeof service; message: string } | null>(null);
  const catalogRevision = useRef(0);
  const loadCatalogs = useCallback(async () => {
    if (!service || serviceRef.current !== service) return;
    const revision = ++catalogRevision.current;
    setCatalogError(null);
    try {
      const value = await service.loadCatalogs();
      if (serviceRef.current === service && catalogRevision.current === revision) setCatalogs({ service, value });
    } catch (error) {
      if (serviceRef.current === service && catalogRevision.current === revision)
        setCatalogError({ service, message: getErrorMessage(error, "운영 선택 목록을 불러오지 못했습니다.") });
    }
  }, [service]);
  useEffect(() => {
    setCatalogs(null); setCatalogError(null);
    void loadCatalogs();
    return () => {
      if (actorScope) invalidateOperationsCatalogCache(actorScope);
    };
  }, [actorScope, loadCatalogs]);

  const snapshot = accepted?.service === service && service ? accepted.snapshot : null;
  const scopedRange = range?.service === service && service ? range : null;
  const data = useMemo<OperationsResult | null>(() => isNumbered
    ? snapshot?.scope ? { ...snapshot, page: { rows: snapshot.rows }, syncGroupCounts: snapshot.syncGroupCounts } : null
    : scopedRange?.data || null, [isNumbered, scopedRange, snapshot]);
  const scopedCatalogs = catalogs?.service === service && service ? catalogs.value : null;
  const displayData = useMemo<OperationsResult | null>(() => data || scopedCatalogs ? { ...(data || {}), catalogs: scopedCatalogs } : null, [data, scopedCatalogs]);
  const displayRequest = useMemo(() => isNumbered && snapshot?.scope ? JSON.parse(snapshot.scope) as OperationsWorkspaceRequest : scopedRange?.request || stableRequest, [isNumbered, scopedRange?.request, snapshot?.scope, stableRequest]);
  const dataMatchesCurrentScope = isNumbered
    ? Boolean(snapshot?.scope && snapshot.scope === desired.current?.scope && desired.current?.fingerprint === fingerprint)
    : Boolean(scopedRange && JSON.stringify(scopedRange.request) === fingerprint);
  const goToPage = useCallback((page: number) => {
    const target = desired.current;
    if (!service || serviceRef.current !== service || !target || target.service !== service || !snapshot?.scope) return Promise.resolve();
    // Keep the preference input (including Auto) intact; ordinary paging belongs
    // to the accepted dataset and size, while retry belongs to the last load.
    pageScopeAdoption.current = true;
    desired.current = { ...target, fingerprint: snapshot.scope, scope: snapshot.scope };
    return controller.current?.load({ scope: snapshot.scope, page, pageSize: snapshot.pageSize });
  }, [controller, service, snapshot]);
  const persistPageSizePreference = size.setPreference;
  const setPageSizePreference = useCallback((preference: DataTablePageSizePreference) => {
    if (!service || serviceRef.current !== service) return;
    persistPageSizePreference(preference);
    // Re-selecting a failed preference is still a new explicit request.
    setPreferenceRevision((revision) => revision + 1);
  }, [service, persistPageSizePreference]);
  const refresh = useCallback(() => {
    if (!service || serviceRef.current !== service) return Promise.resolve();
    if (catalogError?.service === service) void loadCatalogs();
    return isNumbered ? controller.current?.retry() || Promise.resolve() : loadRange();
  }, [catalogError, controller, isNumbered, loadCatalogs, loadRange, service]);
  const loadEventDetail = useCallback(async (input: Parameters<NonNullable<typeof service>["loadEventDetail"]>[0]) => {
    if (!service || serviceRef.current !== service) throw new Error("operations_client_missing");
    const detail = await service.loadEventDetail(input);
    if (serviceRef.current !== service) throw new Error("stale_actor");
    return detail;
  }, [service]);
  const loadClassScheduleDetail = useCallback(async (input: { classId: string; dateFrom: string; dateTo: string }) => {
    if (!service || serviceRef.current !== service) throw new Error("operations_client_missing");
    const detail = await service.loadClassScheduleDetail(input);
    if (serviceRef.current !== service) throw new Error("stale_actor");
    return detail;
  }, [service]);
  const loadClassLessonDesignDetail = useCallback(async (input: Parameters<NonNullable<typeof service>["loadClassLessonDesignDetail"]>[0]) => {
    if (!service || serviceRef.current !== service) throw new Error("operations_client_missing");
    const detail = await service.loadClassLessonDesignDetail(input);
    if (serviceRef.current !== service) throw new Error("stale_actor");
    return detail;
  }, [service]);
  const loadLessonTextbookCandidates = useCallback(async (input: Parameters<NonNullable<typeof service>["loadLessonTextbookCandidates"]>[0]) => {
    if (!service || serviceRef.current !== service) throw new Error("operations_client_missing");
    const detail = await service.loadLessonTextbookCandidates(input);
    if (serviceRef.current !== service) throw new Error("stale_actor");
    return detail;
  }, [service]);
  return {
    data: displayData, actorScope, displayRequest, successfulRequest: data ? displayRequest : null,
    dataFingerprint: data ? snapshot?.scope || fingerprint : null, dataMatchesCurrentScope,
    densityError: service && !isNumbered && densityError?.service === service && densityError.fingerprint === fingerprint ? densityError.value : null,
    loading: authLoading || (Boolean(service) && (isNumbered ? !size.ready || !snapshot || snapshot.loading : rangeLoading)),
    error: (isNumbered ? snapshot?.error ? getErrorMessage(snapshot.error, "목록을 불러오지 못했습니다.") : null : rangeError)
      || (catalogError?.service === service ? catalogError?.message : null),
    page: snapshot?.page || 1, pageSize: snapshot?.scope ? snapshot.pageSize : size.pageSize,
    totalCount: snapshot?.totalCount ?? null, pageSizeMode: size.mode,
    setPageSizePreference, goToPage, refresh,
    loadEventDetail, loadClassScheduleDetail, loadClassLessonDesignDetail, loadLessonTextbookCandidates,
  };
}
