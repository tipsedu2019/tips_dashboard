"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { parsePersonalTargets, type PersonalConnectionService, type PersonalTarget } from "./personal-connection-contract";

export function PersonalTargetPicker({ ownerId, service, kind, title, selected, onChange }: {
  ownerId: string; service: PersonalConnectionService; kind: "classes" | "schools"; title: string;
  selected: PersonalTarget[]; onChange: (items: PersonalTarget[]) => void;
}) {
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [pageSize, setPageSize] = useState<10 | 15 | 20>(10);
  const [result, setResult] = useState<ReturnType<typeof parsePersonalTargets> | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const current = result?.page === page && result.pageSize === pageSize && result.search === search.trim();
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void (async () => {
      setLoading(true); setError(false);
      try {
        const input = { kind, search, page, pageSize };
        const raw = await service.targets({ ...input, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (active) setResult(parsePersonalTargets(raw, ownerId, input));
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [ownerId, service, kind, search, page, pageSize, revision]);
  return <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium">{title} ({selected.length}/50)</legend>
    <Label htmlFor={`personal-${kind}-search`}>{title} 이름 검색</Label>
    <Input id={`personal-${kind}-search`} value={search} maxLength={100} autoComplete="off" onChange={event => { setSearch(event.target.value); setPage(1); }} />
    {selected.length ? <ul aria-label={`선택한 ${title}`} className="space-y-1">{selected.map(row => <li key={row.id}><Button type="button" size="sm" variant="secondary" className="h-auto max-w-full whitespace-normal text-left [overflow-wrap:anywhere]" aria-label={`${row.name} 선택 해제`} onClick={() => onChange(selected.filter(item => item.id !== row.id))}>{row.name} · 해제</Button></li>)}</ul> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{title} 목록을 확인하지 못했습니다. <Button type="button" variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>다시 조회</Button></p> : null}
    {loading ? <p role="status" className="text-sm">{title} 조회 중…</p> : null}
    <ul aria-label={`${title} 검색 결과`} aria-busy={loading} className="divide-y divide-border">{result?.items.map(row => {
      const checked = selected.some(item => item.id === row.id);
      return <li key={row.id}><label className="flex min-h-10 items-center gap-2 py-2 text-sm"><Checkbox checked={checked} disabled={loading || error || !current || !checked && selected.length >= 50} onCheckedChange={value => onChange(value === true ? [...selected.filter(item => item.id !== row.id), row] : selected.filter(item => item.id !== row.id))} /><span className="min-w-0 [overflow-wrap:anywhere]">{row.name}</span></label></li>;
    })}</ul>
    {!loading && !error && current && !result?.items.length ? <p className="text-sm text-muted-foreground">{search ? "검색 결과가 없습니다." : "현재 선택할 수 있는 대상이 없습니다."}</p> : null}
    <DataTablePagination page={page} pageSize={pageSize} totalCount={current && !error ? result?.total ?? null : null} loading={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} ariaLabel={`${title} 페이지`} />
  </fieldset>;
}
