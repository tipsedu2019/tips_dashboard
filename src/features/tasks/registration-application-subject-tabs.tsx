"use client"

import type { KeyboardEvent } from "react"

import { Button } from "@/components/ui/button"
import type { RegistrationWorkflowViewKey } from "./registration-workflow-status.js"

type RegistrationApplicationSubjectTabTrack = {
  id: string
  subject: string
  statusLabel: string
  viewKey: RegistrationWorkflowViewKey
}

export function RegistrationApplicationSubjectTabs({
  tracks,
  value,
  panelIdsByTrackId,
  onValueChange,
}: {
  tracks: readonly RegistrationApplicationSubjectTabTrack[]
  value: string | null
  panelIdsByTrackId: Readonly<Record<string, readonly string[]>>
  onValueChange: (trackId: string) => void
}) {
  const mobileGridClass = tracks.length === 1
    ? "grid-cols-1"
    : tracks.length === 2
      ? "grid-cols-2"
      : "grid-cols-3"

  function handleSubjectTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, trackId: string) {
    const currentIndex = tracks.findIndex((track) => track.id === trackId)
    if (currentIndex < 0) return

    let nextIndex = currentIndex
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tracks.length
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tracks.length) % tracks.length
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = tracks.length - 1
    else return

    event.preventDefault()
    const nextTrackId = tracks[nextIndex]?.id
    if (!nextTrackId) return
    onValueChange(nextTrackId)
    document.getElementById(`registration-subject-tab-${nextTrackId}`)?.focus()
  }

  return (
    <div role="tablist" aria-label="과목별 등록 진행" className={`grid ${mobileGridClass} border-b sm:flex sm:min-w-0 sm:gap-5`}>
      {tracks.map((track) => {
        const selected = track.id === value
        return (
          <Button
            key={track.id}
            id={`registration-subject-tab-${track.id}`}
            type="button"
            role="tab"
            variant="ghost"
            aria-label={`${track.subject} ${track.statusLabel}`}
            aria-selected={selected}
            aria-controls={panelIdsByTrackId[track.id]?.join(" ")}
            data-registration-view-key={track.viewKey}
            tabIndex={selected ? 0 : -1}
            className={`h-auto min-w-0 justify-center gap-2 rounded-none border-b-2 px-2 py-2.5 shadow-none sm:min-w-fit sm:flex-none sm:justify-start sm:px-1 ${selected
              ? "border-primary text-foreground hover:bg-transparent"
              : "border-transparent text-muted-foreground hover:border-border hover:bg-transparent hover:text-foreground"
            }`}
            onKeyDown={(event) => handleSubjectTabKeyDown(event, track.id)}
            onClick={() => onValueChange(track.id)}
          >
            <span className="font-semibold">{track.subject}</span>
            <span className="hidden sm:inline max-w-40 truncate text-xs font-normal opacity-70">{track.statusLabel}</span>
          </Button>
        )
      })}
    </div>
  )
}
