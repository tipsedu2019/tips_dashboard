import * as React from "react"

import { fieldStateClassName } from "@/components/ui/control-styles"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-background px-3 py-2 text-base shadow-xs md:text-sm",
        fieldStateClassName,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
