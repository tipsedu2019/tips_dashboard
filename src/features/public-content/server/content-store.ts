import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type {
  ContentChange,
  ContentEntry,
  ContentKind,
} from "../content-contract.ts";
export type ContentEnvironment = Record<string, string | undefined>;
export const MEDIA_BUCKET = "public-site-media";
export class ContentStoreError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export const settings = (env: ContentEnvironment) => ({
  url: (
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    ""
  ).trim(),
  key: (
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    ""
  ).trim(),
  service: (env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
});
function client(url: string, key: string, token?: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        }),
    },
  });
}
const SELECT =
  "id,kind,data,sort_order,is_published,version,created_at,updated_at";
function entry(row: Record<string, unknown>): ContentEntry {
  return {
    id: String(row.id),
    kind: row.kind as ContentKind,
    data: row.data as ContentEntry["data"],
    sortOrder: Number(row.sort_order),
    isPublished: row.is_published === true,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
export type ContentStore = {
  list(input: {
    kind: ContentKind;
    page: number;
    pageSize: number;
    q?: string;
    subject?: string;
    status?: string;
  }): Promise<{ entries: ContentEntry[]; totalCount: number }>;
  apply(
    requestId: string,
    changes: ContentChange[],
    bootstrap?: boolean,
  ): Promise<unknown>;
  empty(): Promise<boolean>;
  reorder(id: string, direction: number): Promise<ContentChange[]>;
  upload(
    type: string,
    size: number,
  ): Promise<{
    reference: string;
    upload: { signedUrl: string; path: string; token: string };
  }>;
  preview(reference: string): Promise<string>;
};
function adminStore(db: SupabaseClient, env: ContentEnvironment): ContentStore {
  return {
    async list({ kind, page, pageSize, q, subject, status }) {
      let query = db
        .from("public_site_entries")
        .select(SELECT, { count: "exact" })
        .eq("kind", kind);
      if (q)
        query = query.ilike("search_text", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
      if (subject)
        query = query.eq(
          "data->>subject",
          subject === "management" ? "" : subject,
        );
      if (status && status !== "all")
        query = query.eq("is_published", status === "published");
      const result = await query
        .order("sort_order")
        .order("id")
        .range((page - 1) * pageSize, page * pageSize - 1)
        .retry(false);
      if (result.error) throw new ContentStoreError("unavailable");
      return {
        entries: (result.data || []).map(entry),
        totalCount: result.count || 0,
      };
    },
    async apply(requestId, changes, bootstrap = false) {
      const result = await db
        .rpc("apply_public_site_changes_v1", {
          p_request_id: requestId,
          p_changes: changes,
          p_bootstrap: bootstrap,
        })
        .retry(false);
      if (result.error) {
        const message = result.error.message;
        throw new ContentStoreError(
          message.includes("version_conflict")
            ? "version_conflict"
            : message.includes("bootstrap_not_empty")
              ? "bootstrap_not_empty"
              : message.includes("request_reused")
                ? "request_reused"
                : "unavailable",
        );
      }
      return result.data;
    },
    async reorder(id, direction) {
      const result = await db
        .from("public_site_entries")
        .select(SELECT)
        .eq("kind", "teacher")
        .order("sort_order")
        .order("id")
        .limit(501)
        .retry(false);
      if (result.error || (result.data || []).length > 500)
        throw new ContentStoreError("unavailable");
      const all = (result.data || []).map(entry),
        selected = all.find((row) => row.id === id);
      if (!selected) throw new ContentStoreError("not_found");
      const group = all.filter(
          (row) => row.data.subject === selected.data.subject,
        ),
        index = group.findIndex((row) => row.id === id),
        other = index + direction;
      if (other < 0 || other >= group.length) return [];
      [group[index], group[other]] = [group[other], group[index]];
      return group.map((row, index) => ({
        id: row.id,
        expectedVersion: row.version,
        action: "save" as const,
        entry: {
          kind: row.kind,
          data: row.data,
          sortOrder: index * 10,
          isPublished: row.isPublished,
        },
      }));
    },
    async empty() {
      const result = await db
        .from("public_site_entries")
        .select("id", { count: "exact", head: true })
        .retry(false);
      if (result.error) throw new ContentStoreError("unavailable");
      return result.count === 0;
    },
    async upload(type, size) {
      const config = settings(env);
      if (!config.service) throw new ContentStoreError("unavailable");
      const extensions: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/webm": "webm",
      };
      const ext = extensions[type];
      if (
        !ext ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > (type.startsWith("image/") ? 8 : 40) * 1024 * 1024
      )
        throw new ContentStoreError("invalid_upload");
      const path = `teachers/${randomUUID()}.${ext}`;
      const { data, error } = await client(config.url, config.service)
        .storage.from(MEDIA_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (error || !data) throw new ContentStoreError("unavailable");
      return { reference: `storage:${path}`, upload: data };
    },
    async preview(reference) {
      const { data, error } = await db.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(reference.slice(8), 600);
      if (error || !data) throw new ContentStoreError("unavailable");
      return data.signedUrl;
    },
  };
}
export type ContentIdentity =
  { role: string; store: ContentStore } | { status: 401 | 503 };
export async function authenticateContentAdmin(
  request: Request,
  env: ContentEnvironment,
): Promise<ContentIdentity> {
  const token = /^Bearer ([^\s]+)$/i.exec(
    request.headers.get("authorization") || "",
  )?.[1];
  if (!token) return { status: 401 };
  const config = settings(env);
  if (!config.url || !config.key) return { status: 503 };
  try {
    const db = client(config.url, config.key, token);
    const identity = await db.auth.getUser(token);
    if (identity.error || !identity.data.user?.id) return { status: 401 };
    const role = await db.rpc("current_dashboard_role").retry(false);
    if (role.error) return { status: 503 };
    return {
      role: typeof role.data === "string" ? role.data : "",
      store: adminStore(db, env),
    };
  } catch {
    return { status: 503 };
  }
}
export async function publishedEntries(
  env: ContentEnvironment,
  kind: ContentKind,
): Promise<ContentEntry[]> {
  const config = settings(env);
  if (!config.url || !config.key) throw new ContentStoreError("unavailable");
  const db = client(config.url, config.key);
  const all: ContentEntry[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const result = await db
      .from("public_site_entries")
      .select("id,kind,data,sort_order,is_published")
      .eq("kind", kind)
      .eq("is_published", true)
      .order("sort_order")
      .order("id")
      .range(from, from + 999)
      .retry(false);
    if (result.error) throw new ContentStoreError("unavailable");
    const rows = (result.data || []).map(entry);
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
  throw new ContentStoreError("unavailable");
}
export async function publicAsset(env: ContentEnvironment, path: string) {
  const rows = await publishedEntries(env, "teacher");
  const reference = `storage:${path}`;
  if (
    !rows.some(
      (row) =>
        row.data.portraitUrl === reference || row.data.videoUrl === reference,
    )
  )
    throw new ContentStoreError("not_found");
  const config = settings(env);
  if (!config.service) throw new ContentStoreError("unavailable");
  const { data, error } = await client(config.url, config.service)
    .storage.from(MEDIA_BUCKET)
    .createSignedUrl(path, 600);
  if (error || !data) throw new ContentStoreError("not_found");
  return data.signedUrl;
}
