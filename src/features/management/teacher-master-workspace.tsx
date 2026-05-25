"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  History,
  Link2,
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
  settingsTableActionCellClass,
  settingsTableActionHeadClass,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";
import {
  useSettingsTableColumns,
  type SettingsTableColumn,
} from "./settings-table-columns";

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

type DashboardRole = "admin" | "staff" | "teacher" | "viewer";

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

const TEAM_OPTIONS = ["영어팀", "수학팀", "관리팀"] as const;
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
};
const ROLE_OPTIONS = [
  { value: "admin", label: "관리자" },
  { value: "staff", label: "운영" },
  { value: "teacher", label: "선생님" },
  { value: "viewer", label: "보기만" },
] satisfies Array<{ value: DashboardRole; label: string }>;
const TEACHER_TABLE_COLUMNS = [
  { id: "subjects", label: "팀" },
  { id: "name", label: "이름" },
  { id: "account", label: "계정" },
  { id: "role", label: "권한" },
  { id: "visible", label: "표시" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];

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

function getAccountLabel(profile: AccountProfile) {
  if (profile.email) return formatAccountIdentifier(profile.email);
  if (profile.loginId) return formatAccountIdentifier(profile.loginId);
  if (profile.name) return profile.name;
  return `계정 ${profile.id.slice(0, 8)}`;
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
        ? getAccountLabel(profile)
        : "";

  return {
    id: String(row.id || createId()),
    name: typeof row.name === "string" ? row.name : "",
    subjects: normalizeTeamValue(subjects),
    profileId,
    accountEmail,
    dashboardRole: normalizeRole(row.dashboard_role || profile?.role),
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
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } =
    useSettingsTableColumns(
      "tips-settings-table:teachers:v2",
      TEACHER_TABLE_COLUMNS,
    );

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

  const nextSortOrder = useMemo(() => {
    const numericSortOrders = rows
      .map((row) => Number.parseInt(row.sortOrder, 10))
      .filter((value) => Number.isFinite(value));
    return (
      (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1
    );
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          teamFilter === "전체" ||
          normalizeTeamValue(row.subjects) === teamFilter,
      ),
    [rows, teamFilter],
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
    handleFieldChange(id, "subjects", value);
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
                ? getAccountLabel(profile)
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

  const handleAdd = () => {
    setRows((current) => [createEmptyTeacher(nextSortOrder), ...current]);
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      subjects: normalizeTeamValue(row.subjects),
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

  const handleMoveRow = (id: string, direction: "up" | "down") => {
    const currentIndex = rows.findIndex((row) => row.id === id);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }

    const reorderedRows = reorderWithSequentialSort(
      rows,
      currentIndex,
      targetIndex,
    );
    setRows(reorderedRows);
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
            {columnSettingsControl}
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
            const currentIndex = rows.findIndex((item) => item.id === row.id);

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
                    <Select
                      value={row.profileId || "unlinked"}
                      onValueChange={(value) => handleAccountChange(row.id, value)}
                    >
                      <SelectTrigger className="h-9" disabled={!isAccountSchemaReady}>
                        <SelectValue placeholder="연결된 계정" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unlinked">계정 미연결</SelectItem>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {getAccountLabel(profile)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.profileId ? (
                      <Badge variant="outline" className="h-8 w-fit rounded-md px-2 text-[11px]">
                        <Link2 className="mr-1 size-3" />
                        연결됨
                      </Badge>
                    ) : (
                      <Input
                        className="h-8 text-xs"
                        value={row.accountEmail}
                        onChange={(event) =>
                          handleFieldChange(row.id, "accountEmail", event.target.value)
                        }
                        placeholder="이메일 또는 아이디"
                        aria-label="로그인 계정 이메일 또는 아이디"
                        disabled={!isAccountSchemaReady}
                      />
                    )}
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
                      onClick={() => handleMoveRow(row.id, "up")}
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
                      onClick={() => handleMoveRow(row.id, "down")}
                      disabled={saving || currentIndex === rows.length - 1}
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

      <div className="hidden md:block">
      <SettingsTableFrame>
        <Table className="table-fixed">
          <caption className="sr-only">선생님 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("subjects") ? (
                <TableHead className={`w-[14%] ${settingsTableHeadClass}`}>
                  팀
                </TableHead>
              ) : null}
              {isColumnVisible("name") ? (
                <TableHead className={`w-[17%] ${settingsTableHeadClass}`}>
                  이름
                </TableHead>
              ) : null}
              {isColumnVisible("account") ? (
                <TableHead className={`w-[29%] ${settingsTableHeadClass}`}>
                  계정
                </TableHead>
              ) : null}
              {isColumnVisible("role") ? (
                <TableHead className={`w-[14%] ${settingsTableHeadClass}`}>
                  권한
                </TableHead>
              ) : null}
              {isColumnVisible("visible") ? (
                <TableHead
                  className={`w-[8%] text-center ${settingsTableHeadClass}`}
                >
                  표시
                </TableHead>
              ) : null}
              {isColumnVisible("action") ? (
                <TableHead
                  className={`w-[18%] ${settingsTableActionHeadClass}`}
                >
                  작업
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`teacher-loading-${index}`}>
                  <TableCell colSpan={visibleColumnCount} className="px-3 py-2">
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleColumnCount}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  {teamFilter === "전체"
                    ? "등록된 선생님이 없습니다."
                    : `${teamFilter} 선생님이 없습니다.`}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                const currentIndex = rows.findIndex(
                  (item) => item.id === row.id,
                );
                return (
                  <TableRow key={row.id}>
                    {isColumnVisible("subjects") ? (
                      <TableCell className={settingsTableCellClass}>
                        <Select
                          value={normalizeTeamValue(row.subjects)}
                          onValueChange={(value) =>
                            handleTeamChange(row.id, value as TeamOption)
                          }
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
                      </TableCell>
                    ) : null}
                    {isColumnVisible("name") ? (
                      <TableCell className={settingsTableCellClass}>
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
                      </TableCell>
                    ) : null}
                    {isColumnVisible("account") ? (
                      <TableCell className={settingsTableCellClass}>
                        <div className="grid gap-1.5">
                          <Select
                            value={row.profileId || "unlinked"}
                            onValueChange={(value) =>
                              handleAccountChange(row.id, value)
                            }
                          >
                            <SelectTrigger
                              className="h-9"
                              disabled={!isAccountSchemaReady}
                            >
                              <SelectValue placeholder="연결된 계정" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unlinked">
                                계정 미연결
                              </SelectItem>
                              {profiles.map((profile) => (
                                <SelectItem key={profile.id} value={profile.id}>
                                  {getAccountLabel(profile)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {row.profileId ? (
                            <div className="flex justify-end">
                              <Badge
                                variant="outline"
                                className="h-8 rounded-md px-2 text-[11px]"
                              >
                                <Link2 className="mr-1 size-3" />
                                연결됨
                              </Badge>
                            </div>
                          ) : (
                            <Input
                              className="h-8 text-xs"
                              value={row.accountEmail}
                              onChange={(event) =>
                                handleFieldChange(
                                  row.id,
                                  "accountEmail",
                                  event.target.value,
                                )
                              }
                              placeholder="이메일 또는 아이디"
                              aria-label="로그인 계정 이메일 또는 아이디"
                              disabled={!isAccountSchemaReady}
                            />
                          )}
                        </div>
                      </TableCell>
                    ) : null}
                    {isColumnVisible("role") ? (
                      <TableCell className={settingsTableCellClass}>
                        <Select
                          value={row.dashboardRole}
                          onValueChange={(value) =>
                            handleRoleChange(row.id, value)
                          }
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
                      </TableCell>
                    ) : null}
                    {isColumnVisible("visible") ? (
                      <TableCell
                        className={`${settingsTableCellClass} text-center`}
                      >
                        <div className="flex justify-center">
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
                        </div>
                      </TableCell>
                    ) : null}
                    {isColumnVisible("action") ? (
                      <TableCell className={settingsTableActionCellClass}>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-8"
                            onClick={() => handleMoveRow(row.id, "up")}
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
                            onClick={() => handleMoveRow(row.id, "down")}
                            disabled={
                              saving || currentIndex === rows.length - 1
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
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </SettingsTableFrame>
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
