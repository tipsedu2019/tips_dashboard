# Task 4 repair report

School: adding a row from a filtered list now clears the query, preserves the category, inserts at the top and focuses the new name input. Clearing search restores input focus. CMS: the existing draft navigation guard now protects modified teacher, review and result editors; clean close and successful apply keep their existing behavior.

The strict synthetic transport script `/tmp/tips-menu-review-20260915/settings-after.mjs` passed at 1440px and 390px with zero unknown requests or runtime errors. School checks covered filtered add, visible focused input, valid-name save enablement, reset and search-clear focus. CMS checks covered edit, Escape, keep editing, discard, opener focus and reopening unchanged data. These checks did not perform actual saved writes or change public APIs, authentication or provider behavior.

[The baseline audit](task-4-audit.md) records the exact coverage and limits for all seven settings areas, CMS, recruiting, approvals and makeup. Affected-file lint passed, as did four school source checks and nine mounted statistics tests. See [the consolidated report](REPORT.md) for subsequent integrated verification.
