import {
  buildUniqueJejuAreaServedList,
  jejuAdministrativeDongs,
  jejuAliasClusters,
} from "./jejuAreaCatalog.mjs";

export const siteMeta = {
  brandName: "팁스 영어·수학학원",
  organizationName: "팁스 영어·수학학원",
  siteOrigin: "https://tipsedu.co.kr",
  siteName: "팁스 영어·수학학원",
  locale: "ko_KR",
  language: "ko-KR",
  telephone: "070-7174-2795",
  ogImagePath: "/logo_tips.png",
  publicDescription:
    "제주시 전 지역 학생과 학부모를 위한 팁스 영어·수학학원 공개 안내 페이지입니다.",
  keywords: [
    "제주시 영어학원",
    "제주시 수학학원",
    "제주시 초등 영어학원",
    "제주시 중등 수학학원",
    "제주시 고등 영어학원",
    "제주시 고등 수학학원",
    "삼화지구 영어학원",
    "이도2동 수학학원",
    "아라동 영어학원",
    "노형동 수학학원",
  ],
  mainCampus: {
    name: "팁스 영어·수학학원 본관",
    streetAddress: "제주시 연삼로 416 삼화En빌딩 3층",
    addressLocality: "제주시",
    addressRegion: "제주특별자치도",
    addressCountry: "KR",
  },
  annexCampus: {
    name: "팁스 영어·수학학원 별관",
    streetAddress: "제주시 남광북1길 1 제주법조타워 4층",
    addressLocality: "제주시",
    addressRegion: "제주특별자치도",
    addressCountry: "KR",
  },
};

export const publicRouteMeta = {
  home: {
    key: "home",
    path: "/",
    title: "팁스 영어·수학학원 | 제주시 영어학원·수학학원",
    description:
      "팁스 영어·수학학원 홈입니다. 제주시 전 지역 학생과 학부모를 위한 영어·수학 교육, 입학 안내, 상담, 위치 정보를 한곳에서 확인할 수 있습니다.",
    heading: "팁스 영어·수학학원 홈",
  },
  reviews: {
    key: "reviews",
    path: "/reviews",
    title: "팁스 영어·수학학원 후기 | 제주시 영어학원·수학학원",
    description:
      "팁스 영어·수학학원 리뷰 화면입니다. 제주시 전 지역 학생과 학부모가 남긴 후기와 학원 경험을 확인할 수 있습니다.",
    heading: "팁스 영어·수학학원 후기",
  },
  results: {
    key: "results",
    path: "/results",
    title: "팁스 영어·수학학원 성적 사례 | 제주시 영어학원·수학학원",
    description:
      "팁스 영어·수학학원 성적 화면입니다. 제주시 전 지역 학생의 학년별 성적 사례와 학습 결과를 확인할 수 있습니다.",
    heading: "팁스 영어·수학학원 성적 사례",
  },
  classes: {
    key: "classes",
    path: "/classes",
    title: "팁스 영어·수학학원 수업 안내 | 제주시 영어학원·수학학원",
    description:
      "팁스 영어·수학학원 공개 수업 안내 화면입니다. 제주시 전 지역 학생을 위한 현재 모집 수업, 학년, 과목, 시간표를 확인할 수 있습니다.",
    heading: "팁스 영어·수학학원 수업 안내",
  },
  jeju: {
    key: "jeju",
    path: "/jeju",
    title: "제주시 전 지역 영어·수학 학원 안내 | 팁스 영어·수학학원",
    description:
      "삼화지구, 이도2동, 아라동, 노형동을 포함한 제주시 전 지역 학생과 학부모를 위한 팁스 영어·수학학원 지역 안내 허브입니다.",
    heading: "제주시 전 지역 영어·수학 학원 안내",
  },
  admin: {
    key: "admin",
    path: "/admin",
    title: "팁스 영어·수학학원 관리자",
    description: "팁스 영어·수학학원 내부 운영 대시보드입니다.",
    heading: "팁스 영어·수학학원 관리자",
  },
};

export const publicCanonicalKeys = ["home", "reviews", "results", "classes", "jeju"];
export const publicCanonicalRoutes = publicCanonicalKeys.map(
  (key) => publicRouteMeta[key],
);

export function buildAbsoluteUrl(pathname = "/") {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalizedPath === "/"
    ? `${siteMeta.siteOrigin}/`
    : `${siteMeta.siteOrigin}${normalizedPath}`;
}

function buildAddressJsonLd(address) {
  return {
    "@type": "PostalAddress",
    streetAddress: address.streetAddress,
    addressLocality: address.addressLocality,
    addressRegion: address.addressRegion,
    addressCountry: address.addressCountry,
  };
}

export function buildOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "@id": `${buildAbsoluteUrl("/")}#organization`,
    name: siteMeta.organizationName,
    url: buildAbsoluteUrl("/"),
    logo: buildAbsoluteUrl(siteMeta.ogImagePath),
    image: buildAbsoluteUrl(siteMeta.ogImagePath),
    telephone: siteMeta.telephone,
    description: siteMeta.publicDescription,
    address: buildAddressJsonLd(siteMeta.mainCampus),
    department: [
      {
        "@type": "EducationalOrganization",
        name: siteMeta.annexCampus.name,
        address: buildAddressJsonLd(siteMeta.annexCampus),
      },
    ],
    areaServed: buildUniqueJejuAreaServedList(),
    knowsAbout: [
      "초등 영어",
      "초등 수학",
      "중등 영어",
      "중등 수학",
      "고등 영어",
      "고등 수학",
      "제주시 영어학원",
      "제주시 수학학원",
    ],
    availableLanguage: ["ko-KR"],
  };
}

export function buildBreadcrumbJsonLd(items = []) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: buildAbsoluteUrl(item.path),
    })),
  };
}

export function buildWebPageJsonLd(pageKey) {
  const page = publicRouteMeta[pageKey];
  if (!page) {
    throw new Error(`Unknown page key: ${pageKey}`);
  }

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${buildAbsoluteUrl(page.path)}#webpage`,
    url: buildAbsoluteUrl(page.path),
    name: page.title,
    headline: page.heading,
    description: page.description,
    inLanguage: siteMeta.language,
    isPartOf: {
      "@id": `${buildAbsoluteUrl("/")}#organization`,
    },
  };
}

export function buildSeoJsonLd(pageKey, breadcrumbs = []) {
  return [
    buildOrganizationJsonLd(),
    buildWebPageJsonLd(pageKey),
    buildBreadcrumbJsonLd(breadcrumbs),
  ];
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeVerificationContent(value = "", { prefix = "" } = {}) {
  const raw = String(value).trim();
  if (!raw) {
    return "";
  }

  const contentMatch = raw.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
  if (contentMatch?.[1]) {
    return contentMatch[1].trim();
  }

  const unquoted = raw.replace(/^["']|["']$/g, "").trim();
  if (!prefix) {
    return unquoted;
  }

  const prefixedMatch = unquoted.match(
    new RegExp(`^${escapeRegExp(prefix)}\\s*=\\s*(.+)$`, "i"),
  );

  return prefixedMatch?.[1]?.trim().replace(/^["']|["']$/g, "") || unquoted;
}

export function buildVerificationMetaTags({
  googleVerification = "",
  naverVerification = "",
  bingVerification = "",
} = {}) {
  const normalizedGoogleVerification = normalizeVerificationContent(
    googleVerification,
    {
      prefix: "google-site-verification",
    },
  );
  const normalizedNaverVerification = normalizeVerificationContent(
    naverVerification,
    {
      prefix: "naver-site-verification",
    },
  );
  const normalizedBingVerification = normalizeVerificationContent(
    bingVerification,
    {
      prefix: "msvalidate.01",
    },
  );

  const entries = [
    normalizedGoogleVerification
      ? `<meta name="google-site-verification" content="${normalizedGoogleVerification}" />`
      : "",
    normalizedNaverVerification
      ? `<meta name="naver-site-verification" content="${normalizedNaverVerification}" />`
      : "",
    normalizedBingVerification
      ? `<meta name="msvalidate.01" content="${normalizedBingVerification}" />`
      : "",
  ];

  return entries.filter(Boolean).join("\n");
}

export const jejuHubData = {
  aliasClusters: jejuAliasClusters,
  districts: jejuAdministrativeDongs,
};
