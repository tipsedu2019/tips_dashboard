import {
  ContentValidationError,
  FIELDS,
  MAX_IMPORT_ROWS,
  normalizeDraft,
  type ContentDraft,
  type ContentKind,
} from "./content-contract.ts";
export type ImportReview = {
  entries: ContentDraft[];
  errors: { row: number; message: string }[];
  count: number;
};
const aliases: Record<string, string> = {
  이름: "name",
  공개이름: "name",
  작성자: "role",
  유형: "role",
  후기: "content",
  후기원문: "content",
  내용: "content",
  과목: "subject",
  작성일: "date",
  년도: "year",
  연도: "year",
  시험: "exam",
  학교: "school",
  학년: "grade",
  선생님: "teacher",
  점수: "score",
  등급: "rating",
  gradeBand: "rating",
  석차: "rank",
  과목상세: "detail",
};
export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = source
    .slice(0, source.indexOf("\n") < 0 ? undefined : source.indexOf("\n"))
    .includes("\t")
    ? "\t"
    : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (!cell) quoted = true;
      else cell += char;
    } else if (
      !quoted &&
      (char === delimiter || char === "\n" || char === "\r")
    ) {
      row.push(cell);
      cell = "";
      if (char !== delimiter) {
        if (char === "\r" && source[i + 1] === "\n") i++;
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
      }
    } else cell += char;
  }
  if (quoted) throw new Error("따옴표로 묶인 셀이 끝나지 않았습니다.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
export function reviewImport(
  kind: ContentKind,
  rows: string[][],
): ImportReview {
  if (kind === "teacher") throw new Error("선생님 소개는 개별 추가해 주세요.");
  if (rows.length < 2)
    throw new Error(
      "첫 줄에 항목 이름을 넣고, 두 번째 줄부터 자료를 입력해 주세요.",
    );
  if (rows.length - 1 > MAX_IMPORT_ROWS)
    throw new Error(`한 번에 ${MAX_IMPORT_ROWS}행까지 가져올 수 있습니다.`);
  const keys = rows[0].map(
    (label) => aliases[label.replace(/\s/g, "")] || label.trim(),
  );
  if (new Set(keys).size !== keys.length)
    throw new Error("같은 이름의 열이 두 번 있습니다.");
  const unknown = keys.filter(
    (key) => !FIELDS[kind].some((field) => field.key === key),
  );
  if (unknown.length)
    throw new Error(`지원하지 않는 열: ${unknown.join(", ")}`);
  const entries: ContentDraft[] = [],
    errors: ImportReview["errors"] = [];
  rows.slice(1).forEach((cells, index) => {
    if (cells.length > keys.length) {
      errors.push({
        row: index + 2,
        message: "머리글보다 셀 개수가 많습니다.",
      });
      return;
    }
    const data = Object.fromEntries(
      keys.map((key, i) => [key, cells[i] || ""]),
    );
    if (data.role === "학부모") data.role = "학부모님";
    try {
      entries.push(
        normalizeDraft({
          kind,
          data,
          isPublished: false,
          sortOrder: index * 10,
        }),
      );
    } catch (error) {
      errors.push({
        row: index + 2,
        message:
          error instanceof ContentValidationError
            ? Object.values(error.fields).join(" ")
            : "내용을 확인해 주세요.",
      });
    }
  });
  return { entries, errors, count: rows.length - 1 };
}
function xml(text: string, Parser: typeof DOMParser) {
  const doc = new Parser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("엑셀 파일의 XML 형식이 올바르지 않습니다.");
  return doc;
}
// OpenXML built-ins for calendar dates, including the Korean/Japanese locale set.
// Time-only formats (18–21, 32–33, 45–47) must never turn scores into dates.
const DATE_FORMATS = new Set([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55,
  56, 57, 58, 71, 72, 73, 74, 77, 81,
]);
function dateStyles(styles: Document | null): Set<number> {
  if (!styles) return new Set();
  const custom = new Map(
    Array.from(styles.getElementsByTagName("numFmt")).map((node) => [
      Number(node.getAttribute("numFmtId")),
      node.getAttribute("formatCode") || "",
    ]),
  );
  const formats =
    styles.getElementsByTagName("cellXfs")[0]?.getElementsByTagName("xf") || [];
  const dates = new Set<number>();
  Array.from(formats).forEach((format, index) => {
    const id = Number(format.getAttribute("numFmtId"));
    const code = custom.get(id);
    // Ignore quoted text, escaped literals, spacing/fill directives and locale/colour tags.
    const tokens = code?.replace(/"[^"]*"|\\.|_.|\*.|\[[^\]]*\]/g, "");
    if (code === undefined ? DATE_FORMATS.has(id) : /[yd]/i.test(tokens || ""))
      dates.add(index);
  });
  return dates;
}
function calendarDate(value: string, date1904: boolean): string {
  if (!value.trim()) return value;
  const serial = Number(value),
    day = Math.floor(serial);
  if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 1)) return value;
  // Excel keeps the non-existent 1900-02-29 as serial 60. Preserve that visible
  // value so the existing date validator reports the row instead of shifting it.
  if (!date1904 && day === 60) return "1900-02-29";
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(
    epoch + (day - (!date1904 && day > 60 ? 1 : 0)) * 86400000,
  );
  if (!Number.isFinite(date.getTime())) return value;
  const result = date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : value;
}
export async function readSpreadsheet(
  file: File,
  Parser: typeof DOMParser = DOMParser,
): Promise<string[][]> {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("가져오기 파일은 8MB 이내로 선택해 주세요.");
  if (/\.(csv|tsv|txt)$/i.test(file.name))
    return parseDelimited(await file.text());
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("CSV, TSV 또는 XLSX 파일을 선택해 주세요.");
  const { unzipSync, strFromU8 } = await import("fflate");
  let expanded = 0;
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (item) => {
      const wanted =
        /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/sheet\d+\.xml)$/.test(
          item.name,
        );
      if (wanted) {
        expanded += item.originalSize;
        if (expanded > 20 * 1024 * 1024)
          throw new Error(
            "압축을 푼 자료가 너무 큽니다. 필요한 행만 새 파일로 저장해 주세요.",
          );
      }
      return wanted;
    },
  });
  const get = (path: string) => {
    if (!archive[path]) throw new Error("엑셀 워크시트를 찾지 못했습니다.");
    return xml(strFromU8(archive[path]), Parser);
  };
  const workbook = get("xl/workbook.xml"),
    relation = get("xl/_rels/workbook.xml.rels");
  const date1904 = ["1", "true"].includes(
    workbook.getElementsByTagName("workbookPr")[0]?.getAttribute("date1904") ||
      "",
  );
  const calendarStyles = dateStyles(
    archive["xl/styles.xml"] ? get("xl/styles.xml") : null,
  );
  const first = workbook.getElementsByTagName("sheet")[0];
  if (!first) throw new Error("엑셀 시트가 비어 있습니다.");
  const relId = first.getAttribute("r:id");
  const target =
    Array.from(relation.getElementsByTagName("Relationship"))
      .find((node) => node.getAttribute("Id") === relId)
      ?.getAttribute("Target") || "";
  const sheetPath = target.startsWith("/xl/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;
  if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(sheetPath))
    throw new Error("지원하지 않는 워크시트 연결입니다.");
  const shared = archive["xl/sharedStrings.xml"]
    ? Array.from(get("xl/sharedStrings.xml").getElementsByTagName("si")).map(
        (si) =>
          Array.from(si.getElementsByTagName("t"))
            .map((node) => node.textContent || "")
            .join(""),
      )
    : [];
  const sheet = get(sheetPath),
    result: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const address = cell.getAttribute("r") || "";
      const letters = /^[A-Z]+/.exec(address)?.[0];
      if (!letters) continue;
      const index =
        Array.from(letters).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) -
        1;
      if (index > 63) throw new Error("가져올 열은 64개 이내로 정리해 주세요.");
      const type = cell.getAttribute("t"),
        v = cell.getElementsByTagName("v")[0]?.textContent || "";
      if (type === "s") cells[index] = v.trim() ? shared[Number(v)] || "" : "";
      else if (type === "inlineStr")
        cells[index] = Array.from(cell.getElementsByTagName("t"))
          .map((node) => node.textContent || "")
          .join("");
      else if (
        type === "d" &&
        /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v) &&
        Number.isFinite(Date.parse(v))
      )
        cells[index] = v.slice(0, 10);
      else if (
        (!type || type === "n") &&
        calendarStyles.has(Number(cell.getAttribute("s") || 0))
      )
        cells[index] = calendarDate(v, date1904);
      else cells[index] = v;
    }
    if (cells.some((value) => value?.trim()))
      result.push(
        Array.from({ length: cells.length }, (_, i) => cells[i] || ""),
      );
    if (result.length > MAX_IMPORT_ROWS + 1)
      throw new Error(`한 번에 ${MAX_IMPORT_ROWS}행까지 가져올 수 있습니다.`);
  }
  return result;
}
export function importTemplate(kind: ContentKind) {
  return "\uFEFF" + FIELDS[kind].map((field) => field.label).join(",") + "\r\n";
}
