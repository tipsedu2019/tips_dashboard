import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("C:/Antigravity/tips_dashboard");
const publicLandingViewPath = path.join(
  root,
  "src",
  "components",
  "PublicClassLandingView.jsx",
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("public bottom nav uses same-origin embedded microsites for home, reviews, and scores", () => {
  const source = read(publicLandingViewPath);

  assert.doesNotMatch(source, /my-google-ai-studio-applet-899286868308/);
  assert.doesNotMatch(source, /my-google-ai-studio-applet-1075121220662/);
  assert.doesNotMatch(source, /service-941860332771\.us-west1\.run\.app/);

  assert.match(source, /const EMBEDDED_PUBLIC_VIEW_URLS = \{/);
  assert.match(source, /home:\s*'\/embedded\/home\/index\.html'/);
  assert.match(source, /reviews:\s*'\/embedded\/reviews\/index\.html'/);
  assert.match(source, /scores:\s*'\/embedded\/scores\/index\.html'/);
});

test("public bottom nav renders the embedded microsite panel instead of placeholder copy", () => {
  const source = read(publicLandingViewPath);

  assert.match(source, /data-testid="public-embedded-panel"/);
  assert.match(source, /data-testid=\{`public-embedded-frame-\$\{(?:activePublicTab|tabId)\}`\}/);
  assert.doesNotMatch(source, /function PublicPlaceholderPanel/);
});
