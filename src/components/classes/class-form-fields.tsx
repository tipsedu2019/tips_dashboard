'use client';
import {useEffect, useId, useRef, type ReactNode, type ComponentProps} from 'react';
import {Plus, Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {cn} from '@/lib/utils';
import {orderClassInformationFields, type ClassScheduleFormRow, type ClassFormOption} from './class-form-model';

export function ClassInformationFields({fields, className}: {fields: Array<{name: string; content: ReactNode}>; className?: string}) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 [&_[data-slot=select-trigger]]:w-full', className)}>{orderClassInformationFields(fields).map(field => <div key={field.name} className={field.name === 'name' || field.name === 'publicMemo' ? 'sm:col-span-2' : undefined}>{field.content}</div>)}</div>;
}

/** Raw integer text is adapter-owned: an empty value and an explicit zero stay distinct. */
export function ClassAmountInput(props: ComponentProps<typeof Input>) {
  return <div className="relative"><Input {...props} type="text" inputMode="numeric" className={cn('pr-9', props.className)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span></div>;
}

const DAYS = ['월','화','수','목','금','토','일'];
const TIMES = Array.from({length: 88}, (_, i) => {const minute=540+i*10;return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;});
export const CLASS_SCHEDULE_FORM_GRID = 'grid grid-cols-2 gap-2 md:grid-cols-[4.5rem_6.75rem_6.75rem_minmax(7rem,1fr)_minmax(7rem,1fr)_2.5rem]';

type Props = {
  rows: ClassScheduleFormRow[];
  onChange: (index: number, patch: Partial<Omit<ClassScheduleFormRow,'key'>>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  teacherOptions: (index: number) => ClassFormOption[];
  classroomOptions: (index: number) => ClassFormOption[];
  disabled?: boolean;
  minimumRows?: number;
  idPrefix?: string;
};
export function ClassScheduleRows({rows,onChange,onAdd,onRemove,teacherOptions,classroomOptions,disabled=false,minimumRows=0,idPrefix='class-schedule-slot'}: Props) {
  const listId=useId();
  const rowNodes=useRef(new Map<string,HTMLDivElement>());
  const addButton=useRef<HTMLButtonElement>(null);
  const focusFrame=useRef<number | null>(null);
  useEffect(()=>()=>{if(focusFrame.current!==null)window.cancelAnimationFrame(focusFrame.current);},[]);
  const removeRow=(index:number)=>{const nextKey=rows[index+1]?.key||rows[index-1]?.key;onRemove(index);if(focusFrame.current!==null)window.cancelAnimationFrame(focusFrame.current);focusFrame.current=window.requestAnimationFrame(()=>{focusFrame.current=null;const control=nextKey?rowNodes.current.get(nextKey)?.querySelector<HTMLElement>('button,input'):addButton.current;control?.focus({preventScroll:true});});};
  const select = (index: number, field: 'day'|'teacher'|'classroom', label: string, options: ClassFormOption[]) => {
    const value=rows[index][field];
    const shown=value&&!options.some(option=>option.value===value)?[...options,{value,label:value}]:options;
    const id=`${idPrefix}-${index}-${field}`;
    return <div className={cn('grid min-w-0 gap-1',field==='day'&&'col-span-2 md:col-span-1')}><Label htmlFor={id} className="text-[11px] font-medium text-muted-foreground md:sr-only">{label}</Label><Select value={value||'__none__'} disabled={disabled} onValueChange={next=>onChange(index,{[field]:next==='__none__'?'':next})}><SelectTrigger id={id} aria-label={`수업시간 ${index+1} ${label}`} className="w-full min-w-0"><SelectValue placeholder={label}/></SelectTrigger><SelectContent><SelectItem value="__none__">선택 안 함</SelectItem>{shown.map(option=><SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
  };
  return <div className="space-y-3" data-testid="class-schedule-rows">
    <datalist id={`${listId}-start`}>{TIMES.map(time=><option key={time} value={time}/>)}</datalist><datalist id={`${listId}-end`}>{[...TIMES,'24:00'].map(time=><option key={time} value={time}/>)}</datalist>
    <div data-testid="class-schedule-slot-header" className={cn(CLASS_SCHEDULE_FORM_GRID,'hidden px-2 text-[11px] font-medium text-muted-foreground md:grid')}>{['요일','시작시각','종료시각','선생님','강의실'].map(label=><span key={label}>{label}</span>)}<span className="sr-only">관리</span></div>
    <div className="grid gap-2">{rows.map((row,index)=><div key={row.key} ref={node=>{if(node)rowNodes.current.set(row.key,node);else rowNodes.current.delete(row.key);}} data-testid="class-schedule-slot-row" className={cn(CLASS_SCHEDULE_FORM_GRID,'px-2 py-1')}>
      {select(index,'day','요일',DAYS.map(day=>({value:day,label:day})))}
      {(['startTime','endTime'] as const).map(field=>{const label=field==='startTime'?'시작시각':'종료시각';const id=`${idPrefix}-${index}-${field}`;return <div key={field} className="grid min-w-0 gap-1"><Label htmlFor={id} className="text-[11px] font-medium text-muted-foreground md:sr-only">{label}</Label><Input id={id} aria-label={`수업시간 ${index+1} ${label}`} value={row[field]} placeholder={field==='startTime'?'17:13':'24:00'} list={`${listId}-${field==='startTime'?'start':'end'}`} disabled={disabled} onChange={event=>onChange(index,{[field]:event.target.value})}/></div>;})}
      {select(index,'teacher','선생님',teacherOptions(index))}{select(index,'classroom','강의실',classroomOptions(index))}
      <div className="col-span-2 flex items-end justify-end md:col-span-1"><Button type="button" variant="destructive-ghost" size="icon" aria-label="시간표 행 삭제" title="시간표 행 삭제" disabled={disabled||rows.length<=minimumRows} onClick={()=>removeRow(index)}><Trash2 className="size-4" aria-hidden="true"/></Button></div>
    </div>)}</div>
    <Button ref={addButton} type="button" variant="outline" size="sm" disabled={disabled} onClick={onAdd}><Plus className="mr-1.5 size-4" aria-hidden="true"/>시간 추가</Button>
  </div>;
}
