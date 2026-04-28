"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { resolveAcademicCalendarCollections } from "./academic-calendar-baseline.js";

type OperationsWorkspaceRow = Record<string, unknown>;

type OperationsWorkspaceData = {
  classes: OperationsWorkspaceRow[];
  classTerms: OperationsWorkspaceRow[];
  textbooks: OperationsWorkspaceRow[];
  progressLogs: OperationsWorkspaceRow[];
  academicEvents: OperationsWorkspaceRow[];
  academicSchools: OperationsWorkspaceRow[];
  academicEventExamDetails: OperationsWorkspaceRow[];
  academyCurriculumPlans: OperationsWorkspaceRow[];
  academyCurriculumMaterials: OperationsWorkspaceRow[];
  academicCurriculumProfiles: OperationsWorkspaceRow[];
  academicSupplementMaterials: OperationsWorkspaceRow[];
  academicExamMaterialPlans: OperationsWorkspaceRow[];
  academicExamMaterialItems: OperationsWorkspaceRow[];
  academicCalendarSource: "live" | "seed";
  syncGroups: OperationsWorkspaceRow[];
  syncGroupMembers: OperationsWorkspaceRow[];
};

const EMPTY_DATA: OperationsWorkspaceData = {
  classes: [],
  classTerms: [],
  textbooks: [],
  progressLogs: [],
  academicEvents: [],
  academicSchools: [],
  academicEventExamDetails: [],
  academyCurriculumPlans: [],
  academyCurriculumMaterials: [],
  academicCurriculumProfiles: [],
  academicSupplementMaterials: [],
  academicExamMaterialPlans: [],
  academicExamMaterialItems: [],
  academicCalendarSource: "live",
  syncGroups: [],
  syncGroupMembers: [],
};
function isMissingRelationError(error: unknown) {
  const code = String((error as { code?: string })?.code || "").trim();
  const message = String((error as { message?: string })?.message || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

async function readTable(table: string, optional = false) {
  const { data, error } = await supabase!.from(table).select("*");

  if (error) {
    if (optional && isMissingRelationError(error)) {
      return [];
    }

    throw error;
  }

  return data || [];
}

export function useOperationsWorkspaceData() {
  const { session, user, loading: authLoading } = useAuth();
  const [data, setData] = useState<OperationsWorkspaceData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) {
      setData(EMPTY_DATA);
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    if (authLoading) {
      return;
    }

    if (!user) {
      setData(EMPTY_DATA);
      setError("관리자 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const {
        data: { session: activeSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!activeSession?.user?.id) {
        throw new Error("관리자 세션이 준비되지 않았습니다. 다시 로그인해 주세요.");
      }

      const [
        classes,
        classTerms,
        textbooks,
        progressLogs,
        academicEvents,
        academicSchools,
        academicEventExamDetails,
        academyCurriculumPlans,
        academyCurriculumMaterials,
        academicCurriculumProfiles,
        academicSupplementMaterials,
        academicExamMaterialPlans,
        academicExamMaterialItems,
        syncGroups,
        syncGroupMembers,
      ] = await Promise.all([
        readTable("classes"),
        readTable("class_terms", true),
        readTable("textbooks", true),
        readTable("progress_logs", true),
        readTable("academic_events", true),
        readTable("academic_schools", true),
        readTable("academic_event_exam_details", true),
        readTable("academy_curriculum_plans", true),
        readTable("academy_curriculum_materials", true),
        readTable("academic_curriculum_profiles", true),
        readTable("academic_supplement_materials", true),
        readTable("academic_exam_material_plans", true),
        readTable("academic_exam_material_items", true),
        readTable("class_schedule_sync_groups", true),
        readTable("class_schedule_sync_group_members", true),
      ]);

      const academicCalendar = resolveAcademicCalendarCollections({
        academicEvents,
        academicSchools,
        allowSeed: false,
      });

      setData({
        classes,
        classTerms,
        textbooks,
        progressLogs,
        academicEvents: academicCalendar.academicEvents,
        academicSchools: academicCalendar.academicSchools,
        academicEventExamDetails,
        academyCurriculumPlans,
        academyCurriculumMaterials,
        academicCurriculumProfiles,
        academicSupplementMaterials,
        academicExamMaterialPlans,
        academicExamMaterialItems,
        academicCalendarSource: academicCalendar.academicCalendarSource,
        syncGroups,
        syncGroupMembers,
      });
      setError(null);
    } catch (fetchError) {
      setData(EMPTY_DATA);
      setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    void load();
  }, [authLoading, load, session?.access_token, user?.id]);

  return {
    data,
    loading,
    error,
    refresh: load,
  };
}
