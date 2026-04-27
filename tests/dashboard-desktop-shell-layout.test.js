import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const appPath = path.join(root, "src", "App.jsx");
const cssPath = path.join(root, "src", "index.css");
const dashboardCssPath = path.join(root, "src", "styles", "tds-dashboard.css");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("desktop bottom-nav shell uses its own full-width app layout class", () => {
  const source = read(appPath);
  const css = read(cssPath);

  assert.match(
    source,
    /const \{ width, isMobile, isTablet, isCompact, isDesktop \} = useViewport\(\);/,
  );
  assert.match(
    source,
    /const forceDesktopLayout = isDesktop && width <= TABLET_BREAKPOINT;/,
  );
  assert.match(
    source,
    /const dashboardShellLayoutClass = useBottomNavShell\s*\?\s*\(isDesktop \? "dashboard-bottom-nav-desktop-shell" : "dashboard-bottom-nav-only"\)\s*:\s*"";/,
  );
  assert.match(
    source,
    /className=\{`app-layout \$\{dashboardShellLayoutClass\} \$\{forceDesktopLayout \? "app-layout-force-desktop" : ""\}/,
  );
  assert.match(
    css,
    /\.app-layout\.dashboard-bottom-nav-desktop-shell\[data-design-system="toss-refresh"\]\s*\{[\s\S]*padding:\s*0;[\s\S]*gap:\s*0;/,
  );
  assert.match(
    css,
    /\.app-layout\.dashboard-bottom-nav-desktop-shell\[data-design-system="toss-refresh"\]\s*\{[\s\S]*--dashboard-bottom-nav-inline-padding:\s*clamp\(20px,\s*2\.2vw,\s*32px\);[\s\S]*\.main-content\s*\{[\s\S]*padding:\s*18px var\(--dashboard-bottom-nav-inline-padding\)\s*calc\(96px \+ var\(--shell-safe-bottom\)\);/,
  );
});

test("desktop bottom navigation distributes every visible menu across the full width", () => {
  const source = read(appPath);
  const css = read(cssPath);
  const dashboardCss = read(dashboardCssPath);

  assert.match(
    source,
    /const bottomNavItems = useMemo\(\s*\(\) =>\s*DASHBOARD_BOTTOM_NAV_ITEMS\.filter\(/,
  );
  assert.match(
    source,
    /style=\{\{ "--dashboard-bottom-nav-item-count": bottomNavItems\.length \}\}/,
  );
  assert.match(source, /bottomNavItems\.map\(\(item\) => \{/);
  assert.match(
    css,
    /\.app-layout\.dashboard-bottom-nav-desktop-shell\[data-design-system="toss-refresh"\][\s\S]*\.dashboard-shell-bottom-nav-grid\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*max-content;[\s\S]*max-width:\s*min\(/,
  );
  assert.match(
    dashboardCss,
    /\.app-layout\.app-layout-force-desktop \.stats-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(
    dashboardCss,
    /\.app-layout\.app-layout-force-desktop \.stats-ranking-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
});
