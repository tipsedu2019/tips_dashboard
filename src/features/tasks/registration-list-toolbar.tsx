"use client"

import type { ReactNode } from "react"

import { DataTableCommandRow, DataTableToolbar } from "@/components/data-table/data-table-surface"
import { Button } from "@/components/ui/button"

export function RegistrationListToolbar({ search, actions, consultationScope }: {
  search: ReactNode
  actions?: ReactNode
  consultationScope?: {
    value: "mine" | "all"
    counts: { mine: number; all: number }
    onChange: (scope: "mine" | "all") => void
  }
}) {
  return (
    <DataTableToolbar>
      <DataTableCommandRow search={search} actions={actions} />
      {consultationScope ? (
        <div role="group" aria-label="상담 목록 범위" className="flex flex-wrap items-center gap-1">
          {(["mine", "all"] as const).map((scope) => (
            <Button
              key={scope}
              type="button"
              variant={consultationScope.value === scope ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={consultationScope.value === scope}
              aria-label={`${scope === "mine" ? "내 담당" : "전체 담당"} ${consultationScope.counts[scope]}건`}
              onClick={() => consultationScope.onChange(scope)}
            >
              {scope === "mine" ? "내 담당" : "전체 담당"}
              <span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">{consultationScope.counts[scope]}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </DataTableToolbar>
  )
}
