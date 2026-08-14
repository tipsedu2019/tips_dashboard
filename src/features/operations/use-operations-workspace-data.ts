"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { createOperationsReadService } from "./operations-read-service.js";

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

function requestFingerprint(request: OperationsWorkspaceRequest) {
  return JSON.stringify(request);
}

function isDenseResult(value: unknown): value is DenseResult {
  return Boolean(
    value && typeof value === "object" && (value as { ok?: boolean }).ok === false
      && ["visible_range_too_dense", "annual_board_too_dense"].includes(
        String((value as { code?: string }).code || ""),
      ),
  );
}

export function useOperationsWorkspaceData(request: OperationsWorkspaceRequest) {
  const { session, user, loading: authLoading } = useAuth();
  const [data, setData] = useState<OperationsResult | null>(null);
  const [densityError, setDensityError] = useState<DenseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRevisionRef = useRef(0);
  const fingerprint = requestFingerprint(request);
  const stableRequest = useMemo(
    () => JSON.parse(fingerprint) as OperationsWorkspaceRequest,
    [fingerprint],
  );
  const actorScope = `${String(user?.id || "anonymous")}:${String(user?.app_metadata?.role || "authenticated")}`;
  const service = useMemo(
    () => (supabase && user ? createOperationsReadService({ supabase, actorScope }) : null),
    [actorScope, user],
  );

  const load = useCallback(async (options: { preserveData?: boolean } = {}) => {
    const revision = requestRevisionRef.current + 1;
    requestRevisionRef.current = revision;
    if (!service) {
      if (!supabase) setError("Supabase is not configured.");
      else if (!authLoading) setError("관리자 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      if (!options.preserveData) setData(null);
      setLoading(false);
      return;
    }
    if (authLoading) return;

    setLoading(true);
    setError(null);
    try {
      const next = await service.load(stableRequest) as OperationsResult;
      if (requestRevisionRef.current !== revision) return;
      if (isDenseResult(next)) {
        setDensityError(next);
        return;
      }
      if (stableRequest.mode === "class_schedule") {
        const catalogs = await service.loadCatalogs();
        if (requestRevisionRef.current !== revision) return;
        setData({ ...next, catalogs });
      } else {
        setData(next);
      }
      setDensityError(null);
    } catch (fetchError) {
      if (requestRevisionRef.current !== revision) return;
      setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
      if (!options.preserveData) setData(null);
    } finally {
      if (requestRevisionRef.current === revision) setLoading(false);
    }
  }, [authLoading, service, stableRequest]);

  const loadMore = useCallback(async () => {
    if (!service || stableRequest.mode !== "class_schedule" || loadingMore) return;
    const currentPage = data?.page as { rows?: unknown[]; nextCursor?: OperationsKeysetCursor | null; hasMore?: boolean } | undefined;
    if (!currentPage?.hasMore || !currentPage.nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await service.load({ ...stableRequest, cursor: currentPage.nextCursor }) as OperationsResult;
      const nextPage = next.page as { rows?: Array<{ id?: string }>; nextCursor?: OperationsKeysetCursor | null; hasMore?: boolean };
      const existingRows = Array.isArray(currentPage.rows) ? currentPage.rows as Array<{ id?: string }> : [];
      const seen = new Set(existingRows.map((row) => String(row?.id || "")));
      const appended = (Array.isArray(nextPage?.rows) ? nextPage.rows : []).filter((row) => {
        const id = String(row?.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setData((current) => current ? {
        ...current,
        page: {
          ...nextPage,
          rows: [...existingRows, ...appended],
        },
      } : current);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
    } finally {
      setLoadingMore(false);
    }
  }, [data?.page, loadingMore, service, stableRequest]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, fingerprint, load, session?.access_token, user?.id]);

  const loadEventDetail = useCallback(
    (eventId: string) => service?.loadEventDetail(eventId) ?? Promise.reject(new Error("operations_client_missing")),
    [service],
  );
  const loadClassScheduleDetail = useCallback(
    (input: { classId: string; dateFrom: string; dateTo: string }) => service?.loadClassScheduleDetail(input) ?? Promise.reject(new Error("operations_client_missing")),
    [service],
  );

  return {
    data,
    densityError,
    loading,
    loadingMore,
    error,
    refresh: () => load({ preserveData: true }),
    loadMore,
    loadEventDetail,
    loadClassScheduleDetail,
  };
}
