"use client";

import type { ReactNode } from "react";

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
    <div className={cn("mx-auto flex w-full max-w-[1480px] flex-col gap-3 px-4 py-4 sm:px-6", className)}>
      {children}
    </div>
  );
}

export function SettingsMasterHeader({ filters, actions, className }: SettingsMasterHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-1 flex flex-col gap-2 rounded-lg border border-border/70 bg-background/95 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      {filters ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{filters}</div> : <div className="hidden flex-1 md:block" />}
      {actions ? <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">{actions}</div> : null}
    </div>
  );
}

export function SettingsTableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border/70 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {children}
    </div>
  );
}

export const settingsTableHeadClass = "h-9 bg-muted/25 px-3 py-2 text-xs font-medium text-muted-foreground";
export const settingsTableCellClass = "px-3 py-2 align-middle";
export const settingsTableActionHeadClass = `sticky right-0 z-10 text-right ${settingsTableHeadClass}`;
export const settingsTableActionCellClass = `${settingsTableCellClass} sticky right-0 z-10 bg-background`;
