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

test("public SEO surface files exist for canonical routes and crawl assets", () => {
  const requiredFiles = [
    "admin/index.html",
    "classes/index.html",
    "reviews/index.html",
    "results/index.html",
    "public/jeju/index.html",
    "public/404.html",
    "public/robots.txt",
    "public/sitemap.xml",
    "public/llms.txt",
    "src/public-seo/jejuAreaCatalog.mjs",
    "src/public-seo/siteMeta.mjs",
    "scripts/build-public-assets.mjs",
    "scripts/build-public-classes-data.mjs",
  ];

  requiredFiles.forEach((relativePath) => {
    assert.equal(
      fs.existsSync(path.join(root, relativePath)),
      true,
      `${relativePath} should exist`,
    );
  });
});

test("public route surfaces expose canonical metadata and the shared public shell entry", () => {
  const rootIndex = read("index.html");
  const adminIndex = read("admin/index.html");
  const classesIndex = read("classes/index.html");
  const reviewsIndex = read("reviews/index.html");
  const resultsIndex = read("results/index.html");
  const jejuIndex = read("public/jeju/index.html");

  assert.match(rootIndex, /rel="canonical" href="https:\/\/tipsedu\.co\.kr\/"/);
  assert.match(rootIndex, /application\/ld\+json/);
  assert.match(rootIndex, /src="\/src\/public-classes\/main\.jsx"/);
  assert.match(rootIndex, /data-public-tab="home"/);

  assert.match(adminIndex, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(adminIndex, /src="\/src\/main\.jsx"/);

  assert.match(classesIndex, /rel="canonical" href="https:\/\/tipsedu\.co\.kr\/classes"/);
  assert.match(classesIndex, /application\/ld\+json/);
  assert.match(classesIndex, /src="\/src\/public-classes\/main\.jsx"/);
  assert.match(classesIndex, /data-public-tab="classes"/);

  assert.match(reviewsIndex, /rel="canonical" href="https:\/\/tipsedu\.co\.kr\/reviews"/);
  assert.match(reviewsIndex, /application\/ld\+json/);
  assert.match(reviewsIndex, /src="\/src\/public-classes\/main\.jsx"/);
  assert.match(reviewsIndex, /data-public-tab="reviews"/);

  assert.match(resultsIndex, /rel="canonical" href="https:\/\/tipsedu\.co\.kr\/results"/);
  assert.match(resultsIndex, /application\/ld\+json/);
  assert.match(resultsIndex, /src="\/src\/public-classes\/main\.jsx"/);
  assert.match(resultsIndex, /data-public-tab="scores"/);

  assert.match(jejuIndex, /rel="canonical" href="https:\/\/tipsedu\.co\.kr\/jeju"/);
  assert.match(jejuIndex, /application\/ld\+json/);
  assert.match(jejuIndex, /areaServed/);
  assert.match(jejuIndex, /id="samhwa"/);
  assert.match(jejuIndex, /id="ido2"/);
  assert.match(jejuIndex, /id="noyeong"/);
});

test("vercel routing removes the catch-all spa rewrite and adds explicit seo-safe rewrites", () => {
  const config = JSON.parse(read("vercel.json"));
  const rewrites = config.rewrites || [];
  const headers = config.headers || [];

  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/(.*)" && entry.destination === "/index.html",
    ),
    false,
  );

  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/reviews" &&
        entry.destination === "/reviews/index.html",
    ),
    true,
  );
  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/results" &&
        entry.destination === "/results/index.html",
    ),
    true,
  );
  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/classes" &&
        entry.destination === "/classes/index.html",
    ),
    true,
  );
  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/jeju" &&
        entry.destination === "/jeju/index.html",
    ),
    true,
  );
  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/2024/(.*)" && entry.destination === "/api/gone",
    ),
    true,
  );
  assert.equal(
    rewrites.some(
      (entry) =>
        entry.source === "/2025/(.*)" && entry.destination === "/api/gone",
    ),
    true,
  );
  assert.equal(
    headers.some(
      (entry) =>
        entry.source === "/admin/(.*)" &&
        (entry.headers || []).some(
          (header) =>
            header.key === "X-Robots-Tag" &&
            /noindex/i.test(header.value),
        ),
    ),
    true,
  );
});
