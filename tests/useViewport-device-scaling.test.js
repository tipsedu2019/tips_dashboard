import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("C:/Antigravity/tips_dashboard");
const moduleUrl = pathToFileURL(
  path.join(root, "src", "hooks", "useViewport.js"),
).href;

test("desktop-class scaled displays stay on desktop layout when pointer is fine", async () => {
  const { getViewportStateFromMetrics } = await import(
    `${moduleUrl}?desktop-scale`
  );

  const viewport = getViewportStateFromMetrics({
    width: 768,
    devicePixelRatio: 2.5,
    hasCoarsePointer: false,
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });

  assert.equal(viewport.width, 768);
  assert.equal(viewport.isMobile, false);
  assert.equal(viewport.isTablet, false);
  assert.equal(viewport.isCompact, false);
  assert.equal(viewport.isDesktop, true);
});

test("touch-enabled desktop Windows devices still use desktop layout when fullscreen scaling shrinks innerWidth", async () => {
  const { getViewportStateFromMetrics } = await import(
    `${moduleUrl}?touch-scale`
  );

  const viewport = getViewportStateFromMetrics({
    width: 768,
    devicePixelRatio: 2.5,
    hasCoarsePointer: true,
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Touch)",
  });

  assert.equal(viewport.isMobile, false);
  assert.equal(viewport.isDesktop, true);
});

test("actual mobile devices keep the compact layout even with high device pixel ratios", async () => {
  const { getViewportStateFromMetrics } = await import(
    `${moduleUrl}?real-mobile-scale`
  );

  const viewport = getViewportStateFromMetrics({
    width: 768,
    devicePixelRatio: 2.5,
    hasCoarsePointer: true,
    platform: "Linux armv8l",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 Chrome/134.0 Mobile Safari/537.36",
  });

  assert.equal(viewport.isMobile, true);
  assert.equal(viewport.isDesktop, false);
});
