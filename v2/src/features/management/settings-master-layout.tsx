"use client";

import type { ReactNode } from "react";

type SettingsMasterHeaderProps = {
  filters?: ReactNode;
  actions?: ReactNode;
};

export function SettingsMasterHeader({ filters, actions }: SettingsMasterHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 pb-3 md:flex-row md:items-center md:justify-between">
      {filters ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{filters}</div> : <div className="hidden flex-1 md:block" />}
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  );
}

export function SettingsTableFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm">{children}</div>;
}

export const settingsTableHeadClass = "h-10 bg-muted/35 px-3 py-2 text-xs font-semibold text-muted-foreground";
export const settingsTableCellClass = "px-3 py-2 align-middle";
