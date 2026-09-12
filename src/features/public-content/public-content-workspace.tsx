"use client";
/* eslint-disable @next/next/no-img-element -- Private signed previews load directly; a public image optimizer must not cache them. */
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size";
import { ContentImportDialog } from "./content-import-dialog";
import {
  CONTENT_KINDS,
  ContentValidationError,
  FIELDS,
  KIND_LABELS,
  MEDIA_PATH,
  normalizeDraft,
  type ContentChange,
  type ContentDraft,
  type ContentEntry,
  type ContentKind,
} from "./content-contract";
const BASE = "/api/admin/public-content";
const messages: Record<string, string> = {
  content_not_enabled:
    "홈페이지 관리가 아직 운영 연결 전입니다. 배포와 운영 설정이 완료되면 사용할 수 있습니다.",
  unauthorized: "로그인 상태를 확인해 주세요.",
  forbidden: "관리자만 홈페이지 내용을 변경할 수 있습니다.",
  version_conflict:
    "다른 관리자가 이 자료를 변경했습니다. 입력 내용은 유지됩니다. 목록을 새로고침한 뒤 최신 자료를 열어 비교해 주세요.",
  bootstrap_not_empty:
    "이미 관리 중인 자료가 있습니다. 기존 자료를 중복으로 가져오지 않습니다.",
  request_reused:
    "요청 내용이 달라졌습니다. 수정 화면으로 돌아가 다시 검토해 주세요.",
};
type Review = {
  changes: ContentChange[];
  title: string;
  requestId: string;
  bootstrap?: boolean;
  allowBulkStatus?: boolean;
  counts?: Record<string, number>;
};
const label = (entry: ContentDraft) =>
  entry.kind === "result"
    ? `${entry.data.school} ${entry.data.grade} · ${entry.data.name}`
    : entry.data.name;
const description = (entry: ContentDraft) =>
  entry.kind === "teacher"
    ? entry.data.subject || "관리"
    : entry.kind === "review"
      ? entry.data.content
      : `${entry.data.year} ${entry.data.exam} · ${entry.data.subject} ${entry.data.score ? `${entry.data.score}점` : entry.data.rating || entry.data.rank}`;
function blank(kind: ContentKind): ContentDraft {
  return {
    kind,
    data: Object.fromEntries(
      FIELDS[kind].map((field) => [
        field.key,
        field.key === "role"
          ? "학생"
          : field.key === "year"
            ? String(new Date().getFullYear())
            : "",
      ]),
    ),
    sortOrder: 0,
    isPublished: false,
  };
}
function options(
  value: string,
  onChange: (value: string) => void,
  values: { value: string; label: string }[],
  name: string,
  id?: string,
  invalid = false,
) {
  return (
    <Select
      value={value || "__none"}
      onValueChange={(next) => onChange(next === "__none" ? "" : next)}
    >
      <SelectTrigger
        id={id}
        aria-invalid={invalid}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        aria-label={name}
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((option) => (
          <SelectItem value={option.value || "__none"} key={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function mediaSource(
  reference: string,
  preview: string | undefined,
  assetOrigin: string,
) {
  if (!reference) return "";
  if (reference.startsWith("/assets/"))
    return new URL(reference, assetOrigin).href;
  return MEDIA_PATH.test(reference) ? preview || "" : "";
}
function ContentReviewDetails({
  entry,
  previews,
  assetOrigin,
}: {
  entry: ContentDraft;
  previews?: Record<string, string>;
  assetOrigin: string;
}) {
  return (
    <dl className="space-y-3 text-sm">
      {FIELDS[entry.kind]
        .filter((field) => !["name", "legacyId"].includes(field.key))
        .map((field) => {
          const value = entry.data[field.key];
          const isMedia =
            field.key === "portraitUrl" || field.key === "videoUrl";
          const source = isMedia
            ? mediaSource(value, previews?.[field.key], assetOrigin)
            : "";
          return (
            <div
              key={field.key}
              className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3"
            >
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words leading-6">
                {isMedia ? (
                  source ? (
                    field.key === "portraitUrl" ? (
                      <img
                        src={source}
                        alt={`${entry.data.name} 저장할 캐릭터 이미지`}
                        className="max-h-48 max-w-full rounded-lg border object-contain"
                      />
                    ) : (
                      <video
                        src={source}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-48 w-full rounded-lg"
                      />
                    )
                  ) : value ? (
                    "미리보기를 불러오지 못했습니다. 수정 화면에서 파일을 확인해 주세요."
                  ) : (
                    "선택한 파일 없음"
                  )
                ) : (
                  value ||
                  (field.key === "subject"
                    ? entry.kind === "teacher"
                      ? "관리 · 과목 없음"
                      : "공통"
                    : "미입력")
                )}
              </dd>
            </div>
          );
        })}
      {entry.kind === "teacher" && (
        <div className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3">
          <dt className="text-muted-foreground">표시 순서</dt>
          <dd>{entry.sortOrder}</dd>
        </div>
      )}
    </dl>
  );
}
function TeacherThumbnail({
  entry,
  assetOrigin,
}: {
  entry: ContentEntry;
  assetOrigin: string;
}) {
  const [failed, setFailed] = useState(false);
  const portrait = mediaSource(
    entry.data.portraitUrl,
    entry.previewUrls?.portraitUrl,
    assetOrigin,
  );
  const src = entry.data.legacyId
    ? portrait.replace(
        /\/v14\/teachers\/0[1-7]\/frame-\d+\.webp$/,
        `/v15/teachers/thumbnails/${entry.data.legacyId}-144.webp`,
      )
    : portrait;
  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white text-lg text-muted-foreground">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        entry.data.name.slice(0, 1)
      )}
    </span>
  );
}
export function PublicContentWorkspace({
  accessToken,
  assetOrigin = "https://tipsedu.co.kr",
}: {
  accessToken: string;
  assetOrigin?: string;
}) {
  const [kind, setKind] = useState<ContentKind>("teacher"),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [q, setQ] = useState(""),
    [subject, setSubject] = useState(""),
    [status, setStatus] = useState("all");
  const { ready, pageSize, setPreference } = useDataTablePageSize(
    `public-content:${kind}`,
  );
  const [list, setList] = useState<{
      entries: ContentEntry[];
      totalCount: number;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{
      id: string;
      version: number;
      draft: ContentDraft;
      previewUrls: Record<string, string>;
    } | null>(null),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [review, setReview] = useState<Review | null>(null),
    [reviewPage, setReviewPage] = useState(1),
    [importing, setImporting] = useState(false),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState<string | null>(null),
    [dialogError, setDialogError] = useState("");
  const mutationPending = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const importReviewOpening = useRef(false);
  const rememberOpener = () => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const returnFocus = () =>
    (opener.current?.isConnected &&
    !opener.current.matches(":disabled, [aria-disabled='true']")
      ? opener.current
      : addButton.current
    )?.focus({
      preventScroll: true,
    });
  async function request(path: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok) {
      const failure = new Error(
        messages[data.code] ||
          "변경을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
      );
      Object.assign(failure, { fields: data.fields });
      throw failure;
    }
    return data;
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(query.trim());
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      kind,
      page: String(page),
      pageSize: String(pageSize),
      q,
      subject,
      status,
    });
    void request(`${BASE}?${params}`, undefined, controller.signal)
      .then((data) => {
        if (!live) return;
        const last = Math.max(1, Math.ceil(data.totalCount / pageSize));
        if (page > last) {
          setPage(last);
          return;
        }
        setList(data);
      })
      .catch((failure) => {
        if (live) {
          setError(failure.message);
          setList(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
    // Each request is scoped to the selected filters and authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, kind, page, pageSize, q, subject, status, revision, ready]);
  function switchKind(next: ContentKind) {
    setKind(next);
    setPage(1);
    setList(null);
    setQuery("");
    setQ("");
    setSubject("");
    setStatus("all");
  }
  function edit(entry?: ContentEntry) {
    rememberOpener();
    setFieldErrors({});
    setDialogError("");
    setEditing(
      entry
        ? {
            id: entry.id,
            version: entry.version,
            draft: {
              kind: entry.kind,
              data: { ...entry.data },
              sortOrder: entry.sortOrder,
              isPublished: entry.isPublished,
            },
            previewUrls: entry.previewUrls || {},
          }
        : {
            id: crypto.randomUUID(),
            version: 0,
            draft: blank(kind),
            previewUrls: {},
          },
    );
  }
  function update(key: string, value: string) {
    setEditing((current) =>
      current
        ? {
            ...current,
            previewUrls:
              key === "portraitUrl" || key === "videoUrl"
                ? { ...current.previewUrls, [key]: "" }
                : current.previewUrls,
            draft: {
              ...current.draft,
              data: { ...current.draft.data, [key]: value },
            },
          }
        : null,
    );
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }
  function showReview(
    changes: ContentChange[],
    title: string,
    allowBulkStatus = false,
  ) {
    setDialogError("");
    setReviewPage(1);
    setReview({
      changes,
      title,
      allowBulkStatus,
      requestId: crypto.randomUUID(),
    });
  }
  function reviewEditor() {
    if (!editing) return;
    try {
      const draft = normalizeDraft(editing.draft);
      showReview(
        [
          {
            id: editing.id,
            expectedVersion: editing.version,
            action: "save",
            entry: draft,
          },
        ],
        editing.version ? "변경 내용 확인" : "새 콘텐츠 확인",
      );
    } catch (failure) {
      if (failure instanceof ContentValidationError) {
        setFieldErrors(failure.fields);
        requestAnimationFrame(() =>
          document
            .getElementById(`content-${Object.keys(failure.fields)[0]}`)
            ?.focus(),
        );
      }
    }
  }
  async function apply() {
    if (!review || mutationPending.current) return;
    mutationPending.current = true;
    setSaving(true);
    setDialogError("");
    try {
      await request(
        BASE,
        review.bootstrap
          ? { action: "bootstrap", requestId: review.requestId, confirm: true }
          : { requestId: review.requestId, changes: review.changes },
      );
      setNotice(
        review.bootstrap
          ? "기존 홈페이지 자료를 가져왔습니다."
          : `${review.changes.length}개 항목을 적용했습니다.`,
      );
      setReview(null);
      setEditing(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setDialogError(
        failure instanceof Error ? failure.message : "다시 시도해 주세요.",
      );
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }
  async function bootstrap() {
    rememberOpener();
    setError("");
    try {
      const data = await request(`${BASE}?action=bootstrap`);
      if (!data.canApply) {
        setError(messages.bootstrap_not_empty);
        return;
      }
      setReviewPage(1);
      setDialogError("");
      setReview({
        changes: [],
        title: "기존 홈페이지 자료 확인",
        requestId: crypto.randomUUID(),
        bootstrap: true,
        counts: data.counts,
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "자료를 확인하지 못했습니다.",
      );
    }
  }
  async function upload(key: string, file?: File) {
    if (!file || !editing) return;
    setUploading(key);
    setDialogError("");
    try {
      const allowed =
        key === "portraitUrl"
          ? ["image/png", "image/jpeg", "image/webp"]
          : ["video/mp4", "video/webm"];
      if (
        !allowed.includes(file.type) ||
        file.size > (key === "portraitUrl" ? 8 : 40) * 1024 * 1024
      )
        throw new Error(
          key === "portraitUrl"
            ? "PNG·JPG·WebP 이미지, 8MB 이내로 선택해 주세요."
            : "MP4·WebM 영상, 40MB 이내로 선택해 주세요.",
        );
      const result = await request(`${BASE}/uploads`, {
        contentType: file.type,
        size: file.size,
      });
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const uploaded = await fetch(result.upload.signedUrl, {
        method: "PUT",
        body: form,
        headers: { "x-upsert": "false" },
        signal: AbortSignal.timeout(120000),
      });
      if (!uploaded.ok)
        throw new Error(
          "파일 업로드를 확인하지 못했습니다. 다시 선택해 주세요.",
        );
      const preview = await request(`${BASE}/uploads`, {
        action: "preview",
        reference: result.reference,
      });
      setEditing((current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                data: { ...current.draft.data, [key]: result.reference },
              },
              previewUrls: { ...current.previewUrls, [key]: preview.url },
            }
          : null,
      );
    } catch (failure) {
      setDialogError(
        failure instanceof Error
          ? failure.message
          : "파일을 올리지 못했습니다.",
      );
    } finally {
      setUploading(null);
    }
  }
  async function reorder(entry: ContentEntry, direction: number) {
    rememberOpener();
    setError("");
    try {
      const data = await request(
        `${BASE}?action=reorder&id=${entry.id}&direction=${direction}`,
      );
      if (!data.changes.length) {
        setNotice(
          direction < 0
            ? "같은 과목에서 첫 번째 선생님입니다."
            : "같은 과목에서 마지막 선생님입니다.",
        );
        return;
      }
      showReview(data.changes, "표시 순서 확인");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "순서를 확인하지 못했습니다.",
      );
    }
  }
  const rows = list?.entries || [];
  const modalOpen = Boolean(editing || review);
  const closeModal = () => {
    if (saving || uploading) return;
    setEditing(null);
    setReview(null);
    setDialogError("");
  };
  return (
    <div className="space-y-5 px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={kind}
          onValueChange={(value) => switchKind(value as ContentKind)}
        >
          <TabsList aria-label="홈페이지 콘텐츠 종류">
            {CONTENT_KINDS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {KIND_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading}
            aria-label="홈페이지 자료 새로고침"
          >
            <RefreshCw className="size-4" />
          </Button>
          {kind !== "teacher" && (
            <Button
              variant="outline"
              onClick={() => {
                rememberOpener();
                importReviewOpening.current = false;
                setImporting(true);
              }}
            >
              <Upload className="size-4" />
              자료 가져오기
            </Button>
          )}
          <Button ref={addButton} onClick={() => edit()}>
            <Plus className="size-4" />
            {kind === "teacher" ? "선생님 추가" : "직접 추가"}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="콘텐츠 검색"
            placeholder={
              kind === "result"
                ? "학교, 공개 이름, 시험 검색"
                : kind === "review"
                  ? "공개 이름, 후기 내용 검색"
                  : "선생님 이름 검색"
            }
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-72">
          {options(
            subject,
            (value) => {
              setSubject(value);
              setPage(1);
            },
            [
              { value: "", label: "전체 과목" },
              ...["영어", "수학", "과학"].map((value) => ({
                value,
                label: value,
              })),
              ...(kind === "teacher"
                ? [{ value: "management", label: "관리" }]
                : []),
            ],
            "과목 필터",
          )}
          {options(
            status,
            (value) => {
              setStatus(value);
              setPage(1);
            },
            [
              { value: "all", label: "전체 상태" },
              { value: "published", label: "공개" },
              { value: "draft", label: "초안" },
            ],
            "공개 상태 필터",
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className="text-sm">
          {notice} 공개 화면에 반영되기까지 최대 1분 정도 걸릴 수 있습니다.
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-3 rounded-lg border p-4 text-sm">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            다시 불러오기
          </Button>
        </div>
      )}
      <section aria-label={KIND_LABELS[kind]} aria-busy={loading}>
        {loading && !list ? (
          <p role="status" className="py-16 text-center text-muted-foreground">
            자료를 불러오고 있습니다.
          </p>
        ) : !error && !rows.length ? (
          <div className="space-y-4 rounded-xl border py-16 text-center">
            <p className="text-muted-foreground">
              {q || subject || status !== "all"
                ? "조건에 맞는 자료가 없습니다."
                : "아직 등록된 자료가 없습니다."}
            </p>
            {!q && !subject && status === "all" && (
              <Button variant="outline" onClick={() => void bootstrap()}>
                기존 홈페이지 자료 가져오기
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {rows.map((entry, index) => (
              <li
                key={entry.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                {kind === "teacher" && (
                  <TeacherThumbnail
                    key={entry.data.portraitUrl}
                    entry={entry}
                    assetOrigin={assetOrigin}
                  />
                )}
                <button
                  className="min-w-0 flex-1 space-y-1.5 text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => edit(entry)}
                  disabled={loading}
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {label(entry)}
                    <Badge
                      variant={entry.isPublished ? "default" : "secondary"}
                    >
                      {entry.isPublished ? "공개" : "초안"}
                    </Badge>
                  </span>
                  <span className="line-clamp-2 block text-sm text-muted-foreground">
                    {description(entry)}
                  </span>
                </button>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  {kind === "teacher" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${entry.data.name} 위로 이동`}
                        disabled={
                          loading ||
                          (!q &&
                            status === "all" &&
                            page === 1 &&
                            !rows
                              .slice(0, index)
                              .some(
                                (row) =>
                                  row.data.subject === entry.data.subject,
                              ))
                        }
                        onClick={() => reorder(entry, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${entry.data.name} 아래로 이동`}
                        disabled={
                          loading ||
                          (!q &&
                            status === "all" &&
                            page * pageSize >= (list?.totalCount || 0) &&
                            !rows
                              .slice(index + 1)
                              .some(
                                (row) =>
                                  row.data.subject === entry.data.subject,
                              ))
                        }
                        onClick={() => reorder(entry, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => edit(entry)}
                    disabled={loading}
                  >
                    수정
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <DataTablePagination
        page={page}
        pageSize={pageSize}
        totalCount={list?.totalCount ?? null}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPreference(value);
          setPage(1);
        }}
      />
      <div className="flex justify-end">
        <a
          className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
          href={
            new URL(
              `/${kind === "teacher" ? "teachers" : kind === "review" ? "reviews" : "results"}?refresh=1`,
              assetOrigin,
            ).href
          }
          target="_blank"
          rel="noreferrer"
        >
          공개 화면 확인
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      {importing && (
        <ContentImportDialog
          kind={kind}
          onReturnFocus={() => {
            if (!importReviewOpening.current) returnFocus();
          }}
          onClose={() => setImporting(false)}
          onReview={(entries) => {
            importReviewOpening.current = true;
            setImporting(false);
            showReview(
              entries.map((entry) => ({
                id: crypto.randomUUID(),
                expectedVersion: 0,
                action: "save",
                entry,
              })),
              "가져올 자료 확인",
              true,
            );
          }}
        />
      )}
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent
          data-content-review-dialog
          className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            importReviewOpening.current = false;
            returnFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {review
                ? review.title
                : `${KIND_LABELS[kind]} ${editing?.version ? "수정" : "추가"}`}
            </DialogTitle>
            <DialogDescription>
              {review
                ? "아래 내용을 확인한 뒤 적용합니다."
                : kind === "teacher"
                  ? "홈페이지 소개만 변경합니다. 선생님 계정과 수업 연결은 유지됩니다."
                  : "공개 이름은 자동으로 가려집니다. 후기 원문과 성적을 확인해 주세요."}
            </DialogDescription>
          </DialogHeader>
          {dialogError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {dialogError}
            </p>
          )}
          {review ? (
            <div className="space-y-4">
              {review.bootstrap ? (
                <>
                  <p className="text-sm leading-7">
                    현재 홈페이지에 공개된 선생님 {review.counts?.teacher}명,
                    후기 {review.counts?.review}건, 성적 {review.counts?.result}
                    건을 가져옵니다. 이후 이 화면에서 추가·수정·숨김을 관리할 수
                    있습니다.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    현재 홈페이지 원문과 캐릭터 연결을 유지하며, 관리 중인
                    자료가 있으면 중복으로 적용하지 않습니다.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      {review.changes.length}개 항목
                    </p>
                    {review.allowBulkStatus && (
                      <div className="w-40">
                        {options(
                          review.changes[0]?.action === "save" &&
                            review.changes[0].entry.isPublished
                            ? "published"
                            : "draft",
                          (value) =>
                            setReview((current) =>
                              current
                                ? {
                                    ...current,
                                    requestId: crypto.randomUUID(),
                                    changes: current.changes.map((change) =>
                                      change.action === "save"
                                        ? {
                                            ...change,
                                            entry: {
                                              ...change.entry,
                                              isPublished:
                                                value === "published",
                                            },
                                          }
                                        : change,
                                    ),
                                  }
                                : current,
                            ),
                          [
                            { value: "draft", label: "모두 초안" },
                            { value: "published", label: "모두 공개" },
                          ],
                          "가져올 자료 공개 상태",
                        )}
                      </div>
                    )}
                  </div>
                  <ul className="divide-y rounded-lg border">
                    {review.changes
                      .slice((reviewPage - 1) * 10, reviewPage * 10)
                      .map((change) => (
                        <li className="space-y-2 p-4" key={change.id}>
                          {change.action === "delete" ? (
                            <p className="text-destructive">
                              {editing?.draft.data.name || "선택한 콘텐츠"}를
                              홈페이지 관리에서 삭제합니다.
                            </p>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2 font-medium">
                                {label(change.entry)}
                                <Badge
                                  variant={
                                    change.entry.isPublished
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {change.entry.isPublished ? "공개" : "초안"}
                                </Badge>
                              </div>
                              <ContentReviewDetails
                                entry={change.entry}
                                assetOrigin={assetOrigin}
                                previews={
                                  editing?.id === change.id
                                    ? editing.previewUrls
                                    : rows.find((row) => row.id === change.id)
                                        ?.previewUrls
                                }
                              />
                            </>
                          )}
                        </li>
                      ))}
                  </ul>
                  {review.changes.length > 10 && (
                    <DataTablePagination
                      page={reviewPage}
                      pageSize={10}
                      totalCount={review.changes.length}
                      onPageChange={setReviewPage}
                      ariaLabel="가져올 자료 페이지"
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            editing && (
              <div className="space-y-4">
                {FIELDS[kind]
                  .filter((field) => field.key !== "legacyId")
                  .map((field) => (
                    <div key={field.key} className="space-y-2">
                      <label
                        htmlFor={`content-${field.key}`}
                        className="text-sm font-medium"
                      >
                        {field.label}
                        {field.required && <span aria-hidden="true"> *</span>}
                      </label>
                      {field.key === "portraitUrl" ||
                      field.key === "videoUrl" ? (
                        <div className="space-y-2">
                          <Input
                            id={`content-${field.key}`}
                            type="file"
                            accept={
                              field.key === "portraitUrl"
                                ? "image/png,image/jpeg,image/webp"
                                : "video/mp4,video/webm"
                            }
                            disabled={Boolean(uploading)}
                            aria-invalid={Boolean(fieldErrors[field.key])}
                            aria-describedby={
                              fieldErrors[field.key]
                                ? `content-${field.key}-error`
                                : undefined
                            }
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              void upload(field.key, file);
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {field.key === "portraitUrl"
                              ? "PNG·JPG·WebP · 8MB 이내"
                              : "MP4·WebM · 40MB 이내"}
                          </p>
                          {uploading === field.key ? (
                            <p role="status" className="text-sm">
                              파일을 올리고 있습니다…
                            </p>
                          ) : (
                            editing.draft.data[field.key] && (
                              <div className="space-y-2">
                                {field.key === "portraitUrl" ? (
                                  <img
                                    className="h-44 max-w-full rounded-lg border object-contain"
                                    src={mediaSource(
                                      editing.draft.data[field.key],
                                      editing.previewUrls[field.key],
                                      assetOrigin,
                                    )}
                                    alt={`${editing.draft.data.name || "선생님"} 캐릭터 미리보기`}
                                  />
                                ) : (
                                  <video
                                    className="max-h-48 w-full rounded-lg"
                                    src={mediaSource(
                                      editing.draft.data[field.key],
                                      editing.previewUrls[field.key],
                                      assetOrigin,
                                    )}
                                    controls
                                    playsInline
                                    preload="metadata"
                                  />
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => update(field.key, "")}
                                >
                                  선택 해제
                                </Button>
                              </div>
                            )
                          )}
                        </div>
                      ) : field.options ? (
                        options(
                          editing.draft.data[field.key],
                          (value) => update(field.key, value),
                          field.options.map((value) => ({
                            value,
                            label:
                              value ||
                              (kind === "teacher"
                                ? "관리 · 과목 없음"
                                : "공통"),
                          })),
                          field.label,
                          `content-${field.key}`,
                          Boolean(fieldErrors[field.key]),
                        )
                      ) : field.multiline ? (
                        <Textarea
                          id={`content-${field.key}`}
                          value={editing.draft.data[field.key]}
                          maxLength={field.max}
                          onChange={(event) =>
                            update(field.key, event.target.value)
                          }
                          rows={6}
                          aria-invalid={Boolean(fieldErrors[field.key])}
                          aria-describedby={
                            fieldErrors[field.key]
                              ? `content-${field.key}-error`
                              : undefined
                          }
                        />
                      ) : (
                        <Input
                          id={`content-${field.key}`}
                          value={editing.draft.data[field.key]}
                          maxLength={field.max}
                          placeholder={field.placeholder}
                          onChange={(event) =>
                            update(field.key, event.target.value)
                          }
                          aria-invalid={Boolean(fieldErrors[field.key])}
                          aria-describedby={
                            fieldErrors[field.key]
                              ? `content-${field.key}-error`
                              : undefined
                          }
                        />
                      )}{" "}
                      {fieldErrors[field.key] && (
                        <p
                          id={`content-${field.key}-error`}
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {fieldErrors[field.key]}
                        </p>
                      )}
                    </div>
                  ))}
                <div className="grid grid-cols-2 gap-4">
                  <label className="space-y-2 text-sm font-medium">
                    공개 상태
                    {options(
                      editing.draft.isPublished ? "published" : "draft",
                      (value) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                draft: {
                                  ...current.draft,
                                  isPublished: value === "published",
                                },
                              }
                            : null,
                        ),
                      [
                        { value: "draft", label: "초안" },
                        { value: "published", label: "공개" },
                      ],
                      "콘텐츠 공개 상태",
                    )}
                  </label>
                  <label
                    htmlFor="content-sortOrder"
                    className="space-y-2 text-sm font-medium"
                  >
                    표시 순서
                    <Input
                      id="content-sortOrder"
                      type="number"
                      min={0}
                      max={99999}
                      value={editing.draft.sortOrder}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                draft: {
                                  ...current.draft,
                                  sortOrder: Number(event.target.value),
                                },
                              }
                            : null,
                        )
                      }
                    />
                  </label>
                </div>
                {fieldErrors.sortOrder && (
                  <p role="alert" className="text-sm text-destructive">
                    {fieldErrors.sortOrder}
                  </p>
                )}
              </div>
            )
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {!review && editing?.version ? (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  showReview(
                    [
                      {
                        id: editing.id,
                        expectedVersion: editing.version,
                        action: "delete",
                      },
                    ],
                    "홈페이지 콘텐츠 삭제 확인",
                  )
                }
                disabled={Boolean(uploading)}
              >
                삭제
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (review && editing) {
                    setReview(null);
                    setDialogError("");
                  } else closeModal();
                }}
                disabled={saving || Boolean(uploading)}
              >
                {review && editing ? "수정으로 돌아가기" : "취소"}
              </Button>
              {review ? (
                <Button onClick={() => void apply()} disabled={saving}>
                  {saving ? "적용 중…" : "확인 후 적용"}
                </Button>
              ) : (
                <Button onClick={reviewEditor} disabled={Boolean(uploading)}>
                  내용 검토
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
