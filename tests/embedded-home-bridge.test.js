import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const publicLandingViewPath = path.join(
  root,
  "src",
  "components",
  "PublicClassLandingView.jsx",
);
const homeClassInfoPath = path.join(
  root,
  "embedded-apps",
  "home",
  "src",
  "components",
  "home",
  "HomeClassInfo.tsx",
);
const homeHeroSectionPath = path.join(
  root,
  "embedded-apps",
  "home",
  "src",
  "components",
  "home",
  "HomeHeroSection.tsx",
);
const homeHeroWebmPath = path.join(
  root,
  "embedded-apps",
  "home",
  "public",
  "tips-hero.webm",
);
const homeHeroMp4Path = path.join(
  root,
  "embedded-apps",
  "home",
  "public",
  "tips-hero.mp4",
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("embedded iframe allows autoplay and listens for embedded navigation messages", () => {
  const source = read(publicLandingViewPath);

  assert.match(source, /allow="autoplay"/);
  assert.match(source, /window\.addEventListener\('message', handleEmbeddedNavigation\)/);
  assert.match(source, /tips-public-nav/);
  assert.match(source, /setActivePublicTab\(requestedTab\)/);
});

test("home class info CTA requests the classes tab instead of opening the external site", () => {
  const source = read(homeClassInfoPath);

  assert.match(source, /window\.parent\.postMessage\(/);
  assert.match(source, /type:\s*'tips-public-nav'/);
  assert.match(source, /tab:\s*'classes'/);
  assert.doesNotMatch(source, /href=\{siteConfig\.siteUrl\}/);
});

test("home hero keeps the embedded video source and autoplay configuration", () => {
  const source = read(homeHeroSectionPath);

  assert.match(source, /tips-hero\.webm/);
  assert.match(source, /BASE_URL\}tips-hero\.mp4/);
  assert.match(source, /autoPlay/);
  assert.match(source, /loop/);
  assert.match(source, /muted/);
  assert.match(source, /playsInline/);
  assert.match(source, /preload="auto"/);
});

test("home hero keeps both browser-friendly video assets in source control", () => {
  assert.equal(fs.existsSync(homeHeroWebmPath), true);
  assert.equal(fs.existsSync(homeHeroMp4Path), true);
});
