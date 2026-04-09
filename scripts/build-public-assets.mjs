import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildAbsoluteUrl,
  buildSeoJsonLd,
  buildVerificationMetaTags,
  jejuHubData,
  publicCanonicalRoutes,
  publicRouteMeta,
  siteMeta,
} from "../src/public-seo/siteMeta.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeJsonLd(data) {
  return JSON.stringify(data, null, 2).replaceAll("</script>", "<\\/script>");
}

function importEnvFile(filePath) {
  return fs
    .readFile(filePath, "utf8")
    .then((raw) => {
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex < 1) {
          return;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      });
    })
    .catch(() => {});
}

async function loadEnv() {
  await Promise.all([
    importEnvFile(path.join(projectRoot, ".env")),
    importEnvFile(path.join(projectRoot, ".env.local")),
    importEnvFile(path.join(projectRoot, ".env.supabase.local")),
  ]);
}

function buildHead(pageKey, { extraMeta = "" } = {}) {
  const page = publicRouteMeta[pageKey];
  const verificationMeta = buildVerificationMetaTags({
    googleVerification: process.env.GOOGLE_SITE_VERIFICATION || "",
    naverVerification:
      process.env.NAVER_SITE_VERIFICATION ||
      process.env.NAVER_SEARCH_ADVISOR_VERIFICATION ||
      "",
    bingVerification:
      process.env.BING_SITE_VERIFICATION || process.env.MSVALIDATE_01 || "",
  });

  return `    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/logo_tips.png" />
    <link rel="apple-touch-icon" href="/logo_tips.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${buildAbsoluteUrl(page.path)}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${siteMeta.locale}" />
    <meta property="og:site_name" content="${escapeHtml(siteMeta.siteName)}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:url" content="${buildAbsoluteUrl(page.path)}" />
    <meta property="og:image" content="${buildAbsoluteUrl(siteMeta.ogImagePath)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${buildAbsoluteUrl(siteMeta.ogImagePath)}" />
${verificationMeta ? `    ${verificationMeta}\n` : ""}${extraMeta ? `    ${extraMeta}\n` : ""}    <title>${escapeHtml(page.title)}</title>`;
}

function buildCommonStyles() {
  return `    <style>
      :root {
        color-scheme: light;
      }

      html,
      body {
        min-height: 100%;
        margin: 0;
        background: #f8fafc;
      }

      body {
        font-family:
          "Noto Sans KR",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          sans-serif;
        color: #0f172a;
      }

      .jeju-page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 40px 20px 80px;
      }

      .jeju-hero {
        padding: 28px;
        border-radius: 28px;
        background:
          radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 34%),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
      }

      .jeju-kicker {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #2563eb;
      }

      .jeju-title {
        margin: 12px 0 16px;
        font-size: clamp(34px, 5vw, 54px);
        line-height: 1.08;
      }

      .jeju-summary {
        margin: 0;
        max-width: 760px;
        font-size: 17px;
        line-height: 1.7;
        color: #334155;
      }

      .jeju-link-row,
      .jeju-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }

      .jeju-link,
      .jeju-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        text-decoration: none;
        background: #ffffff;
        border: 1px solid rgba(148, 163, 184, 0.28);
        color: #0f172a;
        font-size: 14px;
        font-weight: 600;
      }

      .jeju-section {
        margin-top: 34px;
      }

      .jeju-section h2 {
        margin: 0 0 10px;
        font-size: 28px;
      }

      .jeju-section p {
        margin: 0;
        color: #475569;
        line-height: 1.7;
      }

      .jeju-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
        margin-top: 18px;
      }

      .jeju-card {
        padding: 20px;
        border-radius: 22px;
        background: #ffffff;
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
      }

      .jeju-card h3 {
        margin: 0 0 10px;
        font-size: 20px;
      }

      .jeju-card p {
        margin: 0;
        color: #475569;
        line-height: 1.65;
      }

      .jeju-card ul {
        margin: 12px 0 0;
        padding-left: 18px;
        color: #334155;
        line-height: 1.65;
      }
    </style>`;
}

function buildDocument({ pageKey, breadcrumbs, bodyContent, extraMeta = "" }) {
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
${buildHead(pageKey, { extraMeta })}
    <script type="application/ld+json">
${serializeJsonLd(buildSeoJsonLd(pageKey, breadcrumbs))}
    </script>
${buildCommonStyles()}
  </head>
  <body>
${bodyContent}
  </body>
</html>
`;
}

function buildJejuHubDocument() {
  const page = publicRouteMeta.jeju;
  const aliasCards = jejuHubData.aliasClusters
    .map(
      (cluster) => `        <article class="jeju-card" id="${cluster.slug}">
          <h3>${escapeHtml(cluster.name)}</h3>
          <p>${escapeHtml(cluster.summary)}</p>
          <ul>
            <li>포함 동: ${escapeHtml(cluster.districts.join(", "))}</li>
            <li>연관 검색어: ${escapeHtml(cluster.aliases.join(", "))}</li>
          </ul>
        </article>`,
    )
    .join("\n");

  const districtCards = jejuHubData.districts
    .map(
      (district) => `        <article class="jeju-card" id="${district.slug}">
          <h3>${escapeHtml(district.name)}</h3>
          <p>팁스 영어·수학학원은 ${escapeHtml(district.name)} 생활권 학생과 학부모가 확인할 수 있도록 제주시 전 지역 공개 정보를 같은 기준으로 제공합니다.</p>
          <ul>
            <li>생활권: ${escapeHtml(district.cluster)}</li>
            <li>연관 검색어: ${escapeHtml(district.aliases.join(", "))}</li>
          </ul>
        </article>`,
    )
    .join("\n");

  return buildDocument({
    pageKey: "jeju",
    breadcrumbs: [
      { name: "홈", path: "/" },
      { name: page.heading, path: page.path },
    ],
    bodyContent: `    <main class="jeju-page">
      <section class="jeju-hero">
        <div class="jeju-kicker">Jeju City Coverage</div>
        <h1 class="jeju-title">${escapeHtml(page.heading)}</h1>
        <p class="jeju-summary">
          팁스 영어·수학학원은 삼화지구, 이도2동, 아라동, 노형동을 포함한 제주시 전 지역 학생과 학부모가
          리뷰, 성적, 수업 안내를 같은 공개 화면 기준으로 확인할 수 있도록 정보를 제공합니다.
        </p>
        <nav class="jeju-link-row" aria-label="공개 페이지 바로가기">
          <a class="jeju-link" href="/">홈</a>
          <a class="jeju-link" href="/reviews">리뷰</a>
          <a class="jeju-link" href="/results">성적</a>
          <a class="jeju-link" href="/classes">수업 안내</a>
        </nav>
      </section>

      <section class="jeju-section" aria-labelledby="jeju-aliases">
        <h2 id="jeju-aliases">생활권 묶음과 별칭</h2>
        <p>행정동 전체를 기준으로 하되, 삼화지구, 신제주, 구제주처럼 실제 검색에서 많이 쓰는 별칭도 함께 정리했습니다.</p>
        <div class="jeju-chip-row">
          ${jejuHubData.aliasClusters
            .map(
              (cluster) =>
                `<a class="jeju-chip" href="#${cluster.slug}">${escapeHtml(cluster.name)}</a>`,
            )
            .join("\n          ")}
        </div>
        <div class="jeju-grid">
${aliasCards}
        </div>
      </section>

      <section class="jeju-section" aria-labelledby="jeju-districts">
        <h2 id="jeju-districts">제주시 행정동 전체 안내</h2>
        <p>제주시 행정동 전체를 기준으로 공개 표면과 검색 키워드를 연결해 한곳에서 확인할 수 있게 구성했습니다.</p>
        <div class="jeju-chip-row">
          ${jejuHubData.districts
            .map(
              (district) =>
                `<a class="jeju-chip" href="#${district.slug}">${escapeHtml(district.name)}</a>`,
            )
            .join("\n          ")}
        </div>
        <div class="jeju-grid">
${districtCards}
        </div>
      </section>
    </main>`,
  });
}

function buildRobotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /embedded/

User-agent: Googlebot
Allow: /
Disallow: /admin/

User-agent: Yeti
Allow: /
Disallow: /admin/

User-agent: OAI-SearchBot
Allow: /
Disallow: /admin/

User-agent: GPTBot
Allow: /
Disallow: /admin/

User-agent: ClaudeBot
Allow: /
Disallow: /admin/

Sitemap: ${buildAbsoluteUrl("/sitemap.xml")}
`;
}

function buildSitemapXml() {
  const lastMod = new Date().toISOString().slice(0, 10);
  const urls = publicCanonicalRoutes
    .map(
      (route) => `  <url>
    <loc>${buildAbsoluteUrl(route.path)}</loc>
    <lastmod>${lastMod}</lastmod>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildLlmsTxt() {
  return [
    `# ${siteMeta.siteName}`,
    "",
    "> 제주시 전 지역 학생과 학부모를 위한 팁스 영어·수학학원 공개 안내 사이트입니다.",
    "",
    "## Canonical URLs",
    `- ${buildAbsoluteUrl("/")}`,
    `- ${buildAbsoluteUrl("/reviews")}`,
    `- ${buildAbsoluteUrl("/results")}`,
    `- ${buildAbsoluteUrl("/classes")}`,
    `- ${buildAbsoluteUrl("/jeju")}`,
    "",
    "## Facts",
    `- 브랜드명: ${siteMeta.brandName}`,
    `- 대표 전화: ${siteMeta.telephone}`,
    `- 본관 주소: ${siteMeta.mainCampus.streetAddress}`,
    `- 별관 주소: ${siteMeta.annexCampus.streetAddress}`,
    `- 서비스 지역: 제주시 전 지역, ${jejuHubData.aliasClusters
      .map((cluster) => cluster.name)
      .join(", ")}`,
    "",
    "## Guidance",
    "- 공개 표면은 Canonical URLs를 우선합니다.",
    "- /embedded/* 와 /admin/* 는 검색 표면이 아니라 내부 구현 또는 운영 경로입니다.",
    "",
  ].join("\n");
}

async function writeFile(relativePath, content) {
  const filePath = path.join(publicDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function removePathIfExists(relativePath) {
  const targetPath = path.join(projectRoot, relativePath);
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function main() {
  await loadEnv();

  await Promise.all([
    removePathIfExists(path.join("public", "reviews")),
    removePathIfExists(path.join("public", "results")),
  ]);

  await writeFile(path.join("jeju", "index.html"), buildJejuHubDocument());
  await writeFile("robots.txt", buildRobotsTxt());
  await writeFile("sitemap.xml", buildSitemapXml());
  await writeFile("llms.txt", buildLlmsTxt());

  console.log("[public-assets] generated jeju hub and crawl assets");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
