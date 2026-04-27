export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  )
}
