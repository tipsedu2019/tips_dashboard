'use client';

import { useId, type FocusEventHandler, type Ref } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimePickerControl } from '@/components/ui/date-time-picker';
import type { ClassFieldOption, ClassMetadataValues, ClassScheduleFieldRow } from './class-form-model';

function choicesWithCurrent(options: ClassFieldOption[], value: string) {
  return value && !options.some(option => option.value === value)
    ? [{ value, label: value, disabled: true }, ...options] : options;
}

export function ClassFieldSelect({ id, label, value, options, onChange, disabled, invalid, describedBy }: {
  id: string; label: string; value: string; options: ClassFieldOption[];
  onChange: (value: string) => void; disabled?: boolean; invalid?: boolean; describedBy?: string;
}) {
  return <Select value={value || '__none__'} onValueChange={value => onChange(value === '__none__' ? '' : value)} disabled={disabled}>
    <SelectTrigger id={id} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="w-full min-w-0"><SelectValue placeholder="선택 안 함" /></SelectTrigger>
    <SelectContent><SelectItem value="__none__">선택 안 함</SelectItem>{choicesWithCurrent(options, value).map(option =>
      <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

/** Controlled fields only: callers retain validation, permissions and save/recovery state. */
export function ClassMetadataFields({ idPrefix, values, onChange, disabled, referencesDisabled, statusDisabled,
  statuses, subjects, grades, capacities = [], tuitions = [], areas = [], errors = {}, autoFocus = false, nameInputRef, onNameBlur }: {
  nameInputRef?: Ref<HTMLInputElement>; onNameBlur?: FocusEventHandler<HTMLInputElement>;
  idPrefix: string; values: ClassMetadataValues; onChange: (field: keyof ClassMetadataValues, value: string) => void;
  disabled?: boolean; referencesDisabled?: boolean; statusDisabled?: boolean; autoFocus?: boolean;
  statuses: ClassFieldOption[]; subjects: ClassFieldOption[]; grades: string[]; capacities?: string[]; tuitions?: string[];
  areas?: ClassFieldOption[]; errors?: Partial<Record<keyof ClassMetadataValues, string>>;
}) {
  const input = (field: 'name' | 'grade' | 'capacity' | 'tuition', label: string, options?: string[]) => {
    const id = `${idPrefix}-${field === 'tuition' ? 'fee' : field}`;
    return <div className="min-w-0 space-y-2" key={field}>
      <Label htmlFor={id}>{label}{field === 'name' ? <><span aria-hidden="true" className="text-destructive">*</span><span className="sr-only">필수 입력</span></> : null}</Label>
      <Input id={id} name={field} ref={field === 'name' ? nameInputRef : undefined} onBlur={field === 'name' ? onNameBlur : undefined} value={values[field]} onChange={event => onChange(field, event.target.value)} disabled={disabled}
        required={field === 'name'} maxLength={field === 'name' ? 200 : undefined} autoFocus={field === 'name' && autoFocus}
        inputMode={field === 'capacity' || field === 'tuition' ? 'numeric' : undefined}
        pattern={field === 'capacity' || field === 'tuition' ? '([0-9]+|-0)?' : undefined}
        list={options?.length ? `${id}-options` : undefined} autoComplete="off"
        aria-invalid={Boolean(errors[field]) || undefined} aria-describedby={errors[field] ? `${id}-error` : undefined} />
      {options?.length ? <datalist id={`${id}-options`}>{[...new Set(options)].filter(Boolean).map(value => <option key={value} value={value} />)}</datalist> : null}
      {errors[field] ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{errors[field]}</p> : null}
    </div>;
  };
  const select = (field: 'status' | 'subject' | 'subjectAreaKey', label: string, options: ClassFieldOption[]) => {
    const id = `${idPrefix}-${field}`;
    return <div className="min-w-0 space-y-2" key={field}><Label htmlFor={id}>{label}</Label>
      <ClassFieldSelect id={id} label={label} value={values[field]} options={options} onChange={value => onChange(field, value)}
        disabled={disabled || (field === 'status' ? statusDisabled : referencesDisabled)} invalid={Boolean(errors[field])} describedBy={errors[field] ? `${id}-error` : undefined} />
      {errors[field] ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{errors[field]}</p> : null}
    </div>;
  };
  return <div className="class-fields grid gap-5 sm:grid-cols-2" data-testid="class-metadata-fields">
    {input('name', '수업명')}{select('status', '수업 상태', statuses)}
    {input('grade', '학년', grades)}{select('subject', '과목', subjects)}
    {input('capacity', '정원', capacities)}{input('tuition', '수업료 (원)', tuitions)}
    {values.subject === '과학' ? select('subjectAreaKey', '과학 영역', areas) : null}
  </div>;
}

export function ClassScheduleFields({ rows, teachers, rooms, onChange, onAdd, onRemove, disabled, minimumRows = 0 }: {
  rows: ClassScheduleFieldRow[]; teachers: ClassFieldOption[]; rooms: ClassFieldOption[];
  onChange: (index: number, patch: Partial<ClassScheduleFieldRow>) => void;
  onAdd: () => void; onRemove: (index: number) => void; disabled?: boolean; minimumRows?: number;
}) {
  const prefix = useId();
  const days = ['월', '화', '수', '목', '금', '토', '일'].map(value => ({ value, label: value }));
  return <div className="class-schedule-fields space-y-3" data-testid="class-schedule-fields">
    <div className="grid gap-3">{rows.map((row, index) => {
      const id = `${prefix}-${row.key}`;
      return <div key={row.key} data-testid="class-schedule-slot-row" className="grid min-w-0 grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-3">
        <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1"><Label htmlFor={`${id}-day`}>요일</Label><ClassFieldSelect id={`${id}-day`} label={`시간표 ${index + 1} 요일`} value={row.day} options={days} onChange={day => onChange(index, { day })} disabled={disabled} /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-start`}>시작시각</Label><TimePickerControl value={row.start} onChange={start => onChange(index, { start })} ariaLabel={`수업시간 ${index + 1} 시작시각`} inputId={`${id}-start`} allowDirectInput disabled={disabled} /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-end`}>종료시각</Label><TimePickerControl value={row.end} onChange={end => onChange(index, { end })} ariaLabel={`수업시간 ${index + 1} 종료시각`} inputId={`${id}-end`} allowDirectInput allowEndOfDay disabled={disabled} /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-teacher`}>선생님</Label><ClassFieldSelect id={`${id}-teacher`} label={`시간표 ${index + 1} 선생님`} value={row.teacher} options={teachers} onChange={teacher => onChange(index, { teacher })} disabled={disabled} /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-room`}>강의실</Label><ClassFieldSelect id={`${id}-room`} label={`시간표 ${index + 1} 강의실`} value={row.room} options={rooms} onChange={room => onChange(index, { room })} disabled={disabled} /></div>
        <div className="flex items-end justify-end"><Button type="button" variant="destructive-ghost" size="icon" aria-label={`시간표 ${index + 1} 행 삭제`} disabled={disabled || rows.length <= minimumRows} onClick={() => onRemove(index)}><Trash2 className="size-4" aria-hidden="true" /></Button></div>
      </div>;
    })}</div>
    <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={disabled}><Plus className="size-4" aria-hidden="true" />시간 추가</Button>
  </div>;
}
