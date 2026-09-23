'use client';
import type { Dispatch, SetStateAction, PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PlanSnapshot } from './timetable-plan-contract';
import type { PlacementEditorDraft } from './timetable-placement-editor';
import { itemDraft, PLAN_DAYS, formatPlanTime } from './timetable-plan-interaction';

export function TimetablePlanClassList({ snapshot, search, setSearch, listFilter, setListFilter,
  selectedItemIds, setSelectedItemIds, activeItemId, canEdit, onActivate, onEdit, onDelete, onDrag, suppressClick,
}: {
  snapshot: PlanSnapshot; search: string; setSearch: (value: string) => void;
  listFilter: string; setListFilter: (value: string) => void;
  selectedItemIds: string[]; setSelectedItemIds: Dispatch<SetStateAction<string[]>>;
  activeItemId: string | null; canEdit: boolean; onActivate: (id: string) => void;
  onEdit: (draft: PlacementEditorDraft) => void; onDelete: (id: string) => void;
  onDrag: (event: PointerEvent<HTMLElement>, itemId: string) => void; suppressClick: () => boolean;
}) {
  const rows = snapshot.items.filter(item =>
    (!search || `${item.name} ${item.subject}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
    (listFilter === 'applied' ? item.state === 'applied' : item.state === 'draft' &&
      (listFilter !== 'unplaced' || !snapshot.slots.some(slot => slot.itemId === item.id) || item.pendingSlots.length)));
  const selectable = rows.filter(item => item.state === 'draft');
  return <div className="space-y-3 p-3">
    <Input aria-label="프리셋 수업 검색" placeholder="수업 검색" value={search} onChange={event => setSearch(event.target.value)} />
    <Select value={listFilter} onValueChange={setListFilter}>
      <SelectTrigger aria-label="수업 목록 범위"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">전체 수업</SelectItem>
        <SelectItem value="unplaced">미배치</SelectItem>
        <SelectItem value="applied">운영 반영 이력</SelectItem>
      </SelectContent>
    </Select>
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <Checkbox checked={selectable.length > 0 && selectable.every(item => selectedItemIds.includes(item.id))}
        onCheckedChange={checked => setSelectedItemIds(current => checked
          ? [...new Set([...current, ...selectable.map(item => item.id)])]
          : current.filter(id => !selectable.some(item => item.id === id)))} />
      {search || listFilter !== 'all' ? '검색 결과' : '이 프리셋 전체'} {selectable.length}개
    </label>
    {rows.map(item => {
      const slots = snapshot.slots.filter(slot => slot.itemId === item.id);
      const draft = { item: itemDraft(item), slots };
      return <div key={item.id} className="border-b py-2">
        <div className="flex items-start gap-2">
          {item.state === 'draft' ? <Checkbox className="mt-3" aria-label={`${item.name} 선택`}
            checked={selectedItemIds.includes(item.id)} onCheckedChange={checked => setSelectedItemIds(current =>
              checked ? [...current, item.id] : current.filter(id => id !== item.id))} /> : null}
          <Button variant={activeItemId === item.id ? 'secondary' : 'ghost'}
            className="min-w-0 flex-1 justify-start whitespace-normal break-words text-left" onClick={() => onActivate(item.id)}>
            {item.name}
          </Button>
          {canEdit && item.state === 'draft' ? <Button size="icon" variant="ghost"
            aria-label={`${item.name} 배치 끌기`} className="hidden shrink-0 xl:inline-flex" style={{ touchAction: 'none' }}
            onPointerDown={event => onDrag(event, item.id)} onClick={() => { if (!suppressClick()) onEdit(draft); }}>
            <GripVertical />
          </Button> : null}
        </div>
        <p className="pl-6 text-xs text-muted-foreground">
          {item.subject} · {item.state === 'applied' ? '운영 반영됨' : slots.length ? `${slots.length}개 배치` : '미배치'}
        </p>
        <div className="flex flex-wrap gap-1 pl-6">
          {item.state === 'draft' ? <>
            <Button size="sm" variant="ghost" onClick={() => onEdit(draft)}>편집·배치</Button>
            {canEdit ? <Button size="sm" variant="ghost" onClick={() => onDelete(item.id)}>수업 삭제</Button> : null}
          </> : null}
          {slots.map(slot => <Button key={slot.id} size="sm" variant="ghost" onClick={() => onEdit({ ...draft, slotId: slot.id })}>
            {PLAN_DAYS[slot.weekday]} {formatPlanTime(slot.startMinute)}
          </Button>)}
          {item.state === 'applied' ? snapshot.appliedSnapshots.find(history => history.itemId === item.id)?.slots.map(slot =>
            <span key={slot.id} className="text-xs text-muted-foreground">{PLAN_DAYS[slot.weekday]} {formatPlanTime(slot.startMinute)}–{formatPlanTime(slot.endMinute)}</span>) : null}
        </div>
        {item.pendingSlots.map(pending => <p key={pending.id} className="pl-6 text-xs text-muted-foreground">
          {pending.sourceText} · {pending.reason === 'conflict' ? '충돌' : pending.reason === 'missing_resource' ? '자원 미정' : '시각 확인 필요'}
        </p>)}
      </div>;
    })}
    {!rows.length ? <p className="py-4 text-sm text-muted-foreground">조건에 맞는 수업이 없습니다.</p> : null}
  </div>;
}
