export const PUBLIC_CLASSES_FULL_CACHE_TAG: "public-classes-full-v1";
export const PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS: 600;
export const PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS: 86400000;
export const PUBLIC_CLASSES_SUMMARY_CACHE_TAG: "public-classes-summary-v1";
export const PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS: 600;

export type PublicClassesFullPayload = {
  generatedAt: string;
  source: "supabase";
  classes: Array<Record<string, unknown>>;
  textbooks: Array<Record<string, unknown>>;
  progressLogs: Array<Record<string, unknown>>;
};

export type PublicClassesSummaryPayload = {
  generatedAt: string;
  source: string;
  classes: Array<Record<string, unknown>>;
  textbooks: [];
  progressLogs: [];
};

export function loadSuccessfulPublicClassSummary(
  options?: Record<string, unknown>,
): Promise<PublicClassesSummaryPayload>;

export const loadCachedSuccessfulPublicClassSummary: (
  options?: Record<string, unknown>,
) => Promise<PublicClassesSummaryPayload>;

export function createPublicClassesSummaryCache(options?: {
  loadSummary?: (...sourceArguments: Array<unknown>) => Promise<PublicClassesSummaryPayload>;
  readSnapshot?: () => Promise<unknown>;
  cache?: (
    loader: (...sourceArguments: Array<unknown>) => Promise<PublicClassesSummaryPayload>,
    keys: string[],
    options: { revalidate: number; tags: string[] },
  ) => (...sourceArguments: Array<unknown>) => Promise<PublicClassesSummaryPayload>;
}): {
  load(...sourceArguments: Array<unknown>): Promise<PublicClassesSummaryPayload>;
};

export function loadCachedPublicClassesSummary(
  ...sourceArguments: Array<unknown>
): Promise<PublicClassesSummaryPayload | null>;

export function loadSuccessfulPublicClassesFull(
  options?: Record<string, unknown>,
): Promise<PublicClassesFullPayload>;

export function loadCachedSuccessfulPublicClassesFull(
  options?: Record<string, unknown>,
): Promise<PublicClassesFullPayload>;

export function createPublicClassesFullCache(options?: {
  loadFull?: (...sourceArguments: Array<unknown>) => Promise<unknown>;
  readSnapshot?: () => Promise<unknown>;
  now?: () => number;
}): {
  load(...sourceArguments: Array<unknown>): Promise<PublicClassesFullPayload | {
    generatedAt: string;
    source: "fallback-empty";
    reason: string;
    classes: [];
    textbooks: [];
    progressLogs: [];
  }>;
};

export function loadCachedPublicClassesFull(
  ...sourceArguments: Array<unknown>
): ReturnType<ReturnType<typeof createPublicClassesFullCache>["load"]>;
