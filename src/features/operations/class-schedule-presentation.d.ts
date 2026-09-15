export type ClassScheduleProgressState = 'accepted' | 'missing' | 'loading' | 'error' | 'forbidden' | 'noPeriod';
export function formatClassScheduleProgress(input: { completedSessions: number; sessionCount: number; state: ClassScheduleProgressState }): { label: string; countLabel: string | null; percent: number | null };
export function getClassScheduleProgressState(classItem: unknown, requestState?: ClassScheduleProgressState): ClassScheduleProgressState;
