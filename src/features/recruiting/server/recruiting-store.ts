import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RECRUITING_RETENTION_DAYS, type RecruitingApplicationInput } from "../recruiting-policy.ts";
import { record } from "./recruiting-validation.ts";

export type RecruitingEnvironment = Record<string, string | undefined>;
export type IntakeRecord = RecruitingApplicationInput & { requestHash: string; ipFingerprint: string; contactFingerprint: string; globalFingerprint: string };
export type IntakeReceipt = { status: "accepted"; applicationId: string; receivedAt: string } | { status: "conflict" | "gone" | "unavailable" } | { status: "rate_limited"; retryAfter: number };
export type RecruitingStore = {
  submit(input: IntakeRecord, signal: AbortSignal): Promise<IntakeReceipt>;
};
export function supabaseSettings(env: RecruitingEnvironment) {
  return {
    url: (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim(),
    serviceKey: (env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    publicKey: (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "").trim(),
  };
}
function client(url: string, key: string, token?: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) }),
    },
  });
}
export function createIntakeStore(env: RecruitingEnvironment): RecruitingStore {
  const { url, serviceKey } = supabaseSettings(env);
  const db = client(url, serviceKey);
  return {
    async submit(input, signal) {
      const { data, error } = await db.rpc("submit_recruiting_application_v1", {
        p_request_id: input.requestId, p_request_hash: input.requestHash,
        p_ip_fingerprint: input.ipFingerprint, p_contact_fingerprint: input.contactFingerprint,
        p_global_fingerprint: input.globalFingerprint,
        p_name: input.name, p_phone: input.phone, p_subject: input.subject,
        p_experience: input.experience, p_motivation: input.motivation,
        p_portfolio_url: input.portfolioUrl, p_consent_version: input.consentVersion,
        p_retention_days: RECRUITING_RETENTION_DAYS,
      }).abortSignal(signal).retry(false);
      if (error || !record(data)) throw new Error("recruiting_store_unavailable");
      if (data.status === "accepted" && typeof data.applicationId === "string" && typeof data.receivedAt === "string") return { status: "accepted", applicationId: data.applicationId, receivedAt: data.receivedAt };
      if (data.status === "rate_limited" && Number.isInteger(data.retryAfter) && Number(data.retryAfter) > 0) return { status: "rate_limited", retryAfter: Number(data.retryAfter) };
      if (data.status === "conflict" || data.status === "gone" || data.status === "unavailable") return { status: data.status };
      throw new Error("recruiting_store_unavailable");
    },
  };
}
const SUMMARY = "id,name,phone,subject,created_at,expires_at";
const DETAIL = `${SUMMARY},experience,motivation,portfolio_url,consent_version,consented_at,retention_days`;
function summary(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, phone: row.phone, subject: row.subject, createdAt: row.created_at, expiresAt: row.expires_at };
}
export type RecruitingAdminStore = {
  list(page: number, pageSize: number): Promise<{ applications: unknown[]; totalCount: number; retentionLastSucceededAt: string | null }>;
  detail(id: string): Promise<unknown | null>;
  remove(id: string): Promise<boolean>;
};
function adminStore(db: SupabaseClient): RecruitingAdminStore {
  return {
    async list(page, pageSize) {
      const from = (page - 1) * pageSize;
      const [result, retention] = await Promise.all([
        db.from("recruiting_applications").select(SUMMARY, { count: "exact" }).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + pageSize - 1).abortSignal(AbortSignal.timeout(8000)).retry(false),
        db.from("recruiting_retention_status").select("last_succeeded_at").eq("singleton", true).abortSignal(AbortSignal.timeout(8000)).maybeSingle().retry(false),
      ]);
      if (result.error || retention.error) throw new Error("recruiting_admin_unavailable");
      return { applications: (result.data || []).map(summary), totalCount: result.count ?? 0, retentionLastSucceededAt: retention.data?.last_succeeded_at || null };
    },
    async detail(id) {
      const { data, error } = await db.from("recruiting_applications").select(DETAIL).eq("id", id).gt("expires_at", new Date().toISOString()).abortSignal(AbortSignal.timeout(8000)).maybeSingle().retry(false);
      if (error) throw new Error("recruiting_admin_unavailable");
      return data ? { ...summary(data), experience: data.experience, motivation: data.motivation, portfolioUrl: data.portfolio_url, consentVersion: data.consent_version, consentedAt: data.consented_at, retentionDays: data.retention_days } : null;
    },
    async remove(id) {
      const { data, error } = await db.from("recruiting_applications").delete().eq("id", id).select("id").abortSignal(AbortSignal.timeout(8000)).retry(false);
      if (error) throw new Error("recruiting_admin_unavailable");
      return Boolean(data?.length);
    },
  };
}
export type AdminIdentity = { role: string; store: RecruitingAdminStore } | { status: 401 | 503 };
export async function authenticateRecruitingAdmin(request: Request, env: RecruitingEnvironment): Promise<AdminIdentity> {
  const token = /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return { status: 401 };
  const { url, publicKey } = supabaseSettings(env);
  if (!url || !publicKey) return { status: 503 };
  try {
    const db = client(url, publicKey, token);
    const identity = await db.auth.getUser(token);
    if (identity.error || !identity.data.user?.id) return { status: 401 };
    const role = await db.rpc("current_dashboard_role").abortSignal(AbortSignal.timeout(8000)).retry(false);
    if (role.error) return { status: 503 };
    return { role: typeof role.data === "string" ? role.data : "", store: adminStore(db) };
  } catch { return { status: 503 }; }
}
