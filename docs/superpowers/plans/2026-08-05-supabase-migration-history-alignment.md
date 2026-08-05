# Supabase Migration History Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 운영 Supabase에 이미 적용된 세 migration의 실제 version과 저장소 파일명을 바이트 변경 없이 일치시켜, 원격 history를 수정하지 않고 db push의 history divergence를 제거한다.

**Architecture:** supabase_migrations.schema_migrations의 원격 statement와 저장소 SQL이 길이와 MD5까지 정확히 같다는 읽기 전용 증거를 기준으로 삼는다. 원격 history를 reverted 처리하거나 SQL을 재실행하지 않고 저장소의 세 파일만 실제 원격 version으로 rename한다. CI verifier와 독립 테스트가 새 version, SHA-256, 폐기된 timestamp 부재를 고정하고 변경 후 원격/로컬 version set을 다시 읽기 전용으로 비교한다.

**Tech Stack:** Supabase Postgres 17, Supabase Management connector, Supabase CLI migration history contract, Node.js node:test, Git/GitHub Actions.

## Global Constraints

- 운영 DB에 migration repair, db push, db reset, DDL, DML을 실행하지 않는다.
- 세 SQL 파일의 바이트는 변경하지 않고 파일명만 변경한다.
- 원격 statement, 전체 전화번호, 학생 데이터, provider secret을 파일, 로그, PR에 저장하지 않는다.
- .github/workflows/supabase-db-push.yml은 변경하지 않는다.
- 기존 quarantine SQL, 과거 migration history 행, notification runtime, worker, cron, Google Chat, Web Push, SOLAPI activation을 변경하지 않는다.
- 변경 후 원격 전용 version은 0개이고 로컬 전용 version은 SOLAPI 신규 migration 세 개만 남아야 한다.
- 배포와 병합은 복구 커밋의 별도 검증과 다음 Task 10 재승인 전까지 수행하지 않는다.

## Confirmed Read-Only Evidence

| 원격 version | 저장된 name | 로컬의 잘못된 version | bytes | MD5 | SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| 20260730161538 | notification_google_chat_connection_catalog | 20260730143000 | 5818 | 4a674bc6342a705264ad5d9f56e59550 | a3f72d4ec2a410796d5796019649859d5a329d5bec0e3e83f48242272dd88dda |
| 20260731011040 | notification_transfer_withdrawal_deep_links | 20260730143100 | 9428 | 6edada646da4bf5993f0ff0778ec35e8 | ed5dfb81c2cb5d1bc6dca5c38de62745c02d88b5a4b858ec57e8f0d2c6afb5ab |
| 20260731011229 | notification_owner_aware_delivery_summary | 20260730143200 | 8161 | 6c193b9f3db8ca1c4d7bd8300f3a1282 | eb06042e4e70e05d4fc745053dccc52ac01fa253928f3f04fa442f5ec9704b54 |

원격 142개와 로컬 145개 version을 비교한 현재 차이는 다음과 같다.

- 원격 전용: 위 세 version.
- 로컬 전용: 위 SQL의 잘못된 timestamp 세 개와 20260805110000, 20260805111000, 20260805112000 SOLAPI migration 세 개.
- 같은 version에서 name만 다른 네 과거 placeholder 행은 timestamp 비교에 영향을 주지 않으며 이번 범위에서 변경하지 않는다.

---

### Task 1: Align the Three Repository Migration Identities

**Files:**

- Rename: supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql → supabase/migrations/20260730161538_notification_google_chat_connection_catalog.sql
- Rename: supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql → supabase/migrations/20260731011040_notification_transfer_withdrawal_deep_links.sql
- Rename: supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql → supabase/migrations/20260731011229_notification_owner_aware_delivery_summary.sql
- Modify: scripts/verify-supabase-migration-layout.mjs
- Modify: tests/supabase-migration-layout.test.mjs
- Modify: tests/notification-google-chat-connection-catalog.test.mjs
- Modify: tests/notification-transfer-withdrawal-adapters.test.mjs
- Modify: tests/notification-control-plane-owner-aware-summary.test.mjs
- Create: docs/operations/supabase-migration-history-alignment-2026-08-05.md
- Create: docs/superpowers/plans/2026-08-05-supabase-migration-history-alignment.md

**Interfaces:**

- Consumes: 운영 schema_migrations의 version, name, statement bytes, statement MD5 읽기 전용 증거.
- Produces: 원격 history와 version이 일치하고 SQL SHA-256이 고정된 active migration lane.
- Produces error codes: remote_history_aligned_migration_not_regular, remote_history_aligned_migration_hash_mismatch, remote_history_obsolete_timestamp_present.

- [x] **Step 1: Write the failing alignment regression**

tests/supabase-migration-layout.test.mjs에 verifier 상수와 독립적인 oracle을 추가한다.

~~~js
const REMOTE_HISTORY_ALIGNED_MIGRATIONS = Object.freeze([
  {
    file: "20260730161538_notification_google_chat_connection_catalog.sql",
    obsoleteFile: "20260730143000_notification_google_chat_connection_catalog.sql",
    sha256: "a3f72d4ec2a410796d5796019649859d5a329d5bec0e3e83f48242272dd88dda",
  },
  {
    file: "20260731011040_notification_transfer_withdrawal_deep_links.sql",
    obsoleteFile: "20260730143100_notification_transfer_withdrawal_deep_links.sql",
    sha256: "ed5dfb81c2cb5d1bc6dca5c38de62745c02d88b5a4b858ec57e8f0d2c6afb5ab",
  },
  {
    file: "20260731011229_notification_owner_aware_delivery_summary.sql",
    obsoleteFile: "20260730143200_notification_owner_aware_delivery_summary.sql",
    sha256: "eb06042e4e70e05d4fc745053dccc52ac01fa253928f3f04fa442f5ec9704b54",
  },
])

test("active migration identities match the exact remote history versions", async () => {
  for (const entry of REMOTE_HISTORY_ALIGNED_MIGRATIONS) {
    assert.equal(await sha256(join(activeDir, entry.file)), entry.sha256)
    await assert.rejects(readFile(join(activeDir, entry.obsoleteFile)))
  }
})
~~~

같은 테스트 파일의 독립 fixture 검사에 missing, hash mutation, obsolete timestamp copy를 각각 만들고 다음 error code를 요구한다.

~~~text
remote_history_aligned_migration_not_regular
remote_history_aligned_migration_hash_mismatch
remote_history_obsolete_timestamp_present
~~~

- [x] **Step 2: Run the test to verify RED**

Run:

~~~bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node   --test tests/supabase-migration-layout.test.mjs
~~~

Expected: FAIL because remote-version 파일이 아직 없고 verifier가 세 error code를 구현하지 않았다.

- [x] **Step 3: Rename the files without changing bytes**

Run exactly:

~~~bash
git mv   supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql   supabase/migrations/20260730161538_notification_google_chat_connection_catalog.sql
git mv   supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql   supabase/migrations/20260731011040_notification_transfer_withdrawal_deep_links.sql
git mv   supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql   supabase/migrations/20260731011229_notification_owner_aware_delivery_summary.sql
~~~

새 파일의 SHA-256이 증거 표의 세 값과 정확히 같은지 즉시 확인한다.

- [x] **Step 4: Make the verifier fail closed on future identity drift**

scripts/verify-supabase-migration-layout.mjs에 다음 독립 contract를 추가한다.

~~~js
const REMOTE_HISTORY_ALIGNED_MIGRATIONS = Object.freeze([
  [
    "20260730161538_notification_google_chat_connection_catalog.sql",
    "20260730143000_notification_google_chat_connection_catalog.sql",
    "a3f72d4ec2a410796d5796019649859d5a329d5bec0e3e83f48242272dd88dda",
  ],
  [
    "20260731011040_notification_transfer_withdrawal_deep_links.sql",
    "20260730143100_notification_transfer_withdrawal_deep_links.sql",
    "ed5dfb81c2cb5d1bc6dca5c38de62745c02d88b5a4b858ec57e8f0d2c6afb5ab",
  ],
  [
    "20260731011229_notification_owner_aware_delivery_summary.sql",
    "20260730143200_notification_owner_aware_delivery_summary.sql",
    "eb06042e4e70e05d4fc745053dccc52ac01fa253928f3f04fa442f5ec9704b54",
  ],
])
~~~

activeDir 확인 직후 각 새 파일이 regular file이며 SHA-256이 일치하는지, 각 obsolete file이 존재하지 않는지 검사한다. 실패 시 Interfaces의 세 error code와 exact relative path를 errors에 추가한다.

- [x] **Step 5: Update only active source-test imports**

세 Node 테스트의 migration URL만 다음 mapping으로 변경한다.

~~~text
20260730143000 → 20260730161538
20260730143100 → 20260731011040
20260730143200 → 20260731011229
~~~

역사적 실행 계획 문서의 과거 명령은 대량 치환하지 않는다. 새 운영 증거 문서에서 계획 timestamp와 실제 원격 timestamp mapping을 기록해 역사와 현재 권위를 분리한다.

- [x] **Step 6: Write the operational evidence document**

docs/operations/supabase-migration-history-alignment-2026-08-05.md에 다음을 기록한다.

- GitHub Actions run 30930284103과 30804557922의 동일 divergence.
- 원격 project ACTIVE_HEALTHY 확인.
- 세 원격 version, name, bytes, MD5와 세 로컬 SHA-256.
- statement bytes와 MD5의 3/3 exact equality.
- rename-only 복구이며 remote migration repair와 SQL replay가 0이라는 경계.
- 복구 후 기대 set은 remote-only 0, local-only SOLAPI 세 version.

- [x] **Step 7: Run focused GREEN verification**

Run:

~~~bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node   --test   tests/supabase-migration-layout.test.mjs   tests/notification-google-chat-connection-catalog.test.mjs   tests/notification-transfer-withdrawal-adapters.test.mjs   tests/notification-control-plane-owner-aware-summary.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node   scripts/verify-supabase-migration-layout.mjs
~~~

Expected: all tests PASS and verifier prints no error.

- [x] **Step 8: Recompare local and remote version sets read-only**

Supabase connector list_migrations로 project slnjqlzzhewblvttiidk의 remote version을 다시 읽고 supabase/migrations의 local filenames와 비교한다. 운영 테이블은 조회하지 않는다.

Expected:

~~~json
{
  "remoteOnly": [],
  "localOnly": [
    "20260805110000_registration_customer_solapi_storage.sql",
    "20260805111000_registration_customer_solapi_message_rpc.sql",
    "20260805112000_registration_customer_solapi_activation.sql"
  ]
}
~~~

다른 version이 하나라도 나타나면 push, PR, migration repair, DB mutation 없이 중단한다.

- [x] **Step 9: Run release-boundary regression and inspect diff**

Run:

~~~bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node   --test tests/supabase-migration-layout.test.mjs tests/registration-customer-solapi-db.test.mjs
git diff --check
git status --short
git diff --stat
git diff --find-renames
~~~

Expected: 세 SQL 파일은 100% rename이고 verifier, tests, evidence 문서만 textual change이며 workflow, application, provider 파일 변경은 없다.

- [x] **Step 10: Commit and stop before Task 10 release**

Stage only the authorized files and commit:

~~~bash
git add   scripts/verify-supabase-migration-layout.mjs   tests/supabase-migration-layout.test.mjs   tests/notification-google-chat-connection-catalog.test.mjs   tests/notification-transfer-withdrawal-adapters.test.mjs   tests/notification-control-plane-owner-aware-summary.test.mjs   docs/operations/supabase-migration-history-alignment-2026-08-05.md   docs/superpowers/plans/2026-08-05-supabase-migration-history-alignment.md   supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql   supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql   supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql   supabase/migrations/20260730161538_notification_google_chat_connection_catalog.sql   supabase/migrations/20260731011040_notification_transfer_withdrawal_deep_links.sql   supabase/migrations/20260731011229_notification_owner_aware_delivery_summary.sql
git commit -m "fix: align Supabase migration history"
~~~

커밋, 테스트, 100% rename 세 건, read-only remote set 비교, 원격/provider/deployment 변경 0을 보고하고 멈춘다. Task 10 push, PR, merge는 다음 사용자 승인 뒤 재개한다.

---

## Self-Review

- Spec coverage: 원격/로컬 identity, SQL byte 보존, future drift 방지, affected imports, 운영 증거, read-only 재비교, commit/stop 경계를 모두 포함한다.
- Placeholder scan: TBD, TODO, 추측 hostname, 임의 repair 명령이 없다.
- Type consistency: verifier error code와 test assertion이 정확히 일치한다.
- Safety review: remote history mutation, SQL replay, provider call, workflow change, push, deploy가 없다.
