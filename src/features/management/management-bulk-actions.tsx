"use client";

import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { DataTableSelectionActions } from "@/components/data-table/data-table-selection";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormDialogContent } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type BulkEditField = {
  id: string;
  label: string;
  placeholder: string;
  options?: string[];
};

export function ManagementBulkActionBar({ selectedCount, fields, field, value, pending, deleteLabel = "일괄 삭제", onFieldChange, onValueChange, onApply, onDelete, onClear, returnFocusRef, canEdit = true }: {
  canEdit?: boolean;
  selectedCount: number;
  fields: BulkEditField[];
  field: string;
  value: string;
  pending: boolean;
  deleteLabel?: string;
  onFieldChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onApply: () => Promise<boolean>;
  onDelete?: () => void;
  onClear: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const editRef = useRef<HTMLButtonElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const fieldId = "management-bulk-field";
  const valueId = "management-bulk-value";
  const selectedField = fields.find((item) => item.id === field) || fields[0];
  const valueOptions = selectedField?.options || [];
  if (selectedCount === 0 || !selectedField) return null;

  return <>
    <DataTableSelectionActions count={selectedCount} label="선택 항목 작업" disabled={pending} onClear={onClear}>
      {canEdit ? <Button ref={editRef} type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setError(""); dialogReturnFocusRef.current = editRef.current; setOpen(true); }} aria-label="선택 항목 일괄 수정">
        <Pencil aria-hidden="true" className="size-4" />수정
      </Button> : null}
      {onDelete ? <Button type="button" variant="destructive-ghost" size="sm" disabled={pending} onClick={onDelete} aria-label={deleteLabel}>
        {deleteLabel === "일괄 퇴원" ? "퇴원" : "삭제"}
      </Button> : null}
    </DataTableSelectionActions>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <FormDialogContent height={420} title={`선택 ${selectedCount}건 수정`} description="선택한 항목에 같은 변경 값을 적용합니다."
        returnFocusRef={dialogReturnFocusRef} busy={pending} error={error}
        submitLabel="일괄 수정" cancelLabel="일괄 수정 취소" submitDisabled={!value.trim()}
        onCancel={() => { if (!pending) setOpen(false); }} onSubmit={async (event) => {
          event.preventDefault(); setError("");
          dialogReturnFocusRef.current = returnFocusRef.current?.querySelector<HTMLInputElement>('input[type="search"]') || editRef.current;
          try {
            if (await onApply()) { setOpen(false); return; }
          } catch { /* The caller may reject as well as return false. Keep the draft. */ }
          dialogReturnFocusRef.current = editRef.current;
          setError("일괄 수정하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요.");
        }}>
        <div className="grid gap-2">
          <Label htmlFor={fieldId}>수정 항목</Label>
          <Select value={selectedField.id} onValueChange={(next) => { onFieldChange(next); setError(""); }} disabled={pending}>
            <SelectTrigger id={fieldId} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{fields.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={valueId}>변경 값</Label>
          {valueOptions.length > 0 ? <Select value={value || "__empty__"} onValueChange={(next) => onValueChange(next === "__empty__" ? "" : next)} disabled={pending}>
            <SelectTrigger id={valueId} className="w-full"><SelectValue placeholder={selectedField.placeholder} /></SelectTrigger>
            <SelectContent><SelectItem value="__empty__">선택 안 함</SelectItem>{valueOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
          </Select> : <Input id={valueId} value={value} disabled={pending} onChange={(event) => onValueChange(event.target.value)} placeholder={selectedField.placeholder} />}
        </div>
      </FormDialogContent>
    </Dialog>
  </>;
}
