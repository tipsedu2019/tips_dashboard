export type AcademicCalendarBaselineRow = Record<string, unknown>;

export type AcademicCalendarBaselineSnapshot = {
  academicCalendarSource: "live" | "seed";
  academicEvents: AcademicCalendarBaselineRow[];
  academicSchools: AcademicCalendarBaselineRow[];
};

export function getAcademicCalendarBaselineSnapshot(): AcademicCalendarBaselineSnapshot;

export function resolveAcademicCalendarCollections(input?: {
  academicEvents?: AcademicCalendarBaselineRow[];
  academicSchools?: AcademicCalendarBaselineRow[];
  allowSeed?: boolean;
}): AcademicCalendarBaselineSnapshot;
