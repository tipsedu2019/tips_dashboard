const MAKEEDU_STUDENT_DETAIL_BASE = "https://school.makeedu.co.kr/member/student/list_detail.do";
const UNSAFE_DETAIL_ID_CHARACTER = /[^A-Za-z0-9_+/=-]/;

/** This opaque URL identifier is separate from both the internal UUID and uid. */
export function isMakeEduStudentDetailId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0 && value.length <= 256 && !UNSAFE_DETAIL_ID_CHARACTER.test(value)
    && !(/^[+\d-]+$/.test(value)
      && /^(?:0\d{8,10}|82\d{9,10})$/.test(value.replace(/\D/g, "")));
}

export function buildMakeEduStudentDetailUrl(detailId: unknown): string | null {
  return isMakeEduStudentDetailId(detailId)
    ? `${MAKEEDU_STUDENT_DETAIL_BASE}?studNo=${encodeURIComponent(detailId)}`
    : null;
}

export function parseMakeEduStudentDetailUrl(value: unknown): { detailId: string; url: string } | null {
  if (typeof value !== "string") return null;
  const input = value;
  // Check the original authority too: URL normalizes an explicitly supplied :443.
  if (!input.startsWith(`${MAKEEDU_STUDENT_DETAIL_BASE}?`)
    || input.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  try {
    const parsed = new URL(input);
    if (parsed.origin !== "https://school.makeedu.co.kr"
      || parsed.pathname !== "/member/student/list_detail.do"
      || parsed.username || parsed.password || parsed.port || parsed.hash
      || input.includes("#") || !/^\?studNo=[^&]+$/.test(parsed.search)) return null;
    const entries = [...parsed.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== "studNo") return null;
    const detailId = entries[0][1];
    const url = buildMakeEduStudentDetailUrl(detailId);
    return url ? { detailId, url } : null;
  } catch {
    return null;
  }
}
