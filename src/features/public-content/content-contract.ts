export const CONTENT_KINDS = ["teacher", "review", "result"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export type ContentData = Record<string, string>;
export type ContentDraft = {
  kind: ContentKind;
  data: ContentData;
  sortOrder: number;
  isPublished: boolean;
};
export type ContentEntry = ContentDraft & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  previewUrls?: Record<string, string>;
};
export type ContentChange =
  | { id: string; expectedVersion: number; action: "save"; entry: ContentDraft }
  | { id: string; expectedVersion: number; action: "delete" };
export type ContentField = {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  options?: string[];
  placeholder?: string;
  max: number;
};
export const KIND_LABELS: Record<ContentKind, string> = {
  teacher: "선생님 소개",
  review: "공개 후기",
  result: "성적 공유",
};
export const FIELDS: Record<ContentKind, ContentField[]> = {
  teacher: [
    { key: "name", label: "이름", required: true, max: 80 },
    {
      key: "subject",
      label: "과목",
      options: ["", "영어", "수학", "과학"],
      max: 10,
    },
    { key: "description", label: "소개", multiline: true, max: 2000 },
    { key: "portraitUrl", label: "캐릭터 이미지", required: true, max: 2000 },
    { key: "videoUrl", label: "캐릭터 영상", max: 2000 },
    { key: "legacyId", label: "기존 캐릭터 연결", max: 2 },
  ],
  review: [
    {
      key: "name",
      label: "공개 이름",
      required: true,
      placeholder: "김*수",
      max: 80,
    },
    {
      key: "role",
      label: "작성자",
      required: true,
      options: ["학생", "학부모님"],
      max: 10,
    },
    {
      key: "subject",
      label: "과목",
      options: ["", "영어", "수학", "과학"],
      max: 10,
    },
    {
      key: "content",
      label: "후기 원문",
      required: true,
      multiline: true,
      max: 8000,
    },
    { key: "date", label: "작성일", placeholder: "2026-09-12", max: 10 },
  ],
  result: [
    { key: "year", label: "년도", required: true, max: 4 },
    { key: "exam", label: "시험", required: true, max: 80 },
    { key: "school", label: "학교", required: true, max: 100 },
    {
      key: "grade",
      label: "학년",
      required: true,
      placeholder: "고1",
      max: 30,
    },
    {
      key: "name",
      label: "공개 이름",
      required: true,
      placeholder: "김*수",
      max: 80,
    },
    { key: "subject", label: "과목", required: true, max: 30 },
    { key: "teacher", label: "선생님", max: 80 },
    { key: "score", label: "점수", placeholder: "95.8", max: 8 },
    { key: "rating", label: "등급", placeholder: "1등급", max: 30 },
    { key: "rank", label: "석차", max: 30 },
    { key: "detail", label: "과목상세", max: 120 },
  ],
};
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const MEDIA_PATH =
  /^storage:teachers\/[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp|mp4|webm)$/i;
export const MAX_IMPORT_ROWS = 500;
export class ContentValidationError extends Error {
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super("입력 내용을 확인해 주세요.");
    this.fields = fields;
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
export function maskPublicName(value: string) {
  const name = value.trim();
  const safeUnit = /^(?:익명|[가-힣A-Za-z][*○●•ㅇ]{1,6}[가-힣A-Za-z]?)$/u;
  const units = name.split(/[,·/;&]/u).map((part) => part.trim());
  if (units.every((part) => safeUnit.test(part))) return name;
  return units
    .map((part) => {
      if (safeUnit.test(part)) return part;
      const plain = part
        .replace(/\([^)]*\)|\[[^\]]*\]/gu, "")
        .replace(/[^가-힣A-Za-z]/gu, "")
        .replace(/ㅇ/gu, "");
      const chars = Array.from(plain);
      if (!chars.length) return "익명";
      return chars.length < 3
        ? `${chars[0]}*`
        : `${chars[0]}${"*".repeat(Math.min(chars.length - 2, 6))}${chars[chars.length - 1]}`;
    })
    .join(", ");
}
export function validMedia(value: string, type: "image" | "video") {
  if (!value) return true;
  if (MEDIA_PATH.test(value))
    return type === "image"
      ? /\.(png|jpe?g|webp)$/i.test(value)
      : /\.(mp4|webm)$/i.test(value);
  // Approved existing site assets can remain relative; new media uses the private upload bucket.
  if (
    /^\/assets\/(?:landing\/)?v\d+\/[a-zA-Z0-9/_-]+\.(?:png|jpe?g|webp|mp4|webm)$/i.test(
      value,
    )
  )
    return type === "image"
      ? /\.(png|jpe?g|webp)$/i.test(value)
      : /\.(mp4|webm)$/i.test(value);
  return false;
}
export function normalizeDraft(input: unknown): ContentDraft {
  const errors: Record<string, string> = {};
  if (
    !isRecord(input) ||
    !CONTENT_KINDS.includes(input.kind as ContentKind) ||
    !isRecord(input.data)
  )
    throw new ContentValidationError({ form: "콘텐츠 형식을 확인해 주세요." });
  const kind = input.kind as ContentKind,
    data: ContentData = {};
  if (
    Object.keys(input).some(
      (key) => !["kind", "data", "sortOrder", "isPublished"].includes(key),
    )
  )
    errors.form = "알 수 없는 항목이 포함되어 있습니다.";
  if (
    Object.keys(input.data).some(
      (key) => !FIELDS[kind].some((field) => field.key === key),
    )
  )
    errors.form = "지원하지 않는 필드가 있습니다.";
  for (const field of FIELDS[kind]) {
    const raw = input.data[field.key];
    const value =
      typeof raw === "number" && ["year", "score"].includes(field.key)
        ? String(raw)
        : typeof raw === "string"
          ? kind === "review" && field.key === "content"
            ? raw
            : raw.trim()
          : raw == null
            ? ""
            : "";
    data[field.key] = value;
    if (
      raw != null &&
      typeof raw !== "string" &&
      !(typeof raw === "number" && ["year", "score"].includes(field.key))
    )
      errors[field.key] = "문자로 입력해 주세요.";
    if (field.required && !value.trim())
      errors[field.key] = `${field.label}을(를) 입력해 주세요.`;
    if (value.length > field.max)
      errors[field.key] = `${field.max}자 이내로 입력해 주세요.`;
    if (field.options && !field.options.includes(value))
      errors[field.key] = "목록에서 선택해 주세요.";
  }
  if (
    !Number.isInteger(input.sortOrder) ||
    Number(input.sortOrder) < 0 ||
    Number(input.sortOrder) > 99999
  )
    errors.sortOrder = "표시 순서는 0~99999 사이의 정수입니다.";
  if (typeof input.isPublished !== "boolean")
    errors.isPublished = "공개 상태를 선택해 주세요.";
  if (kind === "teacher") {
    if (!validMedia(data.portraitUrl, "image"))
      errors.portraitUrl =
        "이미지를 업로드하거나 기존 홈페이지 이미지 경로를 사용해 주세요.";
    if (!validMedia(data.videoUrl, "video"))
      errors.videoUrl =
        "영상을 업로드하거나 기존 홈페이지 영상 경로를 사용해 주세요.";
    if (data.legacyId && !/^0[1-7]$/.test(data.legacyId))
      errors.legacyId = "기존 캐릭터 연결을 확인해 주세요.";
  } else data.name = maskPublicName(data.name);
  if (
    kind === "review" &&
    data.date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
      !Number.isFinite(Date.parse(data.date)) ||
      new Date(data.date).toISOString().slice(0, 10) !== data.date)
  )
    errors.date = "실제 날짜를 YYYY-MM-DD로 입력해 주세요.";
  if (kind === "result") {
    if (
      !/^\d{4}$/.test(data.year) ||
      Number(data.year) < 2000 ||
      Number(data.year) > 2100
    )
      errors.year = "2000~2100 사이의 년도를 입력해 주세요.";
    if (
      data.score &&
      (!/^\d{1,3}(?:\.\d{1,2})?$/.test(data.score) || Number(data.score) > 100)
    )
      errors.score = "점수는 0~100 사이, 소수 둘째 자리까지 입력해 주세요.";
    if (!data.score && !data.rating && !data.rank)
      errors.score = "점수·등급·석차 중 하나 이상 입력해 주세요.";
  }
  if (Object.keys(errors).length) throw new ContentValidationError(errors);
  return {
    kind,
    data,
    sortOrder: Number(input.sortOrder),
    isPublished: input.isPublished as boolean,
  };
}
export function normalizeChanges(input: unknown): {
  requestId: string;
  changes: ContentChange[];
} {
  if (
    !isRecord(input) ||
    typeof input.requestId !== "string" ||
    !UUID.test(input.requestId) ||
    !Array.isArray(input.changes) ||
    !input.changes.length ||
    input.changes.length > MAX_IMPORT_ROWS ||
    Object.keys(input).some((key) => !["requestId", "changes"].includes(key))
  )
    throw new ContentValidationError({
      form: "한 번에 1~500개 항목을 적용할 수 있습니다.",
    });
  const ids = new Set<string>();
  const changes = input.changes.map((raw, index): ContentChange => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !UUID.test(raw.id) ||
      ids.has(raw.id) ||
      !Number.isInteger(raw.expectedVersion) ||
      Number(raw.expectedVersion) < 0 ||
      !["save", "delete"].includes(String(raw.action))
    )
      throw new ContentValidationError({
        form: `${index + 1}번째 항목의 식별 정보가 올바르지 않습니다.`,
      });
    ids.add(raw.id);
    if (raw.action === "delete") {
      if (
        raw.expectedVersion === 0 ||
        Object.keys(raw).some(
          (key) => !["id", "expectedVersion", "action"].includes(key),
        )
      )
        throw new ContentValidationError({
          form: "삭제할 항목을 다시 불러와 주세요.",
        });
      return {
        id: raw.id,
        expectedVersion: Number(raw.expectedVersion),
        action: "delete",
      };
    }
    if (
      Object.keys(raw).some(
        (key) => !["id", "expectedVersion", "action", "entry"].includes(key),
      )
    )
      throw new ContentValidationError({
        form: "알 수 없는 항목이 포함되어 있습니다.",
      });
    return {
      id: raw.id,
      expectedVersion: Number(raw.expectedVersion),
      action: "save",
      entry: normalizeDraft(raw.entry),
    };
  });
  return { requestId: input.requestId, changes };
}
