"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  History,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createId, managementService } from "./management-service.js";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  SettingsWorkspaceShell,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";

type TeacherRecord = {
  id: string;
  name: string;
  subjects: string;
  profileId: string;
  accountEmail: string;
  dashboardRole: DashboardRole;
  isVisible: boolean;
  sortOrder: string;
  isNew?: boolean;
};

type DashboardRole = "admin" | "staff" | "teacher" | "assistant" | "viewer";

type AccountProfile = {
  id: string;
  name: string;
  loginId: string;
  email: string;
  role: DashboardRole;
  teacherCatalogId: string;
};

type AuditLog = {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityTable: string;
  entityLabel: string;
  changedAt: string;
};

const TEAM_OPTIONS = ["영어팀", "수학팀", "관리팀", "조교팀"] as const;
type TeamOption = (typeof TEAM_OPTIONS)[number];
const TEAM_FILTERS = ["전체", ...TEAM_OPTIONS] as const;
const TEAM_ALIASES: Record<string, TeamOption> = {
  english: "영어팀",
  영어: "영어팀",
  영어팀: "영어팀",
  math: "수학팀",
  수학: "수학팀",
  수학팀: "수학팀",
  admin: "관리팀",
  staff: "관리팀",
  관리: "관리팀",
  운영: "관리팀",
  관리팀: "관리팀",
  assistant: "조교팀",
  assist: "조교팀",
  조교: "조교팀",
  조교팀: "조교팀",
};
const ROLE_OPTIONS = [
  { value: "admin", label: "관리자" },
  { value: "staff", label: "운영" },
  { value: "teacher", label: "선생님" },
  { value: "assistant", label: "조교" },
  { value: "viewer", label: "보기만" },
] satisfies Array<{ value: DashboardRole; label: string }>;
function normalizeTeamValue(subjects: string) {
  const parsedTeams = subjects
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const team of parsedTeams) {
    const normalized = TEAM_ALIASES[team] || TEAM_ALIASES[team.toLowerCase()];
    if (normalized) {
      return normalized;
    }
  }

  return TEAM_OPTIONS[0];
}

function normalizeRole(value: unknown): DashboardRole {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  return ROLE_OPTIONS.some((option) => option.value === role)
    ? (role as DashboardRole)
    : "teacher";
}

function resolveRoleForTeam(subjects: string, value: unknown): DashboardRole {
  const team = normalizeTeamValue(subjects);
  const role = normalizeRole(value);

  return team === "조교팀" ? "assistant" : role;
}

function getRoleLabel(value: unknown) {
  const role = normalizeRole(value);
  return (
    ROLE_OPTIONS.find((option) => option.value === role)?.label || "선생님"
  );
}

function formatAccountIdentifier(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `아이디 ${trimmed}`;
  return trimmed;
}

function getAccountIdentifier(profile: AccountProfile) {
  if (profile.email) return formatAccountIdentifier(profile.email);
  if (profile.loginId) return formatAccountIdentifier(profile.loginId);
  return "";
}

function getAccountPrimaryLabel(profile: AccountProfile) {
  if (profile.name) return profile.name;
  const identifier = getAccountIdentifier(profile);
  if (identifier) return identifier;
  return `계정 ${profile.id.slice(0, 8)}`;
}

function getAccountSecondaryLabel(profile: AccountProfile) {
  const identifier = getAccountIdentifier(profile);
  if (profile.name && identifier) return identifier;
  return getRoleLabel(profile.role);
}

function normalizeAccountName(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function isAccountNameMatched(row: TeacherRecord, profile: AccountProfile) {
  const teacherName = normalizeAccountName(row.name);
  const profileName = normalizeAccountName(profile.name);
  return Boolean(teacherName && profileName && teacherName === profileName);
}

function getLinkedTeacherName(
  profile: AccountProfile,
  rows: TeacherRecord[],
) {
  if (!profile.teacherCatalogId) return "";
  return rows.find((row) => row.id === profile.teacherCatalogId)?.name || "";
}

function isAccountLinkedToAnotherTeacher(
  profile: AccountProfile,
  currentTeacherId: string,
) {
  return Boolean(
    profile.teacherCatalogId && profile.teacherCatalogId !== currentTeacherId,
  );
}

function getAccountConnectionStatus(
  profile: AccountProfile,
  row: TeacherRecord,
  rows: TeacherRecord[],
) {
  if (isAccountLinkedToAnotherTeacher(profile, row.id)) {
    const linkedTeacherName = getLinkedTeacherName(profile, rows);
    return linkedTeacherName
      ? `이미 연결: ${linkedTeacherName}`
      : "이미 다른 선생님에 연결";
  }

  if (!isAccountNameMatched(row, profile)) {
    return "가입명 확인";
  }

  return profile.teacherCatalogId === row.id
    ? "현재 계정 · 선생님 이름 일치"
    : "연결 가능 · 선생님 이름 일치";
}

function toAccountProfile(row: Record<string, unknown>): AccountProfile {
  return {
    id: String(row.id || ""),
    name: typeof row.name === "string" ? row.name : "",
    loginId: typeof row.login_id === "string" ? row.login_id : "",
    email: typeof row.email === "string" ? row.email : "",
    role: normalizeRole(row.role),
    teacherCatalogId:
      typeof row.teacher_catalog_id === "string" ? row.teacher_catalog_id : "",
  };
}

function toAuditLog(row: Record<string, unknown>): AuditLog {
  return {
    id: String(row.id || createId()),
    actorEmail: typeof row.actor_email === "string" ? row.actor_email : "",
    actorRole: typeof row.actor_role === "string" ? row.actor_role : "",
    action: typeof row.action === "string" ? row.action : "",
    entityTable: typeof row.entity_table === "string" ? row.entity_table : "",
    entityLabel: typeof row.entity_label === "string" ? row.entity_label : "",
    changedAt: typeof row.changed_at === "string" ? row.changed_at : "",
  };
}

function toTeacherRecord(
  row: Record<string, unknown>,
  index: number,
  profilesById = new Map<string, AccountProfile>(),
): TeacherRecord {
  const subjects = Array.isArray(row.subjects)
    ? row.subjects
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
        .join(", ")
    : "";
  const profileId = typeof row.profile_id === "string" ? row.profile_id : "";
  const profile = profileId ? profilesById.get(profileId) : undefined;
  const accountEmail =
    typeof row.account_email === "string" && row.account_email
      ? row.account_email
      : profile
        ? getAccountIdentifier(profile)
        : "";

  const team = normalizeTeamValue(subjects);

  return {
    id: String(row.id || createId()),
    name: typeof row.name === "string" ? row.name : "",
    subjects: team,
    profileId,
    accountEmail,
    dashboardRole: resolveRoleForTeam(team, row.dashboard_role || profile?.role),
    isVisible: row.is_visible !== false,
    sortOrder: String(row.sort_order ?? index),
  };
}

function createEmptyTeacher(nextSortOrder: number): TeacherRecord {
  return {
    id: createId(),
    name: "",
    subjects: TEAM_OPTIONS[0],
    profileId: "",
    accountEmail: "",
    dashboardRole: "teacher",
    isVisible: true,
    sortOrder: String(nextSortOrder),
    isNew: true,
  };
}

function getNextSortOrder(rows: TeacherRecord[]) {
  const numericSortOrders = rows
    .map((row) => Number.parseInt(row.sortOrder, 10))
    .filter((value) => Number.isFinite(value));
  return (
    (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1
  );
}

function reorderWithSequentialSort(
  rows: TeacherRecord[],
  fromIndex: number,
  toIndex: number,
) {
  const nextRows = [...rows];
  const [moved] = nextRows.splice(fromIndex, 1);
  nextRows.splice(toIndex, 0, moved);
  return nextRows.map((row, index) => ({
    ...row,
    sortOrder: String(index + 1),
  }));
}

function withSequentialSort(rows: TeacherRecord[]) {
  return rows.map((row, index) => ({
    ...row,
    sortOrder: String(index + 1),
  }));
}

function TeacherAccountSelect({
  row,
  rows,
  profiles,
  isAccountSchemaReady,
  onAccountChange,
  onManualAccountChange,
}: {
  row: TeacherRecord;
  rows: TeacherRecord[];
  profiles: AccountProfile[];
  isAccountSchemaReady: boolean;
  onAccountChange: (id: string, value: string) => void;
  onManualAccountChange: (id: string, value: string) => void;
}) {
  const selectedProfile = profiles.find((profile) => profile.id === row.profileId);
  const selectedAccountLabel = selectedProfile
    ? getAccountIdentifier(selectedProfile) || getAccountPrimaryLabel(selectedProfile)
    : "";

  return (
    <div className="grid gap-1.5">
      <Select
        value={row.profileId || "unlinked"}
        onValueChange={(value) => onAccountChange(row.id, value)}
      >
        <SelectTrigger
          aria-label="연결된 계정"
          className="h-auto min-h-9 w-full py-1.5 text-left"
          disabled={!isAccountSchemaReady}
        >
          {selectedProfile ? (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {selectedAccountLabel}
              </span>
            </span>
          ) : (
            <span className="truncate text-sm text-muted-foreground">
              {row.accountEmail
                ? formatAccountIdentifier(row.accountEmail)
                : "계정 미연결"}
            </span>
          )}
        </SelectTrigger>
        <SelectContent className="min-w-80">
          <SelectItem value="unlinked">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">계정 미연결</span>
              <span className="text-[11px] text-muted-foreground">
                이메일 또는 아이디 직접 입력
              </span>
            </span>
          </SelectItem>
          {profiles.map((profile) => {
            const status = getAccountConnectionStatus(profile, row, rows);
            const disabled = isAccountLinkedToAnotherTeacher(profile, row.id);

            return (
              <SelectItem
                key={profile.id}
                value={profile.id}
                disabled={disabled}
                className="py-2"
              >
                <span className="grid min-w-0 gap-1">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {getAccountPrimaryLabel(profile)}
                    </span>
                    <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">
                      {getRoleLabel(profile.role)}
                    </Badge>
                  </span>
                  <span className="flex min-w-0 items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {getAccountSecondaryLabel(profile)}
                    </span>
                    <span className="shrink-0">{status}</span>
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {!row.profileId ? (
        <Input
          className="h-8 text-xs"
          value={row.accountEmail}
          onChange={(event) => onManualAccountChange(row.id, event.target.value)}
          placeholder="이메일 또는 아이디"
          aria-label="로그인 계정 이메일 또는 아이디"
          disabled={!isAccountSchemaReady}
        />
      ) : null}
    </div>
  );
}

function getAuditActionLabel(action: string) {
  if (action === "INSERT") return "입력";
  if (action === "UPDATE") return "수정";
  if (action === "DELETE") return "삭제";
  return action || "-";
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function TeacherMasterWorkspace() {
  const [rows, setRows] = useState<TeacherRecord[]>([]);
  const [profiles, setProfiles] = useState<AccountProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isAccountSchemaReady, setIsAccountSchemaReady] = useState(true);
  const [schemaWarning, setSchemaWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [teamFilter, setTeamFilter] =
    useState<(typeof TEAM_FILTERS)[number]>("전체");

  const loadTeachers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await managementService.listTeacherAccountSettingsData();
      const nextProfiles: AccountProfile[] = (data.profiles || []).map(
        (row: Record<string, unknown>) => toAccountProfile(row),
      );
      const profilesById = new Map<string, AccountProfile>(
        nextProfiles.map((profile) => [profile.id, profile]),
      );
      setProfiles(nextProfiles);
      setAuditLogs(
        (data.auditLogs || []).map((row: Record<string, unknown>) =>
          toAuditLog(row),
        ),
      );
      setIsAccountSchemaReady(data.isAccountSchemaReady !== false);
      setSchemaWarning(data.schemaWarning || "");
      setRows(
        (data.teachers || []).map(
          (row: Record<string, unknown>, index: number) =>
            toTeacherRecord(row, index + 1, profilesById),
        ),
      );
      setDeletedIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setRows([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "선생님 목록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeachers();
  }, [loadTeachers]);

  useEffect(() => {
    if (isDirty) {
      return undefined;
    }

    const reloadWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void loadTeachers();
      }
    };
    const reloadOnFocus = () => {
      void loadTeachers();
    };

    document.addEventListener("visibilitychange", reloadWhenVisible);
    window.addEventListener("focus", reloadOnFocus);

    return () => {
      document.removeEventListener("visibilitychange", reloadWhenVisible);
      window.removeEventListener("focus", reloadOnFocus);
    };
  }, [isDirty, loadTeachers]);

  const visibleTeams = useMemo(
    () =>
      teamFilter === "전체"
        ? [...TEAM_OPTIONS]
        : [teamFilter as TeamOption],
    [teamFilter],
  );

  const getRowsForTeam = useCallback(
    (team: TeamOption) =>
      rows.filter((row) => normalizeTeamValue(row.subjects) === team),
    [rows],
  );

  const filteredRows = useMemo(
    () => visibleTeams.flatMap((team) => getRowsForTeam(team)),
    [getRowsForTeam, visibleTeams],
  );

  const handleFieldChange = (
    id: string,
    field: keyof TeacherRecord,
    value: string | boolean,
  ) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setIsDirty(true);
  };

  const handleTeamChange = (id: string, value: TeamOption) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              subjects: value,
              dashboardRole: value === "조교팀" ? "assistant" : row.dashboardRole,
            }
          : row,
      ),
    );
    setIsDirty(true);
  };

  const handleAccountChange = (id: string, value: string) => {
    const profile = profiles.find((item) => item.id === value);
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              profileId: profile ? profile.id : "",
              accountEmail: profile
                ? getAccountIdentifier(profile)
                : row.accountEmail,
              dashboardRole: profile ? profile.role : row.dashboardRole,
            }
          : row,
      ),
    );
    setIsDirty(true);
  };

  const handleRoleChange = (id: string, value: string) => {
    handleFieldChange(id, "dashboardRole", normalizeRole(value));
  };

  const handleAddToTeam = (team: TeamOption) => {
    setRows((current) => {
      const defaultRole: DashboardRole =
        team === "조교팀" ? "assistant" : "teacher";
      const newTeacher: TeacherRecord = {
        ...createEmptyTeacher(getNextSortOrder(current)),
        subjects: team,
        dashboardRole: defaultRole,
      };
      let insertIndex = current.length;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (normalizeTeamValue(current[index].subjects) === team) {
          insertIndex = index + 1;
          break;
        }
      }
      const nextRows = [...current];
      nextRows.splice(insertIndex, 0, newTeacher);
      return withSequentialSort(nextRows);
    });
    setIsDirty(true);
  };

  const handleAdd = () => {
    handleAddToTeam(teamFilter === "전체" ? TEAM_OPTIONS[0] : teamFilter);
  };

  const handleSaveAll = async () => {
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      subjects: normalizeTeamValue(row.subjects),
      dashboardRole: resolveRoleForTeam(row.subjects, row.dashboardRole),
      sortOrder: String(index + 1),
    }));
    if (nextRows.some((row) => !row.name)) {
      setError("선생님 이름을 입력하지 않은 행이 있습니다.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (deletedIds.length > 0) {
        await managementService.deleteTeacherCatalogs(deletedIds);
      }
      if (nextRows.length > 0) {
        await managementService.upsertTeacherCatalogs(
          nextRows.map((row, index) => ({
            id: row.id,
            name: row.name,
            subjects: [normalizeTeamValue(row.subjects)],
            profileId: row.profileId,
            accountEmail: row.accountEmail,
            dashboardRole: row.dashboardRole,
            isVisible: row.isVisible,
            sortOrder: index + 1,
          })),
        );
      }
      await loadTeachers();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "선생님 정보를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: TeacherRecord) => {
    if (!row.isNew) {
      setDeletedIds((current) =>
        current.includes(row.id) ? current : [...current, row.id],
      );
    }
    setRows((current) =>
      current
        .filter((item) => item.id !== row.id)
        .map((item, index) => ({ ...item, sortOrder: String(index + 1) })),
    );
    setIsDirty(true);
  };

  const handleMoveRowWithinTeam = (id: string, direction: "up" | "down") => {
    const row = rows.find((item) => item.id === id);
    if (!row) {
      return;
    }

    const teamRows = getRowsForTeam(normalizeTeamValue(row.subjects));
    const teamIndex = teamRows.findIndex((item) => item.id === id);
    const targetTeamIndex =
      direction === "up" ? teamIndex - 1 : teamIndex + 1;
    if (targetTeamIndex < 0 || targetTeamIndex >= teamRows.length) {
      return;
    }

    const currentIndex = rows.findIndex((item) => item.id === id);
    const targetIndex = rows.findIndex(
      (item) => item.id === teamRows[targetTeamIndex].id,
    );
    if (currentIndex < 0 || targetIndex < 0) {
      return;
    }

    setRows(reorderWithSequentialSort(rows, currentIndex, targetIndex));
    setIsDirty(true);
  };

  return (
    <SettingsWorkspaceShell>
      <SettingsMasterHeader
        filters={TEAM_FILTERS.map((filter) => (
          <Button
            key={filter}
            type="button"
            variant={teamFilter === filter ? "default" : "outline"}
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => setTeamFilter(filter)}
          >
            {filter}
          </Button>
        ))}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => void loadTeachers()}
              disabled={loading || saving}
            >
              <RefreshCw className="mr-2 size-4" />
              계정 새로고침
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd}>
              <Plus className="mr-2 size-4" />
              선생님 추가
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              onClick={() => void handleSaveAll()}
              disabled={!isDirty || saving}
            >
              {saving ? "저장 중" : "변경 저장"}
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {schemaWarning ? (
        <Alert>
          <AlertDescription>{schemaWarning}</AlertDescription>
        </Alert>
      ) : null}

      <div
        data-testid="teacher-settings-mobile-list"
        aria-label="선생님 모바일 편집 목록"
        className="grid gap-2 md:hidden"
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={`teacher-mobile-loading-${index}`} className="h-48 w-full" />
          ))
        ) : filteredRows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            {teamFilter === "전체"
              ? "등록된 선생님이 없습니다."
              : `${teamFilter} 선생님이 없습니다.`}
          </div>
        ) : (
          filteredRows.map((row) => {
            const teamRows = getRowsForTeam(normalizeTeamValue(row.subjects));
            const currentIndex = teamRows.findIndex((item) => item.id === row.id);

            return (
              <section
                key={`teacher-settings-mobile-card-${row.id}`}
                data-testid={`teacher-settings-mobile-card-${row.id}`}
                className="rounded-lg border border-border/70 bg-background px-3 py-3"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {row.name || "새 선생님"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {normalizeTeamValue(row.subjects)} · {getRoleLabel(row.dashboardRole)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Checkbox
                      aria-label="선생님 표시 여부"
                      checked={row.isVisible}
                      onCheckedChange={(checked) =>
                        handleFieldChange(row.id, "isVisible", checked === true)
                      }
                    />
                    <span className="text-xs text-muted-foreground">표시</span>
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">팀</span>
                    <Select
                      value={normalizeTeamValue(row.subjects)}
                      onValueChange={(value) => handleTeamChange(row.id, value as TeamOption)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="팀" />
                      </SelectTrigger>
                      <SelectContent>
                        {TEAM_OPTIONS.map((team) => (
                          <SelectItem key={team} value={team}>
                            {team}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">이름</span>
                    <Input
                      name="teacher-name-mobile"
                      className="h-9"
                      value={row.name}
                      onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                      placeholder="선생님 이름"
                      aria-label={`${row.name || "새 선생님"} 이름`}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">계정</span>
                    <TeacherAccountSelect
                      row={row}
                      rows={rows}
                      profiles={profiles}
                      isAccountSchemaReady={isAccountSchemaReady}
                      onAccountChange={handleAccountChange}
                      onManualAccountChange={(id, value) =>
                        handleFieldChange(id, "accountEmail", value)
                      }
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">권한</span>
                    <Select
                      value={row.dashboardRole}
                      onValueChange={(value) => handleRoleChange(row.id, value)}
                      disabled={!isAccountSchemaReady}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="권한" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role.value} value={role.value}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => handleMoveRowWithinTeam(row.id, "up")}
                      disabled={saving || currentIndex <= 0}
                      aria-label="선생님 순서 위로 이동"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => handleMoveRowWithinTeam(row.id, "down")}
                      disabled={saving || currentIndex === teamRows.length - 1}
                      aria-label="선생님 순서 아래로 이동"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(row)}
                      disabled={saving}
                      aria-label="선생님 삭제"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>

      <div
        data-testid="teacher-organization-tree"
        className="hidden gap-3 md:grid"
      >
        {visibleTeams.map((team) => {
          const teamRows = getRowsForTeam(team);

          return (
            <section
              key={team}
              data-testid={`teacher-team-group-${team}`}
              className="rounded-md bg-background"
            >
              <div className="flex items-center justify-between gap-3 px-2 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                  <h2 className="truncate text-sm font-semibold text-foreground">
                    {team}
                  </h2>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {teamRows.length}명
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => handleAddToTeam(team)}
                  disabled={saving}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  추가
                </Button>
              </div>

              <div className="px-3 py-3">
                {loading ? (
                  <div className="grid gap-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton
                        key={`teacher-tree-loading-${team}-${index}`}
                        className="h-16 w-full"
                      />
                    ))}
                  </div>
                ) : teamRows.length === 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-5 text-sm text-muted-foreground">
                    <span>{team} 선생님이 없습니다.</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      onClick={() => handleAddToTeam(team)}
                      disabled={saving}
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      추가
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {teamRows.map((row) => {
                      const currentIndex = teamRows.findIndex(
                        (item) => item.id === row.id,
                      );

                      return (
                        <div
                          key={row.id}
                          className="grid grid-cols-[minmax(120px,0.8fr)_minmax(150px,0.9fr)_minmax(230px,1.4fr)_minmax(112px,0.7fr)_72px_112px] items-center gap-2 px-2 py-2"
                        >
                          <Select
                            value={normalizeTeamValue(row.subjects)}
                            onValueChange={(value) =>
                              handleTeamChange(row.id, value as TeamOption)
                            }
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder="팀" />
                            </SelectTrigger>
                            <SelectContent>
                              {TEAM_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Input
                            name="teacher-name"
                            className="h-9"
                            value={row.name}
                            onChange={(event) =>
                              handleFieldChange(
                                row.id,
                                "name",
                                event.target.value,
                              )
                            }
                            placeholder="선생님 이름"
                            aria-label={`${row.name || "새 선생님"} 이름`}
                          />

                          <TeacherAccountSelect
                            row={row}
                            rows={rows}
                            profiles={profiles}
                            isAccountSchemaReady={isAccountSchemaReady}
                            onAccountChange={handleAccountChange}
                            onManualAccountChange={(id, value) =>
                              handleFieldChange(id, "accountEmail", value)
                            }
                          />

                          <Select
                            value={row.dashboardRole}
                            onValueChange={(value) =>
                              handleRoleChange(row.id, value)
                            }
                            disabled={!isAccountSchemaReady}
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder="권한" />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((role) => (
                                <SelectItem key={role.value} value={role.value}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <div className="flex h-9 items-center justify-center gap-2">
                            <Checkbox
                              aria-label="선생님 표시 여부"
                              checked={row.isVisible}
                              onCheckedChange={(checked) =>
                                handleFieldChange(
                                  row.id,
                                  "isVisible",
                                  checked === true,
                                )
                              }
                            />
                            <span className="text-xs text-muted-foreground">표시</span>
                          </div>

                          <div className="flex h-9 justify-end gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8"
                              onClick={() => handleMoveRowWithinTeam(row.id, "up")}
                              disabled={saving || currentIndex <= 0}
                              aria-label="선생님 순서 위로 이동"
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8"
                              onClick={() => handleMoveRowWithinTeam(row.id, "down")}
                              disabled={
                                saving || currentIndex === teamRows.length - 1
                              }
                              aria-label="선생님 순서 아래로 이동"
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(row)}
                              disabled={saving}
                              aria-label="선생님 삭제"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div data-testid="teacher-audit-mobile-list" className="grid gap-2 md:hidden">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="size-4" />
          최근 변경 이력
        </div>
        {auditLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            기록된 이력이 없습니다.
          </div>
        ) : (
          auditLogs.map((log) => (
            <section
              key={`teacher-audit-mobile-card-${log.id}`}
              data-testid={`teacher-audit-mobile-card-${log.id}`}
              className="rounded-lg border border-border/70 bg-background px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="rounded-md">
                      {getAuditActionLabel(log.action)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{log.entityTable}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-foreground">
                    {log.entityLabel || "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {log.actorEmail || "-"} · {getRoleLabel(log.actorRole)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatAuditTime(log.changedAt)}
                </span>
              </div>
            </section>
          ))
        )}
      </div>

      <div className="hidden md:block">
      <SettingsTableFrame>
        <Table>
          <caption className="sr-only">최근 변경 이력</caption>
          <TableHeader>
            <TableRow>
              <TableHead className={`w-[18%] ${settingsTableHeadClass}`}>
                <span className="inline-flex items-center gap-1.5">
                  <History className="size-3.5" />
                  최근 변경 이력
                </span>
              </TableHead>
              <TableHead className={`w-[16%] ${settingsTableHeadClass}`}>
                구분
              </TableHead>
              <TableHead className={`w-[28%] ${settingsTableHeadClass}`}>
                대상
              </TableHead>
              <TableHead className={`w-[24%] ${settingsTableHeadClass}`}>
                실행자
              </TableHead>
              <TableHead
                className={`w-[14%] text-right ${settingsTableHeadClass}`}
              >
                시간
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditLogs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  기록된 이력이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              auditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className={settingsTableCellClass}>
                    <Badge variant="outline" className="rounded-md">
                      {getAuditActionLabel(log.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className={settingsTableCellClass}>
                    {log.entityTable}
                  </TableCell>
                  <TableCell className={settingsTableCellClass}>
                    {log.entityLabel || "-"}
                  </TableCell>
                  <TableCell className={settingsTableCellClass}>
                    <div className="truncate">{log.actorEmail || "-"}</div>
                    <div className="text-xs text-muted-foreground">
                      {getRoleLabel(log.actorRole)}
                    </div>
                  </TableCell>
                  <TableCell className={`${settingsTableCellClass} text-right`}>
                    {formatAuditTime(log.changedAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SettingsTableFrame>
      </div>
    </SettingsWorkspaceShell>
  );
}
