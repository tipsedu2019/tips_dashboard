type Row = Record<string, unknown>;
export type EffectiveSchedule = {
  date: string;
  state: string;
  kind: 'resolved' | 'unresolved' | 'cancelled';
  values: Record<string, string | null>;
  provenance: Record<string, string>;
  missing: string[];
  errors: string[];
};
export function resolveEffectiveSchedule(input: Row): EffectiveSchedule;
export function effectiveInputForLesson(plan: Row, session: Row, context: Row | null): Row;
export function projectLegacyEffectivePlan(plan: Row, context: Row | null): Row;
export function setLegacyLessonOverride(plan: Row, date: string, next: Row, displayed: Row): Row;
export function useLegacyLessonBasics(plan: Row, date: string): Row;
export function occupancyOf(result: EffectiveSchedule, classId: string, id: string): Row | null;
