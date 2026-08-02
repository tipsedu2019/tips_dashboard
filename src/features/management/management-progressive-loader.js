export async function loadManagementRowsProgressively({
  loadPrimaryRows,
  enrichRows,
  onPrimaryRows,
  onEnrichedRows,
  onEnrichmentError,
  isCurrent = () => true,
}) {
  const primaryRows = await loadPrimaryRows();

  if (!isCurrent()) {
    return { enrichment: Promise.resolve() };
  }

  onPrimaryRows(primaryRows);

  if (!enrichRows) {
    return { enrichment: Promise.resolve() };
  }

  const enrichment = (async () => {
    try {
      const enrichedRows = await enrichRows(primaryRows);
      if (isCurrent()) {
        onEnrichedRows(enrichedRows);
      }
    } catch (error) {
      if (isCurrent()) {
        onEnrichmentError?.(error);
      }
    }
  })();

  return { enrichment };
}
