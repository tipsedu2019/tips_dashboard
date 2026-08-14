export const PUBLIC_CLASSES_SUMMARY_CACHE_TAG: "public-classes-summary-v1";
export const PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS: 600;

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
