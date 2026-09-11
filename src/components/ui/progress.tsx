import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const maximum = Number.isFinite(max) && max > 0 ? max : 100
  const progressValue = typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, value)) : null

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={progressValue}
      max={maximum}
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-transform duration-200 motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - ((progressValue || 0) / maximum) * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
