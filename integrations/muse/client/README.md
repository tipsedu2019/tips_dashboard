# Pinned Muse client candidate

Version `2026-09-29.1` was supplied by Muse in the [development conversation](https://muse.ai/thread/35b3ea22-938e-4c5e-be65-e1b77a457ac3) and independently reviewed against the TIPS v1/v2 server contracts. `manifest.json` records the delivered archive, original source hashes and reviewed file hashes. `MUSE_GUIDE.md` preserves Muse's delivered instructions as provenance; this README and the parent integration contract describe the reviewed candidate.

The initial 52 v1 / 29 v2 mocks passed locally but missed real failed receipts without a `class`, HTTP 200 malformed bodies, explicit-key replay and damaged journals. Muse corrected these cases, yielding **59 v1 tests and 39 v2 checks**. The original temporary v1 suite had been reconstructed by Muse from the contract; it is not the original temporary file.

Codex added **10 independent contract tests** and fixed remaining malformed nested `data`/`error` envelopes, applied URL validation before every command authenticates, rejected invalid ports, and retained the full canonical-origin SHA256. These corrections are recorded separately from the supplied archive. All three suites pass with socket/DNS/subprocess attempts prohibited.

```sh
python3 integrations/muse/client/tests/run_offline.py
```

The runner clears TIPS connection environment variables, uses temporary journals, and blocks network, authd socket and subprocess operations with a Python audit hook. It is an accidental-I/O guard for these reviewed mocks, not a sandbox for arbitrary code. CI executes the same runner. Synthetic mocks establish client control flow, not real Vault/Sentinel header substitution, production changes or measured speed.

`bin/dynamic_credentials.py` is the helper delivered by Muse, unchanged. It contains no credential values. The client uses its surrogate injection interface; no raw key input, browser-session export or service-role credential is supported. In Muse, use the official connector-generated helper and verify its compatibility. The real helper/socket/HTTPS transport remains an activation gate described in [the integration guide](../README.md).

The canonical-origin journal layout is incompatible with the previous development layout. No operational key or live journal existed during this change. Do not upgrade an active installation by abandoning unresolved journals; resolve/migrate them explicitly. The client assumes a single executor, and does not claim distributed execution coordination.

This directory is a reviewable release candidate, not an installed or activated production connection. Deploying the API and issuing a selected-class grant do not by themselves prove Muse's actual authentication transport.
