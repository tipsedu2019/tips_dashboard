import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const directory = new URL("../public/fonts/pretendard/1.3.9/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8"));
const stylesheet = readFileSync(new URL("../src/lib/fonts/pretendard.css", import.meta.url), "utf8");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("every self-hosted unicode subset is the intact licensed upstream WOFF2", () => {
  const references = [...stylesheet.matchAll(/url\(\/fonts\/pretendard\/1\.3\.9\/([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(references.length, 92);
  assert.deepEqual(new Set(references), new Set(manifest.assets.map((asset) => asset.file)));
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.file, directory));
    assert.equal(bytes.subarray(0, 4).toString(), "wOF2");
    assert.equal(bytes.length, asset.bytes, asset.file);
    assert.equal(hash(bytes), asset.sha256, asset.file);
    assert.ok(asset.url.startsWith("https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/"));
  }
  const license = readFileSync(new URL("LICENSE.txt", directory));
  assert.equal(hash(license), manifest.license.sha256);
  assert.match(license.toString(), /SIL OPEN FONT LICENSE Version 1.1/);
});

test("variable subsets cover Korean identities and numbers without overriding the fallback stack", () => {
  const faces = [...stylesheet.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]);
  const ranges = faces.flatMap((face) => {
    assert.match(face, /font-display:\s*swap/);
    assert.match(face, /font-weight:\s*45 920/);
    return face.match(/unicode-range:\s*([^;]+)/)[1].split(/,\s*/).map((part) => {
      const [start, end = start] = part.trim().slice(2).split("-");
      return [Number.parseInt(start,16), Number.parseInt(end,16)];
    });
  });
  for (const character of "학생김하늘동명이인중앙고등학교교재수업계획빠른이동총20명010-1234–5678") {
    const point = character.codePointAt(0);
    assert.ok(ranges.some(([start,end]) => point >= start && point <= end), character);
  }
  const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(globals, /@import "\.\.\/lib\/fonts\/pretendard.css"/);
  assert.match(globals, /--font-sans-stack: "Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif/);
  assert.doesNotMatch(stylesheet, /local\(/);
});
