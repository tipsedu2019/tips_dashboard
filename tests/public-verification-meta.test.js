import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildVerificationMetaTags } from "../src/public-seo/siteMeta.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const googleVerification = "uK9pMmdIeGxpVhGMQ2Z1nwTyU_OMCRJdz7X26JZKKpE";
const naverVerification = "38b4b7993c1d3c4852d621b9277e5eb04d03a5ba";
const bingVerification = "3000DFC4474EBADCE4F0390685CCE0B7";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("verification meta builder normalizes dns and full meta-tag inputs", () => {
  const markup = buildVerificationMetaTags({
    googleVerification: `google-site-verification=${googleVerification}`,
    naverVerification: `<meta name="naver-site-verification" content="${naverVerification}" />`,
    bingVerification: `<meta name="msvalidate.01" content="${bingVerification}" />`,
  });

  assert.match(
    markup,
    new RegExp(
      `name="google-site-verification" content="${googleVerification}"`,
    ),
  );
  assert.match(
    markup,
    new RegExp(`name="naver-site-verification" content="${naverVerification}"`),
  );
  assert.match(
    markup,
    new RegExp(`name="msvalidate\\.01" content="${bingVerification}"`),
  );
});

test("public static entry surfaces expose search verification meta tags", () => {
  const publicEntries = [
    "index.html",
    "reviews/index.html",
    "classes/index.html",
    "results/index.html",
  ];

  publicEntries.forEach((relativePath) => {
    const html = read(relativePath);

    assert.match(
      html,
      new RegExp(
        `<meta\\s+name="google-site-verification"\\s+content="${googleVerification}"`,
      ),
      `${relativePath} should include the Google verification meta tag`,
    );
    assert.match(
      html,
      new RegExp(
        `<meta\\s+name="naver-site-verification"\\s+content="${naverVerification}"`,
      ),
      `${relativePath} should include the Naver verification meta tag`,
    );
    assert.match(
      html,
      new RegExp(`<meta\\s+name="msvalidate\\.01"\\s+content="${bingVerification}"`),
      `${relativePath} should include the Bing verification meta tag`,
    );
  });
});
