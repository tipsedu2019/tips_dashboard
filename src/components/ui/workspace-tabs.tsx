"use client"

import * as React from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

const WorkspaceTabsContext = React.createContext<{ value: string; panelId: string } | null>(null)

function useWorkspaceTabs() {
  const context = React.useContext(WorkspaceTabsContext)
  if (!context) throw new Error("Workspace tabs must be inside WorkspaceTabs")
  return context
}

/** Remote views share one mounted panel; changing focus must not fetch another view. */
function WorkspaceTabs({ value, className, ...props }: Omit<React.ComponentProps<typeof Tabs>, "activationMode" | "defaultValue"> & { value: string }) {
  const panelId = React.useId()
  return (
    <WorkspaceTabsContext value={{ value, panelId }}>
      <Tabs {...props} value={value} activationMode="manual" className={cn("min-w-0 gap-0", className)} />
    </WorkspaceTabsContext>
  )
}

function WorkspaceTabsList({ className, ref, ...props }: React.ComponentProps<typeof TabsList>) {
  const { value } = useWorkspaceTabs()
  const listRef = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(ref, () => listRef.current!)
  React.useEffect(() => {
    const list = listRef.current
    const selected = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!list || !selected) return
    const viewport = list.getBoundingClientRect()
    const tab = selected.getBoundingClientRect()
    // Deep links can select an offscreen tab without focusing it. Move only
    // this horizontal strip; keep the page position and active input intact.
    if (tab.left < viewport.left) list.scrollLeft += tab.left - viewport.left
    else if (tab.right > viewport.right) list.scrollLeft += tab.right - viewport.right
  }, [value])
  return <TabsList {...props} ref={listRef} className={cn("h-auto min-w-0 w-full max-w-full flex-nowrap justify-start gap-1 overflow-x-auto p-1", className)} />
}

function WorkspaceTabsTrigger({ className, onFocus, ...props }: React.ComponentProps<typeof TabsTrigger>) {
  const { panelId } = useWorkspaceTabs()
  return (
    <TabsTrigger
      {...props}
      aria-controls={panelId}
      className={cn("h-9 shrink-0 flex-none px-3", className)}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented) event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })
      }}
    />
  )
}

/** Keep one panel instance so accepted results and unsaved child state survive view changes. */
function WorkspaceTabsPanel({ className, ...props }: Omit<React.ComponentProps<typeof TabsContent>, "value" | "forceMount" | "id">) {
  const { value, panelId } = useWorkspaceTabs()
  return <TabsContent {...props} value={value} forceMount id={panelId} className={cn("min-w-0", className)} />
}

export { WorkspaceTabs, WorkspaceTabsList, WorkspaceTabsTrigger, WorkspaceTabsPanel }
