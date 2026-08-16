"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/error-message";
import { useAuth } from "@/providers/auth-provider";

import {
  appendAcademicCurriculumPageIfCurrent,
  createAcademicExecutionContext,
  createAcademicReadService,
  isAcademicContinuationLoadingForScope,
  isAcademicResultCurrentForScope,
  selectAcademicDisplayRequest,
  selectAcademicScopedValue,
} from "./academic-read-service.js";

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

function requestFingerprint(request: AcademicWorkspaceRequest) {
  return JSON.stringify(request);
}

function isDensityError(value: unknown): value is AcademicDensityError {
  return Boolean(
    value && typeof value === "object" && (value as { ok?: boolean }).ok === false
      && ["visible_range_too_dense", "timetable_collection_too_dense"].includes(
        String((value as { code?: string }).code || ""),
      ),
  );
}

export function useAcademicWorkspaceData(request: AcademicWorkspaceRequest) {
  const { session, user, role, loading: authLoading } = useAuth();
  const [data, setData] = useState<AcademicResult | null>(null);
  const [dataFingerprint, setDataFingerprint] = useState<string | null>(null);
  const [dataActorScope, setDataActorScope] = useState<string | null>(null);
  const [successfulRequest, setSuccessfulRequest] = useState<AcademicWorkspaceRequest | null>(null);
  const [densityError, setDensityError] = useState<AcademicDensityError | null>(null);
  const [densityErrorFingerprint, setDensityErrorFingerprint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settledFingerprint, setSettledFingerprint] = useState<string | null>(null);
  const [loadingMoreFingerprint, setLoadingMoreFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorFingerprint, setErrorFingerprint] = useState<string | null>(null);
  const requestRevisionRef = useRef(0);
  const requestScopeFingerprint = requestFingerprint(request);
  const stableRequest = useMemo(
    () => JSON.parse(requestScopeFingerprint) as AcademicWorkspaceRequest,
    [requestScopeFingerprint],
  );
  const { actorScope, fingerprint } = createAcademicExecutionContext({
    userId: user?.id,
    role,
    request: stableRequest,
  });
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const loadingMore = isAcademicContinuationLoadingForScope(loadingMoreFingerprint, fingerprint);
  const scopedData = selectAcademicScopedValue(data, dataActorScope, actorScope) as AcademicResult | null;
  const scopedSuccessfulRequest = scopedData ? successfulRequest : null;
  const scopedDensityError = selectAcademicScopedValue(
    densityError,
    densityErrorFingerprint,
    fingerprint,
  ) as AcademicDensityError | null;
  const scopedError = selectAcademicScopedValue(error, errorFingerprint, fingerprint) as string | null;
  const scopedLoading = loading || settledFingerprint !== fingerprint;
  const service = useMemo(
    () => (supabase && user ? createAcademicReadService({ supabase, actorScope }) : null),
    [actorScope, user],
  );

  const load = useCallback(async () => {
    const revision = requestRevisionRef.current + 1;
    requestRevisionRef.current = revision;
    if (!service) {
      if (!supabase) setError("Supabase is not configured.");
      else if (!authLoading) setError("관리자 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      setErrorFingerprint(fingerprint);
      setSettledFingerprint(fingerprint);
      setLoading(false);
      return;
    }
    if (authLoading) return;

    setLoading(true);
    setError(null);
    setErrorFingerprint(null);
    try {
      const next = await service.load(stableRequest) as AcademicResult;
      if (requestRevisionRef.current !== revision || fingerprintRef.current !== fingerprint) return;
      if (isDensityError(next)) {
        setDensityError(next);
        setDensityErrorFingerprint(fingerprint);
        return;
      }
      setData(next);
      setDataFingerprint(fingerprint);
      setDataActorScope(actorScope);
      setSuccessfulRequest(stableRequest);
      setDensityError(null);
      setDensityErrorFingerprint(null);
    } catch (fetchError) {
      if (requestRevisionRef.current !== revision || fingerprintRef.current !== fingerprint) return;
      setError(getErrorMessage(fetchError, "학사 데이터를 불러오지 못했습니다."));
      setErrorFingerprint(fingerprint);
    } finally {
      if (requestRevisionRef.current === revision && fingerprintRef.current === fingerprint) {
        setSettledFingerprint(fingerprint);
        setLoading(false);
      }
    }
  }, [actorScope, authLoading, fingerprint, service, stableRequest]);

  const loadMore = useCallback(async () => {
    if (!service || stableRequest.mode !== "curriculum" || loadingMore) return;
    const currentPage = scopedData?.page as {
      rows?: unknown[];
      nextCursor?: AcademicKeysetCursor | null;
      hasMore?: boolean;
    } | undefined;
    if (!currentPage?.hasMore || !currentPage.nextCursor) return;
    const expectedRevision = requestRevisionRef.current;
    const expectedFingerprint = fingerprint;
    setLoadingMoreFingerprint(expectedFingerprint);
    setError(null);
    setErrorFingerprint(null);
    try {
      const next = await service.load({
        ...stableRequest,
        cursor: currentPage.nextCursor,
      }) as AcademicResult;
      setData((current) => appendAcademicCurriculumPageIfCurrent({
        current,
        next,
        expectedRevision,
        currentRevision: requestRevisionRef.current,
        expectedFingerprint,
        currentFingerprint: fingerprintRef.current,
      }));
    } catch (fetchError) {
      if (requestRevisionRef.current === expectedRevision
        && fingerprintRef.current === expectedFingerprint) {
        setError(getErrorMessage(fetchError, "수업계획을 더 불러오지 못했습니다."));
        setErrorFingerprint(expectedFingerprint);
      }
    } finally {
      setLoadingMoreFingerprint((current) => current === expectedFingerprint ? null : current);
    }
  }, [fingerprint, loadingMore, scopedData?.page, service, stableRequest]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, fingerprint, load, session?.access_token, user?.id]);

  const loadCurriculumDetail = useCallback(
    (classId: string) => service?.loadCurriculumDetail(classId)
      ?? Promise.reject(new Error("academic_client_missing")),
    [service],
  );
  const displayRequest = selectAcademicDisplayRequest({
    data: scopedData,
    successfulRequest: scopedSuccessfulRequest,
    currentRequest: stableRequest,
  }) as AcademicWorkspaceRequest;
  const displayFingerprint = createAcademicExecutionContext({
    userId: user?.id,
    role,
    request: displayRequest,
  }).fingerprint;
  const scopedDataFingerprint = scopedData ? dataFingerprint : null;
  const dataMatchesCurrentScope = isAcademicResultCurrentForScope(
    scopedDataFingerprint,
    fingerprint,
    displayFingerprint,
  );

  return {
    data: scopedData,
    dataFingerprint: scopedDataFingerprint,
    successfulRequest: scopedSuccessfulRequest,
    displayRequest,
    dataMatchesCurrentScope,
    densityError: scopedDensityError,
    loading: scopedLoading,
    loadingMore,
    error: scopedError,
    refresh: load,
    loadMore,
    loadCurriculumDetail,
  };
}
