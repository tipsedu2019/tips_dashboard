"use client";

import type { ReactNode } from "react";

import {
  DATA_TABLE_BODY_CELL_CLASS_NAME,
  DATA_TABLE_HEADER_CELL_CLASS_NAME,
  DataTableToolbar,
  DataTableViewport,
} from "@/components/data-table/data-table-surface";
import { cn } from "@/lib/utils";

type SettingsWorkspaceShellProps = {
  children: ReactNode;
  className?: string;
};

type SettingsMasterHeaderProps = {
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function SettingsWorkspaceShell({ children, className }: SettingsWorkspaceShellProps) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1560px] flex-col gap-3 px-4 py-3 sm:px-5 lg:px-6", className)}>
      {children}
    </div>
  );
}

export function SettingsMasterHeader({ filters, actions, className }: SettingsMasterHeaderProps) {
  return (
    <DataTableToolbar
      className={cn(
        "sticky top-0 z-30 bg-background backdrop-blur md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      {filters ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{filters}</div> : <div className="hidden flex-1 md:block" />}
      {actions ? <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">{actions}</div> : null}
    </DataTableToolbar>
  );
}

export function SettingsTableFrame({ children }: { children: ReactNode }) {
  return (
    <DataTableViewport
      data-testid="settings-database-frame"
      role="region"
      aria-label="설정 목록"
      tabIndex={0}
      className="max-h-[calc(100dvh-12rem)] overflow-x-auto overflow-y-auto rounded-lg border border-border/70 [&>[data-slot=table-container]]:overflow-visible [&_tbody_tr]:h-12"
    >
      {children}
    </DataTableViewport>
  );
}

export const settingsTableHeadClass = `${DATA_TABLE_HEADER_CELL_CLASS_NAME} z-20`;
export const settingsTableCellClass = `${DATA_TABLE_BODY_CELL_CLASS_NAME} border-b border-border/70`;
export const settingsTableActionHeadClass = `${settingsTableHeadClass} sticky right-0 z-30 text-right`;
export const settingsTableActionCellClass = `${settingsTableCellClass} sticky right-0 z-10 bg-background shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]`;
