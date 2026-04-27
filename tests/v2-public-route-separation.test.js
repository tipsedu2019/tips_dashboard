import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("v2 public routes point to separated public surfaces while preserving admin entry", () => {
  const homeSource = read("v2/src/app/page.tsx");
  const landingSource = read("v2/src/app/landing/page.tsx");
  const reviewSource = read("v2/src/app/reviews/page.tsx");
  const resultsSource = read("v2/src/app/results/page.tsx");
  const inquirySource = read("v2/src/app/inquiry/page.tsx");
  const classesSource = read("v2/src/app/classes/page.tsx");

  assert.match(homeSource, /redirect\("\/legacy-public\/home\/index\.html"\);/);
  assert.match(landingSource, /redirect\("\/"\);/);
  assert.match(reviewSource, /redirect\("\/legacy-public\/reviews\/index\.html"\);/);
  assert.match(resultsSource, /redirect\("\/legacy-public\/results\/index\.html"\);/);
  assert.match(classesSource, /redirect\("\/legacy-public\/classes\/index\.html"\);/);
  assert.match(inquirySource, /redirect\("https:\/\/tipsedu\.channel\.io\/"\);/);
});

test("legacy static public shells are copied into v2 public assets", () => {
  const homeHtml = read("v2/public/legacy-public/home/index.html");
  const reviewsHtml = read("v2/public/legacy-public/reviews/index.html");
  const resultsHtml = read("v2/public/legacy-public/results/index.html");
  const classesHtml = read("v2/public/legacy-public/classes/index.html");

  assert.match(homeHtml, /data-public-tab="home"/);
  assert.match(reviewsHtml, /data-public-tab="reviews"/);
  assert.match(resultsHtml, /data-public-tab="scores"/);
  assert.match(classesHtml, /data-public-tab="classes"/);
  assert.match(homeHtml, /PublicClassLandingView/);
  assert.match(reviewsHtml, /PublicClassLandingView/);
  assert.match(resultsHtml, /PublicClassLandingView/);
  assert.match(classesHtml, /PublicClassLandingView/);
});
