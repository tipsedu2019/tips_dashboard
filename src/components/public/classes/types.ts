export type PublicClassAvailability = "live" | "snapshot" | "unavailable";

export interface PublicLesson {
  id?: string;
  title?: string;
  name?: string;
  label?: string;
  parentId?: string;
  order?: number;
  pageStart?: number;
  pageEnd?: number;
  children?: PublicLesson[];
}

export interface PublicTextbookRange {
  rangeType?: string;
  start?: string;
  end?: string;
  label?: string;
  status?: string;
  publicNote?: string;
  updatedAt?: string;
}

export interface PublicScheduleTextbookEntry {
  textbookId?: string;
  role?: string;
  alias?: string;
  area?: string;
  subSubject?: string;
  startSessionId?: string;
  endSessionId?: string;
  order?: number;
  plan?: PublicTextbookRange;
  actual?: PublicTextbookRange;
}

export interface PublicBillingPeriod {
  id?: string;
  label?: string;
  startDate?: string;
  endDate?: string;
  sessionCount?: number;
}

export interface PublicClassSession {
  id?: string;
  sessionKey?: string;
  date?: string;
  scheduleState?: string;
  makeupDate?: string;
  originalDate?: string;
  startTime?: string;
  endTime?: string;
  classroomName?: string;
  teacherName?: string;
  progressStatus?: string;
  publicNote?: string;
  billingId?: string;
  billingLabel?: string;
  sessionNumber?: number;
  textbookEntries?: PublicScheduleTextbookEntry[];
}

export interface PublicClassSchedule {
  generatedAt?: string;
  version?: number;
  billingPeriods?: PublicBillingPeriod[];
  textbooks: PublicScheduleTextbookEntry[];
  sessions: PublicClassSession[];
}

export interface PublicClassItem {
  id: string;
  name: string;
  className: string;
  subject: string;
  grade: string;
  teacher: string;
  room: string;
  classroom: string;
  schedule: string;
  status: string;
  capacity: number;
  enrolledCount: number;
  waitlistCount: number;
  fee: number;
  tuition: number;
  startDate?: string;
  endDate?: string;
  textbookIds?: string[];
  lessons?: PublicLesson[];
  schedulePlan?: PublicClassSchedule | null;
}

export interface PublicTextbook {
  id: string;
  title: string;
  publisher: string;
  price: number;
  tags: string[];
  lessons: PublicLesson[];
  updatedAt: string | null;
}

export interface PublicProgressLog {
  id: string;
  classId: string;
  textbookId: string;
  progressKey: string;
  sessionId: string;
  sessionOrder: number;
  status: string;
  rangeStart: string;
  rangeEnd: string;
  rangeLabel: string;
  publicNote: string;
  updatedAt: string | null;
  completedLessonIds: string[];
}

export interface PublicClassCatalog {
  classes: PublicClassItem[];
  generatedAt: string | null;
  availability: PublicClassAvailability;
}

export interface PublicClassDetail {
  classItem: PublicClassItem;
  textbooks: PublicTextbook[];
  progressLogs: PublicProgressLog[];
  generatedAt: string;
  availability: Exclude<PublicClassAvailability, "unavailable">;
}
