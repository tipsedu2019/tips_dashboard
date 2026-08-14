"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

import {
  appendAcademicCurriculumPageIfCurrent,
  createAcademicReadService,
  isAcademicContinuationLoadingForScope,
  selectAcademicDisplayRequest,
} from "./academic-read-service.js";

export type AcademicKeysetCursor = {
  sortValues: [string];
  id: string;
  scopeHash: string;
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
  const { session, user, loading: authLoading } = useAuth();
  const [data, setData] = useState<AcademicResult | null>(null);
  const [dataFingerprint, setDataFingerprint] = useState<string | null>(null);
  const [successfulRequest, setSuccessfulRequest] = useState<AcademicWorkspaceRequest | null>(null);
  const [densityError, setDensityError] = useState<AcademicDensityError | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreFingerprint, setLoadingMoreFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRevisionRef = useRef(0);
  const fingerprint = requestFingerprint(request);
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const stableRequest = useMemo(
    () => JSON.parse(fingerprint) as AcademicWorkspaceRequest,
    [fingerprint],
  );
  const loadingMore = isAcademicContinuationLoadingForScope(loadingMoreFingerprint, fingerprint);
  const actorScope = `${String(user?.id || "anonymous")}:${String(user?.app_metadata?.role || "authenticated")}`;
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
      setLoading(false);
      return;
    }
    if (authLoading) return;

    setLoading(true);
    setError(null);
    try {
      const next = await service.load(stableRequest) as AcademicResult;
      if (requestRevisionRef.current !== revision) return;
      if (isDensityError(next)) {
        setDensityError(next);
        return;
      }
      setData(next);
      setDataFingerprint(fingerprint);
      setSuccessfulRequest(stableRequest);
      setDensityError(null);
    } catch (fetchError) {
      if (requestRevisionRef.current !== revision) return;
      setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
    } finally {
      if (requestRevisionRef.current === revision) setLoading(false);
    }
  }, [authLoading, fingerprint, service, stableRequest]);

  const loadMore = useCallback(async () => {
    if (!service || stableRequest.mode !== "curriculum" || loadingMore) return;
    const currentPage = data?.page as {
      rows?: unknown[];
      nextCursor?: AcademicKeysetCursor | null;
      hasMore?: boolean;
    } | undefined;
    if (!currentPage?.hasMore || !currentPage.nextCursor) return;
    const expectedRevision = requestRevisionRef.current;
    const expectedFingerprint = fingerprint;
    setLoadingMoreFingerprint(expectedFingerprint);
    setError(null);
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
        setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
      }
    } finally {
      setLoadingMoreFingerprint((current) => current === expectedFingerprint ? null : current);
    }
  }, [data?.page, fingerprint, loadingMore, service, stableRequest]);

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
    data,
    successfulRequest,
    currentRequest: stableRequest,
  }) as AcademicWorkspaceRequest;

  return {
    data,
    dataFingerprint,
    successfulRequest,
    displayRequest,
    densityError,
    loading,
    loadingMore,
    error,
    refresh: load,
    loadMore,
    loadCurriculumDetail,
  };
}
