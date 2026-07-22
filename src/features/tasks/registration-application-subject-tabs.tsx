"use client"

import type { KeyboardEvent } from "react"

import { Button } from "@/components/ui/button"

type RegistrationApplicationSubjectTabTrack = {
  id: string
  subject: string
  statusLabel: string
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
    <div role="tablist" aria-label="과목별 등록 진행" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {tracks.map((track) => {
        const selected = track.id === value
        return (
          <Button
            key={track.id}
            id={`registration-subject-tab-${track.id}`}
            type="button"
            role="tab"
            variant={selected ? "default" : "outline"}
            aria-selected={selected}
            aria-controls={panelIdsByTrackId[track.id]?.join(" ")}
            tabIndex={selected ? 0 : -1}
            className="h-auto min-w-0 justify-between gap-3 px-3 py-2"
            onKeyDown={(event) => handleSubjectTabKeyDown(event, track.id)}
            onClick={() => onValueChange(track.id)}
          >
            <span>{track.subject}</span>
            <span className="truncate text-xs font-normal opacity-80">{track.statusLabel}</span>
          </Button>
        )
      })}
    </div>
  )
}
