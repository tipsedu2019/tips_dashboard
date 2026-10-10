import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as links from "../src/features/management/makeedu-student-link.ts";

const base = "https://school.makeedu.co.kr/member/student/list_detail.do";
const require = createRequire(import.meta.url);
const file = new URL("../src/features/management/makeedu-student-number.tsx", import.meta.url);
const output = ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: file.pathname,
}).outputText;
const runtime = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file.pathname })((specifier) => (
  specifier === "./makeedu-student-link" ? links : require(specifier)
), runtime, runtime.exports);
const { MakeEduStudentNumber } = runtime.exports;

test("only a separate opaque detail ID builds the canonical external URL", () => {
  for (const detailId of ["external_A-42", "ab+/cd==", "6721"]) {
    const url = `${base}?studNo=${encodeURIComponent(detailId)}`;
    assert.equal(links.buildMakeEduStudentDetailUrl(detailId), url);
    assert.deepEqual(links.parseMakeEduStudentDetailUrl(url), { detailId, url });
  }
  for (const value of [null, undefined, "", {}, "name@example.test", "010-0000-0000", "01000000000", "821000000000", "external\n", "external\r", "external\t", "홍길동", "a".repeat(257)]) {
    assert.equal(links.buildMakeEduStudentDetailUrl(value), null);
  }
});

test("malformed authorities, PII queries, duplicate parameters and decoded controls never become links", () => {
  const denied = [
    `http://school.makeedu.co.kr/member/student/list_detail.do?studNo=external`,
    `https://user:pass@school.makeedu.co.kr/member/student/list_detail.do?studNo=external`,
    `https://@school.makeedu.co.kr/member/student/list_detail.do?studNo=external`,
    `https://school.makeedu.co.kr:443/member/student/list_detail.do?studNo=external`,
    `https://school.makeedu.co.kr:8443/member/student/list_detail.do?studNo=external`,
    `https://school.makeedu.co.kr.evil.test/member/student/list_detail.do?studNo=external`,
    `https://school.makeedu.co.kr/member/student/../student/list_detail.do?studNo=external`,
    `${base}?studNo=external#`, `${base}?studNo=external#fragment`,
    `${base}?studNo=external&phone=01000000000`, `${base}?studNo=external&email=name%40example.test`,
    `${base}?studNo=external&studNo=another`, `${base}?studNo=external&`,
    `${base}?%73tudNo=external`, `${base}?studNo=`, `${base}?uid=S-42`,
    `${base}?studNo=external%0A`, `${base}?studNo=external%0D`, `${base}?studNo=external%26phone%3D01000000000`,
    `${base}?studNo=external%252F`, `${base}?studNo=ab+cd`, `${base}?studNo=010-0000-0000`,
    ` ${base}?studNo=external`, `${base}?studNo=external\n`, `//school.makeedu.co.kr/member/student/list_detail.do?studNo=external`,
    `javascript:alert(1)`, `${base}?studNo=external\\value`,
  ];
  for (const input of denied) assert.equal(links.parseMakeEduStudentDetailUrl(input), null);
});

test("UID without mapping stays plain text; an external mapping uses native safe new-tab focus", () => {
  for (const makeeduDetailId of [undefined, null, "", "external\n", `${base}?studNo=external`]) {
    const dom = new JSDOM(renderToStaticMarkup(createElement(MakeEduStudentNumber, { uid: "S-42", makeeduDetailId })));
    assert.equal(dom.window.document.body.textContent, "S-42");
    assert.equal(dom.window.document.querySelector("a"), null);
    dom.window.close();
  }
  const dom = new JSDOM(renderToStaticMarkup(createElement(MakeEduStudentNumber, { uid: "<합성 & 학생>", makeeduDetailId: "external_A-42" })));
  const anchor = dom.window.document.querySelector("a");
  assert.equal(anchor.textContent, "<합성 & 학생>");
  assert.equal(anchor.getAttribute("href"), `${base}?studNo=external_A-42`);
  assert.equal(anchor.getAttribute("target"), "_blank");
  assert.equal(anchor.getAttribute("rel"), "noopener noreferrer");
  assert.equal(anchor.getAttribute("referrerPolicy"), "no-referrer");
  assert.match(anchor.getAttribute("aria-label"), /새 탭/);
  assert.equal(dom.window.document.querySelector("img"), null);
  anchor.focus();
  assert.equal(dom.window.document.activeElement, anchor);
  dom.window.close();
});
