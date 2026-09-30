import { z } from "zod";

export const calendarYear = z.number().int().min(2000).max(2200);
export const calendarSource = z.object({
  url: z.url().max(2000).refine(value => { const u=new URL(value); return ["https:","http:"].includes(u.protocol) && !u.username && !u.password; }),
  title: z.string().trim().min(1).max(300),
  authority: z.enum(["official_school", "education_authority"]),
  checkedAt: z.iso.datetime({ offset: true }),
  publishedOn: z.iso.date().optional(),
  schoolIdentityEvidence: z.string().trim().min(1).max(500),
}).strict();
export const calendarEvent = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["시험기간", "영어시험일", "수학시험일", "과학시험일", "체험학습", "방학·휴일·기타"]),
  start: z.iso.date(), end: z.iso.date(),
  grade: z.string().max(40).regex(/^(all|초등|[중고][123](, ?[중고][123])*)$/),
  examTerm: z.enum(["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"]).optional(),
  scienceAreaKey: z.string().min(1).max(80).optional(),
  source: calendarSource,
  conflictResolution: z.string().trim().min(1).max(500).optional(),
}).strict().refine(value => value.end >= value.start, { message: "reversed range" });
export const calendarChange = z.object({
  schoolId: z.string().uuid(), schoolYear: calendarYear,
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(300),
  events: z.array(calendarEvent).min(1).max(100),
}).strict();
