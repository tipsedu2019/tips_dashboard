# 알림 콘텐츠 무료 티어 IPv4 Session Pooler QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase Free 프로젝트의 고정 IPv4 Session Pooler를 통해 운영 metadata와 두 schema만 읽고, DB password를 Docker metadata에 남기지 않은 채 기존 격리 로컬 DB QA를 시작할 수 있게 한다.

**Architecture:** 기존 `supabase-go --linked` remote collector만 고정 Postgres 17 client container 기반 collector로 교체한다. 고정 route·image·공개 CA를 먼저 검증하고, password는 trusted executor가 `psql`·`pg_dump` stdin prompt로만 전달한다. metadata-before에서 실제 server major를 확인한 뒤에만 schema-only dump와 metadata-after를 실행하며, 성공한 경우에만 기존 local 17단계 orchestration으로 넘긴다.

**Tech Stack:** Node.js 24, `node:test`, Docker Desktop 29.6.2 engine, pinned Supabase Postgres client image `17.6.1.132`, PostgreSQL `psql`·`pg_dump` 17.6, Supabase CLI 2.103.0, macOS Keychain.

## Global Constraints

- Supabase Free 요금제를 유지한다. Preview Branch, Dedicated IPv4 add-on, Pro upgrade를 사용하지 않는다.
- 고정 remote route는 `aws-1-ap-northeast-2.pooler.supabase.com:5432`, user `postgres.slnjqlzzhewblvttiidk`, database `postgres`, `sslmode=verify-full`이다.
- 고정 client image는 `public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13`이다.
- Supabase 공개 CA file SHA-256은 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`, certificate SHA-256 fingerprint는 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, 만료 시각은 `2031-04-26T10:56:53Z`다.
- DB password는 runner parent memory와 one-shot stdin pipe에만 존재한다. argv, DB URL, child environment, Docker container config, 파일, stdout, stderr, evidence, Git에 기록하지 않는다.
- password는 non-empty UTF-8 4096 bytes 이하이고 NUL·CR·LF를 포함하지 않아야 한다.
- 운영 DB에는 `begin read only` metadata query와 exact `pg_dump --schema-only --schema public --schema dashboard_private`만 허용한다.
- 운영 row, 학생·수업·알림 이력, webhook·provider secret을 복사하지 않는다. 운영 DDL·DML·migration mutation과 provider send·worker·cron 실행은 0건이다.
- remote server major가 17이 아니면 schema dump와 local orchestration call은 모두 0이다.
- local 17단계 orchestration, 합성 fixture, pgTAP 10개, provider-zero, exact resource cleanup 계약은 변경하지 않는다.
- 모든 Docker container는 실행별 `tips_notify_collector_qa_<12 hex>` label 소유권, `--rm`, read-only root, numeric caller UID/GID, `--cap-drop ALL`, `no-new-privileges`를 사용한다.
- 기존 matching collector가 있으면 삭제하거나 attach하지 않고 fail closed 한다. cleanup은 current exact label의 container ID만 대상으로 한다.
- 실제 `--execute --approved-local-db` 실행과 Database password 재설정은 이 구현 계획 밖의 별도 승인 gate다.
- Google OAuth Dashboard 로그인 password를 Database password로 사용하지 않는다. 현재 Keychain 값은 실제 Session Pooler 인증에서 거부된 상태다.
- Supabase의 temporary token-based database access는 2026-08-04 기준 Feature Preview이므로 이 안정화 작업에 도입하지 않는다.
- 사용자 소유 미추적 파일 `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md`는 수정·스테이징하지 않는다.
- Task 5A는 하나의 구현 Task와 하나의 최종 commit으로 끝낸다. 네 phase마다 RED → 최소 구현 → 관련 GREEN → diff checkpoint를 수행하지만 중간 commit은 만들지 않는다.

---

## File Structure

- Create: `supabase/certs/prod-ca-2021.crt`
  - Supabase가 배포한 공개 root CA의 exact PEM만 보관한다. secret이 아니며 runtime download를 하지 않는다.
- Modify: `scripts/run-notification-isolated-db-qa.mjs:1-2227,3183-3323`
  - 고정 trust descriptor, CA 검사, Docker invocation, stdin secret transport, structured cleanup, remote collector integration을 기존 fail-closed runner 안에 추가한다.
- Modify: `tests/notification-isolated-db-qa.test.mjs:1-1512,2920-3010`
  - trust input, ordered Docker argv, secret non-leak, metadata envelope, version gate, ownership, cleanup 조합과 source contract를 외부 DB 없이 검증한다.
- Retain unchanged: `scripts/notification-content-local-qa-fixture.mjs`
  - 기존 합성 fixture와 pgTAP 10-file allowlist의 기준본이다.
- Retain unchanged: `tests/notification-content-local-qa-fixture.test.mjs`
  - local fixture·provider-zero 회귀 기준본이다.

## Verified External Inputs

- Supabase 공식 Database 연결 문서는 Free tier의 Shared Supavisor Session mode가 IPv4 `:5432`임을 명시한다: `https://supabase.com/docs/guides/database/connecting-to-postgres`.
- Supabase 공식 PSQL 문서는 Session Pooler에 `sslmode=verify-full`과 Supabase CA를 사용하도록 안내한다: `https://supabase.com/docs/guides/database/psql`.
- Supabase 공식 roles 문서는 project Database password가 `postgres` role password이며 Dashboard `Database Settings`에서 변경할 수 있다고 명시한다: `https://supabase.com/docs/guides/database/postgres/roles`.
- 2026-08-04 changelog scan에서 이 collector에 적용할 Session Pooler·password breaking change는 없었다. 2026-07-30 restore credential resync와 2026-05-25 temporary token Feature Preview는 이번 범위에 적용하지 않는다.

---

### Task 1: Task 5A 무료 티어 IPv4 Session Pooler collector 구현

#### Phase 1: 고정 route·image·CA 신뢰 입력을 코드와 테스트로 잠그기

**Files:**

- Create: `supabase/certs/prod-ca-2021.crt`
- Modify: `scripts/run-notification-isolated-db-qa.mjs:1-94,361-398`
- Modify: `tests/notification-isolated-db-qa.test.mjs:1-90,793-970`

**Interfaces:**

- Produces: `assertNotificationRemotePoolerRoute(value): Readonly<RemotePoolerRoute>`
- Produces: `assertNotificationRemoteClientImage(value): Readonly<RemoteClientImage>`
- Produces: `assertNotificationRemoteClientVersion(stdout, executable): 17`
- Produces: `inspectNotificationRemoteTlsCa({ repoRoot, now }): Promise<Readonly<RemoteTlsCaEvidence>>`
- `RemotePoolerRoute` exact keys: `mode`, `projectRef`, `region`, `host`, `port`, `user`, `database`, `sslmode`, `sslrootcert`.
- `RemoteClientImage` exact keys: `tag`, `digest`, `reference`, `major`.
- `RemoteTlsCaEvidence` exact keys: `path`, `sha256`, `fingerprint256`, `notAfter`.

- [ ] **Step 1: trust descriptor RED 테스트 작성**

`tests/notification-isolated-db-qa.test.mjs`에 exact accepted descriptor와 field-by-field refusal을 추가한다.

```js
const expectedRemotePoolerRoute = Object.freeze({
  mode: "shared-supavisor-session",
  projectRef: "slnjqlzzhewblvttiidk",
  region: "ap-northeast-2",
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.slnjqlzzhewblvttiidk",
  database: "postgres",
  sslmode: "verify-full",
  sslrootcert: "/qa/prod-ca-2021.crt",
})

const expectedRemoteClientImage = Object.freeze({
  tag: "public.ecr.aws/supabase/postgres:17.6.1.132",
  digest: "sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  reference: "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  major: 17,
})

test("remote pooler route와 client image는 exact allowlist만 허용한다", async () => {
  const {
    assertNotificationRemoteClientImage,
    assertNotificationRemotePoolerRoute,
  } = await loadSubject()
  assert.deepEqual(
    assertNotificationRemotePoolerRoute(expectedRemotePoolerRoute),
    expectedRemotePoolerRoute,
  )
  assert.deepEqual(
    assertNotificationRemoteClientImage(expectedRemoteClientImage),
    expectedRemoteClientImage,
  )
  assert.throws(
    () => assertNotificationRemotePoolerRoute({
      ...expectedRemotePoolerRoute,
      host: "aws-0-ap-northeast-2.pooler.supabase.com",
    }),
    /notification_local_db_remote_pooler_route_refused/u,
  )
  assert.throws(
    () => assertNotificationRemoteClientImage({
      ...expectedRemoteClientImage,
      reference: expectedRemoteClientImage.tag,
    }),
    /notification_local_db_remote_client_image_refused/u,
  )
})
```

같은 table-driven test에서 direct host, port `6543`, 다른 ref·region·user·database, `sslmode=require`, CA path 누락, extra key, control character, tag-only, digest drift, major drift를 각각 거부한다.

`sourceEnvironment`에 `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGSSLMODE`, `PGSSLROOTCERT`, `DATABASE_URL` override를 넣어도 fixed descriptor가 바뀌지 않으며 raw URL은 invocation에 들어가지 않는 회귀도 추가한다.

- [ ] **Step 2: 공개 CA RED 테스트 작성**

실제 repository fixture는 exact hash·fingerprint·만료 시각으로 통과하고, temp repo의 modified PEM·symlink·만료 이후 `now`는 모두 child call 전에 거부되게 한다.

```js
test("Supabase 공개 CA는 file identity와 인증서 identity를 함께 검증한다", async () => {
  const { inspectNotificationRemoteTlsCa } = await loadSubject()
  const evidence = await inspectNotificationRemoteTlsCa({
    repoRoot,
    now: Date.parse("2026-08-04T00:00:00Z"),
  })
  assert.deepEqual(evidence, {
    path: join(repoRoot, "supabase/certs/prod-ca-2021.crt"),
    sha256: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
    fingerprint256: "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    notAfter: "2031-04-26T10:56:53.000Z",
  })
  await assert.rejects(
    () => inspectNotificationRemoteTlsCa({
      repoRoot,
      now: Date.parse("2031-04-26T10:56:54Z"),
    }),
    /notification_local_db_remote_tls_ca_refused/u,
  )
})
```

- [ ] **Step 3: RED 확인**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: FAIL because the four trust-input exports and CA fixture do not exist.

- [ ] **Step 4: exact 공개 CA fixture 생성**

`supabase/certs/prod-ca-2021.crt`를 mode `0644`의 일반 파일로 만들고 다음 PEM만 넣는다.

```pem
-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
```

생성 직후 다음으로 byte identity를 확인한다.

```bash
shasum -a 256 supabase/certs/prod-ca-2021.crt
openssl x509 -in supabase/certs/prod-ca-2021.crt -noout -fingerprint -sha256 -enddate
```

Expected: file hash와 certificate fingerprint가 Global Constraints의 값과 정확히 일치한다.

- [ ] **Step 5: trust descriptor와 CA inspector 최소 구현**

`node:crypto` import에 `X509Certificate`를 추가하고 exact constants를 frozen object로 정의한다. 모든 validator는 extra key도 거부한다.

```js
const REMOTE_POOLER_ROUTE = deepFreeze({
  mode: "shared-supavisor-session",
  projectRef: PARENT_PROJECT_REF,
  region: ALLOWED_REGION,
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: `postgres.${PARENT_PROJECT_REF}`,
  database: "postgres",
  sslmode: "verify-full",
  sslrootcert: "/qa/prod-ca-2021.crt",
})
const REMOTE_CLIENT_IMAGE = deepFreeze({
  tag: "public.ecr.aws/supabase/postgres:17.6.1.132",
  digest: "sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  reference: "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  major: 17,
})
const REMOTE_CA_FILE_SHA256 =
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
const REMOTE_CA_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"

export function assertNotificationRemotePoolerRoute(value) {
  const keys = Object.keys(REMOTE_POOLER_ROUTE)
  if (
    !hasExactKeys(value, keys)
    || keys.some((key) => value[key] !== REMOTE_POOLER_ROUTE[key])
  ) {
    throw new Error("notification_local_db_remote_pooler_route_refused")
  }
  return REMOTE_POOLER_ROUTE
}

export function assertNotificationRemoteClientImage(value) {
  const keys = Object.keys(REMOTE_CLIENT_IMAGE)
  if (
    !hasExactKeys(value, keys)
    || keys.some((key) => value[key] !== REMOTE_CLIENT_IMAGE[key])
  ) {
    throw new Error("notification_local_db_remote_client_image_refused")
  }
  return REMOTE_CLIENT_IMAGE
}

export function assertNotificationRemoteClientVersion(stdout, executable) {
  if (executable !== "psql" && executable !== "pg_dump") {
    throw new Error("notification_local_db_remote_client_version_refused")
  }
  const prefix = executable === "psql" ? "psql" : "pg_dump"
  const pattern = new RegExp(`^${prefix} \\(PostgreSQL\\) (\\d+)\\.\\d+(?:\\.\\d+)?$`, "u")
  const match = String(stdout).trim().match(pattern)
  if (Number(match?.[1]) !== REMOTE_CLIENT_IMAGE.major) {
    throw new Error("notification_local_db_remote_client_version_refused")
  }
  return REMOTE_CLIENT_IMAGE.major
}
```

`inspectNotificationRemoteTlsCa`는 다음처럼 file identity와 certificate identity를 한 file handle에서 확인한다.

```js
export async function inspectNotificationRemoteTlsCa({
  repoRoot = ROOT,
  now = Date.now(),
} = {}) {
  const caPath = join(repoRoot, "supabase/certs/prod-ca-2021.crt")
  let fileHandle
  try {
    if (!isAbsolute(repoRoot) || !Number.isFinite(now)) {
      throw new Error("notification_local_db_remote_tls_ca_refused")
    }
    fileHandle = await open(
      caPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    )
    const before = await fileHandle.stat({ bigint: true })
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || (before.mode & 0o777n) !== 0o644n
    ) {
      throw new Error("notification_local_db_remote_tls_ca_refused")
    }
    const bytes = await fileHandle.readFile()
    const after = await fileHandle.stat({ bigint: true })
    const certificate = new X509Certificate(bytes)
    const notAfterMs = Date.parse(certificate.validTo)
    if (
      !sameFileSnapshot(before, after)
      || sha256(bytes) !== REMOTE_CA_FILE_SHA256
      || certificate.fingerprint256 !== REMOTE_CA_FINGERPRINT
      || !Number.isFinite(notAfterMs)
      || notAfterMs <= now
    ) {
      throw new Error("notification_local_db_remote_tls_ca_refused")
    }
    return deepFreeze({
      path: caPath,
      sha256: REMOTE_CA_FILE_SHA256,
      fingerprint256: REMOTE_CA_FINGERPRINT,
      notAfter: new Date(notAfterMs).toISOString(),
    })
  } catch (error) {
    if (error?.message === "notification_local_db_remote_tls_ca_refused") throw error
    throw new Error("notification_local_db_remote_tls_ca_refused")
  } finally {
    await fileHandle?.close().catch(() => {})
  }
}
```

- [ ] **Step 6: Phase 1 GREEN과 회귀 확인**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --check
git diff -- supabase/certs/prod-ca-2021.crt scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
```

Expected: tests PASS, lint PASS, whitespace error 0, remote DB·Docker call 0.

- [ ] **Step 7: Phase 1 diff checkpoint 후 멈춤**

```bash
git diff --check
git status --short --branch
```

Expected: Phase 1 변경만 working tree에 있고 staged file과 새 commit은 0이다. 다음 phase는 이 checkpoint 검토 뒤 시작한다.

---

#### Phase 2: 비밀번호가 남지 않는 Docker invocation과 stdin transport 구현

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs:31-101,1205-1269,1932-2017`
- Modify: `tests/notification-isolated-db-qa.test.mjs:793-970`

**Interfaces:**

- Consumes: Phase 1의 frozen route·image·CA evidence.
- Produces: `buildNotificationRemoteDockerInvocation(step, options): Readonly<ProcessInvocation>`
- Produces: `writeNotificationDatabasePasswordPrompt(childStdin, secretInputProvider): Promise<void>`
- Extends private `executeBoundedProcess(processOptions, secretInputProvider?)` with exact `stdinMode="database-password-prompt"` support.
- Extends private `executeRemoteStep(invocation, execute, failureCode, secretInputProvider?)` so the provider is a separate executor argument.
- `step` exact set: `image-inspect`, `psql-version`, `pg-dump-version`, `metadata-before`, `schema-dump`, `metadata-after`.
- `ProcessInvocation` contains the non-secret marker `stdinMode`; it never contains the provider or password.

- [ ] **Step 1: ordered Docker argv RED 테스트 작성**

고정 test runtime은 `projectId`, `label`, `workdir`, `uid: 501`, `gid: 20`, Phase 1의 `client`, exact `files`, hyphenated five `containers` keys를 모두 가진다. 이 runtime으로 모든 six-step invocation의 full ordered args를 `deepEqual`한다. metadata invocation의 기준 배열은 다음과 같다.

```js
[
  "run", "--rm", "--pull", "never", "--interactive",
  "--name", "tips_notify_collector_qa_a0b1c2d3e4f5-metadata-before",
  "--label", "com.supabase.cli.project=tips_notify_collector_qa_a0b1c2d3e4f5",
  "--read-only",
  "--user", "501:20",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
  "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
  "--network", "bridge",
  "--env", "PGHOST",
  "--env", "PGPORT",
  "--env", "PGUSER",
  "--env", "PGDATABASE",
  "--env", "PGSSLMODE",
  "--env", "PGSSLROOTCERT",
  "--env", "PGCONNECT_TIMEOUT",
  "--mount", `type=bind,src=${join(repoRoot, "supabase/certs/prod-ca-2021.crt")},dst=/qa/prod-ca-2021.crt,readonly`,
  "--mount", `type=bind,src=${join(artifactRoot, "notification-remote-metadata.sql")},dst=/qa/notification-remote-metadata.sql,readonly`,
  "--entrypoint", "psql",
  "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  "--no-psqlrc", "--password", "--quiet", "--tuples-only", "--no-align",
  "--set", "ON_ERROR_STOP=1", "--file", "/qa/notification-remote-metadata.sql",
]
```

schema invocation은 두 번째 mount만 read-write dump file로 바꾸고 inner args를 다음 exact array로 고정한다.

```js
[
  "--password",
  "--schema-only",
  "--schema", "public",
  "--schema", "dashboard_private",
  "--file", "/qa/notification-remote-schema.sql",
]
```

version probes는 `--pull never`, `--network none`, no `--interactive`, no `--tty`, no `--env`, no mount, no `stdinMode`이며 각각 `--entrypoint psql|pg_dump`, `--version`만 허용한다. metadata·dump에도 `--tty`는 금지한다. image inspect는 exact tag에 `docker image inspect --format {{json .RepoDigests}}`만 허용한다.

- [ ] **Step 2: secret boundary와 delayed zeroize RED 테스트 작성**

fake stdin은 `end(buffer, callback)`의 buffer reference와 callback을 보관한다. callback 전에는 sentinel bytes가 유지되고 callback 후에는 모두 `0`인지 검사한다. error path도 같은 zeroize 결과를 요구한다.

```js
test("database password buffer는 stdin 완료 뒤에만 zeroize한다", async () => {
  const { writeNotificationDatabasePasswordPrompt } = await loadSubject()
  let capturedBuffer
  let finishWrite
  const childStdin = {
    once() {},
    off() {},
    end(buffer, callback) {
      capturedBuffer = buffer
      finishWrite = callback
    },
  }
  let providerCalls = 0
  const writing = writeNotificationDatabasePasswordPrompt(childStdin, () => {
    providerCalls += 1
    return "sentinel-database-password"
  })
  assert.equal(capturedBuffer.toString("utf8"), "sentinel-database-password\n")
  assert.equal(capturedBuffer.every((byte) => byte === 0), false)
  finishWrite()
  await writing
  assert.equal(providerCalls, 1)
  assert.equal(capturedBuffer.every((byte) => byte === 0), true)
})
```

별도 table test에서 empty, 4097-byte, NUL, CR, LF password와 missing provider를 `notification_local_db_remote_credential_required`로 거부한다. invocation, args, env, JSON evidence에는 sentinel, `PGPASSWORD`, `SUPABASE_DB_PASSWORD`, access token, webhook이 없어야 한다.

- [ ] **Step 3: RED 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: FAIL on missing Docker invocation builder and stdin transport export.

- [ ] **Step 4: non-secret Docker environment와 exact invocation builder 구현**

Docker CLI child environment는 `LOCAL_ENV_SOURCE_KEYS`와 다음 fixed values만 포함한다.

```js
const REMOTE_POSTGRES_ENVIRONMENT = deepFreeze({
  PGHOST: "aws-1-ap-northeast-2.pooler.supabase.com",
  PGPORT: "5432",
  PGUSER: "postgres.slnjqlzzhewblvttiidk",
  PGDATABASE: "postgres",
  PGSSLMODE: "verify-full",
  PGSSLROOTCERT: "/qa/prod-ca-2021.crt",
  PGCONNECT_TIMEOUT: "30",
})
const DATABASE_PASSWORD_STDIN_MODE = "database-password-prompt"
```

`buildNotificationRemoteDockerInvocation`은 step별 args를 위 exact order로 생성하고 `Object.freeze`한 뒤 반환한다. path에는 comma·NUL·CR·LF가 없어야 하며 모든 host path는 absolute regular-file path여야 한다. metadata·dump만 `stdinMode: DATABASE_PASSWORD_STDIN_MODE`를 갖는다. invocation object에는 `shell: false`, exact timeout, stdout/stderr byte limit와 optional `AbortSignal`을 포함한다.

```js
const REMOTE_POSTGRES_ENV_KEYS = Object.freeze([
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGDATABASE",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGCONNECT_TIMEOUT",
])

function remoteRunBaseArgs(runtime, step, { interactive, network }) {
  const containerName = runtime.containers[step]
  return [
    "run", "--rm", "--pull", "never",
    ...(interactive ? ["--interactive"] : []),
    "--name", containerName,
    "--label", `${runtime.label.key}=${runtime.label.value}`,
    "--read-only",
    "--user", `${runtime.uid}:${runtime.gid}`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--network", network,
  ]
}

export function buildNotificationRemoteDockerInvocation(step, options) {
  const runtime = options.runtime
  const base = {
    step,
    command: DEFAULT_DOCKER_CLI_PATH,
    cwd: runtime.workdir,
    shell: false,
    maxStderrBytes: MAX_STDERR_BYTES,
    ...(options.abortSignal instanceof AbortSignal
      ? { abortSignal: options.abortSignal }
      : {}),
  }
  const safeEnvironment = buildRemoteCollectorDockerEnvironment(
    options.sourceEnvironment,
  )
  if (step === "image-inspect") {
    return deepFreeze({
      ...base,
      args: ["image", "inspect", "--format", "{{json .RepoDigests}}", runtime.client.tag],
      env: safeEnvironment,
      stdin: "ignore",
      timeoutMs: 30 * 1000,
      maxStdoutBytes: MAX_STATUS_STDOUT_BYTES,
    })
  }
  if (step === "psql-version" || step === "pg-dump-version") {
    const executable = step === "psql-version" ? "psql" : "pg_dump"
    return deepFreeze({
      ...base,
      args: [
        ...remoteRunBaseArgs(runtime, step, { interactive: false, network: "none" }),
        "--entrypoint", executable,
        runtime.client.reference,
        "--version",
      ],
      env: safeEnvironment,
      stdin: "ignore",
      timeoutMs: 30 * 1000,
      maxStdoutBytes: MAX_STATUS_STDOUT_BYTES,
    })
  }
  const env = deepFreeze({ ...safeEnvironment, ...REMOTE_POSTGRES_ENVIRONMENT })
  const envArgs = REMOTE_POSTGRES_ENV_KEYS.flatMap((key) => ["--env", key])
  const caMount =
    `type=bind,src=${runtime.files.caPath},dst=/qa/prod-ca-2021.crt,readonly`
  const isMetadata = step === "metadata-before" || step === "metadata-after"
  const fileMount = isMetadata
    ? `type=bind,src=${runtime.files.queryPath},dst=/qa/notification-remote-metadata.sql,readonly`
    : `type=bind,src=${runtime.files.schemaDumpPath},dst=/qa/notification-remote-schema.sql`
  const executable = isMetadata ? "psql" : "pg_dump"
  const innerArgs = isMetadata
    ? [
        "--no-psqlrc", "--password", "--quiet", "--tuples-only", "--no-align",
        "--set", "ON_ERROR_STOP=1", "--file", "/qa/notification-remote-metadata.sql",
      ]
    : [
        "--password", "--schema-only",
        "--schema", "public", "--schema", "dashboard_private",
        "--file", "/qa/notification-remote-schema.sql",
      ]
  return deepFreeze({
    ...base,
    args: [
      ...remoteRunBaseArgs(runtime, step, { interactive: true, network: "bridge" }),
      ...envArgs,
      "--mount", caMount,
      "--mount", fileMount,
      "--entrypoint", executable,
      runtime.client.reference,
      ...innerArgs,
    ],
    env,
    stdinMode: DATABASE_PASSWORD_STDIN_MODE,
    timeoutMs: isMetadata ? 60 * 1000 : 20 * 60 * 1000,
    maxStdoutBytes: isMetadata ? MAX_METADATA_BYTES : MAX_STATUS_STDOUT_BYTES,
  })
}
```

`runtime.containers`는 exact keys `psql-version`, `pg-dump-version`, `metadata-before`, `schema-dump`, `metadata-after`를 사용한다. builder 진입 시 runtime, step, paths, route·client identity를 검증해 unsupported step과 comma·control-character path를 `notification_local_db_remote_context_refused`로 거부한다.

- [ ] **Step 5: one-shot stdin writer 구현**

```js
export async function writeNotificationDatabasePasswordPrompt(
  childStdin,
  secretInputProvider,
) {
  let secretBuffer
  try {
    if (typeof secretInputProvider !== "function") {
      throw new Error("notification_local_db_remote_credential_required")
    }
    const password = secretInputProvider()
    if (
      typeof password !== "string"
      || password.length === 0
      || Buffer.byteLength(password, "utf8") > 4096
      || /[\0\r\n]/u.test(password)
    ) {
      throw new Error("notification_local_db_remote_credential_required")
    }
    secretBuffer = Buffer.from(`${password}\n`, "utf8")
    await new Promise((resolvePromise, rejectPromise) => {
      const onError = () => rejectPromise(
        new Error("notification_local_db_remote_credential_write_failed"),
      )
      childStdin.once("error", onError)
      childStdin.end(secretBuffer, () => {
        childStdin.off("error", onError)
        resolvePromise()
      })
    })
  } catch (error) {
    if (/^notification_local_db_remote_credential_(?:required|write_failed)$/u.test(error?.message)) {
      throw error
    }
    throw new Error("notification_local_db_remote_credential_write_failed")
  } finally {
    secretBuffer?.fill(0)
  }
}
```

- [ ] **Step 6: bounded executor에 opt-in stdin transport 연결**

`executeBoundedProcess(processOptions, secretInputProvider)`는 marker가 없는 모든 기존 step에 `stdio[0]="ignore"`를 유지한다. marker가 있으면 `stdio[0]="pipe"`로 spawn하고 `writeNotificationDatabasePasswordPrompt`를 시작한다. `finish()`는 stdin promise가 성공·오류로 settle한 뒤 결과를 resolve하며 stdin failure는 exit code `1`로 정규화한다. provider가 marker 없이 전달되거나 marker가 있는데 provider가 없으면 spawn 전에 `notification_local_db_remote_context_refused`로 거부한다.

```js
const usesDatabasePasswordPrompt =
  processOptions.stdinMode === DATABASE_PASSWORD_STDIN_MODE
const child = spawn(processOptions.command, processOptions.args, {
  cwd: processOptions.cwd,
  env: processOptions.env,
  shell: false,
  stdio: [usesDatabasePasswordPrompt ? "pipe" : "ignore", "pipe", "pipe"],
  windowsHide: true,
})
const stdinPromise = usesDatabasePasswordPrompt
  ? writeNotificationDatabasePasswordPrompt(child.stdin, secretInputProvider)
  : Promise.resolve()
```

stdin promise rejection은 raw error를 stdout/stderr에 합치지 않고 child termination만 요청한다. `finish()`는 다음처럼 stdin settle을 기다린 뒤 기존 result shape만 반환한다.

```js
let stdinFailed = false
stdinPromise.catch(() => {
  stdinFailed = true
  terminate()
})
const finish = async (code) => {
  if (settled) return
  settled = true
  clearTimeout(timeout)
  clearTimeout(forceKillTimeout)
  clearTimeout(forceFinishTimeout)
  abortSignal?.removeEventListener?.("abort", handleAbort)
  await stdinPromise.catch(() => {})
  resolvePromise({
    code: overflowed || aborted || spawnErrored || stdinFailed
      ? 1
      : Number.isInteger(code) ? code : 1,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  })
}
```

abort·timeout·overflow의 기존 kill/drain 계약을 유지한다. 실제 구현에서는 `terminate`와 `finish` 선언 뒤 stdin promise를 시작해 temporal-dead-zone 없이 같은 순서를 만족시킨다.

`executeRemoteStep`은 serializable invocation을 바꾸지 않고 provider를 별도 두 번째 executor argument로만 전달한다.

```js
async function executeRemoteStep(
  invocation,
  execute,
  failureCode,
  secretInputProvider,
) {
  assertNotificationRunNotAborted(invocation.abortSignal)
  let result
  try {
    result = await execute(invocation, secretInputProvider)
  } catch {
    assertNotificationRunNotAborted(invocation.abortSignal)
    throw new Error(failureCode)
  }
  assertNotificationRunNotAborted(invocation.abortSignal)
  if (
    !isPlainRecord(result)
    || !Number.isInteger(result.code)
    || result.code !== 0
    || typeof result.stdout !== "string"
    || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) > invocation.maxStdoutBytes
    || Buffer.byteLength(result.stderr) > invocation.maxStderrBytes
  ) {
    throw new Error(failureCode)
  }
  return result.stdout
}
```

- [ ] **Step 7: Phase 2 GREEN과 회귀 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
"$TASK_NODE" --test tests/notification-content-local-qa-fixture.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --check
git diff -- scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
```

Expected: all PASS, existing collector behavior unchanged, actual Docker·remote DB call 0.

- [ ] **Step 8: Phase 2 diff checkpoint 후 멈춤**

```bash
git diff --check
git status --short --branch
```

Expected: Phase 1·2 변경만 working tree에 있고 staged file과 새 commit은 0이다. collector production path는 아직 기존 동작을 유지한다.

---

#### Phase 3: collector·artifact·outer cleanup 오류를 구조화해 보존하기

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs:1377-1417,1570-1584,1629-1643,2177-2227,3288-3323`
- Modify: `tests/notification-isolated-db-qa.test.mjs:1090-1239,1320-1417,2620-2730`

**Interfaces:**

- Consumes: existing `NotificationLocalDbQaError` and exact-label cleanup controller.
- Produces: `primaryCodeFromError(error, fallback): string`.
- Produces: every collector/preparation failure as `NotificationLocalDbQaError` with frozen `{ primaryCode, cleanupCode }` evidence.
- Removes: colon composite error strings such as `primary:notification_local_db_remote_artifact_cleanup_failed`.

- [ ] **Step 1: structured failure matrix RED 테스트 작성**

다음 조합을 table-driven test로 추가한다.

```js
const structuredFailureCases = Object.freeze([
  Object.freeze({
    name: "metadata failure and artifact cleanup success",
    primaryCode: "notification_local_db_remote_metadata_query_failed",
    innerCleanupCode: "notification_local_db_cleanup_ok",
    outerCleanupCode: "notification_local_db_cleanup_ok",
    expectedCleanupCode: "notification_local_db_cleanup_ok",
  }),
  Object.freeze({
    name: "schema failure and artifact cleanup failure",
    primaryCode: "notification_local_db_remote_schema_dump_failed",
    innerCleanupCode: "notification_local_db_cleanup_failed",
    outerCleanupCode: "notification_local_db_cleanup_ok",
    expectedCleanupCode: "notification_local_db_cleanup_failed",
  }),
  Object.freeze({
    name: "metadata failure and container cleanup failure",
    primaryCode: "notification_local_db_remote_metadata_query_failed",
    innerCleanupCode: "notification_local_db_cleanup_ok",
    outerCleanupCode: "notification_local_db_cleanup_failed",
    expectedCleanupCode: "notification_local_db_cleanup_failed",
  }),
])
```

각 case는 `caught.code === primaryCode`, `caught.evidence` exact equality, raw stderr·sentinel non-match, local orchestration call `0`을 검사한다. `prepareNotificationLocalQaContext`를 통과해도 같은 evidence가 유지되어야 한다. source test는 `.split(":", 1)`과 colon composite throw가 runner에서 제거됐는지 확인한다.

- [ ] **Step 2: RED 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: FAIL because current collector concatenates cleanup failure with `:` and outer wrapper truncates it.

- [ ] **Step 3: safe structured error extractor 구현**

```js
function primaryCodeFromError(error, fallback) {
  return safeFailureCode(
    error?.evidence?.primaryCode ?? error?.code ?? error?.message,
    fallback,
  )
}

function cleanupFailedIn(error) {
  return error?.evidence?.cleanupCode === "notification_local_db_cleanup_failed"
}
```

- [ ] **Step 4: artifact cleanup catch를 `NotificationLocalDbQaError`로 교체**

`collectRemoteSchemaMetadata` catch는 primary와 cleanup을 독립적으로 계산한다.

```js
} catch (error) {
  const primaryCode = primaryCodeFromError(
    error,
    "notification_local_db_remote_collector_failed",
  )
  let cleanupCode = "notification_local_db_cleanup_ok"
  try {
    await cleanupCollectorArtifacts(collectorArtifacts)
  } catch {
    cleanupCode = "notification_local_db_cleanup_failed"
  }
  throw new NotificationLocalDbQaError(primaryCode, cleanupCode)
}
```

- [ ] **Step 5: outer collector cleanup 결합 규칙 구현**

`runNotificationRemoteCollectorWithCleanup`은 source evidence를 먼저 읽고 inner·outer 중 하나라도 cleanup failed면 최종 cleanup failed로 만든다.

```js
const sourcePrimaryCode = primaryCodeFromError(
  remoteCollectionError,
  "notification_local_db_remote_collector_failed",
)
const cleanupCode = cleanupFailedIn(remoteCollectionError)
    || collectorCleanup?.cleanupCode !== "notification_local_db_cleanup_ok"
  ? "notification_local_db_cleanup_failed"
  : "notification_local_db_cleanup_ok"
const primaryCode = abortSignal?.aborted
  ? "notification_local_db_signal_received"
  : sourcePrimaryCode
```

remote collection 성공 뒤 outer cleanup만 실패한 경우 primary는 `notification_local_db_remote_collector_failed`다. signal은 cleanup drain 이후 `notification_local_db_signal_received`를 우선한다.

- [ ] **Step 6: preparation wrapper에서도 evidence-first 규칙 적용**

`prepareNotificationLocalQaContext` catch는 `.split(":", 1)`을 삭제하고 `primaryCodeFromError(error, "notification_local_db_preparation_failed")`를 사용한다. inherited cleanup failure와 temp-root cleanup failure 중 하나라도 있으면 최종 cleanup failed다.

```js
const rootCleanupCode = tempRoot === undefined
  ? "notification_local_db_cleanup_not_required"
  : await removeNotificationRuntimeRoot(tempRoot)
    ? "notification_local_db_cleanup_ok"
    : "notification_local_db_cleanup_failed"
const cleanupCode = cleanupFailedIn(error)
    || rootCleanupCode === "notification_local_db_cleanup_failed"
  ? "notification_local_db_cleanup_failed"
  : error?.evidence?.cleanupCode === "notification_local_db_cleanup_ok"
      || rootCleanupCode === "notification_local_db_cleanup_ok"
    ? "notification_local_db_cleanup_ok"
    : "notification_local_db_cleanup_not_required"
const primaryCode = abortSignal?.aborted
  ? "notification_local_db_signal_received"
  : primaryCodeFromError(error, "notification_local_db_preparation_failed")
throw new NotificationLocalDbQaError(primaryCode, cleanupCode)
```

- [ ] **Step 7: Phase 3 GREEN과 회귀 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
"$TASK_NODE" --test tests/notification-content-local-qa-fixture.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --check
git diff -- scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
```

Expected: all PASS, colon composite source 0, remote DB·Docker call 0.

- [ ] **Step 8: Phase 3 diff checkpoint 후 멈춤**

```bash
git diff --check
git status --short --branch
```

Expected: Phase 1·2·3 변경만 working tree에 있고 staged file과 새 commit은 0이다. actual remote DB·Docker call은 하지 않는다.

---

#### Phase 4: Docker Session Pooler collector를 통합하고 기존 remote CLI 경로 제거

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs:31-101,142-199,1109-1269,1272-1375,1418-1584,1932-2017,3183-3323`
- Modify: `tests/notification-isolated-db-qa.test.mjs:793-1512,2920-3010`

**Interfaces:**

- Consumes: Phase 1 trust validators, Phase 2 Docker invocation/stdin transport, Phase 3 structured failure boundary.
- Produces: `buildNotificationRemoteCollectorRuntime({ tempRoot, randomBytes, getUid, getGid })` version 2 manifest with exact `uid`·`gid`, frozen route·client, file paths와 container names.
- Produces: `collectRemoteSchemaMetadata(context, execute, { collectorRuntime })` transcript `image-inspect → psql-version → pg-dump-version → metadata-before → schema-dump → metadata-after`.
- Retains unchanged: `parseRemoteMetadataOutput`, migration drift manifest, local 17-step orchestration, fixture, pgTAP and provider-zero assertions.
- Removes from remote collector: `supabase-go db query --linked`, `supabase-go db dump --linked`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` child environment.

- [ ] **Step 1: full collector transcript RED 테스트 작성**

현재 main success test를 six-step Docker transcript로 바꾼다. fake executor는 invocation과 별도 `secretInputProvider`를 받고, metadata·dump step에서만 provider를 정확히 한 번 호출한다.

```js
const expectedRemoteSteps = Object.freeze([
  "image-inspect",
  "psql-version",
  "pg-dump-version",
  "metadata-before",
  "schema-dump",
  "metadata-after",
])

const calls = []
let promptCalls = 0
const metadataRows = JSON.stringify([{
  notification_local_qa_remote_metadata: remoteMetadataFixture(),
}])

const execute = async (invocation, secretInputProvider) => {
  calls.push(invocation)
  if (invocation.step === "image-inspect") {
    return {
      code: 0,
      stdout: JSON.stringify([
        "public.ecr.aws/supabase/postgres@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
      ]),
      stderr: "",
    }
  }
  if (invocation.step === "psql-version") {
    return { code: 0, stdout: "psql (PostgreSQL) 17.6\n", stderr: "" }
  }
  if (invocation.step === "pg-dump-version") {
    return { code: 0, stdout: "pg_dump (PostgreSQL) 17.6\n", stderr: "" }
  }
  promptCalls += 1
  assert.equal(secretInputProvider(), "sentinel-database-password")
  if (invocation.step === "schema-dump") {
    await writeFile(
      join(artifactRoot, "notification-remote-schema.sql"),
      "-- PostgreSQL database dump\ncreate schema if not exists dashboard_private;\n",
    )
    return { code: 0, stdout: "", stderr: "Password: " }
  }
  return { code: 0, stdout: metadataRows, stderr: "Password: " }
}
```

test는 calls step exact equality, ordered args, `promptCalls === 3`, stdout parser, migration manifest, schema hash, `rowDataCopied: 0`, `productionMutationCount: 0`, secret non-leak를 확인한다.

- [ ] **Step 2: fail-closed transcript RED matrix 작성**

다음 failure마다 실행된 step 배열과 local orchestration call `0`을 exact assertion한다.

- CA hash·expiry failure: Docker call `0`.
- image inspect digest drift: only `image-inspect`.
- psql version 16: through `psql-version`; remote connection `0`.
- pg_dump version 16: through `pg-dump-version`; remote connection `0`.
- metadata-before server major 16: through `metadata-before`; dump `0`.
- metadata object-only stdout: `notification_local_db_remote_metadata_invalid`.
- schema dump data marker or `COPY FROM stdin`: `notification_local_db_remote_schema_dump_refused`; metadata-after `0`.
- metadata-before/after drift: all six calls, `notification_local_db_remote_snapshot_changed`.
- output file inode·UID·GID·mode replacement: `notification_local_db_remote_schema_dump_refused`.
- stale exact-pattern collector: preflight only, run container `0`, deletion `0`.

- [ ] **Step 3: RED 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: FAIL because current collector still emits three `supabase-go` calls and the SQL output envelope is CLI-specific.

- [ ] **Step 4: metadata SQL output envelope를 psql contract로 변경**

`REMOTE_METADATA_SQL`의 첫 select 시작을 정확히 다음 문자열로 바꾼다.

```sql
select pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object(
    'notification_local_qa_remote_metadata',
    pg_catalog.jsonb_build_object(
```

기존 metadata object 마지막의 다음 문자열:

```sql
) as notification_local_qa_remote_metadata;
```

을 다음으로 바꾼다.

```sql
    )
  )
)::text;
```

기존 inner key와 subquery는 하나도 삭제·추가하지 않는다. `parseRemoteMetadataOutput`은 수정하지 않는다. query file은 첫 statement `begin read only;`, 마지막 statement `rollback;`을 유지한다.

- [ ] **Step 5: remote runtime manifest를 numeric UID/GID version 2로 갱신**

```js
export async function buildNotificationRemoteCollectorRuntime({
  tempRoot,
  randomBytes = secureRandomBytes,
  getUid = process.getuid,
  getGid = process.getgid,
} = {}) {
  const uid = getUid?.()
  const gid = getGid?.()
  if (
    !Number.isSafeInteger(uid)
    || uid < 0
    || !Number.isSafeInteger(gid)
    || gid < 0
  ) {
    throw new Error("notification_local_db_remote_runtime_refused")
  }
  return deepFreeze({
    version: 2,
    projectId,
    tempRoot,
    workdir,
    uid,
    gid,
    label: { key: "com.supabase.cli.project", value: projectId },
    route: REMOTE_POOLER_ROUTE,
    client: REMOTE_CLIENT_IMAGE,
    files: {
      caPath: join(ROOT, "supabase/certs/prod-ca-2021.crt"),
      queryPath: join(tempRoot, "notification-remote-metadata.sql"),
      schemaDumpPath: join(tempRoot, "notification-remote-schema.sql"),
    },
    containers: {
      "psql-version": `${projectId}-psql-version`,
      "pg-dump-version": `${projectId}-pg-dump-version`,
      "metadata-before": `${projectId}-metadata-before`,
      "schema-dump": `${projectId}-schema-dump`,
      "metadata-after": `${projectId}-metadata-after`,
    },
  })
}
```

함수의 기존 temp-root·random-id 검증은 그대로 유지한다. Supabase linked config와 project-ref 파일 생성·검사는 제거하고 mode `0700`의 empty `remote-collector` workdir만 유지한다. `assertNotificationRemoteCollectorRuntime`은 version 2 exact keys, UID/GID, frozen route·client, exact host paths와 five container names를 검사한다.

- [ ] **Step 6: artifact identity에 owner를 포함**

`writePrivateFile`이 `{ dev, ino, uid, gid }`를 반환하게 하고 query·schema inspector가 pre/post `dev`, `ino`, `uid`, `gid`, mode를 모두 확인하게 한다. schema output file은 caller가 mode `0600`으로 미리 만들고 Docker container는 `--user ${uid}:${gid}`로만 쓴다. `chmod`로 owner mismatch를 덮지 않는다.

```js
return Object.freeze({
  dev: fileStat.dev,
  ino: fileStat.ino,
  uid: fileStat.uid,
  gid: fileStat.gid,
})
```

`inspectSchemaDump`의 `fileHandle.chmod(0o600)`을 삭제하고 pre/post 조건에 다음 owner identity를 추가한다.

```js
fileStat.uid !== expectedIdentity.uid
  || fileStat.gid !== expectedIdentity.gid
  || afterReadStat.uid !== expectedIdentity.uid
  || afterReadStat.gid !== expectedIdentity.gid
```

- [ ] **Step 7: CA·image·client version preflight 통합**

`collectRemoteSchemaMetadata`는 credential shape, route, runtime, CA를 검증한 뒤에만 Docker executor를 호출한다.

```js
const caEvidence = await inspectNotificationRemoteTlsCa({ repoRoot: ROOT })
if (caEvidence.path !== normalizedCollectorRuntime.files.caPath) {
  throw new Error("notification_local_db_remote_tls_ca_refused")
}
const dockerOptions = Object.freeze({
  runtime: normalizedCollectorRuntime,
  sourceEnvironment: context.sourceEnvironment,
  abortSignal: context.abortSignal,
})
const imageInspect = await executeRemoteStep(
  buildNotificationRemoteDockerInvocation("image-inspect", dockerOptions),
  execute,
  "notification_local_db_remote_client_image_refused",
)
assertNotificationRemoteImageInspectOutput(imageInspect)

for (const [step, executable] of [
  ["psql-version", "psql"],
  ["pg-dump-version", "pg_dump"],
]) {
  const stdout = await executeRemoteStep(
    buildNotificationRemoteDockerInvocation(step, dockerOptions),
    execute,
    "notification_local_db_remote_client_version_refused",
  )
  assertNotificationRemoteClientVersion(stdout, executable)
}
```

`assertNotificationRemoteImageInspectOutput`은 stdout을 JSON으로 읽은 값이 exact repo digest 하나만 가진 array와 deep equality일 때만 통과한다. image pull은 하지 않는다.

- [ ] **Step 8: metadata-before와 server-major gate 통합**

validated password를 닫아둔 `secretInputProvider`를 만들되 invocation object에는 넣지 않는다.

```js
const secretInputProvider = () => databasePassword
const metadataBeforeStdout = await executeRemoteStep(
  buildNotificationRemoteDockerInvocation("metadata-before", dockerOptions),
  execute,
  "notification_local_db_remote_metadata_query_failed",
  secretInputProvider,
)
const metadataBefore = parseRemoteMetadataOutput(metadataBeforeStdout)
if (metadataBefore.postgresMajor !== REMOTE_CLIENT_IMAGE.major) {
  throw new Error("notification_local_db_remote_client_version_refused")
}
```

`executeRemoteStep`의 네 번째 인자만 executor의 두 번째 인자로 전달한다. image/version step에는 provider를 전달하지 않는다.

- [ ] **Step 9: schema-only dump와 metadata-after 통합**

server-major gate 통과 뒤 exact schema invocation을 한 번 실행하고 `inspectSchemaDump`를 통과시킨다. 이후 metadata-after를 같은 query invocation으로 실행해 before와 deep equality를 확인한다. 기존 local migration catalog pre/post identity, pending manifest, metadata file, safety evidence 생성은 유지한다.

```js
await executeRemoteStep(
  buildNotificationRemoteDockerInvocation("schema-dump", dockerOptions),
  execute,
  "notification_local_db_remote_schema_dump_failed",
  secretInputProvider,
)
const schemaDump = await inspectSchemaDump(
  normalizedCollectorRuntime.files.schemaDumpPath,
  schemaDumpIdentity,
)
const metadataAfterStdout = await executeRemoteStep(
  buildNotificationRemoteDockerInvocation("metadata-after", dockerOptions),
  execute,
  "notification_local_db_remote_metadata_query_failed",
  secretInputProvider,
)
const metadataAfter = parseRemoteMetadataOutput(metadataAfterStdout)
if (JSON.stringify(metadataBefore) !== JSON.stringify(metadataAfter)) {
  throw new Error("notification_local_db_remote_snapshot_changed")
}
```

`collectRemoteSchemaMetadata` context에서 기존 `cliPath`를 삭제하고 Docker command는 내부 `DEFAULT_DOCKER_CLI_PATH`로 고정한다. context나 environment의 Docker path override는 허용하지 않는다. remote Docker environment는 access token·Database password·provider secret을 포함하지 않는다.

project evidence는 외부 context가 아니라 validated fixed route에서만 만든다.

```js
const project = deepFreeze({
  projectRef: REMOTE_POOLER_ROUTE.projectRef,
  region: REMOTE_POOLER_ROUTE.region,
})
```

- [ ] **Step 10: production preparation wiring과 source contract 갱신**

`prepareNotificationLocalQaContext`는 local orchestration용 Supabase CLI version check는 유지하되 remote collector에는 다음 context를 전달한다.

```js
collectorContext: {
  approved: true,
  artifactRoot: tempRoot,
  sourceEnvironment: process.env,
  abortSignal,
}
```

source contract test는 remote collector 구간에서 `db query --linked`, `db dump --linked`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` child env가 없음을 확인한다. local query·migration orchestration의 pinned `supabase-go` 사용은 그대로 둔다.

더 이상 사용하지 않는 `REMOTE_SAFE_ENV_KEYS`, `assertLinkedProjectMetadata`, `assertLinkedProjectState`, `buildRemoteEnvironment`, test helper `writeLinkedProject`, `buildNotificationQaChildEnvironments`의 `remoteMetadata`·`remoteSchema` output을 삭제한다. `buildNotificationQaChildEnvironments`는 exact `{ local }`만 반환하고 local environment의 remote credential 차단 assertion은 유지한다.

`planEvidence().expectedResources`에는 다음 non-secret collector 요약을 추가한다.

```js
remoteCollector: {
  mode: "shared-supavisor-session",
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  sslmode: "verify-full",
  clientImage:
    "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  clientMajor: 17,
  schemas: ["public", "dashboard_private"],
  productionRowDataCopied: 0,
  productionMutationCount: 0,
}
```

- [ ] **Step 11: Phase 4 targeted GREEN 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --check
```

Expected: isolated runner unit tests PASS, lint PASS, actual remote DB call 0.

- [ ] **Step 12: local-only pinned image smoke 확인**

DB password와 network를 사용하지 않고 고정 image identity와 client major만 확인한다.

```bash
docker image inspect public.ecr.aws/supabase/postgres:17.6.1.132 --format '{{index .RepoDigests 0}}'
docker run --rm --pull never --read-only --user 501:20 --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m --network none --entrypoint psql public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13 --version
docker run --rm --pull never --read-only --user 501:20 --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m --network none --entrypoint pg_dump public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13 --version
```

Expected: pinned digest, `psql (PostgreSQL) 17.6`, `pg_dump (PostgreSQL) 17.6`; remaining labeled container 0.

- [ ] **Step 13: 전체 관련 회귀 확인**

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
"$TASK_NODE" --test tests/notification-content-local-qa-fixture.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-contract.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-manifest.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-system-template-vnext.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/dashboard-notification-content.test.mjs
"$TASK_NODE" --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --check
git status --short --branch
```

Expected: all tests/lint PASS; runner without approval flags prints plan mode only; provider attempt 0; remote DB call 0; user-owned untracked plan unchanged.

- [ ] **Step 14: Task 5A 전체 diff 검토**

```bash
git diff --stat
git diff -- supabase/certs/prod-ca-2021.crt scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --check
```

확인 항목: 실제 Database password value와 raw DB URL 0, remote Docker argv·env·container model의 `PGPASSWORD` 0, remote Supabase CLI query/dump 0, provider env 0, exact six-step order, local orchestration 무관 변경 0. 기존 disposable local Postgres의 고정 `PGPASSWORD=postgres`는 이 remote 검사 대상이 아니다.

- [ ] **Step 15: Task 5A 단일 implementation commit 후 멈춤**

```bash
git add supabase/certs/prod-ca-2021.crt scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --cached --check
git diff --cached --stat
git commit -m "feat: collect notification QA schema over IPv4 pooler"
```

이 commit은 Task 5A 코드·fake executor·local-only image 검증 완료만 뜻한다. 실제 Supabase metadata 수집, local DB round-trip, production migration, push, deploy, notification activation, provider send 완료를 뜻하지 않는다.

---

## Post-implementation Credential and Live-QA Gate

이 gate는 Task 1의 네 구현 phase와 별도이며, 다시 사용자 승인을 받은 뒤 진행한다.

1. Supabase Dashboard의 Google OAuth 로그인은 유지한다. Google password를 수집하거나 DB client에 사용하지 않는다.
2. Vercel·로컬 환경에서 direct Postgres password를 사용하는 variable name과 connection consumer 존재 여부만 read-only로 확인한다. 값은 출력하지 않는다.
3. 유효한 Database password를 찾지 못하면 사용자가 Dashboard `Database > Settings`에서 새 strong password를 설정한다. 이 external credential rotation은 별도 명시 승인 없이는 실행하지 않는다.
4. 새 password를 macOS Keychain service `tips-dashboard-supabase-db-password`에 저장하되 stdout·shell history·Git 파일에 남기지 않는다.
5. exact Session Pooler에 `verify-full` read-only authentication preflight 한 번만 수행한다. 실패하면 retry loop 없이 중단한다.
6. 별도 승인 뒤에만 `--execute --approved-local-db` 실제 QA를 한 번 실행하고 remote read-only → local 17단계 → pgTAP 10개 → exact cleanup evidence를 각각 보고한다.
7. 실제 QA가 통과해도 production migration, Git push, Vercel deployment, notification rule activation, provider send는 각각 별도 release gate로 남긴다.
