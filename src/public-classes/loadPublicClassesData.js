export const PUBLIC_CLASSES_API_PATH = "/api/public-classes";
export const PUBLIC_CLASSES_FALLBACK_PATH = "/data/public-classes.json";

function normalizePublicClassesPayload(payload = {}) {
  return {
    classes: Array.isArray(payload?.classes) ? payload.classes : [],
    textbooks: Array.isArray(payload?.textbooks) ? payload.textbooks : [],
    progressLogs: Array.isArray(payload?.progressLogs)
      ? payload.progressLogs
      : [],
  };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json();
}

export async function loadPublicClassesData({
  fetchImpl = fetch,
  apiPath = PUBLIC_CLASSES_API_PATH,
  fallbackPath = PUBLIC_CLASSES_FALLBACK_PATH,
} = {}) {
  try {
    const livePayload = await fetchJson(fetchImpl, apiPath);
    return {
      isFallback: false,
      source: apiPath,
      ...normalizePublicClassesPayload(livePayload),
    };
  } catch {
    const fallbackPayload = await fetchJson(fetchImpl, fallbackPath);
    return {
      isFallback: true,
      source: fallbackPath,
      ...normalizePublicClassesPayload(fallbackPayload),
    };
  }
}
