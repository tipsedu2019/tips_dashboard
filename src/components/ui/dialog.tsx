"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none fixed inset-0 z-50 bg-black/50 duration-[var(--motion-duration-dialog)] ease-[var(--motion-easing-spatial)] motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  closeButtonLabel = "모달 닫기",
  onCloseButtonClick,
  overlayClassName,
  layer = "default",
  showCloseButton = true,
  showCloseButtonText = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeButtonLabel?: string
  onCloseButtonClick?: React.MouseEventHandler<HTMLButtonElement>
  overlayClassName?: string
  layer?: "default" | "nested"
  showCloseButton?: boolean
  showCloseButtonText?: boolean
}) {
  const closeButtonClassName = cn(
    buttonVariants({ variant: showCloseButtonText ? "outline" : "ghost", size: showCloseButtonText ? "sm" : "icon" }),
    "z-30 text-muted-foreground",
    showCloseButtonText
      ? "order-first h-auto min-h-11 max-w-full self-end justify-self-end py-2 text-xs sm:min-h-9"
      : "absolute top-2 right-2 size-11 sm:top-3 sm:right-3 sm:size-9",
  )
  const closeButtonContent = (
    <>
      <XIcon aria-hidden="true" />
      <span className={showCloseButtonText ? "min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]" : "sr-only"}>{closeButtonLabel}</span>
    </>
  )

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={cn(layer === "nested" && "z-[85]", overlayClassName)} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-[var(--motion-duration-dialog)] ease-[var(--motion-easing-spatial)] motion-reduce:animate-none sm:max-w-lg",
          showCloseButton && !showCloseButtonText && "[&>[data-slot=dialog-header]]:pr-14",
          layer === "nested" && "z-[90]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          onCloseButtonClick ? (
            <button
              type="button"
              data-slot="dialog-close"
              aria-label={closeButtonLabel}
              className={closeButtonClassName}
              onClick={onCloseButtonClick}
            >
              {closeButtonContent}
            </button>
          ) : (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              aria-label={closeButtonLabel}
              className={closeButtonClassName}
            >
              {closeButtonContent}
            </DialogPrimitive.Close>
          )
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex min-w-0 flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("min-w-0 text-lg leading-snug font-semibold [overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
