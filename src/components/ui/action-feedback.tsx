"use client"

import * as React from "react"
import { X } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/** Non-modal task feedback: stays available without moving the workspace or taking focus. */
export function ActionFeedback({ message, error = false, onDismiss, returnFocusRef }: {
  message: string
  error?: boolean
  onDismiss: () => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const openerRef = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.activeElement.closest('[data-slot="action-feedback"]')) {
      openerRef.current = document.activeElement
    }
  }, [message])

  return (
    <div data-slot="action-feedback" className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 sm:left-auto sm:right-6 sm:w-[min(28rem,calc(100vw-3rem))]">
      <Alert role={error ? "alert" : "status"} aria-atomic="true" variant={error ? "destructive" : "default"} className="pointer-events-auto grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-popover py-2 shadow-md">
        <AlertDescription tabIndex={0} aria-label="처리 결과" className="col-start-1 max-h-[30dvh] min-w-0 overflow-y-auto whitespace-pre-line break-words rounded-sm py-1 leading-relaxed focus-visible:outline-2 focus-visible:outline-ring">
          {message}
        </AlertDescription>
        <Button type="button" variant="ghost" size="icon" className="size-11 sm:size-9" aria-label="처리 결과 닫기" onClick={() => {
          const opener = openerRef.current
          const target = opener?.isConnected && !opener.hasAttribute("disabled") ? opener : returnFocusRef?.current
          onDismiss()
          if (target?.isConnected) target.focus({ preventScroll: true })
        }}><X aria-hidden="true" /></Button>
      </Alert>
    </div>
  )
}
