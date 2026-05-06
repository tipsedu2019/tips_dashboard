"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createId } from "@/features/management/management-service.js";
import {
  SettingsTableFrame,
  SettingsWorkspaceShell,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "@/features/management/settings-master-layout";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import {
  type TextbookSubSubjectSettingRecord,
  mergeTextbookSubSubjectSettings,
} from "./textbook-taxonomy";

type Row = Record<string, unknown>;

type PublisherRecord = {
  id: string;
  name: string;
  subjects: string[];
  supplierIds: string[];
  sourceNotionUrl: string;
  isNew?: boolean;
};

type SupplierRecord = {
  id: string;
  name: string;
  contact: string;
  memo: string;
  isNew?: boolean;
};

type SettingsSection = "publishers" | "suppliers" | "subSubjects";

const SUBJECT_OPTIONS = [
  { value: "english", label: "영어" },
  { value: "math", label: "수학" },
  { value: "other", label: "기타" },
];

const SUBJECT_LABELS: Record<string, string> = Object.fromEntries(
  SUBJECT_OPTIONS.map((option) => [option.value, option.label]),
);

function text(value: unknown) {
  return String(value || "").trim();
}

function normalizeList(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean))];
}

function toPublisherRecord(row: Row): PublisherRecord {
  return {
    id: text(row.id) || createId(),
    name: text(row.name),
    subjects: normalizeList(row.subjects),
    supplierIds: [],
    sourceNotionUrl: text(row.source_notion_url || row.sourceNotionUrl),
  };
}

function toSupplierRecord(row: Row): SupplierRecord {
  return {
    id: text(row.id) || createId(),
    name: text(row.name),
    contact: text(row.contact),
    memo: text(row.memo),
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const maybeError = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [maybeError.message, maybeError.details, maybeError.hint]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return fallback;
}

function isMissingOptionalTableError(error: unknown) {
  const code = text((error as { code?: unknown })?.code);
  const message = text((error as { message?: unknown })?.message).toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function subjectLabel(subjects: string[]) {
  const labels = normalizeList(subjects).map((subject) => SUBJECT_LABELS[subject] || subject);
  return labels.length > 0 ? labels.join(", ") : "미설정";
}

function formatQuantity(value: unknown) {
  const count = Number(value || 0);
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(count) ? count : 0);
}

function sortSubSubjectRows(rows: TextbookSubSubjectSettingRecord[]) {
  return [...rows].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko", { numeric: true }));
}

function createPublisher(): PublisherRecord {
  return {
    id: createId(),
    name: "",
    subjects: [],
    supplierIds: [],
    sourceNotionUrl: "",
    isNew: true,
  };
}

function createSupplier(): SupplierRecord {
  return {
    id: createId(),
    name: "",
    contact: "",
    memo: "",
    isNew: true,
  };
}

function createSubSubject(subject: string, sortOrder: number): TextbookSubSubjectSettingRecord {
  return {
    id: createId(),
    subject,
    name: "",
    sortOrder,
    isVisible: true,
    isNew: true,
  };
}

function PublisherSubjectSelect({
  publisher,
  onSubjectChange,
}: {
  publisher: PublisherRecord;
  onSubjectChange: (subject: string, checked: boolean) => void;
}) {
  const selectedSubjects = normalizeList(publisher.subjects);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between overflow-hidden px-3">
          <span className={cn("truncate", selectedSubjects.length === 0 && "text-muted-foreground")}>
            {subjectLabel(selectedSubjects)}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="grid gap-1">
          {SUBJECT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/70"
            >
              <Checkbox
                checked={selectedSubjects.includes(option.value)}
                onCheckedChange={(checked) => onSubjectChange(option.value, checked === true)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SubSubjectSettingsPanel({
  rows,
  activeSubject,
  searchQuery,
  saving,
  onActiveSubjectChange,
  onNameChange,
  onVisibleChange,
  onMove,
  onDelete,
}: {
  rows: TextbookSubSubjectSettingRecord[];
  activeSubject: string;
  searchQuery: string;
  saving: boolean;
  onActiveSubjectChange: (subject: string) => void;
  onNameChange: (id: string, value: string) => void;
  onVisibleChange: (id: string, value: boolean) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDelete: (row: TextbookSubSubjectSettingRecord) => void;
}) {
  const safeQuery = searchQuery.trim().toLowerCase();
  const activeRows = sortSubSubjectRows(rows.filter((row) => row.subject === activeSubject)).filter((row) =>
    safeQuery ? row.name.toLowerCase().includes(safeQuery) : true,
  );

  return (
    <SettingsTableFrame>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="세부과목 과목 선택">
          {SUBJECT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={activeSubject === option.value ? "default" : "outline"}
              className="h-8 rounded-md"
              aria-pressed={activeSubject === option.value}
              onClick={() => onActiveSubjectChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <Table className="min-w-[720px] table-fixed">
        <caption className="sr-only">교재 세부과목 설정</caption>
        <TableHeader>
          <TableRow>
            <TableHead className={`w-[62%] ${settingsTableHeadClass}`}>세부과목</TableHead>
            <TableHead className={`w-[14%] text-center ${settingsTableHeadClass}`}>순서</TableHead>
            <TableHead className={`w-[12%] text-center ${settingsTableHeadClass}`}>표시</TableHead>
            <TableHead className={`sticky right-0 z-10 w-[12%] bg-muted text-right ${settingsTableHeadClass}`}>작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                표시할 세부과목이 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            activeRows.map((row, index) => (
              <TableRow key={row.id}>
                <TableCell className={settingsTableCellClass}>
                  <Input
                    value={row.name}
                    onChange={(event) => onNameChange(row.id, event.target.value)}
                    className="h-9"
                    placeholder="세부과목명"
                    aria-label={`${SUBJECT_LABELS[row.subject] || row.subject} 세부과목명`}
                  />
                </TableCell>
                <TableCell className={`${settingsTableCellClass} text-center`}>
                  <div className="flex justify-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => onMove(row.id, "up")}
                      disabled={saving || index === 0}
                      aria-label={`${row.name || "세부과목"} 위로 이동`}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => onMove(row.id, "down")}
                      disabled={saving || index === activeRows.length - 1}
                      aria-label={`${row.name || "세부과목"} 아래로 이동`}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className={`${settingsTableCellClass} text-center`}>
                  <Checkbox
                    checked={row.isVisible}
                    onCheckedChange={(checked) => onVisibleChange(row.id, checked === true)}
                    aria-label={`${row.name || "세부과목"} 표시`}
                  />
                </TableCell>
                <TableCell className={`${settingsTableCellClass} sticky right-0 bg-background`}>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(row)}
                      disabled={saving}
                      aria-label="세부과목 삭제"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </SettingsTableFrame>
  );
}

export function TextbookSupplierSettingsWorkspace() {
  const [publishers, setPublishers] = useState<PublisherRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [subSubjects, setSubSubjects] = useState<TextbookSubSubjectSettingRecord[]>(() =>
    mergeTextbookSubSubjectSettings([]),
  );
  const [activeSubSubject, setActiveSubSubject] = useState("english");
  const [activeSection, setActiveSection] = useState<SettingsSection>("publishers");
  const [publisherTextbookCounts, setPublisherTextbookCounts] = useState<Record<string, number>>({});
  const [deletedPublisherIds, setDeletedPublisherIds] = useState<string[]>([]);
  const [deletedSupplierIds, setDeletedSupplierIds] = useState<string[]>([]);
  const [deletedSubSubjectIds, setDeletedSubSubjectIds] = useState<string[]>([]);
  const [subSubjectSettingsLoaded, setSubSubjectSettingsLoaded] = useState(false);
  const [subSubjectsTouched, setSubSubjectsTouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadRows = useCallback(async () => {
    if (!supabase) {
      setError("Supabase 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [publisherResult, supplierResult, linkResult, textbookResult] = await Promise.all([
        supabase.from("textbook_publishers").select("*").order("name", { ascending: true }),
        supabase.from("textbook_suppliers").select("*").order("name", { ascending: true }),
        supabase.from("textbook_publisher_supplier_links").select("*"),
        supabase.from("textbooks").select("id, publisher_id, publisher"),
      ]);

      if (publisherResult.error) throw publisherResult.error;
      if (supplierResult.error) throw supplierResult.error;
      if (linkResult.error) throw linkResult.error;
      if (textbookResult.error) throw textbookResult.error;

      const linksByPublisher = new Map<string, string[]>();
      for (const link of (linkResult.data || []) as Row[]) {
        const publisherId = text(link.publisher_id);
        const supplierId = text(link.supplier_id);
        if (!publisherId || !supplierId) continue;
        linksByPublisher.set(publisherId, [...(linksByPublisher.get(publisherId) || []), supplierId]);
      }

      const nextPublishers = ((publisherResult.data || []) as Row[]).map((row) => {
        const publisher = toPublisherRecord(row);
        return { ...publisher, supplierIds: linksByPublisher.get(publisher.id) || [] };
      });

      const publisherIdByName = new Map(nextPublishers.map((publisher) => [publisher.name, publisher.id]));
      const nextPublisherTextbookCounts: Record<string, number> = {};
      for (const textbook of (textbookResult.data || []) as Row[]) {
        const publisherId = text(textbook.publisher_id) || publisherIdByName.get(text(textbook.publisher));
        if (!publisherId) continue;
        nextPublisherTextbookCounts[publisherId] = (nextPublisherTextbookCounts[publisherId] || 0) + 1;
      }

      setPublishers(nextPublishers);
      setPublisherTextbookCounts(nextPublisherTextbookCounts);
      setSuppliers(((supplierResult.data || []) as Row[]).map(toSupplierRecord));
      setDeletedPublisherIds([]);
      setDeletedSupplierIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "교재 설정을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSubSubjectRows = useCallback(async () => {
    if (!supabase || subSubjectSettingsLoaded) {
      return;
    }

    const { data, error: subSubjectError } = await supabase
      .from("textbook_sub_subject_settings")
      .select("*")
      .order("subject", { ascending: true })
      .order("sort_order", { ascending: true });

    if (subSubjectError && !isMissingOptionalTableError(subSubjectError)) {
      setError(getErrorMessage(subSubjectError, "세부과목 설정을 불러오지 못했습니다."));
      return;
    }

    setSubSubjects(mergeTextbookSubSubjectSettings((subSubjectError ? [] : data || []) as Row[]));
    setDeletedSubSubjectIds([]);
    setSubSubjectsTouched(false);
    setSubSubjectSettingsLoaded(true);
  }, [subSubjectSettingsLoaded]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (activeSection === "subSubjects") {
      void loadSubSubjectRows();
    }
  }, [activeSection, loadSubSubjectRows]);

  const suppliersById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);

  const publisherLinkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const publisher of publishers) {
      for (const supplierId of publisher.supplierIds) {
        counts.set(supplierId, (counts.get(supplierId) || 0) + 1);
      }
    }
    return counts;
  }, [publishers]);

  const publisherNamesBySupplierId = useMemo(() => {
    const namesBySupplier = new Map<string, string[]>();
    for (const publisher of publishers) {
      for (const supplierId of publisher.supplierIds) {
        const names = namesBySupplier.get(supplierId) || [];
        names.push(publisher.name);
        namesBySupplier.set(supplierId, names);
      }
    }

    for (const names of namesBySupplier.values()) {
      names.sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
    }

    return namesBySupplier;
  }, [publishers]);

  const filteredPublishers = useMemo(() => {
    const safeQuery = query.trim().toLowerCase();
    if (!safeQuery) return publishers;
    return publishers.filter((publisher) => {
      const supplierNames = publisher.supplierIds
        .map((supplierId) => suppliersById.get(supplierId)?.name || "")
        .join(" ");
      return `${publisher.name} ${subjectLabel(publisher.subjects)} ${supplierNames}`.toLowerCase().includes(safeQuery);
    });
  }, [publishers, query, suppliersById]);

  const filteredSuppliers = useMemo(() => {
    const safeQuery = query.trim().toLowerCase();
    if (!safeQuery) return suppliers;
    return suppliers.filter((supplier) => {
      const linkedPublishers = publishers
        .filter((publisher) => publisher.supplierIds.includes(supplier.id))
        .map((publisher) => publisher.name)
        .join(" ");
      return `${supplier.name} ${linkedPublishers}`.toLowerCase().includes(safeQuery);
    });
  }, [publishers, query, suppliers]);

  function setPublisherField(id: string, field: keyof PublisherRecord, value: string | string[]) {
    setPublishers((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  }

  function setSupplierField(id: string, field: keyof SupplierRecord, value: string) {
    setSuppliers((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  }

  function setSubSubjectField(id: string, patch: Partial<TextbookSubSubjectSettingRecord>) {
    setSubSubjects((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setSubSubjectsTouched(true);
    setIsDirty(true);
  }

  function addSubSubject() {
    const activeRows = sortSubSubjectRows(subSubjects.filter((row) => row.subject === activeSubSubject));
    const maxSortOrder = activeRows.reduce((max, row) => Math.max(max, row.sortOrder), 0);
    setSubSubjects((current) => [createSubSubject(activeSubSubject, maxSortOrder + 10), ...current]);
    setSubSubjectsTouched(true);
    setIsDirty(true);
  }

  function moveSubSubject(id: string, direction: "up" | "down") {
    const activeRows = sortSubSubjectRows(subSubjects.filter((row) => row.subject === activeSubSubject));
    const currentIndex = activeRows.findIndex((row) => row.id === id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeRows.length) {
      return;
    }

    const reorderedRows = [...activeRows];
    [reorderedRows[currentIndex], reorderedRows[targetIndex]] = [reorderedRows[targetIndex], reorderedRows[currentIndex]];
    const nextSortOrders = new Map(reorderedRows.map((row, index) => [row.id, (index + 1) * 10]));

    setSubSubjects((current) =>
      current.map((row) => {
        const sortOrder = nextSortOrders.get(row.id);
        return sortOrder === undefined ? row : { ...row, sortOrder };
      }),
    );
    setSubSubjectsTouched(true);
    setIsDirty(true);
  }

  function togglePublisherSubject(publisherId: string, subject: string, checked: boolean) {
    setPublishers((current) =>
      current.map((publisher) => {
        if (publisher.id !== publisherId) return publisher;
        const subjects = normalizeList(publisher.subjects);
        return {
          ...publisher,
          subjects: checked ? [...new Set([...subjects, subject])] : subjects.filter((item) => item !== subject),
        };
      }),
    );
    setIsDirty(true);
  }

  function togglePublisherSupplier(publisherId: string, supplierId: string, checked: boolean) {
    setPublishers((current) =>
      current.map((publisher) => {
        if (publisher.id !== publisherId) return publisher;
        const currentIds = normalizeList(publisher.supplierIds);
        return {
          ...publisher,
          supplierIds: checked ? [...new Set([...currentIds, supplierId])] : currentIds.filter((id) => id !== supplierId),
        };
      }),
    );
    setIsDirty(true);
  }

  function handleDeletePublisher(publisher: PublisherRecord) {
    if (!publisher.isNew) {
      setDeletedPublisherIds((current) => (current.includes(publisher.id) ? current : [...current, publisher.id]));
    }
    setPublishers((current) => current.filter((row) => row.id !== publisher.id));
    setIsDirty(true);
  }

  function handleDeleteSupplier(supplier: SupplierRecord) {
    if (!supplier.isNew) {
      setDeletedSupplierIds((current) => (current.includes(supplier.id) ? current : [...current, supplier.id]));
    }
    setSuppliers((current) => current.filter((row) => row.id !== supplier.id));
    setPublishers((current) =>
      current.map((publisher) => ({
        ...publisher,
        supplierIds: publisher.supplierIds.filter((id) => id !== supplier.id),
      })),
    );
    setIsDirty(true);
  }

  function handleDeleteSubSubject(row: TextbookSubSubjectSettingRecord) {
    if (!row.isNew) {
      setDeletedSubSubjectIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setSubSubjects((current) => current.filter((item) => item.id !== row.id));
    setSubSubjectsTouched(true);
    setIsDirty(true);
  }

  function getPublisherTextbookCount(publisher: PublisherRecord) {
    return publisherTextbookCounts[publisher.id] || 0;
  }

  async function saveRows() {
    if (!supabase) {
      setError("Supabase 연결 설정을 확인해 주세요.");
      return;
    }

    const nextPublishers = publishers.map((publisher) => ({ ...publisher, name: publisher.name.trim() }));
    const nextSuppliers = suppliers.map((supplier) => ({ ...supplier, name: supplier.name.trim() }));
    const nextSubSubjects = subSubjects
      .map((row, index) => ({
        ...row,
        name: row.name.trim(),
        sortOrder: row.sortOrder || (index + 1) * 10,
      }))
      .filter((row) => row.name);

    if (nextPublishers.some((publisher) => !publisher.name)) {
      setError("출판사명이 비어 있습니다.");
      return;
    }
    if (nextSuppliers.some((supplier) => !supplier.name)) {
      setError("총판명이 비어 있습니다.");
      return;
    }

    const shouldPersistSubSubjects = subSubjectsTouched || deletedSubSubjectIds.length > 0;
    if (shouldPersistSubSubjects) {
      const duplicateSubSubject = nextSubSubjects.find((row, index) =>
        nextSubSubjects.findIndex((item) => item.subject === row.subject && item.name === row.name) !== index,
      );
      if (duplicateSubSubject) {
        setError(`${SUBJECT_LABELS[duplicateSubSubject.subject] || duplicateSubSubject.subject} 세부과목이 중복되었습니다.`);
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      if (deletedPublisherIds.length > 0) {
        const { error: deletePublisherError } = await supabase.from("textbook_publishers").delete().in("id", deletedPublisherIds);
        if (deletePublisherError) throw deletePublisherError;
      }

      if (deletedSupplierIds.length > 0) {
        const { error: deleteSupplierError } = await supabase.from("textbook_suppliers").delete().in("id", deletedSupplierIds);
        if (deleteSupplierError) throw deleteSupplierError;
      }

      if (shouldPersistSubSubjects && deletedSubSubjectIds.length > 0) {
        const { error: deleteSubSubjectError } = await supabase
          .from("textbook_sub_subject_settings")
          .delete()
          .in("id", deletedSubSubjectIds);
        if (deleteSubSubjectError) throw deleteSubSubjectError;
      }

      if (shouldPersistSubSubjects && nextSubSubjects.length > 0) {
        const { error: subSubjectError } = await supabase.from("textbook_sub_subject_settings").upsert(
          nextSubSubjects.map((row, index) => ({
            id: row.isNew ? undefined : row.id,
            subject: row.subject,
            name: row.name,
            sort_order: row.sortOrder || (index + 1) * 10,
            is_visible: row.isVisible,
          })),
        );
        if (subSubjectError) throw subSubjectError;
      }

      if (nextSuppliers.length > 0) {
        const { error: supplierError } = await supabase.from("textbook_suppliers").upsert(
          nextSuppliers.map((supplier) => ({
            id: supplier.id,
            name: supplier.name,
            contact: supplier.contact.trim(),
            memo: supplier.memo.trim(),
          })),
        );
        if (supplierError) throw supplierError;
      }

      if (nextPublishers.length > 0) {
        const { error: publisherError } = await supabase.from("textbook_publishers").upsert(
          nextPublishers.map((publisher) => ({
            id: publisher.id,
            name: publisher.name,
            subjects: normalizeList(publisher.subjects),
            source_notion_url: publisher.sourceNotionUrl || null,
          })),
        );
        if (publisherError) throw publisherError;
      }

      const publisherIds = nextPublishers.map((publisher) => publisher.id);
      if (publisherIds.length > 0) {
        const { error: resetLinkError } = await supabase
          .from("textbook_publisher_supplier_links")
          .delete()
          .in("publisher_id", publisherIds);
        if (resetLinkError) throw resetLinkError;

        const nextLinks = nextPublishers.flatMap((publisher) =>
          normalizeList(publisher.supplierIds).map((supplierId, index) => ({
            publisher_id: publisher.id,
            supplier_id: supplierId,
            priority: index + 1,
            is_primary: index === 0,
          })),
        );

        if (nextLinks.length > 0) {
          const { error: linkError } = await supabase.from("textbook_publisher_supplier_links").insert(nextLinks);
          if (linkError) throw linkError;
        }
      }

      setSubSubjectsTouched(false);
      await loadRows();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "교재 설정을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  const toolbarPlaceholder =
    activeSection === "publishers"
      ? "출판사, 총판 검색"
      : activeSection === "suppliers"
        ? "총판, 연결 출판사 검색"
        : "세부과목 검색";

  function handleSectionChange(value: string) {
    setActiveSection(value as SettingsSection);
    setQuery("");
  }

  const isSearchActive = query.trim().length > 0;

  return (
    <SettingsWorkspaceShell>
      <div className="flex flex-col gap-3">
        <Tabs value={activeSection} onValueChange={handleSectionChange} className="min-w-0">
          <div className="sticky top-0 z-20 -mx-1 bg-background/95 px-1 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-lg border bg-muted/35 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <TabsTrigger
              value="publishers"
              onClick={() => handleSectionChange("publishers")}
              className="h-10 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none data-[state=active]:[&_span[data-slot=badge]]:bg-primary-foreground/20 data-[state=active]:[&_span[data-slot=badge]]:text-primary-foreground"
            >
              <span>출판사</span>
              <Badge variant="secondary" className="rounded-md px-1.5 text-[11px]">
                {formatQuantity(publishers.length)}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="suppliers"
              onClick={() => handleSectionChange("suppliers")}
              className="h-10 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none data-[state=active]:[&_span[data-slot=badge]]:bg-primary-foreground/20 data-[state=active]:[&_span[data-slot=badge]]:text-primary-foreground"
            >
              <span>총판</span>
              <Badge variant="secondary" className="rounded-md px-1.5 text-[11px]">
                {formatQuantity(suppliers.length)}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="subSubjects"
              onClick={() => handleSectionChange("subSubjects")}
              className="h-10 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none data-[state=active]:[&_span[data-slot=badge]]:bg-primary-foreground/20 data-[state=active]:[&_span[data-slot=badge]]:text-primary-foreground"
            >
              <span>세부과목</span>
              <Badge variant="secondary" className="rounded-md px-1.5 text-[11px]">
                {formatQuantity(subSubjects.filter((row) => row.isVisible).length)}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border/70 bg-background p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={toolbarPlaceholder}
              className="h-10 w-full max-w-xl pl-9 pr-10"
            />
            {isSearchActive ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground"
                onClick={() => setQuery("")}
                aria-label="검색어 지우기"
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeSection === "publishers" ? (
              <Button
                type="button"
                size="sm"
                className="h-10"
                onClick={() => {
                  setPublishers((current) => [createPublisher(), ...current]);
                  setIsDirty(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                출판사 추가
              </Button>
            ) : null}
            {activeSection === "suppliers" ? (
              <Button
                type="button"
                size="sm"
                className="h-10"
                onClick={() => {
                  setSuppliers((current) => [createSupplier(), ...current]);
                  setIsDirty(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                총판 추가
              </Button>
            ) : null}
            {activeSection === "subSubjects" ? (
              <Button type="button" size="sm" className="h-10" onClick={addSubSubject} disabled={saving}>
                <Plus className="mr-2 size-4" />
                세부과목 추가
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant={isDirty ? "default" : "secondary"}
              className="h-10 min-w-28"
              onClick={() => void saveRows()}
              disabled={!isDirty || saving}
            >
              {saving ? "저장 중" : "변경 저장"}
            </Button>
          </div>
          </div>
          </div>

          {error ? (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

            <TabsContent value="publishers" className="mt-3 min-w-0">
              <SettingsTableFrame>
                <Table className="min-w-[900px] table-fixed">
                  <caption className="sr-only">출판사별 총판 설정</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={`w-[16%] ${settingsTableHeadClass}`}>과목</TableHead>
                      <TableHead className={`w-[34%] ${settingsTableHeadClass}`}>출판사</TableHead>
                      <TableHead className={`w-[10%] text-center ${settingsTableHeadClass}`}>교재</TableHead>
                      <TableHead className={`w-[28%] ${settingsTableHeadClass}`}>총판</TableHead>
                      <TableHead className={`sticky right-0 z-10 w-[12%] bg-muted text-right ${settingsTableHeadClass}`}>작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, index) => (
                        <TableRow key={`publisher-loading-${index}`}>
                          <TableCell colSpan={5} className="px-3 py-2">
                            <Skeleton className="h-10 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : filteredPublishers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                          표시할 출판사가 없습니다.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPublishers.map((publisher) => (
                        <TableRow key={publisher.id}>
                          <TableCell className={settingsTableCellClass}>
                            <PublisherSubjectSelect
                              publisher={publisher}
                              onSubjectChange={(subject, checked) => togglePublisherSubject(publisher.id, subject, checked)}
                            />
                          </TableCell>
                          <TableCell className={settingsTableCellClass}>
                            <Input
                              value={publisher.name}
                              onChange={(event) => setPublisherField(publisher.id, "name", event.target.value)}
                              className="h-9"
                              placeholder="출판사명"
                            />
                          </TableCell>
                          <TableCell className={`${settingsTableCellClass} text-center`}>
                            <Badge variant="secondary" className="h-8 min-w-16 justify-center rounded-md px-2 text-xs">
                              {formatQuantity(getPublisherTextbookCount(publisher))}종
                            </Badge>
                          </TableCell>
                          <TableCell className={settingsTableCellClass}>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button type="button" variant="outline" className="h-9 w-full justify-between overflow-hidden px-3">
                                  <span className="truncate">
                                    {publisher.supplierIds.length > 0
                                      ? publisher.supplierIds
                                          .map((supplierId) => suppliersById.get(supplierId)?.name)
                                          .filter(Boolean)
                                          .join(", ")
                                      : "총판 선택"}
                                  </span>
                                  <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-72 p-2">
                                <div className="grid max-h-72 gap-1 overflow-y-auto">
                                  {suppliers.map((supplier) => (
                                    <label
                                      key={supplier.id}
                                      className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/70"
                                    >
                                      <Checkbox
                                        checked={publisher.supplierIds.includes(supplier.id)}
                                        onCheckedChange={(checked) =>
                                          togglePublisherSupplier(publisher.id, supplier.id, checked === true)
                                        }
                                      />
                                      <span className="truncate">{supplier.name}</span>
                                    </label>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                          <TableCell className={`${settingsTableCellClass} sticky right-0 bg-background`}>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeletePublisher(publisher)}
                                disabled={saving}
                                aria-label="출판사 삭제"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </SettingsTableFrame>
            </TabsContent>

            <TabsContent value="suppliers" className="mt-3 min-w-0">
              <SettingsTableFrame>
                <Table className="min-w-[760px] table-fixed">
                  <caption className="sr-only">교재 총판 목록</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={`w-[42%] ${settingsTableHeadClass}`}>총판</TableHead>
                      <TableHead className={`w-[46%] ${settingsTableHeadClass}`}>연결 출판사</TableHead>
                      <TableHead className={`sticky right-0 z-10 w-[12%] bg-muted text-right ${settingsTableHeadClass}`}>작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, index) => (
                        <TableRow key={`supplier-loading-${index}`}>
                          <TableCell colSpan={3} className="px-3 py-2">
                            <Skeleton className="h-10 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : filteredSuppliers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="px-3 py-10 text-center text-sm text-muted-foreground">
                          표시할 총판이 없습니다.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSuppliers.map((supplier) => {
                        const linkCount = publisherLinkCounts.get(supplier.id) || 0;
                        const linkedPublisherNames = publisherNamesBySupplierId.get(supplier.id) || [];
                        const visiblePublisherNames = linkedPublisherNames.slice(0, 3);
                        const hiddenPublisherCount = Math.max(linkedPublisherNames.length - visiblePublisherNames.length, 0);
                        return (
                          <TableRow key={supplier.id}>
                            <TableCell className={settingsTableCellClass}>
                              <Input
                                value={supplier.name}
                                onChange={(event) => setSupplierField(supplier.id, "name", event.target.value)}
                                className="h-9"
                                placeholder="총판명"
                              />
                            </TableCell>
                            <TableCell className={settingsTableCellClass}>
                              <div className="flex min-h-9 flex-wrap items-center gap-1.5">
                                {visiblePublisherNames.length > 0 ? (
                                  <>
                                    {visiblePublisherNames.map((publisherName) => (
                                      <Badge
                                        key={`${supplier.id}-${publisherName}`}
                                        variant="secondary"
                                        className="max-w-36 justify-center truncate rounded-md px-2 text-xs"
                                      >
                                        {publisherName}
                                      </Badge>
                                    ))}
                                    {hiddenPublisherCount > 0 ? (
                                      <Badge variant="outline" className="rounded-md px-2 text-xs">
                                        +{hiddenPublisherCount}
                                      </Badge>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="text-sm text-muted-foreground">-</span>
                                )}
                                <Badge
                                  variant="outline"
                                  className={cn("ml-auto min-w-10 justify-center rounded-md", linkCount === 0 && "text-muted-foreground")}
                                >
                                  {linkCount}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className={`${settingsTableCellClass} sticky right-0 bg-background`}>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteSupplier(supplier)}
                                  disabled={saving}
                                  aria-label="총판 삭제"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </SettingsTableFrame>
            </TabsContent>

            <TabsContent value="subSubjects" className="mt-3 min-w-0">
              <SubSubjectSettingsPanel
                rows={subSubjects}
                activeSubject={activeSubSubject}
                searchQuery={query}
                saving={saving}
                onActiveSubjectChange={setActiveSubSubject}
                onNameChange={(id, value) => setSubSubjectField(id, { name: value })}
                onVisibleChange={(id, value) => setSubSubjectField(id, { isVisible: value })}
                onMove={moveSubSubject}
                onDelete={handleDeleteSubSubject}
              />
            </TabsContent>
        </Tabs>
      </div>
    </SettingsWorkspaceShell>
  );
}
