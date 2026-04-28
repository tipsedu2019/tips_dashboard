export type TextbookScopeItem = {
  name: string
  publisher: string
  scope: string
}

export interface CalendarEvent {
  id: number | string
  sourceId?: number | string
  title: string
  date: Date
  endDate?: Date | null
  time: string
  duration: string
  type: "meeting" | "event" | "personal" | "task" | "reminder"
  typeLabel?: string
  attendees: string[]
  location: string
  color: string
  description?: string
  schoolId?: string
  schoolName?: string
  category?: string
  grade?: string
  examTerm?: string
  scopeSummary?: string
  textbookScope?: string
  subtextbookScope?: string
  textbookScopes?: TextbookScopeItem[]
  subtextbookScopes?: TextbookScopeItem[]
  note?: string
}

export interface Calendar {
  id: string
  name: string
  color: string
  visible: boolean
  type: "personal" | "work" | "shared"
}
