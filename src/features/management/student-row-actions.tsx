"use client";

import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function StudentRowActions({ studentName, onWithdraw }: { studentName: string; onWithdraw?: () => void }) {
  return (
    <DataTableRowActions label={`${studentName} 더보기`} disabled={!onWithdraw}>
      <DropdownMenuItem variant="destructive" onSelect={onWithdraw}>퇴원 처리</DropdownMenuItem>
    </DataTableRowActions>
  );
}
