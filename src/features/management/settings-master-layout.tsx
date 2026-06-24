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
    <div className={cn("mx-auto flex w-full max-w-[1560px] flex-col gap-3 px-4 py-3 sm:px-5 lg:px-6", className)}>
      {children}
    </div>
  );
}

export function SettingsMasterHeader({ filters, actions, className }: SettingsMasterHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-1 flex flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85 md:flex-row md:items-center md:justify-between",
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
    <div
      data-testid="settings-database-frame"
      className="max-h-[calc(100dvh-12rem)] overflow-x-auto overflow-y-auto rounded-md border border-border/70 bg-background shadow-none"
    >
      {children}
    </div>
  );
}

export const settingsTableHeadClass = "sticky top-0 z-20 h-9 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground";
export const settingsTableCellClass = "border-b border-border/60 px-3 py-2 align-middle";
export const settingsTableActionHeadClass = `sticky right-0 z-10 text-right ${settingsTableHeadClass}`;
export const settingsTableActionCellClass = `${settingsTableCellClass} sticky right-0 z-10 bg-background shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]`;
