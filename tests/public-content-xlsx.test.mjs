import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { zipSync, strToU8 } from "fflate";
import {
  readSpreadsheet,
  reviewImport,
} from "../src/features/public-content/content-import.ts";

const dom = new JSDOM("");
const Parser = dom.window.DOMParser;
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const inline = (address, value) =>
  `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
const header = ["공개이름", "작성자", "후기원문", "작성일"]
  .map((label, index) => inline(`${"ABCD"[index]}1`, label))
  .join("");
const original = '  첫 줄 그대로.\n둘째 줄, "인용"도 그대로.  ';
function workbook({
  dateCells = ['<c r="D2" s="1"><v>46277</v></c>'],
  date1904,
  formatId = 14,
  formatCode,
  sharedStrings,
  extraCells = "",
  headerCells = header,
} = {}) {
  const files = {
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${date1904 === undefined ? "" : `<workbookPr date1904="${date1904}"/>`}<sheets><sheet name="후기" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/styles.xml": `<styleSheet>${formatCode === undefined ? "" : `<numFmts count="1"><numFmt numFmtId="${formatId}" formatCode="${escape(formatCode)}"/></numFmts>`}<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="${formatId}"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${headerCells}</row>${dateCells.map((cell, index) => `<row r="${index + 2}">${inline(`A${index + 2}`, "김*민")}${inline(`B${index + 2}`, "학생")}${inline(`C${index + 2}`, original)}${cell}${extraCells}</row>`).join("")}</sheetData></worksheet>`,
    ...(sharedStrings === undefined
      ? {}
      : { "xl/sharedStrings.xml": sharedStrings }),
  };
  return new File(
    [
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([key, value]) => [key, strToU8(value)]),
        ),
      ),
    ],
    "reviews.xlsx",
  );
}
const read = (options) => readSpreadsheet(workbook(options), Parser);

test("XLSX built-in date reaches the review contract with exact original text", async () => {
  const rows = await read();
  assert.equal(rows[1][3], "2026-09-12");
  const result = reviewImport("review", rows);
  assert.deepEqual(result.errors, []);
  assert.equal(result.entries[0].data.date, "2026-09-12");
  assert.equal(result.entries[0].data.content, original);
});

test("XLSX custom Korean date formats and cached date formulas retain their calendar day", async () => {
  const rows = await read({
    formatId: 164,
    formatCode: 'yyyy"년" mm"월" dd"일"',
    dateCells: ['<c r="D2" s="1"><f>DATE(2026,9,12)</f><v>46277.75</v></c>'],
  });
  assert.equal(rows[1][3], "2026-09-12");
});

test("XLSX 1904 workbooks support both XML true values and the epoch", async () => {
  for (const date1904 of ["1", "true"]) {
    const rows = await read({
      date1904,
      dateCells: [
        '<c r="D2" s="1"><v>44815</v></c>',
        '<c r="D3" s="1"><v>0</v></c>',
      ],
    });
    assert.deepEqual(
      rows.slice(1).map((row) => row[3]),
      ["2026-09-12", "1904-01-01"],
    );
  }
});

test("XLSX 1900 dates preserve the early calendar and reject its fictitious leap day", async () => {
  const rows = await read({
    dateCells: [
      '<c r="D2" s="1"><v>59</v></c>',
      '<c r="D3" s="1"><v>60</v></c>',
      '<c r="D4" s="1"><v>61</v></c>',
    ],
  });
  assert.deepEqual(
    rows.slice(1).map((row) => row[3]),
    ["1900-02-28", "1900-02-29", "1900-03-01"],
  );
  assert.deepEqual(
    reviewImport("review", rows).errors.map((error) => error.row),
    [3],
  );
});

test("XLSX shared strings, ISO date cells and blank styled cells are not treated as serial zero", async () => {
  const rows = await read({
    sharedStrings: "<sst><si><t>2026-09-12</t></si></sst>",
    dateCells: [
      '<c r="D2" t="s" s="1"><v>0</v></c>',
      '<c r="D3" t="d"><v>2026-09-12T23:45:00Z</v></c>',
      '<c r="D4" s="1"/>',
      "",
      '<c r="D6" t="s"/>',
    ],
  });
  assert.deepEqual(
    rows.slice(1).map((row) => row[3] ?? ""),
    ["2026-09-12", "2026-09-12", "", "", ""],
  );
  assert.deepEqual(reviewImport("review", rows).errors, []);
});

test("XLSX ordinary numbers, time-only formats and quoted date letters stay numeric", async () => {
  for (const options of [
    { formatId: 0 },
    { formatId: 20 },
    { formatId: 164, formatCode: '0.00 "days"' },
    { formatId: 164, formatCode: "[h]:mm:ss" },
  ]) {
    const rows = await read({
      ...options,
      dateCells: ['<c r="D2" s="1"><v>46277</v></c>'],
    });
    assert.equal(rows[1][3], "46277");
    assert.equal(reviewImport("review", rows).errors.length, 1);
  }
});

test("XLSX malformed ISO date cells remain invalid rather than losing their suffix", async () => {
  const rows = await read({
    dateCells: ['<c r="D2" t="d"><v>2026-09-12Tnot-a-time</v></c>'],
  });
  assert.equal(rows[1][3], "2026-09-12Tnot-a-time");
  assert.equal(reviewImport("review", rows).errors.length, 1);
});

test("XLSX locale date formats used by Korean Excel are accepted", async () => {
  for (const formatId of [22, 27, 31, 34, 55])
    assert.equal((await read({ formatId }))[1][3], "2026-09-12");
});

test("XLSX numeric scores are retained while date parsing is active elsewhere", async () => {
  const labels = ["년도", "시험", "학교", "학년", "공개이름", "과목", "점수"];
  const entries = ["2026", "1학기 중간", "팁스고", "고1", "김*민", "영어"];
  const files = {
    "xl/workbook.xml":
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="성적" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/styles.xml":
      '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${labels.map((label, i) => inline(`${"ABCDEFG"[i]}1`, label)).join("")}</row><row r="2">${entries.map((value, i) => inline(`${"ABCDEFG"[i]}2`, value)).join("")}<c r="G2"><v>95.8</v></c></row></sheetData></worksheet>`,
  };
  const file = new File(
    [
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([key, value]) => [key, strToU8(value)]),
        ),
      ),
    ],
    "results.xlsx",
  );
  const result = reviewImport("result", await readSpreadsheet(file, Parser));
  assert.deepEqual(result.errors, []);
  assert.equal(result.entries[0].data.score, "95.8");
});
