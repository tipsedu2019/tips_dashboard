import * as React from "react"

import { fieldStateClassName } from "@/components/ui/control-styles"
import { cn } from "@/lib/utils"

/** Native options and keyboard behavior with the shared field presentation. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input bg-background text-foreground h-9 w-full min-w-0 rounded-md border px-3 text-base shadow-xs md:text-sm",
        fieldStateClassName,
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
