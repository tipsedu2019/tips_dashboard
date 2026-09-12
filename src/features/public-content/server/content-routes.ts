import { createHash } from "node:crypto";
import {
  ContentValidationError,
  CONTENT_KINDS,
  FIELDS,
  MEDIA_PATH,
  UUID,
  isRecord,
  maskPublicName,
  normalizeChanges,
  normalizeDraft,
  type ContentChange,
  type ContentKind,
  type ContentEntry,
} from "../content-contract.ts";
import {
  authenticateContentAdmin,
  ContentStoreError,
  publicAsset,
  publishedEntries,
  type ContentEnvironment,
  type ContentIdentity,
} from "./content-store.ts";
import seed from "../data/approved-seed.json" with { type: "json" };
const plural: Record<string, ContentKind> = {
  teachers: "teacher",
  reviews: "review",
  results: "result",
};
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const error = (code: string, status: number, fields?: Record<string, string>) =>
  json({ ok: false, code, ...(fields ? { fields } : {}) }, status);
function resultError(failure: unknown) {
  if (failure instanceof ContentValidationError)
    return error("invalid_input", 400, failure.fields);
  if (failure instanceof ContentStoreError) {
    if (
      ["version_conflict", "bootstrap_not_empty", "request_reused"].includes(
        failure.code,
      )
    )
      return error(failure.code, 409);
    if (failure.code === "invalid_upload") return error(failure.code, 400);
    if (failure.code === "not_found") return error("not_found", 404);
  }
  return error("content_unavailable", 503);
}
async function readJson(request: Request) {
  if (
    !(request.headers.get("content-type") || "").startsWith("application/json")
  )
    throw new ContentValidationError({ form: "JSON 형식으로 요청해 주세요." });
  const reader = request.body?.getReader();
  if (!reader)
    throw new ContentValidationError({ form: "내용이 비어 있습니다." });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new ContentValidationError({ form: "요청 용량이 너무 큽니다." });
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks);
    return JSON.parse(text.toString("utf8"));
  } catch (failure) {
    if (failure instanceof ContentValidationError) throw failure;
    throw new ContentValidationError({ form: "요청 내용을 읽지 못했습니다." });
  } finally {
    reader.releaseLock();
  }
}
function sameOrigin(request: Request, env: ContentEnvironment) {
  const origin = request.headers.get("origin");
  const allow = [
    new URL(request.url).origin,
    ...(env.PUBLIC_CONTENT_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  return Boolean(origin && allow.includes(origin));
}
function stableId(kind: string, id: string) {
  const value = createHash("sha256")
    .update(`tips-approved-site-v1:${kind}:${id}`)
    .digest("hex")
    .slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20)}`;
}
export function approvedSeedChanges(): ContentChange[] {
  return Object.entries(plural).flatMap(([key, kind]) =>
    (
      seed[key as "teachers" | "reviews" | "results"] as unknown as Record<
        string,
        unknown
      >[]
    ).map((row) => ({
      id: stableId(kind, String(row.id)),
      expectedVersion: 0,
      action: "save" as const,
      entry: normalizeDraft({
        kind,
        data: Object.fromEntries(
          FIELDS[kind].map((field) => [field.key, row[field.key] ?? ""]),
        ),
        sortOrder: row.sortOrder,
        isPublished: true,
      }),
    })),
  );
}
export function createContentAdminHandlers({
  env = process.env,
  authenticate = (request: Request) => authenticateContentAdmin(request, env),
}: {
  env?: ContentEnvironment;
  authenticate?: (request: Request) => Promise<ContentIdentity>;
} = {}) {
  const run = async (request: Request, upload = false) => {
    try {
      const identity = await authenticate(request);
      if ("status" in identity)
        return error(
          identity.status === 401 ? "unauthorized" : "content_unavailable",
          identity.status,
        );
      if (identity.role !== "admin") return error("forbidden", 403);
      if (env.PUBLIC_CONTENT_MANAGEMENT_ENABLED !== "true")
        return error("content_not_enabled", 503);
      if (
        !["GET", "POST"].includes(request.method) ||
        (upload && request.method !== "POST")
      )
        return error("method_not_allowed", 405);
      const url = new URL(request.url);
      if (request.method === "GET") {
        if (url.searchParams.get("action") === "reorder") {
          const id = url.searchParams.get("id") || "",
            direction = Number(url.searchParams.get("direction"));
          if (!UUID.test(id) || ![-1, 1].includes(direction))
            return error("invalid_input", 400);
          return json({
            ok: true,
            changes: await identity.store.reorder(id, direction),
          });
        }
        if (url.searchParams.get("action") === "bootstrap") {
          const canApply = await identity.store.empty();
          const changes = approvedSeedChanges();
          return json({
            ok: true,
            canApply,
            counts: Object.fromEntries(
              CONTENT_KINDS.map((kind) => [
                kind,
                changes.filter(
                  (change) =>
                    change.action === "save" && change.entry.kind === kind,
                ).length,
              ]),
            ),
          });
        }
        const q = (url.searchParams.get("q") || "").trim(),
          subject = url.searchParams.get("subject") || "",
          status = url.searchParams.get("status") || "all";
        const kind = url.searchParams.get("kind") as ContentKind;
        const page = Number(url.searchParams.get("page") || 1),
          pageSize = Number(url.searchParams.get("pageSize") || 10);
        if (
          q.length > 100 ||
          subject.length > 30 ||
          !["all", "published", "draft"].includes(status) ||
          !CONTENT_KINDS.includes(kind) ||
          !Number.isInteger(page) ||
          page < 1 ||
          page > 10000 ||
          ![10, 15, 20].includes(pageSize) ||
          Array.from(url.searchParams.keys()).some(
            (k) =>
              !["kind", "page", "pageSize", "q", "subject", "status"].includes(
                k,
              ),
          )
        )
          return error("invalid_input", 400);
        const result = await identity.store.list({
          kind,
          page,
          pageSize,
          q,
          subject,
          status,
        });
        for (const row of result.entries) {
          if (row.kind !== "teacher") continue;
          row.previewUrls = {};
          for (const key of ["portraitUrl", "videoUrl"]) {
            const value = row.data[key];
            if (MEDIA_PATH.test(value))
              row.previewUrls[key] = await identity.store
                .preview(value)
                .catch(() => "");
            else if (value.startsWith("/assets/"))
              row.previewUrls[key] = new URL(
                value,
                env.PUBLIC_CONTENT_SITE_ORIGIN || "https://tipsedu.co.kr",
              ).href;
          }
        }
        return json({ ok: true, ...result });
      }
      if (!sameOrigin(request, env)) return error("origin_not_allowed", 403);
      const body = await readJson(request);
      if (upload) {
        if (!isRecord(body)) return error("invalid_input", 400);
        if (
          body.action === "preview" &&
          typeof body.reference === "string" &&
          MEDIA_PATH.test(body.reference)
        )
          return json({
            ok: true,
            url: await identity.store.preview(body.reference),
          });
        if (
          typeof body.contentType !== "string" ||
          typeof body.size !== "number"
        )
          return error("invalid_input", 400);
        return json({
          ok: true,
          ...(await identity.store.upload(body.contentType, body.size)),
        });
      }
      if (isRecord(body) && body.action === "bootstrap") {
        if (
          typeof body.requestId !== "string" ||
          !UUID.test(body.requestId) ||
          body.confirm !== true ||
          Object.keys(body).some(
            (key) => !["action", "requestId", "confirm"].includes(key),
          )
        )
          return error("invalid_input", 400);
        return json({
          ok: true,
          result: await identity.store.apply(
            body.requestId,
            approvedSeedChanges(),
            true,
          ),
        });
      }
      const input = normalizeChanges(body);
      return json({
        ok: true,
        result: await identity.store.apply(input.requestId, input.changes),
      });
    } catch (failure) {
      return resultError(failure);
    }
  };
  return {
    entries: (request: Request) => run(request),
    uploads: (request: Request) => run(request, true),
  };
}
function publicRecord(row: ContentEntry) {
  const data = Object.fromEntries(
    FIELDS[row.kind].map((field) => [field.key, row.data[field.key] || ""]),
  );
  if (row.kind !== "teacher") data.name = maskPublicName(data.name);
  for (const key of ["portraitUrl", "videoUrl"]) {
    if (MEDIA_PATH.test(data[key] || ""))
      data[key] = `/api/public-content/assets/${data[key].slice(8)}`;
  }
  return { id: row.id, ...data, sortOrder: row.sortOrder };
}
export function createPublicContentHandler({
  env = process.env,
  read = (kind: ContentKind) => publishedEntries(env, kind),
}: {
  env?: ContentEnvironment;
  read?: (kind: ContentKind) => Promise<ContentEntry[]>;
} = {}) {
  return async (request: Request) => {
    if (request.method !== "GET") return error("method_not_allowed", 405);
    if (env.PUBLIC_CONTENT_PUBLIC_READ_ENABLED !== "true")
      return error("content_not_enabled", 503);
    try {
      const params = new URL(request.url).searchParams;
      const key = params.get("kind");
      if (
        (key && !plural[key]) ||
        Array.from(params.keys()).some((k) => !["kind", "refresh"].includes(k))
      )
        return error("invalid_input", 400);
      const headers = {
        "Cache-Control": params.has("refresh")
          ? "no-store"
          : "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
      };
      if (key)
        return json(
          {
            ok: true,
            schemaVersion: 1,
            kind: key,
            records: (await read(plural[key]))
              .filter((row) => row.isPublished)
              .map(publicRecord),
          },
          200,
          headers,
        );
      const values = await Promise.all(
        Object.entries(plural).map(async ([label, kind]) => [
          label,
          (await read(kind)).filter((row) => row.isPublished).map(publicRecord),
        ]),
      );
      return json(
        { ok: true, schemaVersion: 1, ...Object.fromEntries(values) },
        200,
        headers,
      );
    } catch (failure) {
      return resultError(failure);
    }
  };
}
export async function servePublicContentAsset(
  request: Request,
  path: string[],
  env: ContentEnvironment = process.env,
) {
  if (request.method !== "GET") return error("method_not_allowed", 405);
  if (env.PUBLIC_CONTENT_PUBLIC_READ_ENABLED !== "true")
    return error("content_not_enabled", 503);
  const name = path.join("/");
  if (!MEDIA_PATH.test(`storage:${name}`)) return error("not_found", 404);
  try {
    return new Response(null, {
      status: 302,
      headers: {
        Location: await publicAsset(env, name),
        "Cache-Control": "public, max-age=0, s-maxage=60",
      },
    });
  } catch (failure) {
    return resultError(failure);
  }
}
