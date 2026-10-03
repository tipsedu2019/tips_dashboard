import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type LegacyLessonDetails = { startTime: string; endTime: string; teacherCatalogId: string; classroomCatalogId: string };
type Catalog = { id: string; name: string };

// Same controls and field layout as the normalized lesson editor.
export function LegacyLessonScheduleFields({ date, value, teachers, classrooms, onChange, disabled = false }: {
  date: string; value: LegacyLessonDetails; teachers: Catalog[]; classrooms: Catalog[];
  onChange: (value: LegacyLessonDetails) => void;
  disabled?: boolean;
}) {
  return <div className="grid gap-2 sm:grid-cols-2" data-testid="legacy-lesson-schedule-fields">
    {([['startTime', '시작'], ['endTime', '종료']] as const).map(([field, label]) =>
      <label key={field} className="grid gap-1 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Input type="time" disabled={disabled} aria-label={`${date} ${label}`} value={value[field]} onChange={event => onChange({ ...value, [field]: event.target.value })} />
      </label>)}
    {([['teacherCatalogId', '선생님', teachers], ['classroomCatalogId', '강의실', classrooms]] as const).map(([field, label, options]) =>
      <label key={field} className="grid gap-1 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <NativeSelect disabled={disabled} aria-label={`${date} ${label}`} value={value[field]} onChange={event => onChange({ ...value, [field]: event.target.value })}>
          <option value="">선택</option>
          {value[field] && !options.some(option => option.id === value[field]) ? <option value={value[field]}>현재 {label}</option> : null}
          {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </NativeSelect>
      </label>)}
  </div>;
}
