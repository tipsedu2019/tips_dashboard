"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ACADEMIC_SUBJECTS, type AcademicSubjectValue } from "@/lib/academic-subject-registry";
import { useAuth } from "@/providers/auth-provider";
import {
  academicSubjectSettingsService,
  type AcademicSubjectSetting,
} from "./academic-subject-settings-service";
import { managementService } from "./management-service.js";
import {
  SettingsMasterHeader,
  SettingsWorkspaceShell,
} from "./settings-master-layout";

const SUBJECT_ROWS = ACADEMIC_SUBJECTS;
const UNASSIGNED_DIRECTOR_VALUE = "unassigned";

type TeacherCatalogRow = Record<string, unknown>;
type WorkspaceLoadResult = [
  readonly AcademicSubjectSetting[],
  { teachers?: TeacherCatalogRow[] },
];

function getTeacherName(teacher: TeacherCatalogRow) {
  return typeof teacher.name === "string" && teacher.name.trim()
    ? teacher.name.trim()
    : "이름 없음";
}

function getDirectorCandidates(
  teachers: readonly TeacherCatalogRow[],
  subject: (typeof SUBJECT_ROWS)[number],
) {
  return teachers.filter((teacher) => (
    teacher.is_visible !== false
    && typeof teacher.profile_id === "string"
    && teacher.profile_id.trim() !== ""
    && Array.isArray(teacher.subjects)
    && teacher.subjects.some((team) => team === subject.team)
  ));
}

export function SubjectMasterWorkspace() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<AcademicSubjectSetting[]>([]);
  const [teachers, setTeachers] = useState<TeacherCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSubject, setSavingSubject] = useState<AcademicSubjectValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const workspaceLoadRef = useRef<Promise<WorkspaceLoadResult> | null>(null);

  useEffect(() => {
    let active = true;

    async function loadWorkspace() {
      setLoading(true);
      setError(null);
      try {
        workspaceLoadRef.current ??= Promise.all([
          academicSubjectSettingsService.list(),
          managementService.listTeacherAccountSettingsData(),
        ]) as Promise<WorkspaceLoadResult>;
        const [settings, teacherData] = await workspaceLoadRef.current;
        if (!active) return;
        setRows([...settings]);
        setTeachers((teacherData.teachers || []) as TeacherCatalogRow[]);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "과목 설정을 불러오지 못했습니다.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      active = false;
    };
  }, []);

  const updateDraft = (
    subject: AcademicSubjectValue,
    patch: Partial<Pick<
      AcademicSubjectSetting,
      "isActive" | "registrationCreateEnabled" | "defaultDirectorProfileId"
    >>,
  ) => {
    setRows((current) => current.map((row) => (
      row.subject === subject ? { ...row, ...patch } : row
    )));
    setMessage(null);
  };

  const handleSave = async (subject: AcademicSubjectValue) => {
    if (!isAdmin) {
      setError("과목 설정은 운영자만 변경할 수 있습니다.");
      return;
    }

    const row = rows.find((candidate) => candidate.subject === subject);
    if (!row) {
      setError("저장할 과목 설정을 찾지 못했습니다.");
      return;
    }

    setSavingSubject(subject);
    setError(null);
    setMessage(null);
    try {
      const updated = await academicSubjectSettingsService.update({
        subject: row.subject,
        isActive: row.isActive,
        registrationCreateEnabled: row.registrationCreateEnabled,
        gradeLevels: [...row.gradeLevels],
        defaultDirectorProfileId: row.defaultDirectorProfileId,
      });
      setRows((current) => current.map((candidate) => (
        candidate.subject === updated.subject ? updated : candidate
      )));
      setMessage(`${subject} 설정을 저장했습니다.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "과목 설정을 저장하지 못했습니다.",
      );
    } finally {
      setSavingSubject(null);
    }
  };

  return (
    <SettingsWorkspaceShell>
      <SettingsMasterHeader
        filters={(
          <Badge variant={isAdmin ? "default" : "secondary"}>
            {isAdmin ? "운영자 편집" : "읽기 전용"}
          </Badge>
        )}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border/70 bg-background">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={`subject-setting-loading-${index}`} className="border-b p-4 last:border-b-0">
              <Skeleton className="h-20 w-full" />
            </div>
          ))
        ) : (
          SUBJECT_ROWS.map((subject) => {
            const row = rows.find((candidate) => candidate.subject === subject.value);
            if (!row) return null;
            const directorCandidates = getDirectorCandidates(teachers, subject);
            const hasCurrentDirector = Boolean(
              row.defaultDirectorProfileId
              && directorCandidates.some(
                (teacher) => teacher.profile_id === row.defaultDirectorProfileId,
              ),
            );

            return (
              <section
                key={subject.key}
                data-subject-key={subject.key}
                className="grid gap-3 border-b p-4 last:border-b-0 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)_minmax(260px,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{subject.value}</h2>
                    <Badge variant={row.isActive ? "default" : "outline"}>
                      {row.isActive ? "운영" : "중지"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.gradeLevels.join(", ")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                    <Checkbox
                      checked={row.isActive}
                      disabled={!isAdmin || savingSubject !== null}
                      onCheckedChange={(checked) => updateDraft(subject.value, {
                        isActive: checked === true,
                      })}
                    />
                    운영
                  </label>
                  <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                    <Checkbox
                      checked={row.registrationCreateEnabled}
                      disabled={!isAdmin || savingSubject !== null}
                      onCheckedChange={(checked) => updateDraft(subject.value, {
                        registrationCreateEnabled: checked === true,
                      })}
                    />
                    등록 생성
                  </label>
                </div>

                <Select
                  value={row.defaultDirectorProfileId || UNASSIGNED_DIRECTOR_VALUE}
                  disabled={!isAdmin || savingSubject !== null}
                  onValueChange={(value) => updateDraft(subject.value, {
                    defaultDirectorProfileId: value === UNASSIGNED_DIRECTOR_VALUE
                      ? null
                      : value,
                  })}
                >
                  <SelectTrigger aria-label={`${subject.value} 기본 담당 원장`}>
                    <SelectValue placeholder="담당 원장" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED_DIRECTOR_VALUE}>
                      {subject.key === "science" ? "미지정" : "기존 자동 배정"}
                    </SelectItem>
                    {row.defaultDirectorProfileId && !hasCurrentDirector ? (
                      <SelectItem value={row.defaultDirectorProfileId}>현재 설정</SelectItem>
                    ) : null}
                    {directorCandidates.map((teacher) => (
                      <SelectItem
                        key={String(teacher.profile_id)}
                        value={String(teacher.profile_id)}
                      >
                        {getTeacherName(teacher)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingSubject !== null}
                    onClick={() => void handleSave(subject.value)}
                  >
                    {savingSubject === subject.value ? "저장 중" : "저장"}
                  </Button>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </SettingsWorkspaceShell>
  );
}
