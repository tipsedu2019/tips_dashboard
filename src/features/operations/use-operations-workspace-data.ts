"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/error-message";
import { useAuth } from "@/providers/auth-provider";
import { appendOperationsPageIfCurrent, createOperationsReadService } from "./operations-read-service.js";

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
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
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
      const catalogs = await service.loadCatalogs();
      if (requestRevisionRef.current !== revision) return;
      setData({ ...next, catalogs });
      setDensityError(null);
    } catch (fetchError) {
      if (requestRevisionRef.current !== revision) return;
      setError(getErrorMessage(fetchError, "운영 데이터를 불러오지 못했습니다."));
      if (!options.preserveData) setData(null);
    } finally {
      if (requestRevisionRef.current === revision) setLoading(false);
    }
  }, [authLoading, service, stableRequest]);

  const loadMore = useCallback(async () => {
    if (!service || stableRequest.mode !== "class_schedule" || loadingMore) return;
    const currentPage = data?.page as { rows?: unknown[]; nextCursor?: OperationsKeysetCursor | null; hasMore?: boolean } | undefined;
    if (!currentPage?.hasMore || !currentPage.nextCursor) return;
    const expectedRevision = requestRevisionRef.current;
    const expectedFingerprint = fingerprint;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await service.load({ ...stableRequest, cursor: currentPage.nextCursor }) as OperationsResult;
      setData((current) => appendOperationsPageIfCurrent({
        current,
        next,
        expectedRevision,
        currentRevision: requestRevisionRef.current,
        expectedFingerprint,
        currentFingerprint: fingerprintRef.current,
      }));
    } catch (fetchError) {
      if (
        requestRevisionRef.current === expectedRevision &&
        fingerprintRef.current === expectedFingerprint
      ) {
        setError(getErrorMessage(fetchError, "수업계획을 더 불러오지 못했습니다."));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [data?.page, fingerprint, loadingMore, service, stableRequest]);

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
  const loadClassLessonDesignDetail = useCallback(
    (classId: string) => service?.loadClassLessonDesignDetail(classId) ?? Promise.reject(new Error("operations_client_missing")),
    [service],
  );
  const loadLessonTextbookCandidates = useCallback(
    (input: { classId: string; search?: string; cursor?: { title: string; id: string } | null }) => service?.loadLessonTextbookCandidates(input) ?? Promise.reject(new Error("operations_client_missing")),
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
    loadClassLessonDesignDetail,
    loadLessonTextbookCandidates,
  };
}
