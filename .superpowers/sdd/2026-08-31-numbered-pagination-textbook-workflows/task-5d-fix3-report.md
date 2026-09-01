# Task 5d fix round 3 report

## Scope and outcome boundary

- Base/parent: `69372f86c78357b35e4d48f3982a89449be56b9e`.
- Changed only `src/features/textbooks/textbook-operations-workspace.tsx`, the directly affected mounted renderer test, and this report.
- No SQL/migration/API/service/type, formula, writer order/atomicity, hook framework, navigation, package/manifest/query budget, `.next`, browser/server/build, Docker/DB, network/remote, provider/send, push, or deploy work was performed.
- Task 5d remains pending fresh independent final review; plan checkboxes remain untouched.

## Fix

`masterBulkIdentity` now includes a selection-revision object built only from the currently selected textbook IDs. The shared master edit/status/delete action guard therefore detects a same-book deselect then reselect ABA change even when the final selected-ID array and patch value equal the original values.

The already-started writer is unchanged: it is neither cancelled nor retried. When the revision no longer matches, `runAction` suppresses stale invalidation, success presentation, and the successful continuation that would clear the newer selection and patch. Revisions belonging only to unselected old IDs are excluded, so they do not create unrelated invalidation.

The accepted old-scope-before-target-scope invalidation overfetch Minor remains unchanged and nonblocking.

## TDD evidence

Before the product edit, the new mounted same-A counterexample failed `0/1`: after selecting A with patch P, starting and holding its writer, and deselecting then reselecting A without changing P, the stale completion increased the RPC count from `4` to `8`. This was the expected ordinary product RED at the stale-invalidation assertion. The writer had started once with the correct P payload.

- RED log: `/private/tmp/task5d-fix3-red.log`
- RED SHA-256: `02a2e6f1b286a56c279d99e407173e5f026209600f4f0d4fc18e807e176758cc`

After adding only the selected per-key revisions to the shared identity, the same test passed `1/1`. It asserts one writer request, no stale RPC invalidation, no stale success, and preservation of the reselected A and unchanged P.

- GREEN log: `/private/tmp/task5d-fix3-green.log`
- GREEN SHA-256: `6a3bda255bef1aa79537768b0cf9b8b35e8b5fdb5c2783b9b1acb166c778bfbe`

## Final verification

- Renderer suite: `37/37` PASS. Log `/private/tmp/task5d-fix3-renderer-final.log`, SHA-256 `c4550f883fbe2a4e5c9bfb84d7b7a54515adc42eb29c3cafbeb4f60b582fb812`.
- Focused Task 5d aggregate: `433 tests; 432 pass; 1 fail`. The sole failure is the preserved unrelated assertion `buildPurchaseSupplierHandoffGroups is imported` in `tests/textbook-work-context.test.mjs`. Log `/private/tmp/task5d-fix3-focused-final.log`, SHA-256 `74201acee7eefc440d6967037b7e3a341c5d42d95acf82bf3d2c32ca7a9c11f9`.
- Full affected aggregate: `767 tests; 766 pass; 1 fail`, solely the same known unrelated import assertion. Log `/private/tmp/task5d-fix3-full-affected-final.log`, SHA-256 `fef3c7ccfb3a8f8978019c34716e9b5b18d48adeb80bc3646ca6cd9e7f0edd4d`.
- Nonincremental TypeScript: exit 0, no diagnostics. Log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- ESLint over the owned TSX/MJS files: exit 0, zero errors and warnings; Babel emitted only its informational file-size note. Log SHA-256 `f6c780bb47409995693d1a58cfc9e2e08ad1f71a015d72768975691db252ae82`.
- The initial TypeScript/ESLint wrapper attempt exited before either tool ran because the default shell PATH had no `node`. Both tools were then run through the repository's pinned Codex Node runtime; the results above are those actual final checks.
- `git diff --check`: exit 0.

## Final hashes

```text
61e0dc2b8fdcb4ab77a06515a6c229e5f10565fe3d2f8ed830de3ddd83b939a0  src/features/textbooks/textbook-operations-workspace.tsx
795aea7f41038757acb40c1c08b9ea9715be4a75d492a9804d208546ba5bd3bc  tests/textbook-numbered-renderers.test.mjs
527be1303451aa891dce077f071bf990a31701ceb0dce05f9fda694bd2ea1314  tests/textbook-numbered-pagination.test.mjs
3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323  .next/BUILD_ID
aac272c3ac88e8389ab35ebb9e4c6aeb13292e2a9dce55864bb29963dd28ddcf  .next/build-manifest.json
```

Reserved direct-page-11/startup/auth assertions, all prior Task 5c/5d lifecycle fixes, protected `.next` artifacts, the accepted invalidation Minor, and the known unrelated import failure remain preserved.
