/**
 * @template TPrimary
 * @template TEnriched
 * @param {{
 *   cachedPrimaryRows?: TPrimary[] | null,
 *   loadPrimaryRows: () => Promise<TPrimary[]>,
 *   cachePrimaryRows?: (rows: TPrimary[]) => void,
 *   enrichRows?: (rows: TPrimary[]) => Promise<TEnriched>,
 *   onPrimaryRows: (rows: TPrimary[]) => void,
 *   onEnrichedRows?: (rows: TEnriched) => void,
 *   onEnrichmentError?: (error: unknown) => void,
 *   isCurrent?: () => boolean,
 * }} input
 */
export async function loadManagementRowsProgressively({
  cachedPrimaryRows = null,
  loadPrimaryRows,
  cachePrimaryRows,
  enrichRows,
  onPrimaryRows,
  onEnrichedRows,
  onEnrichmentError,
  isCurrent = () => true,
}) {
  if (Array.isArray(cachedPrimaryRows) && isCurrent()) {
    onPrimaryRows(cachedPrimaryRows);
  }

  const primaryRows = await loadPrimaryRows();

  if (!isCurrent()) {
    return { enrichment: Promise.resolve() };
  }

  cachePrimaryRows?.(primaryRows);
  onPrimaryRows(primaryRows);

  if (!enrichRows) {
    return { enrichment: Promise.resolve() };
  }

  const enrichment = (async () => {
    try {
      const enrichedRows = await enrichRows(primaryRows);
      if (isCurrent()) {
        onEnrichedRows?.(enrichedRows);
      }
    } catch (error) {
      if (isCurrent()) {
        onEnrichmentError?.(error);
      }
    }
  })();

  return { enrichment };
}
