"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SettingsTableFrame,
  SettingsWorkspaceShell,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "@/features/management/settings-master-layout";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import { saveTextbookSettingsDraft } from "./textbook-settings-draft-service";
import {
  acceptTextbookOwnerRevision,
  acceptTextbookSubSubjectRevision,
  acknowledgeTextbookSettingsSave,
  appendTextbookOwnerOperation,
  appendTextbookSubSubjectOperation,
  classifyTextbookSettingsSaveError,
  createTextbookSettingsDraftState,
  discardTextbookSettingsDrafts,
  freezeTextbookSettingsSave,
  hasTextbookSettingsChanges,
  markTextbookSettingsSaveUnknown,
  overlayPublisherSettingRow,
  overlaySubSubjectSettingRow,
  overlaySupplierSettingRow,
  rejectTextbookSettingsSave,
  type TextbookSettingsDraftState,
} from "./textbook-settings-draft-model";
import type {
  OwnerCounts,
  OwnerDraft,
  OwnerDraftOperation,
  PublisherSettingRow,
  SubSubjectCounts,
  SubSubjectDraft,
  SubSubjectDraftOperation,
  SupplierSettingRow,
  TextbookSettingsSubject,
  TextbookSubSubjectSettingRow,
} from "./textbook-settings-types";
import { TEXTBOOK_SUBJECT_OPTIONS } from "./textbook-taxonomy";
import {
  useTextbookSettingsPages,
  type TextbookSettingsSection,
} from "./use-textbook-settings-pages";

const SUBJECT_OPTIONS = TEXTBOOK_SUBJECT_OPTIONS;
const SUBJECT_LABELS: Record<string, string> = Object.fromEntries(
  SUBJECT_OPTIONS.map((option) => [option.value, option.label]),
);
const EMPTY_OWNER_COUNTS: OwnerCounts = { publishers: 0, suppliers: 0 };
const EMPTY_SUBJECT_COUNTS: SubSubjectCounts = { english: 0, math: 0, science: 0, other: 0 };

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(value) ? value : 0);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [candidate.message, candidate.details, candidate.hint]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(" ");
    if (message) return message;
  }
  return fallback;
}

function subjectLabel(subjects: string[]) {
  const labels = subjects.map((subject) => SUBJECT_LABELS[subject] || subject);
  return labels.length > 0 ? labels.join(", ") : "미설정";
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function publisherAddRow(
  operation: Extract<OwnerDraftOperation, { type: "publisher.add" }>,
): PublisherSettingRow {
  return {
    id: operation.id,
    name: operation.name,
    subjects: [...operation.subjects],
    suppliers: operation.supplierIds.map((id) => ({ id, name: "" })),
    textbookCount: 0,
    isNew: true,
  };
}

function supplierAddRow(
  operation: Extract<OwnerDraftOperation, { type: "supplier.add" }>,
): SupplierSettingRow {
  return {
    id: operation.id,
    name: operation.name,
    contact: operation.contact,
    memo: operation.memo,
    linkedPublisherCount: 0,
    linkedPublisherNames: [],
    isNew: true,
  };
}

function subSubjectAddRow(
  operation: Extract<SubSubjectDraftOperation, { type: "add" }>,
  canMoveUp: boolean,
  canMoveDown: boolean,
  sortOrder: number,
): TextbookSubSubjectSettingRow {
  return {
    id: operation.id,
    subject: operation.subject,
    name: operation.name,
    sortOrder,
    isVisible: operation.isVisible,
    kind: "added",
    canMoveUp,
    canMoveDown,
  };
}

function PublisherSubjectSelect({
  publisher,
  disabled,
  onChange,
}: {
  publisher: PublisherSettingRow;
  disabled: boolean;
  onChange: (subjects: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between overflow-hidden px-3" disabled={disabled}>
          <span className={cn("truncate", publisher.subjects.length === 0 && "text-muted-foreground")}>
            {subjectLabel(publisher.subjects)}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="grid gap-1">
          {SUBJECT_OPTIONS.map((option) => {
            const checked = publisher.subjects.includes(option.value);
            return (
              <label key={option.value} className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/70">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => onChange(value === true
                    ? [...new Set([...publisher.subjects, option.value])]
                    : publisher.subjects.filter((subject) => subject !== option.value))}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SettingsPages = ReturnType<typeof useTextbookSettingsPages>;

function PublisherSupplierPicker({
  anchor,
  publisher,
  pages,
  pickerAnchor,
  disabled,
  onPickerAnchorChange,
  onSupplierIdsChange,
}: {
  anchor: string;
  publisher: PublisherSettingRow;
  pages: SettingsPages;
  pickerAnchor: string | null;
  disabled: boolean;
  onPickerAnchorChange: (value: string | null) => void;
  onSupplierIdsChange: (ids: string[]) => void;
}) {
  const picker = pages.supplierPicker;
  const open = picker.publisherId === publisher.id && pickerAnchor === anchor;
  const completePublisher = picker.detailCurrent && picker.detail?.id === publisher.id ? picker.detail : publisher;
  const selectedIds = completePublisher.suppliers.map((supplier) => supplier.id);
  const selectedNames = completePublisher.suppliers.map((supplier) => supplier.name).filter(Boolean);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onPickerAnchorChange(anchor);
          picker.open(publisher.id);
        } else if (open) {
          onPickerAnchorChange(null);
          picker.close();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between overflow-hidden px-3" disabled={disabled}>
          <span className={cn("truncate", selectedIds.length === 0 && "text-muted-foreground")}>
            {selectedNames.length > 0 ? selectedNames.join(", ") : selectedIds.length > 0 ? `${selectedIds.length}개 선택` : "총판 선택"}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,34rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={picker.search} onValueChange={picker.setSearch} placeholder="총판 검색" aria-label="연결할 총판 검색" />
          <CommandList className="max-h-72">
            {picker.detailError ? (
              <div className="border-b p-2 text-sm text-destructive">
                <p>{getErrorMessage(picker.detailError, "출판사 연결 정보를 불러오지 못했습니다.")}</p>
                <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={picker.retryDetail}>다시 시도</Button>
              </div>
            ) : null}
            {picker.page.error ? (
              <div className="border-b p-2 text-sm text-destructive">
                <p>{getErrorMessage(picker.page.error, "총판 목록을 불러오지 못했습니다.")}</p>
                <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={picker.page.retry}>다시 시도</Button>
              </div>
            ) : null}
            <CommandEmpty>{picker.page.loading ? "불러오는 중" : "표시할 총판이 없습니다."}</CommandEmpty>
            <CommandGroup>
              {picker.page.rows.map((supplier) => {
                const checked = selectedIds.includes(supplier.id);
                return (
                  <CommandItem
                    key={supplier.id}
                    value={`${supplier.id}:${supplier.name}`}
                    onSelect={() => onSupplierIdsChange(checked
                      ? selectedIds.filter((id) => id !== supplier.id)
                      : [...selectedIds, supplier.id])}
                  >
                    <Checkbox
                      checked={checked}
                      aria-label={`${supplier.name} 연결`}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(value) => onSupplierIdsChange(value === true
                        ? [...new Set([...selectedIds, supplier.id])]
                        : selectedIds.filter((id) => id !== supplier.id))}
                    />
                    <span className="truncate">{supplier.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t p-2">
          <DataTablePagination page={picker.page.page} pageSize={10} totalCount={picker.page.totalCount} loading={picker.page.loading} onPageChange={picker.page.goToPage} ariaLabel="총판 선택 페이지 탐색" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" className="mt-3">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{getErrorMessage(error, "목록을 불러오지 못했습니다.")}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>다시 시도</Button>
      </AlertDescription>
    </Alert>
  );
}

type FooterResource = {
  page: number;
  pageSize: 10 | 15 | 20;
  totalCount: number | null;
  loading: boolean;
  goToPage: (page: number) => void;
  setPageSizePreference?: (value: 10 | 15 | 20) => void;
};

function PageFooter({ resource, label }: { resource: FooterResource; label: string }) {
  return (
    <div className="border-t px-3 py-3">
      <DataTablePagination page={resource.page} pageSize={resource.pageSize} totalCount={resource.totalCount} loading={resource.loading} onPageChange={resource.goToPage} onPageSizeChange={resource.setPageSizePreference} ariaLabel={label} />
    </div>
  );
}

export function TextbookSupplierSettingsWorkspace() {
  const { user, role, loading } = useAuth();
  const actorScope = !loading && user?.id && role ? `${user.id}:${role}` : null;
  if (!actorScope) return <div role="status">로그인 정보를 확인하는 중입니다.</div>;
  return (
    <TextbookSupplierSettingsSession
      key={actorScope}
      actorScope={actorScope}
      canManage={role === "admin" || role === "staff"}
    />
  );
}

function TextbookSupplierSettingsSession({
  actorScope,
  canManage,
}: {
  actorScope: string;
  canManage: boolean;
}) {
  const [draftState, setDraftState] = useState<TextbookSettingsDraftState>(() => createTextbookSettingsDraftState(actorScope));
  const draftRef = useRef(draftState);
  const [activeSection, setActiveSection] = useState<TextbookSettingsSection>("publishers");
  const [activeSubject, setActiveSubject] = useState<TextbookSettingsSubject>("english");
  const [query, setQuery] = useState("");
  const [ownerCounts, setOwnerCounts] = useState<OwnerCounts>(EMPTY_OWNER_COUNTS);
  const [visibleSubSubjectCount, setVisibleSubSubjectCount] = useState(0);
  const [subjectCounts, setSubjectCounts] = useState<SubSubjectCounts>(EMPTY_SUBJECT_COUNTS);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const aliveRef = useRef(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflictPending, setConflictPending] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [publisherBaselineReloading, setPublisherBaselineReloading] = useState(false);
  const [supplierBaselineReloading, setSupplierBaselineReloading] = useState(false);
  const [subSubjectBaselineReloading, setSubSubjectBaselineReloading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [subSubjectAddPages, setSubSubjectAddPages] = useState<Record<string, number>>({});
  const [pickerAnchor, setPickerAnchor] = useState<string | null>(null);
  const ownerDraft = useMemo<OwnerDraft | null>(() => draftState.ownerOperations.length > 0 ? {
    version: 1,
    baseRevision: draftState.ownerBaseRevision!,
    operations: draftState.ownerOperations,
  } : null, [draftState.ownerBaseRevision, draftState.ownerOperations]);
  const subSubjectDraft = useMemo<SubSubjectDraft | null>(() => draftState.subSubjectOperations.length > 0 ? {
    version: 1,
    baseRevision: draftState.subSubjectBaseRevision!,
    operations: draftState.subSubjectOperations,
  } : null, [draftState.subSubjectBaseRevision, draftState.subSubjectOperations]);
  const rawPages = useTextbookSettingsPages({
    actorScope,
    activeSection,
    activeSubject,
    search: query,
    ownerDraft,
    subSubjectDraft,
    publisherBaselineOnly: publisherBaselineReloading,
    supplierBaselineOnly: supplierBaselineReloading,
    subSubjectBaselineOnly: subSubjectBaselineReloading,
    reloadVersion,
  });
  const publisherAdditions = useMemo(() => {
    if (query.trim() || rawPages.publishers.requestedPage !== 1) return [];
    const pageIds = new Set(rawPages.publishers.rows.map((row) => row.id));
    return draftState.ownerOperations
      .filter((operation): operation is Extract<OwnerDraftOperation, { type: "publisher.add" }> => operation.type === "publisher.add")
      .filter((operation) => !pageIds.has(operation.id))
      .map(publisherAddRow)
      .reverse()
      .map((row) => overlayPublisherSettingRow(row, draftState))
      .filter(isPresent);
  }, [draftState, query, rawPages.publishers.requestedPage, rawPages.publishers.rows]);
  const supplierAdditions = useMemo(() => {
    if (query.trim() || rawPages.suppliers.requestedPage !== 1) return [];
    const pageIds = new Set(rawPages.suppliers.rows.map((row) => row.id));
    return draftState.ownerOperations
      .filter((operation): operation is Extract<OwnerDraftOperation, { type: "supplier.add" }> => operation.type === "supplier.add")
      .filter((operation) => !pageIds.has(operation.id))
      .map(supplierAddRow)
      .reverse()
      .map((row) => overlaySupplierSettingRow(row, draftState))
      .filter(isPresent);
  }, [draftState, query, rawPages.suppliers.requestedPage, rawPages.suppliers.rows]);
  const subSubjectAdditions = useMemo(() => {
    if (query.trim()) return [];
    const pageIds = new Set(rawPages.subSubjects.rows.map((row) => row.id));
    return draftState.subSubjectOperations
      .filter((operation): operation is Extract<SubSubjectDraftOperation, { type: "add" }> => (
        operation.type === "add"
        && operation.subject === activeSubject
        && !pageIds.has(operation.id)
        && subSubjectAddPages[operation.id] === rawPages.subSubjects.requestedPage
      ))
      .map((operation, index, rows) => subSubjectAddRow(
        operation,
        subjectCounts[activeSubject] > rows.length || index > 0,
        index < rows.length - 1,
        (subjectCounts[activeSubject] - rows.length + index + 1) * 10,
      ))
      .map((row) => overlaySubSubjectSettingRow(row, draftState))
      .filter(isPresent);
  }, [activeSubject, draftState, query, rawPages.subSubjects.requestedPage, rawPages.subSubjects.rows, subSubjectAddPages, subjectCounts]);
  const pages = {
    ...rawPages,
    publishers: publisherAdditions.length > 0 ? {
      ...rawPages.publishers,
      page: rawPages.publishers.requestedPage,
      totalCount: Math.max(rawPages.publishers.totalCount || 0, ownerCounts.publishers),
    } : rawPages.publishers,
    suppliers: supplierAdditions.length > 0 ? {
      ...rawPages.suppliers,
      page: rawPages.suppliers.requestedPage,
      totalCount: Math.max(rawPages.suppliers.totalCount || 0, ownerCounts.suppliers),
    } : rawPages.suppliers,
    subSubjects: subSubjectAdditions.length > 0 ? {
      ...rawPages.subSubjects,
      page: rawPages.subSubjects.requestedPage,
      totalCount: Math.max(rawPages.subSubjects.totalCount || 0, subjectCounts[activeSubject]),
    } : rawPages.subSubjects,
  };
  const publisherAccepted = pages.publishers.accepted;
  const publisherCurrent = pages.publishers.current;
  const supplierAccepted = pages.suppliers.accepted;
  const supplierCurrent = pages.suppliers.current;
  const subSubjectAccepted = pages.subSubjects.accepted;
  const subSubjectCurrent = pages.subSubjects.current;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  function updateDraft(updater: (current: TextbookSettingsDraftState) => TextbookSettingsDraftState) {
    setDraftState((current) => {
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    const accepted = publisherCurrent ? publisherAccepted : null;
    if (!accepted) return;
    setOwnerCounts(accepted.ownerCounts);
    updateDraft((current) => acceptTextbookOwnerRevision(current, accepted.baseRevision));
    if (publisherBaselineReloading) {
      setPublisherBaselineReloading(false);
      setSaveError(null);
      setNotice("최신 출판사 설정을 불러왔습니다.");
    }
  }, [publisherAccepted, publisherBaselineReloading, publisherCurrent]);

  useEffect(() => {
    const accepted = supplierCurrent ? supplierAccepted : null;
    if (!accepted) return;
    setOwnerCounts(accepted.ownerCounts);
    updateDraft((current) => acceptTextbookOwnerRevision(current, accepted.baseRevision));
    if (supplierBaselineReloading) {
      setSupplierBaselineReloading(false);
      setSaveError(null);
      setNotice("최신 총판 설정을 불러왔습니다.");
    }
  }, [supplierAccepted, supplierBaselineReloading, supplierCurrent]);

  useEffect(() => {
    const accepted = subSubjectCurrent ? subSubjectAccepted : null;
    if (!accepted) return;
    setVisibleSubSubjectCount(accepted.visibleCount);
    setSubjectCounts(accepted.subjectCounts);
    updateDraft((current) => acceptTextbookSubSubjectRevision(current, accepted.baseRevision));
    if (subSubjectBaselineReloading) {
      setSubSubjectBaselineReloading(false);
      setSaveError(null);
      setNotice("최신 세부과목 설정을 불러왔습니다.");
    }
  }, [subSubjectAccepted, subSubjectBaselineReloading, subSubjectCurrent]);

  const activeResource = activeSection === "publishers" ? pages.publishers : activeSection === "suppliers" ? pages.suppliers : pages.subSubjects;
  const publisherRows = useMemo(() => {
    const accepted = pages.publishers.rows
      .map((row) => overlayPublisherSettingRow(row, draftState))
      .filter(isPresent);
    if (publisherAdditions.length === 0) return accepted;
    if (rawPages.publishers.page !== rawPages.publishers.requestedPage) {
      return publisherAdditions.slice(0, pages.publishers.pageSize);
    }
    return [...publisherAdditions, ...accepted].slice(0, pages.publishers.pageSize);
  }, [draftState, pages.publishers.pageSize, pages.publishers.rows, publisherAdditions, rawPages.publishers.page, rawPages.publishers.requestedPage]);

  const supplierRows = useMemo(() => {
    const accepted = pages.suppliers.rows
      .map((row) => overlaySupplierSettingRow(row, draftState))
      .filter(isPresent);
    if (supplierAdditions.length === 0) return accepted;
    if (rawPages.suppliers.page !== rawPages.suppliers.requestedPage) {
      return supplierAdditions.slice(0, pages.suppliers.pageSize);
    }
    return [...supplierAdditions, ...accepted].slice(0, pages.suppliers.pageSize);
  }, [draftState, pages.suppliers.pageSize, pages.suppliers.rows, rawPages.suppliers.page, rawPages.suppliers.requestedPage, supplierAdditions]);

  const subSubjectRows = useMemo(() => {
    const accepted = pages.subSubjects.rows
      .map((row) => overlaySubSubjectSettingRow(row, draftState))
      .filter(isPresent);
    if (subSubjectAdditions.length === 0) return accepted;
    if (rawPages.subSubjects.page !== rawPages.subSubjects.requestedPage) {
      return subSubjectAdditions.slice(0, pages.subSubjects.pageSize);
    }
    return [
      ...accepted.slice(0, Math.max(0, pages.subSubjects.pageSize - subSubjectAdditions.length)),
      ...subSubjectAdditions,
    ];
  }, [draftState, pages.subSubjects.pageSize, pages.subSubjects.rows, rawPages.subSubjects.page, rawPages.subSubjects.requestedPage, subSubjectAdditions]);

  useEffect(() => {
    if (!pendingFocusId) return;
    const mode = typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches ? "desktop" : "mobile";
    const input = document.querySelector<HTMLInputElement>(`input[data-focus-id="${pendingFocusId}"][data-focus-mode="${mode}"]`)
      || document.querySelector<HTMLInputElement>(`input[data-focus-id="${pendingFocusId}"]`);
    if (!input) return;
    input.focus();
    setPendingFocusId(null);
  }, [activeResource.loading, pendingFocusId, publisherRows, subSubjectRows, supplierRows]);

  const isDirty = hasTextbookSettingsChanges(draftState);
  const saveUnknown = draftState.pendingSave?.status === "unknown";
  const ownerReady = Boolean(draftState.ownerBaseRevision);
  const subSubjectsReady = Boolean(draftState.subSubjectBaseRevision);
  const activeBaselineReloading = activeSection === "publishers"
    ? publisherBaselineReloading
    : activeSection === "suppliers"
      ? supplierBaselineReloading
      : subSubjectBaselineReloading;
  const activeBaselineReady = activeSection === "subSubjects" ? subSubjectsReady : ownerReady;
  const dirtyBaselinesReady = (draftState.ownerOperations.length === 0 || ownerReady)
    && (draftState.subSubjectOperations.length === 0 || subSubjectsReady);
  const editingDisabled = !canManage || activeBaselineReloading || !activeBaselineReady;

  function appendOwner(operation: OwnerDraftOperation) {
    if (!canManage || activeBaselineReloading || !ownerReady) return;
    setNotice(null);
    if (operation.type === "publisher.add") {
      setOwnerCounts((current) => ({ ...current, publishers: current.publishers + 1 }));
    } else if (operation.type === "publisher.delete") {
      setOwnerCounts((current) => ({ ...current, publishers: Math.max(0, current.publishers - 1) }));
    } else if (operation.type === "supplier.add") {
      setOwnerCounts((current) => ({ ...current, suppliers: current.suppliers + 1 }));
    } else if (operation.type === "supplier.delete") {
      setOwnerCounts((current) => ({ ...current, suppliers: Math.max(0, current.suppliers - 1) }));
    }
    updateDraft((current) => appendTextbookOwnerOperation(current, operation));
  }

  function appendSubSubject(operation: SubSubjectDraftOperation) {
    if (!canManage || subSubjectBaselineReloading || !subSubjectsReady) return;
    setNotice(null);
    if (operation.type === "delete") {
      const row = subSubjectRows.find((candidate) => candidate.id === operation.id);
      if (row) {
        setSubjectCounts((current) => ({
          ...current,
          [row.subject]: Math.max(0, current[row.subject] - 1),
        }));
        if (row.isVisible) setVisibleSubSubjectCount((current) => Math.max(0, current - 1));
      }
    }
    updateDraft((current) => appendTextbookSubSubjectOperation(current, operation));
  }

  function setPublisherPatch(id: string, patch: Extract<OwnerDraftOperation, { type: "publisher.patch" }>["patch"]) {
    appendOwner({ type: "publisher.patch", id, patch });
  }

  function setSupplierPatch(id: string, patch: Extract<OwnerDraftOperation, { type: "supplier.patch" }>["patch"]) {
    appendOwner({ type: "supplier.patch", id, patch });
  }

  function setSubSubjectPatch(id: string, patch: Extract<SubSubjectDraftOperation, { type: "patch" }>["patch"]) {
    if (typeof patch.isVisible === "boolean") {
      const row = subSubjectRows.find((candidate) => candidate.id === id);
      if (row && row.isVisible !== patch.isVisible) {
        setVisibleSubSubjectCount((current) => Math.max(0, current + (patch.isVisible ? 1 : -1)));
      }
    }
    appendSubSubject({ type: "patch", id, patch });
  }

  function setSearch(value: string) {
    activeResource.goToPage(1);
    setQuery(value);
  }

  function changeSection(value: string) {
    const section = value as TextbookSettingsSection;
    const resource = section === "publishers" ? pages.publishers : section === "suppliers" ? pages.suppliers : pages.subSubjects;
    resource.goToPage(1);
    setPickerAnchor(null);
    pages.supplierPicker.close();
    setQuery("");
    setActiveSection(section);
  }

  function addPublisher() {
    if (!canManage || publisherBaselineReloading || !ownerReady) return;
    const id = crypto.randomUUID();
    pages.publishers.goToPage(1);
    setQuery("");
    setPendingFocusId(id);
    appendOwner({ type: "publisher.add", id, name: "", subjects: [], supplierIds: [] });
  }

  function addSupplier() {
    if (!canManage || supplierBaselineReloading || !ownerReady) return;
    const id = crypto.randomUUID();
    pages.suppliers.goToPage(1);
    setQuery("");
    setPendingFocusId(id);
    appendOwner({ type: "supplier.add", id, name: "", contact: "", memo: "" });
  }

  function addSubSubject() {
    if (!canManage || subSubjectBaselineReloading || !subSubjectsReady) return;
    const id = crypto.randomUUID();
    const nextCount = subjectCounts[activeSubject] + 1;
    const finalPage = Math.max(1, Math.ceil(nextCount / pages.subSubjects.pageSize));
    pages.subSubjects.goToPage(finalPage);
    setQuery("");
    setPendingFocusId(id);
    setSubSubjectAddPages((current) => ({ ...current, [id]: finalPage }));
    setSubjectCounts((current) => ({ ...current, [activeSubject]: nextCount }));
    setVisibleSubSubjectCount((current) => current + 1);
    appendSubSubject({ type: "add", id, subject: activeSubject, name: "", isVisible: true });
  }

  function deletePublisher(publisher: PublisherSettingRow) {
    if (!canManage || publisherBaselineReloading || !ownerReady) return;
    appendOwner({ type: "publisher.delete", id: publisher.id });
  }

  async function saveRows() {
    if (!canManage || savingRef.current || !dirtyBaselinesReady || conflictPending) return;
    let frozen: ReturnType<typeof freezeTextbookSettingsSave>;
    try {
      frozen = freezeTextbookSettingsSave(draftRef.current);
    } catch (error) {
      setSaveError(getErrorMessage(error, "저장할 변경사항을 확인해 주세요."));
      return;
    }
    draftRef.current = frozen.state;
    setDraftState(frozen.state);
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const result = await saveTextbookSettingsDraft(frozen.request);
      if (!aliveRef.current || draftRef.current.actorScope !== actorScope) return;
      const next = acknowledgeTextbookSettingsSave(draftRef.current, result);
      draftRef.current = next;
      setDraftState(next);
      setConflictPending(false);
      setNotice(hasTextbookSettingsChanges(next) ? "제출한 변경을 저장했습니다. 저장 중 추가한 변경은 아직 남아 있습니다." : "변경사항을 저장했습니다.");
    } catch (error) {
      if (!aliveRef.current || draftRef.current.actorScope !== actorScope) return;
      const kind = classifyTextbookSettingsSaveError(error);
      if (kind === "unknown") {
        updateDraft(markTextbookSettingsSaveUnknown);
        setSaveError("저장 결과를 확인하지 못했습니다. 자동 재시도하지 않았습니다.");
      } else {
        updateDraft(rejectTextbookSettingsSave);
        if (kind === "conflict") {
          setConflictPending(true);
          setConflictOpen(true);
          setSaveError("다른 사용자가 먼저 설정을 변경했습니다. 초안을 유지하거나 버리고 최신 설정을 불러오세요.");
        } else {
          setSaveError(getErrorMessage(error, "교재 설정을 저장하지 못했습니다."));
        }
      }
    } finally {
      savingRef.current = false;
      if (aliveRef.current) setSaving(false);
    }
  }

  function confirmDiscardAndReload() {
    try {
      const next = discardTextbookSettingsDrafts(draftRef.current);
      draftRef.current = next;
      setDraftState(next);
      setConflictPending(false);
      setConflictOpen(false);
      setPublisherBaselineReloading(true);
      setSupplierBaselineReloading(true);
      setSubSubjectBaselineReloading(true);
      setSubSubjectAddPages({});
      setSaveError(null);
      setNotice(null);
      setReloadVersion((value) => value + 1);
    } catch (error) {
      setSaveError(getErrorMessage(error, "저장 결과를 먼저 확인해 주세요."));
    }
  }

  const toolbarPlaceholder = activeSection === "publishers" ? "출판사, 총판 검색" : activeSection === "suppliers" ? "총판, 연결 출판사 검색" : "세부과목 검색";

  return (
    <SettingsWorkspaceShell>
      <div className="flex flex-col gap-3">
        <Tabs value={activeSection} onValueChange={changeSection} className="min-w-0">
          <div className="sticky top-0 z-20 -mx-1 bg-background/95 px-1 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <TabsList className="grid h-auto w-full grid-cols-3 rounded-lg border bg-muted/35 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <TabsTrigger value="publishers" onClick={() => changeSection("publishers")} className="h-10 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><span>출판사</span><Badge variant="secondary" className="rounded-md px-1.5 text-[11px]">{formatQuantity(ownerCounts.publishers)}</Badge></TabsTrigger>
              <TabsTrigger value="suppliers" onClick={() => changeSection("suppliers")} className="h-10 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><span>총판</span><Badge variant="secondary" className="rounded-md px-1.5 text-[11px]">{formatQuantity(ownerCounts.suppliers)}</Badge></TabsTrigger>
              <TabsTrigger value="subSubjects" onClick={() => changeSection("subSubjects")} className="h-10 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><span>세부과목</span><Badge variant="secondary" className="rounded-md px-1.5 text-[11px]">{formatQuantity(visibleSubSubjectCount)}</Badge></TabsTrigger>
            </TabsList>

            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border/70 bg-background p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center lg:justify-between">
              <div className="relative min-w-0 flex-1" role="search" aria-label={toolbarPlaceholder}>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" value={query} onChange={(event) => setSearch(event.target.value)} placeholder={toolbarPlaceholder} aria-label={toolbarPlaceholder} autoComplete="off" enterKeyHint="search" className="h-10 w-full max-w-xl pl-9 pr-10" />
                {query ? <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground" onClick={() => setSearch("")} aria-label="검색어 지우기"><X className="size-4" /></Button> : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {activeSection === "publishers" ? <Button type="button" size="sm" className="h-10" onClick={addPublisher} disabled={editingDisabled || !ownerReady}><Plus className="mr-2 size-4" />출판사 추가</Button> : null}
                {activeSection === "suppliers" ? <Button type="button" size="sm" className="h-10" onClick={addSupplier} disabled={editingDisabled || !ownerReady}><Plus className="mr-2 size-4" />총판 추가</Button> : null}
                {activeSection === "subSubjects" ? <Button type="button" size="sm" className="h-10" onClick={addSubSubject} disabled={editingDisabled || !subSubjectsReady}><Plus className="mr-2 size-4" />세부과목 추가</Button> : null}
                <Button type="button" size="sm" variant={isDirty ? "default" : "secondary"} className="h-10 min-w-28" onClick={() => void saveRows()} disabled={!canManage || !isDirty || saving || !dirtyBaselinesReady || conflictPending}>{saving ? "저장 중" : saveUnknown ? "저장 결과 확인" : "변경 저장"}</Button>
              </div>
            </div>
          </div>

          {saveError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{saveError}</span>
                {conflictPending ? <Button type="button" variant="outline" size="sm" onClick={confirmDiscardAndReload}>초안 버리고 새로 불러오기</Button> : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}
          {activeBaselineReloading ? <Alert><AlertDescription>이 탭의 최신 설정을 불러오는 중입니다. 완료될 때까지 편집할 수 없습니다.</AlertDescription></Alert> : null}
          <PageError error={activeResource.error} onRetry={activeResource.retry} />

          <TabsContent value="publishers" className="mt-3 min-w-0">
            <div data-testid="textbook-publishers-mobile-list" className="grid gap-2 md:hidden">
              {pages.publishers.loading && publisherRows.length === 0 ? Array.from({ length: 10 }, (_, index) => <Skeleton key={index} className="h-56 w-full" />) : publisherRows.length === 0 ? <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">표시할 출판사가 없습니다.</div> : publisherRows.map((publisher) => (
                <section key={publisher.id} data-testid={`textbook-publisher-mobile-card-${publisher.id}`} className="rounded-lg border border-border/70 bg-background px-3 py-3">
                  <div className="mb-3 flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{publisher.name || "새 출판사"}</p><p className="text-xs text-muted-foreground">{subjectLabel(publisher.subjects)} · {formatQuantity(publisher.textbookCount)}종</p></div><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" disabled={editingDisabled} onClick={() => deletePublisher(publisher)} aria-label="출판사 삭제"><Trash2 className="size-4" /></Button></div>
                  <div className="grid gap-2"><PublisherSubjectSelect publisher={publisher} disabled={editingDisabled} onChange={(subjects) => setPublisherPatch(publisher.id, { subjects })} /><Input data-focus-id={publisher.id} data-focus-mode="mobile" value={publisher.name} onChange={(event) => setPublisherPatch(publisher.id, { name: event.target.value })} className="h-9" placeholder="출판사명" disabled={editingDisabled} /><PublisherSupplierPicker anchor={`mobile:${publisher.id}`} publisher={publisher} pages={pages} pickerAnchor={pickerAnchor} disabled={editingDisabled} onPickerAnchorChange={setPickerAnchor} onSupplierIdsChange={(supplierIds) => setPublisherPatch(publisher.id, { supplierIds })} /></div>
                </section>
              ))}
            </div>
            <div className="hidden md:block"><SettingsTableFrame><Table className="min-w-[900px] table-fixed"><caption className="sr-only">출판사별 총판 설정</caption><TableHeader><TableRow><TableHead className={`w-[18%] ${settingsTableHeadClass}`}>과목</TableHead><TableHead className={`w-[32%] ${settingsTableHeadClass}`}>출판사</TableHead><TableHead className={`w-[10%] text-center ${settingsTableHeadClass}`}>교재</TableHead><TableHead className={`w-[28%] ${settingsTableHeadClass}`}>총판</TableHead><TableHead className={`sticky right-0 w-[12%] bg-muted text-right ${settingsTableHeadClass}`}>작업</TableHead></TableRow></TableHeader><TableBody>{pages.publishers.loading && publisherRows.length === 0 ? Array.from({ length: 10 }, (_, index) => <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-9 w-full" /></TableCell></TableRow>) : publisherRows.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">표시할 출판사가 없습니다.</TableCell></TableRow> : publisherRows.map((publisher) => <TableRow key={publisher.id} data-testid={`textbook-publisher-desktop-row-${publisher.id}`}><TableCell className={settingsTableCellClass}><PublisherSubjectSelect publisher={publisher} disabled={editingDisabled} onChange={(subjects) => setPublisherPatch(publisher.id, { subjects })} /></TableCell><TableCell className={settingsTableCellClass}><Input data-focus-id={publisher.id} data-focus-mode="desktop" value={publisher.name} onChange={(event) => setPublisherPatch(publisher.id, { name: event.target.value })} className="h-9" placeholder="출판사명" disabled={editingDisabled} /></TableCell><TableCell className={`${settingsTableCellClass} text-center`}><Badge variant="secondary">{formatQuantity(publisher.textbookCount)}종</Badge></TableCell><TableCell className={settingsTableCellClass}><PublisherSupplierPicker anchor={`desktop:${publisher.id}`} publisher={publisher} pages={pages} pickerAnchor={pickerAnchor} disabled={editingDisabled} onPickerAnchorChange={setPickerAnchor} onSupplierIdsChange={(supplierIds) => setPublisherPatch(publisher.id, { supplierIds })} /></TableCell><TableCell className={`${settingsTableCellClass} sticky right-0 bg-background text-right`}><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" disabled={editingDisabled} onClick={() => appendOwner({ type: "publisher.delete", id: publisher.id })} aria-label="출판사 삭제"><Trash2 className="size-4" /></Button></TableCell></TableRow>)}</TableBody></Table><PageFooter resource={pages.publishers} label="출판사 목록 페이지 탐색" /></SettingsTableFrame></div>
            <div className="mt-3 md:hidden"><PageFooter resource={pages.publishers} label="출판사 목록 페이지 탐색" /></div>
          </TabsContent>

          <TabsContent value="suppliers" className="mt-3 min-w-0">
            <div data-testid="textbook-suppliers-mobile-list" className="grid gap-2 md:hidden">
              {pages.suppliers.loading && supplierRows.length === 0 ? Array.from({ length: 10 }, (_, index) => <Skeleton key={index} className="h-52 w-full" />) : supplierRows.length === 0 ? <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">표시할 총판이 없습니다.</div> : supplierRows.map((supplier) => { const hidden = Math.max(0, supplier.linkedPublisherCount - supplier.linkedPublisherNames.length); return <section key={supplier.id} data-testid={`textbook-supplier-mobile-card-${supplier.id}`} className="rounded-lg border border-border/70 bg-background px-3 py-3"><div className="mb-3 flex justify-between gap-3"><div><p className="text-sm font-semibold">{supplier.name || "새 총판"}</p><p className="text-xs text-muted-foreground">연결 출판사 {supplier.linkedPublisherCount}개</p></div><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" disabled={editingDisabled} onClick={() => appendOwner({ type: "supplier.delete", id: supplier.id })} aria-label="총판 삭제"><Trash2 className="size-4" /></Button></div><div className="grid gap-2"><Input data-focus-id={supplier.id} data-focus-mode="mobile" value={supplier.name} onChange={(event) => setSupplierPatch(supplier.id, { name: event.target.value })} placeholder="총판명" disabled={editingDisabled} /><Input value={supplier.contact} onChange={(event) => setSupplierPatch(supplier.id, { contact: event.target.value })} placeholder="연락처" disabled={editingDisabled} /><Input value={supplier.memo} onChange={(event) => setSupplierPatch(supplier.id, { memo: event.target.value })} placeholder="메모" disabled={editingDisabled} /></div><div className="mt-3 flex flex-wrap gap-1">{supplier.linkedPublisherNames.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}{hidden > 0 ? <Badge variant="outline">+{hidden}</Badge> : null}</div></section>; })}
            </div>
            <div className="hidden md:block"><SettingsTableFrame><Table className="min-w-[960px] table-fixed"><caption className="sr-only">교재 총판 목록</caption><TableHeader><TableRow><TableHead className={`w-[22%] ${settingsTableHeadClass}`}>총판</TableHead><TableHead className={`w-[18%] ${settingsTableHeadClass}`}>연락처</TableHead><TableHead className={`w-[20%] ${settingsTableHeadClass}`}>메모</TableHead><TableHead className={`w-[28%] ${settingsTableHeadClass}`}>연결 출판사</TableHead><TableHead className={`sticky right-0 w-[12%] bg-muted text-right ${settingsTableHeadClass}`}>작업</TableHead></TableRow></TableHeader><TableBody>{pages.suppliers.loading && supplierRows.length === 0 ? Array.from({ length: 10 }, (_, index) => <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-9 w-full" /></TableCell></TableRow>) : supplierRows.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">표시할 총판이 없습니다.</TableCell></TableRow> : supplierRows.map((supplier) => { const hidden = Math.max(0, supplier.linkedPublisherCount - supplier.linkedPublisherNames.length); return <TableRow key={supplier.id} data-testid={`textbook-supplier-desktop-row-${supplier.id}`}><TableCell className={settingsTableCellClass}><Input data-focus-id={supplier.id} data-focus-mode="desktop" value={supplier.name} onChange={(event) => setSupplierPatch(supplier.id, { name: event.target.value })} placeholder="총판명" disabled={editingDisabled} /></TableCell><TableCell className={settingsTableCellClass}><Input value={supplier.contact} onChange={(event) => setSupplierPatch(supplier.id, { contact: event.target.value })} placeholder="연락처" disabled={editingDisabled} /></TableCell><TableCell className={settingsTableCellClass}><Input value={supplier.memo} onChange={(event) => setSupplierPatch(supplier.id, { memo: event.target.value })} placeholder="메모" disabled={editingDisabled} /></TableCell><TableCell className={settingsTableCellClass}><div className="flex flex-wrap gap-1">{supplier.linkedPublisherNames.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}{hidden > 0 ? <Badge variant="outline">+{hidden}</Badge> : null}</div></TableCell><TableCell className={`${settingsTableCellClass} sticky right-0 bg-background text-right`}><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" disabled={editingDisabled} onClick={() => appendOwner({ type: "supplier.delete", id: supplier.id })} aria-label="총판 삭제"><Trash2 className="size-4" /></Button></TableCell></TableRow>; })}</TableBody></Table><PageFooter resource={pages.suppliers} label="총판 목록 페이지 탐색" /></SettingsTableFrame></div>
            <div className="mt-3 md:hidden"><PageFooter resource={pages.suppliers} label="총판 목록 페이지 탐색" /></div>
          </TabsContent>

          <TabsContent value="subSubjects" className="mt-3 min-w-0">
            <SettingsTableFrame>
              <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-3" aria-label="세부과목 과목 선택">{SUBJECT_OPTIONS.map((option) => <Button key={option.value} type="button" size="sm" variant={activeSubject === option.value ? "default" : "outline"} aria-pressed={activeSubject === option.value} onClick={() => { pages.subSubjects.goToPage(1); setActiveSubject(option.value as TextbookSettingsSubject); }}>{option.label}</Button>)}</div>
              <div data-testid="textbook-subsubjects-mobile-list" className="grid gap-2 p-3 md:hidden">{pages.subSubjects.loading && subSubjectRows.length === 0 ? Array.from({ length: 10 }, (_, index) => <Skeleton key={index} className="h-32 w-full" />) : subSubjectRows.length === 0 ? <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">표시할 세부과목이 없습니다.</div> : subSubjectRows.map((row) => <section key={row.id} data-testid={`textbook-subsubject-mobile-card-${row.id}`} className="rounded-lg border border-border/70 bg-background px-3 py-3"><div className="mb-3 flex items-center justify-between gap-2"><span className="text-sm font-semibold">{row.name || "새 세부과목"}</span><label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={row.isVisible} onCheckedChange={(value) => setSubSubjectPatch(row.id, { isVisible: value === true })} disabled={editingDisabled} />표시</label></div><Input data-focus-id={row.id} data-focus-mode="mobile" value={row.name} onChange={(event) => setSubSubjectPatch(row.id, { name: event.target.value })} placeholder="세부과목명" disabled={editingDisabled} /><div className="mt-2 flex justify-end gap-1"><Button type="button" variant="outline" size="icon" className="size-8" onClick={() => appendSubSubject({ type: "move", id: row.id, direction: "up" })} disabled={editingDisabled || !row.canMoveUp} aria-label={`${row.name || "세부과목"} 위로 이동`}><ArrowUp className="size-4" /></Button><Button type="button" variant="outline" size="icon" className="size-8" onClick={() => appendSubSubject({ type: "move", id: row.id, direction: "down" })} disabled={editingDisabled || !row.canMoveDown} aria-label={`${row.name || "세부과목"} 아래로 이동`}><ArrowDown className="size-4" /></Button><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => appendSubSubject({ type: "delete", id: row.id })} disabled={editingDisabled} aria-label="세부과목 삭제"><Trash2 className="size-4" /></Button></div></section>)}</div>
              <div className="hidden md:block"><Table className="min-w-[720px] table-fixed"><caption className="sr-only">교재 세부과목 설정</caption><TableHeader><TableRow><TableHead className={`w-[62%] ${settingsTableHeadClass}`}>세부과목</TableHead><TableHead className={`w-[14%] text-center ${settingsTableHeadClass}`}>순서</TableHead><TableHead className={`w-[12%] text-center ${settingsTableHeadClass}`}>표시</TableHead><TableHead className={`sticky right-0 w-[12%] bg-muted text-right ${settingsTableHeadClass}`}>작업</TableHead></TableRow></TableHeader><TableBody>{pages.subSubjects.loading && subSubjectRows.length === 0 ? Array.from({ length: 10 }, (_, index) => <TableRow key={index}><TableCell colSpan={4}><Skeleton className="h-9 w-full" /></TableCell></TableRow>) : subSubjectRows.length === 0 ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">표시할 세부과목이 없습니다.</TableCell></TableRow> : subSubjectRows.map((row) => <TableRow key={row.id} data-testid={`textbook-subsubject-desktop-row-${row.id}`}><TableCell className={settingsTableCellClass}><Input data-focus-id={row.id} data-focus-mode="desktop" value={row.name} onChange={(event) => setSubSubjectPatch(row.id, { name: event.target.value })} placeholder="세부과목명" disabled={editingDisabled} /></TableCell><TableCell className={`${settingsTableCellClass} text-center`}><div className="flex justify-center gap-1"><Button type="button" variant="outline" size="icon" className="size-8" onClick={() => appendSubSubject({ type: "move", id: row.id, direction: "up" })} disabled={editingDisabled || !row.canMoveUp} aria-label={`${row.name || "세부과목"} 위로 이동`}><ArrowUp className="size-4" /></Button><Button type="button" variant="outline" size="icon" className="size-8" onClick={() => appendSubSubject({ type: "move", id: row.id, direction: "down" })} disabled={editingDisabled || !row.canMoveDown} aria-label={`${row.name || "세부과목"} 아래로 이동`}><ArrowDown className="size-4" /></Button></div></TableCell><TableCell className={`${settingsTableCellClass} text-center`}><Checkbox checked={row.isVisible} onCheckedChange={(value) => setSubSubjectPatch(row.id, { isVisible: value === true })} disabled={editingDisabled} aria-label={`${row.name || "세부과목"} 표시`} /></TableCell><TableCell className={`${settingsTableCellClass} sticky right-0 bg-background text-right`}><Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => appendSubSubject({ type: "delete", id: row.id })} disabled={editingDisabled} aria-label="세부과목 삭제"><Trash2 className="size-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>
              <PageFooter resource={pages.subSubjects} label="세부과목 목록 페이지 탐색" />
            </SettingsTableFrame>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}><DialogContent><DialogHeader><DialogTitle>최신 설정을 다시 불러올까요?</DialogTitle><DialogDescription>현재 초안을 버리고 다른 사용자가 저장한 최신 설정을 불러옵니다. 취소하면 초안은 그대로 유지됩니다.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConflictOpen(false)}>취소</Button><Button type="button" variant="destructive" onClick={confirmDiscardAndReload}>초안 버리고 새로 불러오기</Button></DialogFooter></DialogContent></Dialog>
    </SettingsWorkspaceShell>
  );
}
