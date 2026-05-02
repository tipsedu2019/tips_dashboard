"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "@/features/management/settings-master-layout";
import { createId } from "@/features/management/management-service.js";
import {
  TextbookSubSubjectSettingRecord,
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
  return labels.length > 0 ? labels.join(", ") : "-";
}

function formatQuantity(value: unknown) {
  const count = Number(value || 0);
  return new Intl.NumberFormat("ko-KR").format(Number.isFinite(count) ? count : 0);
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
        <Button type="button" variant="outline" className="h-9 w-full justify-start overflow-hidden px-3">
          <span className="truncate">{subjectLabel(selectedSubjects)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="grid gap-1">
          {SUBJECT_OPTIONS.map((option) => (
            <label key={option.value} className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/70">
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
  saving,
  onActiveSubjectChange,
  onAdd,
  onNameChange,
  onVisibleChange,
  onDelete,
}: {
  rows: TextbookSubSubjectSettingRecord[];
  activeSubject: string;
  saving: boolean;
  onActiveSubjectChange: (subject: string) => void;
  onAdd: () => void;
  onNameChange: (id: string, value: string) => void;
  onVisibleChange: (id: string, value: boolean) => void;
  onDelete: (row: TextbookSubSubjectSettingRecord) => void;
}) {
  const activeRows = rows
    .filter((row) => row.subject === activeSubject)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko", { numeric: true }));

  return (
    <SettingsTableFrame>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
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
        <Button type="button" size="sm" className="h-8" onClick={onAdd} disabled={saving}>
          <Plus className="mr-2 size-4" />
          세부과목 추가
        </Button>
      </div>
      <Table className="table-fixed">
        <caption className="sr-only">교재 세부과목 설정</caption>
        <TableHeader>
          <TableRow>
            <TableHead className={`w-[72%] ${settingsTableHeadClass}`}>세부과목</TableHead>
            <TableHead className={`w-[16%] text-center ${settingsTableHeadClass}`}>필터 표시</TableHead>
            <TableHead className={`w-[12%] text-right ${settingsTableHeadClass}`}>작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                등록된 세부과목이 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            activeRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={settingsTableCellClass}>
                  <Input
                    value={row.name}
                    onChange={(event) => onNameChange(row.id, event.target.value)}
                    className="h-9"
                    placeholder="예: 독해"
                    aria-label={`${SUBJECT_LABELS[row.subject] || row.subject} 세부과목명`}
                  />
                </TableCell>
                <TableCell className={`${settingsTableCellClass} text-center`}>
                  <Checkbox
                    checked={row.isVisible}
                    onCheckedChange={(checked) => onVisibleChange(row.id, checked === true)}
                    aria-label={`${row.name || "세부과목"} 필터 표시`}
                  />
                </TableCell>
                <TableCell className={settingsTableCellClass}>
                  <div className="flex justify-end">
                    <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => onDelete(row)} disabled={saving} aria-label="세부과목 삭제">
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
  const [subSubjects, setSubSubjects] = useState<TextbookSubSubjectSettingRecord[]>([]);
  const [activeSubSubject, setActiveSubSubject] = useState("english");
  const [publisherTextbookCounts, setPublisherTextbookCounts] = useState<Record<string, number>>({});
  const [deletedPublisherIds, setDeletedPublisherIds] = useState<string[]>([]);
  const [deletedSupplierIds, setDeletedSupplierIds] = useState<string[]>([]);
  const [deletedSubSubjectIds, setDeletedSubSubjectIds] = useState<string[]>([]);
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
      const [publisherResult, supplierResult, linkResult, textbookResult, subSubjectResult] = await Promise.all([
        supabase.from("textbook_publishers").select("*").order("name", { ascending: true }),
        supabase.from("textbook_suppliers").select("*").order("name", { ascending: true }),
        supabase.from("textbook_publisher_supplier_links").select("*"),
        supabase.from("textbooks").select("id, publisher_id, publisher"),
        supabase.from("textbook_sub_subject_settings").select("*").order("subject", { ascending: true }).order("sort_order", { ascending: true }),
      ]);

      if (publisherResult.error) throw publisherResult.error;
      if (supplierResult.error) throw supplierResult.error;
      if (linkResult.error) throw linkResult.error;
      if (textbookResult.error) throw textbookResult.error;
      if (subSubjectResult.error && !isMissingOptionalTableError(subSubjectResult.error)) throw subSubjectResult.error;

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
      setSubSubjects(mergeTextbookSubSubjectSettings((subSubjectResult.error ? [] : subSubjectResult.data || []) as Row[]));
      setDeletedPublisherIds([]);
      setDeletedSupplierIds([]);
      setDeletedSubSubjectIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "교재 설정을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filteredPublishers = useMemo(() => {
    const safeQuery = query.trim().toLowerCase();
    if (!safeQuery) return publishers;
    return publishers.filter((publisher) => {
      const supplierNames = publisher.supplierIds
        .map((supplierId) => suppliers.find((supplier) => supplier.id === supplierId)?.name || "")
        .join(" ");
      return `${publisher.name} ${subjectLabel(publisher.subjects)} ${supplierNames}`.toLowerCase().includes(safeQuery);
    });
  }, [publishers, query, suppliers]);

  const setPublisherField = (id: string, field: keyof PublisherRecord, value: string | string[]) => {
    setPublishers((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const setSupplierField = (id: string, field: keyof SupplierRecord, value: string) => {
    setSuppliers((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const setSubSubjectField = (id: string, patch: Partial<TextbookSubSubjectSettingRecord>) => {
    setSubSubjects((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setIsDirty(true);
  };

  const addSubSubject = () => {
    const activeRows = subSubjects.filter((row) => row.subject === activeSubSubject);
    const maxSortOrder = activeRows.reduce((max, row) => Math.max(max, row.sortOrder), 0);
    setSubSubjects((current) => [createSubSubject(activeSubSubject, maxSortOrder + 10), ...current]);
    setIsDirty(true);
  };

  const togglePublisherSubject = (publisherId: string, subject: string, checked: boolean) => {
    setPublishers((current) =>
      current.map((publisher) => {
        if (publisher.id !== publisherId) return publisher;
        const subjects = normalizeList(publisher.subjects);
        return {
          ...publisher,
          subjects: checked
            ? [...new Set([...subjects, subject])]
            : subjects.filter((item) => item !== subject),
        };
      }),
    );
    setIsDirty(true);
  };

  const togglePublisherSupplier = (publisherId: string, supplierId: string, checked: boolean) => {
    setPublishers((current) =>
      current.map((publisher) => {
        if (publisher.id !== publisherId) return publisher;
        const currentIds = normalizeList(publisher.supplierIds);
        return {
          ...publisher,
          supplierIds: checked
            ? [...new Set([...currentIds, supplierId])]
            : currentIds.filter((id) => id !== supplierId),
        };
      }),
    );
    setIsDirty(true);
  };

  const handleDeletePublisher = (publisher: PublisherRecord) => {
    if (!publisher.isNew) {
      setDeletedPublisherIds((current) => (current.includes(publisher.id) ? current : [...current, publisher.id]));
    }
    setPublishers((current) => current.filter((row) => row.id !== publisher.id));
    setIsDirty(true);
  };

  const handleDeleteSupplier = (supplier: SupplierRecord) => {
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
  };

  const handleDeleteSubSubject = (row: TextbookSubSubjectSettingRecord) => {
    if (!row.isNew) {
      setDeletedSubSubjectIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setSubSubjects((current) => current.filter((item) => item.id !== row.id));
    setIsDirty(true);
  };

  const getPublisherTextbookCount = (publisher: PublisherRecord) => publisherTextbookCounts[publisher.id] || 0;

  const saveRows = async () => {
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
    const duplicateSubSubject = nextSubSubjects.find((row, index) =>
      nextSubSubjects.findIndex((item) => item.subject === row.subject && item.name === row.name) !== index,
    );
    if (duplicateSubSubject) {
      setError(`${SUBJECT_LABELS[duplicateSubSubject.subject] || duplicateSubSubject.subject} 세부과목이 중복되었습니다.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (deletedPublisherIds.length > 0) {
        const { error: deletePublisherError } = await supabase
          .from("textbook_publishers")
          .delete()
          .in("id", deletedPublisherIds);
        if (deletePublisherError) throw deletePublisherError;
      }
      if (deletedSupplierIds.length > 0) {
        const { error: deleteSupplierError } = await supabase
          .from("textbook_suppliers")
          .delete()
          .in("id", deletedSupplierIds);
        if (deleteSupplierError) throw deleteSupplierError;
      }
      if (deletedSubSubjectIds.length > 0) {
        const { error: deleteSubSubjectError } = await supabase
          .from("textbook_sub_subject_settings")
          .delete()
          .in("id", deletedSubSubjectIds);
        if (deleteSubSubjectError) throw deleteSubSubjectError;
      }

      if (nextSubSubjects.length > 0) {
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

      await loadRows();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "교재 설정을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-6">
      <div className="flex min-w-0 flex-col gap-4">
        <SubSubjectSettingsPanel
          rows={subSubjects}
          activeSubject={activeSubSubject}
          saving={saving}
          onActiveSubjectChange={setActiveSubSubject}
          onAdd={addSubSubject}
          onNameChange={(id, value) => setSubSubjectField(id, { name: value })}
          onVisibleChange={(id, value) => setSubSubjectField(id, { isVisible: value })}
          onDelete={handleDeleteSubSubject}
        />
        <SettingsMasterHeader
          filters={
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="출판사, 총판 검색"
              className="h-9 w-full max-w-sm"
            />
          }
          actions={
            <>
              <Button type="button" size="sm" className="h-9" onClick={() => { setPublishers((current) => [createPublisher(), ...current]); setIsDirty(true); }}>
                <Plus className="mr-2 size-4" />
                출판사 추가
              </Button>
              <Button type="button" size="sm" className="h-9" onClick={() => void saveRows()} disabled={!isDirty || saving}>
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

        <SettingsTableFrame>
          <Table className="table-fixed">
            <caption className="sr-only">출판사별 총판 설정</caption>
            <TableHeader>
              <TableRow>
                <TableHead className={`w-[20%] ${settingsTableHeadClass}`}>과목</TableHead>
                <TableHead className={`w-[34%] ${settingsTableHeadClass}`}>출판사</TableHead>
                <TableHead className={`w-[34%] ${settingsTableHeadClass}`}>총판</TableHead>
                <TableHead className={`w-[12%] text-right ${settingsTableHeadClass}`}>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={`publisher-loading-${index}`}>
                    <TableCell colSpan={4} className="px-3 py-2">
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredPublishers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    등록된 출판사가 없습니다.
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
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <Input
                          value={publisher.name}
                          onChange={(event) => setPublisherField(publisher.id, "name", event.target.value)}
                          className="h-9"
                          placeholder="출판사"
                        />
                        <Badge variant="secondary" className="h-8 justify-center rounded-md px-2 text-xs">
                          교재 {formatQuantity(getPublisherTextbookCount(publisher))}종
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className={settingsTableCellClass}>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" className="h-9 w-full justify-start overflow-hidden px-3">
                            <span className="truncate">
                              {publisher.supplierIds.length > 0
                                ? publisher.supplierIds
                                    .map((supplierId) => suppliers.find((supplier) => supplier.id === supplierId)?.name)
                                    .filter(Boolean)
                                    .join(", ")
                                : "총판 선택"}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 p-2">
                          <div className="grid gap-1">
                            {suppliers.map((supplier) => (
                              <label key={supplier.id} className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/70">
                                <Checkbox
                                  checked={publisher.supplierIds.includes(supplier.id)}
                                  onCheckedChange={(checked) => togglePublisherSupplier(publisher.id, supplier.id, checked === true)}
                                />
                                <span className="truncate">{supplier.name}</span>
                              </label>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell className={settingsTableCellClass}>
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDeletePublisher(publisher)} disabled={saving} aria-label="출판사 삭제">
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
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <SettingsMasterHeader
          actions={
            <Button type="button" size="sm" className="h-9" onClick={() => { setSuppliers((current) => [createSupplier(), ...current]); setIsDirty(true); }}>
              <Plus className="mr-2 size-4" />
              총판 추가
            </Button>
          }
        />
        <SettingsTableFrame>
          <Table className="table-fixed">
            <caption className="sr-only">교재 총판 목록</caption>
            <TableHeader>
              <TableRow>
                <TableHead className={`w-[64%] ${settingsTableHeadClass}`}>총판</TableHead>
                <TableHead className={`w-[24%] ${settingsTableHeadClass}`}>연결</TableHead>
                <TableHead className={`w-[12%] text-right ${settingsTableHeadClass}`}>작업</TableHead>
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
              ) : suppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    등록된 총판이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                suppliers.map((supplier) => {
                  const linkCount = publishers.filter((publisher) => publisher.supplierIds.includes(supplier.id)).length;
                  return (
                    <TableRow key={supplier.id}>
                      <TableCell className={settingsTableCellClass}>
                        <Input
                          value={supplier.name}
                          onChange={(event) => setSupplierField(supplier.id, "name", event.target.value)}
                          className="h-9"
                          placeholder="총판"
                        />
                      </TableCell>
                      <TableCell className={settingsTableCellClass}>
                        <Badge variant="secondary" className={cn("rounded-md", linkCount === 0 && "text-muted-foreground")}>
                          {linkCount}
                        </Badge>
                      </TableCell>
                      <TableCell className={settingsTableCellClass}>
                        <div className="flex justify-end">
                          <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDeleteSupplier(supplier)} disabled={saving} aria-label="총판 삭제">
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
      </div>
    </div>
  );
}
