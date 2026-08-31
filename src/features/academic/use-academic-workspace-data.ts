"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/error-message";
import { useAuth } from "@/providers/auth-provider";
import { createNumberedPageController } from "@/lib/numbered-page-controller";
import { normalizePage, type DataTablePageSize } from "@/lib/numbered-pagination";
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";

import { createAcademicReadService } from "./academic-read-service.js";

export type AcademicKeysetCursor = {
  sortValues: [string];
  id: string;
  scopeHash: string;
  resolvedPeriodId?: string | null;
};

export type AcademicWorkspaceRequest =
  | {
      mode: "timetable";
      dateFrom: string;
      dateTo: string;
      filters: {
        classGroupId: string | null;
        status: string | null;
        subject: string | null;
      };
    }
  | {
      mode: "curriculum";
      periodId: string | null;
      search: string;
      status: string | null;
      subject: string | null;
      grade: string | null;
      teacher: string | null;
      classroom: string | null;
      viewMode: string;
      page?: number;
      navigationKey?: string;
      cursor: AcademicKeysetCursor | null;
    };

export type AcademicDensityError =
  | {
      ok: false;
      code: "visible_range_too_dense";
      range: { dateFrom: string; dateTo: string };
      rows: [];
      observedRowsAtLeast: 2001;
      suggestedDays: 7;
    }
  | {
      ok: false;
      code: "timetable_collection_too_dense";
      range: { dateFrom: string; dateTo: string };
      collection: "class_summaries" | "class_terms" | "class_groups" | "class_group_members" | "teacher_catalogs" | "classroom_catalogs";
      observedItemsAtLeast: 501;
      action: "narrow_filters";
      rows: [];
    };

type AcademicResult = Record<string, unknown>;

function isDensityError(value: unknown): value is AcademicDensityError {
  return Boolean(
    value && typeof value === "object" && (value as { ok?: boolean }).ok === false
      && ["visible_range_too_dense", "timetable_collection_too_dense"].includes(
        String((value as { code?: string }).code || ""),
      ),
  );
}

type NumberedResult = import("./academic-read-service.js").CurriculumNumberedPage;
type PageState = import("@/lib/numbered-page-controller").NumberedPageSnapshot<NumberedResult["rows"][number]> & Partial<NumberedResult>;

export function useAcademicWorkspaceData(request: AcademicWorkspaceRequest) {
  const { user, role, loading: authLoading } = useAuth();
  const actorScope = !authLoading && user?.id && role ? `${user.id}:${role}` : null;
  const service = useMemo(() => supabase && actorScope
    ? createAcademicReadService({ supabase, actorScope }) : null, [actorScope]);
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const size = useDataTablePageSize("academic:curriculum");
  const isNumbered = request.mode === "curriculum";
  const sourceRequest = isNumbered ? { ...request, page: undefined, navigationKey: undefined, cursor: null } : request;
  const fingerprint = JSON.stringify(sourceRequest);
  const stableRequest = useMemo(() => JSON.parse(fingerprint) as AcademicWorkspaceRequest, [fingerprint]);
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const navigationKey = isNumbered ? `${request.navigationKey || ""}:${normalizePage(request.page)}` : "";
  const restoredPage = isNumbered ? normalizePage(request.page) : 1;
  const [accepted, setAccepted] = useState<{ service: typeof service; snapshot: PageState } | null>(null);
  const [range, setRange] = useState<{ service: typeof service; data: AcademicResult; request: AcademicWorkspaceRequest } | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [densityError, setDensityError] = useState<{ service: typeof service; fingerprint: string; value: AcademicDensityError } | null>(null);
  const rangeRevision = useRef(0);
  const desired = useRef<{ service: typeof service; fingerprint: string; navigationKey: string; scope: string; pageSize: DataTablePageSize } | null>(null);
  const controller = useRef<ReturnType<typeof createNumberedPageController<NumberedResult["rows"][number]>> | null>(null);
  useEffect(() => {
    serviceRef.current = service;
    const instance = createNumberedPageController<NumberedResult["rows"][number]>({
      async loadPage({ scope, page, pageSize, signal, canonicalizeScope }) {
        if (!service || serviceRef.current !== service) throw new Error("stale_actor");
        const current = JSON.parse(scope) as Extract<AcademicWorkspaceRequest, { mode: "curriculum" }>;
        const filters = { periodId: current.periodId, search: current.search, status: current.status, subject: current.subject,
          grade: current.grade, teacher: current.teacher, classroom: current.classroom, viewMode: current.viewMode };
        const result = await service.readCurriculumNumberedPage({
          filters: filters as import("./academic-read-service.js").CurriculumNumberedFilters, page, pageSize, signal, includeScopeMetadata: true,
        });
        // Only the active invocation may pin an absent default; explicit name aliases stay selectors.
        if (!current.periodId && result.resolvedPeriodId) {
          const canonical = JSON.stringify({ ...current, periodId: result.resolvedPeriodId });
          if (canonicalizeScope(canonical) && desired.current?.service === service) desired.current.scope = canonical;
        }
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
    if (!service || !isNumbered || !size.ready) return;
    const previous = desired.current;
    const restored = !previous || previous.service !== service || previous.navigationKey !== navigationKey;
    const scopeChanged = !previous || previous.fingerprint !== fingerprint;
    const scope = !restored && !scopeChanged ? previous.scope : fingerprint;
    desired.current = { service, fingerprint, navigationKey, scope, pageSize: size.pageSize };
    void controller.current?.load({ scope, page: restored ? restoredPage : 1, pageSize: size.pageSize });
  }, [controller, fingerprint, isNumbered, navigationKey, restoredPage, service, size.pageSize, size.ready]);

  const loadRange = useCallback(async () => {
    if (!service || isNumbered || serviceRef.current !== service) return;
    const revision = ++rangeRevision.current;
    setRangeLoading(true); setRangeError(null);
    try {
      const next = await service.load(stableRequest) as AcademicResult;
      if (serviceRef.current !== service || revision !== rangeRevision.current || fingerprintRef.current !== fingerprint) return;
      if (isDensityError(next)) { setDensityError({ service, fingerprint, value: next }); return; }
      setRange({ service, data: next, request: stableRequest }); setDensityError(null);
    } catch (error) {
      if (serviceRef.current === service && revision === rangeRevision.current && fingerprintRef.current === fingerprint)
        setRangeError(getErrorMessage(error, "학사 데이터를 불러오지 못했습니다."));
    } finally {
      if (serviceRef.current === service && revision === rangeRevision.current) setRangeLoading(false);
    }
  }, [fingerprint, isNumbered, service, stableRequest]);
  useEffect(() => {
    void loadRange();
    const revision = rangeRevision.current;
    return () => { if (rangeRevision.current === revision) rangeRevision.current = revision + 1; };
  }, [loadRange]);

  const snapshot = accepted?.service === service && service ? accepted.snapshot : null;
  const scopedRange = range?.service === service && service ? range : null;
  const data = useMemo<AcademicResult | null>(() => isNumbered
    ? snapshot?.scope ? { ...snapshot, page: { rows: snapshot.rows }, resolvedPeriodId: snapshot.resolvedPeriodId } : null
    : scopedRange?.data || null, [isNumbered, scopedRange, snapshot]);

  const displayRequest = useMemo(() => isNumbered && snapshot?.scope ? JSON.parse(snapshot.scope) as AcademicWorkspaceRequest : scopedRange?.request || stableRequest, [isNumbered, scopedRange?.request, snapshot?.scope, stableRequest]);
  const dataMatchesCurrentScope = isNumbered
    ? Boolean(snapshot?.scope && snapshot.scope === desired.current?.scope && desired.current?.fingerprint === fingerprint)
    : Boolean(scopedRange && JSON.stringify(scopedRange.request) === fingerprint);
  const goToPage = useCallback((page: number) => {
    const target = desired.current;
    if (!service || serviceRef.current !== service || !target || target.service !== service) return Promise.resolve();
    return controller.current?.load({ scope: target.scope, page, pageSize: target.pageSize });
  }, [controller, service]);
  const refresh = useCallback(() => {
    if (!service || serviceRef.current !== service) return Promise.resolve();
    return isNumbered ? controller.current?.retry() || Promise.resolve() : loadRange();
  }, [controller, isNumbered, loadRange, service]);
  const loadCurriculumDetail = useCallback(async (classId: string) => {
    if (!service || serviceRef.current !== service) throw new Error("academic_client_missing");
    const detail = await service.loadCurriculumDetail(classId);
    if (serviceRef.current !== service) throw new Error("stale_actor");
    return detail;
  }, [service]);
  return {
    data, actorScope, displayRequest, successfulRequest: data ? displayRequest : null,
    dataFingerprint: data ? snapshot?.scope || fingerprint : null, dataMatchesCurrentScope,
    densityError: service && !isNumbered && densityError?.service === service && densityError.fingerprint === fingerprint ? densityError.value : null,
    loading: authLoading || (Boolean(service) && (isNumbered ? !size.ready || !snapshot || snapshot.loading : rangeLoading)),
    error: isNumbered ? snapshot?.error ? getErrorMessage(snapshot.error, "목록을 불러오지 못했습니다.") : null : rangeError,
    page: snapshot?.page || 1, pageSize: snapshot?.scope ? snapshot.pageSize : size.pageSize,
    totalCount: snapshot?.totalCount ?? null, pageSizeMode: size.mode,
    setPageSizePreference: size.setPreference, goToPage, refresh,
    loadCurriculumDetail,
  };
}
