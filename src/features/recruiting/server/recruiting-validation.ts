import {
  RECRUITING_CONSENT_VERSION,
  RECRUITING_MAX_BODY_BYTES,
  RECRUITING_SUBJECTS,
  type RecruitingApplicationInput,
} from "../recruiting-policy.ts";

export const RECRUITING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const APPLICATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEYS = new Set(["requestId", "name", "phone", "subject", "experience", "motivation", "portfolioUrl", "talentPoolConsent", "consentVersion", "website"]);
// Permit ordinary paragraphs, but never NUL/control characters in stored text.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
export function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function parseApplication(value: unknown): { data?: RecruitingApplicationInput; fields?: string[] } {
  if (!record(value) || Object.keys(value).some((key) => !KEYS.has(key))) return { fields: ["form"] };
  const fields: string[] = [];
  const clean = (key: string, min: number, max: number) => {
    const raw = value[key];
    if (typeof raw !== "string" || CONTROL.test(raw) || raw.trim().length < min || raw.trim().length > max) {
      fields.push(key);
      return "";
    }
    return raw.trim();
  };
  const name = clean("name", 2, 80);
  const experience = clean("experience", 1, 2000);
  const motivation = clean("motivation", 10, 3000);
  const rawPhone = clean("phone", 8, 40);
  const phone = rawPhone.replace(/[\s()-]/gu, "");
  if (!/^\+?[0-9]{8,15}$/u.test(phone)) fields.push("phone");
  if (typeof value.requestId !== "string" || !RECRUITING_UUID.test(value.requestId)) fields.push("requestId");
  if (!RECRUITING_SUBJECTS.includes(value.subject as typeof RECRUITING_SUBJECTS[number])) fields.push("subject");
  if (value.talentPoolConsent !== true) fields.push("talentPoolConsent");
  if (value.consentVersion !== RECRUITING_CONSENT_VERSION) fields.push("consentVersion");
  if (value.website !== undefined && value.website !== "") fields.push("form");
  let portfolioUrl: string | null = null;
  if (value.portfolioUrl !== undefined && value.portfolioUrl !== null && value.portfolioUrl !== "") {
    try {
      if (typeof value.portfolioUrl !== "string" || value.portfolioUrl.length > 1000 || CONTROL.test(value.portfolioUrl)) throw new Error();
      const url = new URL(value.portfolioUrl.trim());
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new Error();
      portfolioUrl = url.href;
      if (portfolioUrl.length > 1000) throw new Error();
    } catch { fields.push("portfolioUrl"); }
  }
  if (fields.length) return { fields: [...new Set(fields)] };
  return { data: {
    requestId: (value.requestId as string).toLowerCase(), name, phone,
    subject: value.subject as RecruitingApplicationInput["subject"], experience, motivation,
    portfolioUrl, talentPoolConsent: true, consentVersion: RECRUITING_CONSENT_VERSION,
  } };
}
export class RecruitingRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
/** Enforce actual streamed bytes; Content-Length is only an early rejection. */
export async function readBoundedJson(request: Request, maxBytes = RECRUITING_MAX_BODY_BYTES) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") || "")) throw new RecruitingRequestError("unsupported_media_type", 415);
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)) throw new RecruitingRequestError("payload_too_large", 413);
  if (!request.body) throw new RecruitingRequestError("invalid_request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RecruitingRequestError("request_timeout", 408)), 3000);
  });
  try {
    while (true) {
      if (request.signal.aborted) throw new RecruitingRequestError("request_cancelled", 400);
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RecruitingRequestError("payload_too_large", 413);
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof RecruitingRequestError) throw error;
    throw new RecruitingRequestError("invalid_request", 400);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
