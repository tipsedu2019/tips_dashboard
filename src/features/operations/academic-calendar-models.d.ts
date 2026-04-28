export type AcademicTemplateCalendarEvent = {
  id: string;
  sourceId?: string | number;
  title: string;
  date: Date;
  endDate?: Date | null;
  time: string;
  duration: string;
  type: "meeting" | "event" | "personal" | "task" | "reminder";
  typeLabel?: string;
  attendees: string[];
  location: string;
  color: string;
  description?: string;
  schoolId?: string;
  schoolName?: string;
  category?: string;
  grade?: string;
  gradeBadges?: string[];
  scopeSummary?: string;
  note?: string;
};

export type AcademicTemplateCalendarModel = {
  events: AcademicTemplateCalendarEvent[];
  eventDates: Array<{ date: Date; count: number }>;
};

export type AcademicAnnualBoardType =
  | "시험기간"
  | "영어시험일"
  | "수학시험일"
  | "체험학습"
  | "방학·휴일·기타"
  | "팁스";

export type AcademicAnnualBoardEntry = {
  id: string;
  title: string;
  type: AcademicAnnualBoardType;
  dateLabel: string;
  start: string;
  end: string;
  schoolId?: string;
  schoolName?: string;
  grade?: string;
  gradeBadges?: string[];
  examTerm?: string;
  examDateLabel?: string;
  linkedScheduleLabel?: string;
  subjectSummary?: boolean;
  scopeSummary?: string;
  textbookScope?: string;
  subtextbookScope?: string;
  textbookScopes?: Array<{ name: string; publisher: string; scope: string }>;
  subtextbookScopes?: Array<{ name: string; publisher: string; scope: string }>;
  metaBadges?: string[];
  materialSections?: Array<{ label: string; items: string[] }>;
  displaySections?: Array<{ label: string; items: string[] }>;
  note?: string;
  color?: string;
};

export type AcademicAnnualBoardRow = {
  id: string;
  schoolId?: string;
  schoolName: string;
  category: string;
  grade: string;
  gradeValues: string[];
  gradeBadges: string[];
  totalEvents: number;
  gradeLabel: string;
  searchText: string;
  typeBuckets: Record<AcademicAnnualBoardType, AcademicAnnualBoardEntry[]>;
};

export type AcademicAnnualBoardModel = {
  selectedYear: string;
  selectedSemester: string;
  yearOptions: string[];
  semesterOptions: string[];
  boardTypes: AcademicAnnualBoardType[];
  rows: AcademicAnnualBoardRow[];
  summary: {
    schoolCount: number;
    eventCount: number;
    activeTypeCount: number;
  };
};

export function buildAcademicCalendarTemplateModel(input?: {
  academicEvents?: Array<Record<string, unknown>>;
  academicSchools?: Array<Record<string, unknown>>;
}): AcademicTemplateCalendarModel;

export function buildAcademicAnnualBoardModel(input?: {
  academicEvents?: Array<Record<string, unknown>>;
  academicSchools?: Array<Record<string, unknown>>;
  academicEventExamDetails?: Array<Record<string, unknown>>;
  academyCurriculumPlans?: Array<Record<string, unknown>>;
  academyCurriculumMaterials?: Array<Record<string, unknown>>;
  academicCurriculumProfiles?: Array<Record<string, unknown>>;
  academicSupplementMaterials?: Array<Record<string, unknown>>;
  academicExamMaterialPlans?: Array<Record<string, unknown>>;
  academicExamMaterialItems?: Array<Record<string, unknown>>;
  textbooks?: Array<Record<string, unknown>>;
  selectedYear?: string;
  selectedSemester?: string;
}): AcademicAnnualBoardModel;
