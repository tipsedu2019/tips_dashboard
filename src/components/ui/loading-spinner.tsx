"use client"

import { cn } from "@/lib/utils"

interface LoadingSpinnerProps {
  className?: string
  size?: "sm" | "md" | "lg"
}

export function LoadingSpinner({ className, size = "md" }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-8 w-8", 
    lg: "h-12 w-12"
  }

  return (
    <div role="status" aria-label="불러오는 중" className="flex items-center justify-center min-h-[200px]">
      <div
        aria-hidden="true"
        className={cn(
          "animate-spin motion-reduce:animate-none rounded-full border-b-2 border-primary",
          sizeClasses[size],
          className
        )}
      />
    </div>
  )
}
