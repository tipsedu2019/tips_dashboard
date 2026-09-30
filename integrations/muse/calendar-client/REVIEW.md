# Reviewed calendar client

Imported from the user-authorized Muse collaboration on 2026-09-30. The source archive and reviewed files are pinned in manifest.json. The frozen class client is unchanged. One local compatibility correction accepts UTC Z timestamps on Python 3.9/3.10; Muse was asked to mirror the identical source hash.

The upstream README describes its original candidate state. The maintained integration contract and current source-null semantics are in ../CALENDAR.md: source:null means no verified source for the current row, whether never researched or changed after research.

Verification: all 86 upstream mocks pass with network, DNS, credential-socket and subprocess access blocked. The real compiler/final SQL DTO probe also feeds preview, commit, receipt, fresh workspace, same-token replay and unknown receipt into this actual client. It confirms one POST and matching school/year/hash. This is local data-contract evidence, not a Muse-hosted network call or production mutation. The archived client does not contain a real key.

Run `python3 integrations/muse/calendar-client/tests/run_offline.py`. Full DB consumer check is registered as `tests/probe-agent-calendar-dto.mjs` in the isolated DB runner and CI. Production use still requires the human's secure grant entry and health/read verification after the code and migration release.
