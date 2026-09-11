"use client"

import * as React from "react"
import { Loader2, Save } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const dialogBodyClassName = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable] sm:px-6"
const dialogActionsClassName = "shrink-0 space-y-3 border-t bg-background px-5 py-4 sm:px-6"

type DialogFrameProps = { title: string; description: string; children: React.ReactNode; compact?: boolean; wide?: boolean; returnFocusRef?: React.RefObject<HTMLElement | null>; confirmation?: boolean; busy?: boolean; height?: number; initialFocusRef?: React.RefObject<HTMLElement | null> }

function DialogFrame({ title, description, children, compact = false, wide = false, returnFocusRef, confirmation = false, busy = false, height, initialFocusRef }: DialogFrameProps) {
  const openerRef = React.useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  return (
    <DialogContent
      role={confirmation ? "alertdialog" : "dialog"}
      showCloseButton={!confirmation}
      onInteractOutside={confirmation ? (event) => event.preventDefault() : undefined}
      onEscapeKeyDown={busy && confirmation ? (event) => event.preventDefault() : undefined}
      style={height ? { height: `min(${height}px, calc(100dvh - 2rem))` } : undefined}
      onOpenAutoFocus={(event) => {
        const scope = event.target
        const active = document.activeElement
        if (scope instanceof HTMLElement && active instanceof HTMLElement && !scope.contains(active)) {
          openerRef.current = active
        }
        if (initialFocusRef?.current) {
          event.preventDefault()
          initialFocusRef.current.focus({ preventScroll: true })
        }
      }}
      onCloseAutoFocus={(event) => {
        const opener = returnFocusRef?.current || openerRef.current
        if (opener?.isConnected && opener !== document.body) {
          event.preventDefault()
          opener.focus({ preventScroll: true })
        }
      }}
      className={cn(
        "flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 motion-reduce:animate-none",
        wide ? "sm:max-w-5xl xl:max-w-6xl" : "sm:max-w-2xl",
        compact ? "sm:h-[min(34rem,calc(100dvh-2rem))]" : "sm:h-[min(42rem,calc(100dvh-2rem))]",
        confirmation && "sm:max-w-lg",
      )}
      overlayClassName="motion-reduce:animate-none"
    >
      <DialogHeader className={cn("shrink-0 border-b px-5 py-5 pr-14 text-left sm:px-6 sm:pr-14", confirmation && "pr-5 sm:pr-6")}>
        <DialogTitle className="leading-6">{title}</DialogTitle>
        <DialogDescription className={confirmation ? "leading-relaxed" : "sr-only"}>{description}</DialogDescription>
      </DialogHeader>
      {children}
    </DialogContent>
  )
}

/** Confirmation semantics on the existing Radix modal: explicit response, cancel-first focus, and bounded preview. */
function ConfirmationDialogContent({ title, description, items = [], totalCount = items.length, itemsLabel = "확인 대상", confirmLabel, onConfirm, onCancel, busy = false, error = "", returnFocusRef }: {
  title: string
  description: string
  items?: Array<{ id: string; title: string; detail: string }>
  totalCount?: number
  itemsLabel?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  error?: string
  returnFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const errorRef = React.useRef<HTMLDivElement>(null)
  const errorId = React.useId()
  const visibleItems = items.slice(0, 5)
  const remaining = Math.max(0, totalCount - visibleItems.length)
  React.useEffect(() => { if (error) errorRef.current?.focus({ preventScroll: true }) }, [error])
  return (
    <DialogFrame title={title} description={description} confirmation busy={busy} height={Math.max(400, 270 + visibleItems.length * 64)} initialFocusRef={cancelRef} returnFocusRef={returnFocusRef}>
      <div data-slot="confirmation-dialog-body" role="region" aria-label={`${itemsLabel} 스크롤`} tabIndex={visibleItems.length > 0 ? 0 : undefined} className={cn(dialogBodyClassName, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50")}>
        {visibleItems.length > 0 ? <ul aria-label={itemsLabel} className="divide-y divide-border/70">
          {visibleItems.map((item) => <li key={item.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
            <p className="break-words text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">{item.title}</p>
            {item.detail ? <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{item.detail}</p> : null}
          </li>)}
        </ul> : null}
        {remaining > 0 ? <p className="mt-3 text-xs text-muted-foreground">외 {remaining.toLocaleString("ko-KR")}건 더</p> : null}
      </div>
      <div data-slot="confirmation-dialog-footer" className={dialogActionsClassName} aria-busy={busy}>
        {error ? <Alert ref={errorRef} id={errorId} role="alert" tabIndex={-1} variant="destructive" className="max-h-28 overflow-y-auto">
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert> : null}
        <span role="status" className="sr-only">{busy ? "처리 중입니다." : ""}</span>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button ref={cancelRef} type="button" variant="outline" className="h-11 sm:h-9" disabled={busy} aria-label={`${title} 취소`} onClick={onCancel}>취소</Button>
          <Button type="button" variant="destructive" className="h-11 min-w-32 sm:h-9" disabled={busy} aria-label={`${title} ${confirmLabel}`} aria-describedby={error ? errorId : undefined} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}{confirmLabel}
          </Button>
        </div>
      </div>
    </DialogFrame>
  )
}

type FormDialogContentProps = {
  returnFocusRef?: React.RefObject<HTMLElement | null>
  title: string
  description: string
  children: React.ReactNode
  onSubmit: React.FormEventHandler<HTMLFormElement>
  onCancel: () => void
  cancelLabel: string
  submitLabel: string
  submitAriaLabel?: string
  submitDisabled?: boolean
  busy?: boolean
  error?: string
  hint?: string
}

/** Presentation only: validation, writes and protection against duplicate writes belong to the caller. */
function FormDialogContent({
  title, description, children, onSubmit, onCancel, cancelLabel,
  submitLabel, submitAriaLabel, submitDisabled = false, busy = false, error = "", hint = "",
  returnFocusRef,
}: FormDialogContentProps) {
  const feedbackId = React.useId()
  const errorRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (error) errorRef.current?.focus({ preventScroll: true })
  }, [error])

  return (
    <DialogFrame title={title} description={description} returnFocusRef={returnFocusRef}>
      <form
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        onSubmit={(event) => {
          if (busy || submitDisabled) { event.preventDefault(); return }
          onSubmit(event)
        }}
        aria-busy={busy}
      >
        <div data-slot="form-dialog-body" className={dialogBodyClassName}>
          <fieldset className="grid min-w-0 gap-4 [&>*]:min-w-0 [&>*]:max-w-full">
            {children}
          </fieldset>
        </div>
        <div data-slot="form-dialog-footer" className={dialogActionsClassName}>
          {error ? (
            <Alert className="max-h-28 overflow-y-auto" ref={errorRef} role="alert" tabIndex={-1} variant="destructive" id={feedbackId}>
              <AlertDescription className="break-words">{error}</AlertDescription>
            </Alert>
          ) : hint ? <p id={feedbackId} className="text-sm text-muted-foreground">{hint}</p> : null}
          <span role="status" className="sr-only">{busy ? "저장 중입니다." : ""}</span>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onCancel} aria-label={cancelLabel}>취소</Button>
            <Button type="submit" className="h-11 sm:h-9" aria-label={submitAriaLabel} disabled={busy || submitDisabled} aria-describedby={error || hint ? feedbackId : undefined}>
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Save />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </DialogFrame>
  )
}

function DetailDialogContent({ title, description, children, onClose, compact = true }: DialogFrameProps & { onClose: () => void }) {
  return (
    <DialogFrame title={title} description={description} compact={compact}>
      <div data-slot="detail-dialog-body" className={dialogBodyClassName}>{children}</div>
      <div data-slot="detail-dialog-footer" className={cn(dialogActionsClassName, "flex justify-end")}>
        <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
      </div>
    </DialogFrame>
  )
}

function DocumentDialogContent({ title, description, children, toolbar, feedback, actions, onClose }: DialogFrameProps & {
  toolbar: React.ReactNode
  feedback: React.ReactNode
  actions?: React.ReactNode
  onClose: () => void
}) {
  return (
    <DialogFrame title={title} description={description} wide>
      <div data-slot="document-dialog-toolbar" className="shrink-0 border-b px-5 py-3 sm:px-6">{toolbar}</div>
      <div data-slot="document-dialog-body" className={dialogBodyClassName}>{children}</div>
      <div data-slot="document-dialog-footer" className={dialogActionsClassName}>
        <div role="status" aria-live="polite" className="flex h-10 min-w-0 items-center overflow-y-auto text-sm text-muted-foreground">{feedback}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
          {actions}
        </div>
      </div>
    </DialogFrame>
  )
}

export { FormDialogContent, DetailDialogContent, DocumentDialogContent, ConfirmationDialogContent }
