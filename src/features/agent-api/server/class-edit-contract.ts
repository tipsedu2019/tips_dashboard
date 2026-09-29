import { z } from "zod";

const uuid = z.string().uuid();
export const editWindow = z.object({ from: z.iso.date(), to: z.iso.date() }).strict().refine(v => {
  const days = (Date.parse(v.to) - Date.parse(v.from)) / 86400000;
  return days >= 0 && days <= 93;
});
const timing = z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1439), teacherId: uuid, classroomId: uuid }).strict().refine(v => v.endMinute > v.startMinute);
const basic = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  classType: z.string().trim().max(80).optional(),
  subject: z.string().trim().min(1).max(80).optional(),
  subjectAreaKey: z.string().trim().max(80).nullable().optional(),
  grade: z.string().trim().max(80).optional(),
  capacity: z.number().int().min(0).max(10000).optional(),
  fee: z.number().int().min(0).max(100000000).optional(),
}).strict().refine(v => Object.keys(v).length > 0);
const weeklySlot = z.object({ id: z.string().min(1).max(160), weekday: z.number().int().min(0).max(6), ...timing.shape, sortOrder: z.number().int().min(0).max(1000) }).strict().refine(v => v.endMinute > v.startMinute);
const lesson = z.object({
  date: z.iso.date(), lessonId: z.string().min(1).max(240).optional(),
  state: z.enum(["scheduled", "cancelled", "skipped", "undecided"]),
  timing: timing.optional(),
  makeup: z.object({ date: z.iso.date(), ...timing.shape }).strict().refine(v => v.endMinute > v.startMinute).nullable().optional(),
}).strict().refine(v => v.makeup == null || (v.state === "cancelled" && v.makeup.date !== v.date));
export const classEditRequest = z.object({
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  window: editWindow,
  reason: z.string().trim().min(1).max(300),
  basic: basic.optional(), weeklySlots: z.array(weeklySlot).min(1).max(14).optional(),
  lessons: z.array(lesson).min(1).max(50).optional(),
}).strict().refine(v => Boolean(v.basic || v.weeklySlots || v.lessons)).refine(v => {
  const dates = (v.lessons || []).map(x => x.date);
  return new Set(dates).size === dates.length && (v.lessons || []).every(x => x.date >= v.window.from && x.date <= v.window.to && (!x.makeup || (x.makeup.date >= v.window.from && x.makeup.date <= v.window.to)));
});
export type ClassEditRequest = z.infer<typeof classEditRequest>;
export const EDIT_SCOPES = ["class-details:read", "class-info:write", "weekly-plan:write", "lesson-plan:write"] as const;
export function requiredEditScopes(request: ClassEditRequest): string[] {
  return ["class-details:read", ...(request.basic ? ["class-info:write"] : []), ...(request.weeklySlots ? ["weekly-plan:write"] : []), ...(request.lessons ? ["lesson-plan:write"] : [])];
}
