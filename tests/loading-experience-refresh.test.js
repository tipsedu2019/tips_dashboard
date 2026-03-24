import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(process.cwd(), "src", "App.jsx"), "utf8");
const pageLoaderSource = readFileSync(
  join(process.cwd(), "src", "components", "ui", "PageLoader.jsx"),
  "utf8",
);
const landingSource = readFileSync(
  join(process.cwd(), "src", "components", "PublicClassLandingView.jsx"),
  "utf8",
);
const listSource = readFileSync(
  join(process.cwd(), "src", "components", "PublicClassListView.jsx"),
  "utf8",
);
const stylesSource = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

test("global page loading uses TDS-style loader and skeleton surfaces", () => {
  assert.match(pageLoaderSource, /tds-page-loader/);
  assert.match(pageLoaderSource, /tds-page-loader-shell/);
  assert.match(pageLoaderSource, /tds-page-loader-highlights/);
  assert.match(pageLoaderSource, /tds-skeleton-block/);
  assert.match(stylesSource, /\.tds-page-loader/);
  assert.match(stylesSource, /\.tds-skeleton-block/);
});

test("loader copy is readable Korean in both defaults and app bootstrapping fallbacks", () => {
  [
    "대시보드를 준비하는 중입니다",
    "최신 데이터와 화면 구성을 안전하게 불러오고 있습니다.",
    "데이터 동기화 중",
    "시간표와 수업 계획 동기화",
    "권한과 표시 데이터 확인",
    "공개 뷰와 관리자 화면 준비",
  ].forEach((copy) => assert.match(pageLoaderSource, new RegExp(copy)));

  [
    "TIPS 대시보드를 준비하는 중입니다",
    "공개 수업 화면을 불러오는 중입니다",
    "데이터를 불러오는 중입니다",
    "화면을 준비하는 중입니다",
  ].forEach((copy) => assert.match(appSource, new RegExp(copy)));
});

test("public views use dedicated skeleton sections while data is loading", () => {
  assert.match(landingSource, /PublicClassLandingSkeleton/);
  assert.match(listSource, /PublicTimetableSkeleton/);
  assert.match(pageLoaderSource, /aria-label="수업 목록을 불러오는 중"/);
  assert.match(pageLoaderSource, /aria-label="수업시간표를 불러오는 중"/);
});

test("class plan modal keeps its editable content scrollable on desktop", () => {
  assert.match(
    stylesSource,
    /\.class-plan-desktop-modal\.is-editable \{[\s\S]*height:\s*min\(92vh,\s*1080px\)/,
  );
  assert.match(
    stylesSource,
    /\.class-plan-desktop-modal\.is-editable \.class-plan-sheet/,
  );
  assert.match(stylesSource, /\.class-plan-sheet-content/);
  assert.match(stylesSource, /overscroll-behavior:\s*contain/);
  assert.match(
    stylesSource,
    /\.class-plan-sheet-content--editable-workspace \{[\s\S]*display:\s*flex[\s\S]*min-height:\s*100%/,
  );
});
