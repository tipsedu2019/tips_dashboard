# 알림 콘텐츠 무료 티어 IPv4 세션 풀러 QA 설계

**작성일:** 2026-08-04

**상태:** 사용자 설계 승인 · 구현 전 명세

**대상:** `scripts/run-notification-isolated-db-qa.mjs`의 remote read-only collector

## 1. 배경

기존 무료 티어 QA runner는 운영 Supabase의 metadata query와 schema-only dump를 `supabase-go ... --linked`로 실행한다. 대상 프로젝트의 direct database endpoint는 IPv6만 제공하고 현재 실행 네트워크는 해당 IPv6 경로에 연결하지 못해 실제 Task 5가 `notification_local_db_remote_metadata_query_failed`로 중단됐다. 이 실패는 local DB start 전에 발생했고 exact cleanup은 성공했다.

Supabase Dashboard의 `Connect > Session pooler`에서 대상 프로젝트의 무료 IPv4 경로를 다음과 같이 확인했다.

- project ref: `slnjqlzzhewblvttiidk`
- region: `ap-northeast-2`
- host: `aws-1-ap-northeast-2.pooler.supabase.com`
- port: `5432`
- user: `postgres.slnjqlzzhewblvttiidk`
- database: `postgres`
- SSL: CA·hostname verification required

Supabase 공식 문서도 IPv4-only 환경에서는 Shared Supavisor session mode `:5432`를 direct connection의 무료 대안으로 안내한다.

## 2. 목표

1. Free 요금제에서 운영 metadata와 `public`, `dashboard_private` schema를 IPv4로 읽는다.
2. metadata SQL은 계속 `begin read only` transaction으로 제한한다.
3. schema 수집은 정확한 schema-only `pg_dump`로 제한하고 row data를 복사하지 않는다.
4. DB password를 argv, DB URL, child environment, Docker container config, 파일, stdout, stderr, evidence, Git에 기록하지 않는다.
5. remote collector가 실패하면 local DB를 시작하지 않고 exact collector cleanup만 수행한다.
6. 기존 local DB 17단계 orchestration, 합성 fixture, evidence, pgTAP 10개, provider-zero, exact cleanup 계약은 변경하지 않는다.

## 3. 비목표

- 운영 DB DDL·DML, migration apply·repair·reset
- 운영 row, 학생·수업·알림 이력, webhook·provider secret 복사
- Supabase Pro, Preview Branch, Dedicated IPv4 add-on 사용
- Google Chat·Web Push·FCM·SOLAPI 발송 또는 worker·cron 시작
- 자동 IPv6 fallback, 임의 pooler 탐색, transaction pooler `:6543` 지원
- Keychain을 runner 내부에서 직접 읽는 기능
- 현재 Keychain credential의 교체·reset
- local orchestration, fixture, pgTAP의 무관한 리팩터링

## 4. 검토한 접근법

### 4.1 채택: 고정 Postgres client image의 일회성 collector container

이미 설치된 Supabase Postgres 17 image의 digest를 고정하고, 해당 image의 `psql`과 `pg_dump`만 remote collector에 사용한다. 접속 route와 TLS 설정처럼 비밀이 아닌 `PG*` 값만 Docker client child env에 주입한다. DB password는 `psql --password`와 `pg_dump --password`가 여는 stdin prompt에만 전달한다. `PGPASSWORD`와 raw DB URL은 Docker argv·environment·container config 어디에도 만들지 않는다.

각 collector container는 실행별 random project label을 사용하고 `--rm`, read-only root filesystem, capability 제거, no-new-privileges를 적용한다. 정상 종료 시 Docker가 제거하고, signal·부분 실패로 남으면 기존 exact-label cleanup controller가 해당 실행 소유 container만 제거한다.

### 4.2 기각: Supabase CLI `--db-url`

Session pooler URL에서 password를 제외하고 `SUPABASE_DB_PASSWORD` 또는 `PGPASSWORD`만 전달하는 실험은 CLI가 인증값을 사용하지 않아 실패했다. password를 URI에 포함하면 process argv와 오류 경로에 secret이 노출될 수 있으므로 채택하지 않는다.

### 4.3 기각: IPv6·유료 IPv4·터널

IPv6 네트워크나 Dedicated IPv4 add-on은 Free-only 요구사항과 재현성에 맞지 않는다. 로컬 proxy, tunnel, DNS override는 새 외부 신뢰 경로와 인증서 문제를 만들므로 runner가 자동 구성하지 않는다.

## 5. 고정 remote route 계약

runner는 다음 descriptor와 정확히 일치하는 route만 허용한다.

```text
mode=shared-supavisor-session
projectRef=slnjqlzzhewblvttiidk
region=ap-northeast-2
host=aws-1-ap-northeast-2.pooler.supabase.com
port=5432
user=postgres.slnjqlzzhewblvttiidk
database=postgres
sslmode=verify-full
sslrootcert=/qa/prod-ca-2021.crt
```

다음 값은 실행 전에 `notification_local_db_remote_pooler_route_refused`로 거부한다.

- `db.<project-ref>.supabase.co` direct host
- `:6543` transaction mode
- 다른 project ref, region, host, user, database
- `verify-full`이 아닌 SSL mode 또는 CA path 누락·변경
- raw DB URL 또는 환경에서 주입된 route override
- NUL, whitespace, control character를 포함한 값

pooler host의 `aws-1` lane은 region만으로 추측하지 않고 Dashboard에서 확인한 project-specific allowlist 값으로 고정한다.

TLS trust anchor는 Supabase가 공식 연결 문서에서 제공하는 공개 CA를 version-controlled fixture로 고정한다.

```text
repositoryPath=supabase/certs/prod-ca-2021.crt
containerPath=/qa/prod-ca-2021.crt
source=https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
fileSha256=700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7
certificateSha256Fingerprint=80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
validUntil=2031-04-26T10:56:53Z
```

- runner는 CA를 실행 중 다운로드하거나 갱신하지 않는다.
- 실행 전에 fixture가 regular file·non-symlink이고 exact SHA-256인지 검사한다.
- CA는 container에 exact read-only bind mount하며 `PGSSLROOTCERT`는 고정 container path만 가리킨다.
- 인증서 만료·hash drift·mount drift는 `notification_local_db_remote_tls_ca_refused`로 remote connection 전에 거부한다.

## 6. 고정 client image 계약

remote collector는 다음 image reference만 허용한다.

```text
public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13
```

- 실행 전 `docker image inspect`로 exact digest가 로컬에 있는지 확인한다.
- tag-only 또는 digest가 다른 image는 거부한다.
- runner가 임의 latest image를 pull하지 않는다.
- image가 없으면 `notification_local_db_remote_client_image_refused`로 종료하고 별도 dependency 작업으로 분리한다.
- remote connection 전 `--network none`의 hardening된 exact-label container에서 `psql --version`과 `pg_dump --version`을 각각 실행해 두 client major가 모두 17인지 확인한다.
- metadata-before가 반환한 실제 server major를 확인한 뒤 17이 아니면 `notification_local_db_remote_client_version_refused`로 거부한다. 이때 schema dump와 local orchestration call은 0이다.

## 7. Credential·환경 경계

top-level runner는 기존과 같이 호출자가 제공한 `SUPABASE_DB_PASSWORD`를 runner process memory에서만 읽는다. 값은 non-empty, UTF-8 4096 bytes 이하이며 NUL·CR·LF를 포함하지 않아야 한다. 이후 remote Docker client child environment에는 비밀이 아닌 다음 allowlist만 만든다.

```text
PGHOST=aws-1-ap-northeast-2.pooler.supabase.com
PGPORT=5432
PGUSER=postgres.slnjqlzzhewblvttiidk
PGDATABASE=postgres
PGSSLMODE=verify-full
PGSSLROOTCERT=/qa/prod-ca-2021.crt
PGCONNECT_TIMEOUT=30
```

Docker argv에는 `--env PGHOST`, `--env PGPORT`, `--env PGUSER`, `--env PGDATABASE`, `--env PGSSLMODE`, `--env PGSSLROOTCERT`, `--env PGCONNECT_TIMEOUT`처럼 key 이름만 포함한다. `PGPASSWORD` key, `--env=PGPASSWORD=<value>` 형식, password 값, DB URL은 금지한다.

각 remote invocation object에는 secret 값 대신 frozen marker `stdinMode=database-password-prompt`만 둔다. trusted process executor는 invocation과 별도로 받은 `secretInputProvider`를 child spawn 뒤 정확히 한 번 호출한다. provider는 이미 검증한 password를 반환하고, executor는 다음 계약만 수행한다.

1. `docker run --interactive`를 TTY 없이 spawn한다.
2. password와 LF 하나를 임시 `Buffer`로 만들고, error handler를 먼저 붙인 뒤 `child.stdin.end(buffer, callback)`으로 정확히 한 번 전달하면서 stdin을 닫는다.
3. end callback 또는 stream error가 확정될 때까지 기다린다. 전송 중인 Buffer를 먼저 지우지 않는다.
4. 성공·오류 모두 `finally`에서 임시 buffer를 `fill(0)`으로 지운다.
5. provider·password·stdin bytes를 result, error, invocation, evidence, log에 반환하지 않는다.

`executeBoundedProcess`의 다른 step은 계속 stdin=`ignore`다. `database-password-prompt` marker가 있으면서 trusted provider가 없거나, provider가 두 번 호출되거나, `--interactive`·`--password` 계약이 어긋나면 실행 전에 거부한다. 이 분리는 fake executor가 secret 전달을 검증할 수 있게 하면서 실제 secret을 serializable invocation에 넣지 않는다.

remote child environment에는 다음을 전달하지 않는다.

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD` 원래 key
- Google Chat webhook·ciphertext
- SOLAPI, Web Push, FCM credential
- provider·worker·cron enable flag

local child environment에는 기존과 같이 remote `PG*`, Supabase credential, provider credential을 전혀 전달하지 않는다.

Docker daemon의 container config에는 비밀이 아닌 고정 route·TLS environment만 남을 수 있다. DB password는 stdin pipe로만 흐르므로 `docker inspect` 대상 config에 들어가지 않는다. container는 `--rm`과 exact-label cleanup으로 즉시 제거한다.

## 8. Remote metadata query

metadata-before와 metadata-after는 각각 별도 일회성 container에서 다음 `psql` 계약으로 실행한다.

```text
psql
  --no-psqlrc
  --password
  --quiet
  --tuples-only
  --no-align
  --set ON_ERROR_STOP=1
  --file /qa/notification-remote-metadata.sql
```

query file만 exact read-only bind mount로 제공한다. Docker root filesystem도 read-only로 둔다.

metadata SQL은 다음 조건을 모두 만족한다.

- 첫 statement는 `begin read only;`
- `statement_timeout=30s`, `lock_timeout=5s`
- 현재 migration version/name, server version, extension, 필수 role·schema·catalog 존재 여부만 조회
- 마지막 statement는 `rollback;`
- psql unaligned output이 기존 parser 계약을 유지하도록 정확히 한 줄의 JSON array text를 반환
- outer SQL은 기존 metadata object를 `jsonb_build_array(jsonb_build_object('notification_local_qa_remote_metadata', <metadata object>))::text`로 감싼다.
- 따라서 stdout을 trim한 값은 정확히 `[{"notification_local_qa_remote_metadata":{...}}]` shape이며 object-only `{...}`나 column alias만으로 대체하지 않는다.
- 기존 `parseRemoteMetadataOutput`은 변경하지 않고 JSON array 안의 object 하나와 key 하나를 계속 강제한다.

stdout은 기존 byte limit와 exact shape 검사를 통과해야 한다. stderr 원문은 성공 evidence에 포함하지 않고 실패 시 기존 safe error code로 치환한다.

## 9. Remote schema-only dump

schema dump는 별도 일회성 container에서 다음 `pg_dump` 계약으로 실행한다.

```text
pg_dump
  --password
  --schema-only
  --schema public
  --schema dashboard_private
  --file /qa/notification-remote-schema.sql
```

- trusted runtime manifest는 환경변수나 CLI override가 아닌 `process.getuid()`·`process.getgid()`의 numeric caller UID/GID를 기록한다. 값을 얻을 수 없거나 non-integer이면 실행 전에 거부한다.
- host에서 caller가 미리 만든 mode `0600`, exact UID/GID의 regular non-symlink output file 하나만 read-write bind mount한다.
- container는 exact `--user <uid>:<gid>`로 실행한다. dump 뒤에도 같은 inode·UID·GID·mode인지 검사한다.
- data-only, `--table`, `--exclude-table-data`, `--inserts`, `--column-inserts`, `--load-via-partition-root`, arbitrary extra option을 허용하지 않는다.
- dump 뒤 inode·mode·size·SHA-256을 다시 검사한다.
- `-- Data for Name:`, `COPY ... FROM stdin`, DB URL, Supabase token, Google Chat webhook pattern이 있으면 즉시 거부하고 artifact를 삭제한다.
- `pg_dump`는 SQL transaction의 `begin read only`로 감쌀 수 있다고 주장하지 않는다. 안전성은 exact `--schema-only` allowlist와 결과 scan으로 보장한다.

## 10. Collector container 보안·소유권

각 invocation은 다음 공통 Docker 옵션을 사용한다.

```text
--rm
--name <exact collector project id>-<step>
--label com.supabase.cli.project=<exact collector project id>
--read-only
--user <trusted caller uid>:<trusted caller gid>
--cap-drop ALL
--security-opt no-new-privileges
--tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m
--network bridge
```

- collector project id는 기존 `tips_notify_collector_qa_<12 hex>` pattern을 유지한다.
- container name과 label은 current runtime manifest에서만 계산한다.
- 실행 전 같은 collector pattern의 기존 label container가 하나라도 있으면 자동 삭제하지 않고 중단한다.
- metadata invocation은 `--entrypoint psql`, schema invocation은 `--entrypoint pg_dump`만 허용한다. image의 기본 entrypoint와 다른 executable은 사용하지 않는다.
- remote invocation에는 `--interactive`를 사용하고 `--tty`는 금지한다. version probe는 stdin을 열지 않는다.
- CA와 metadata SQL mount는 read-only, schema output mount 하나만 read-write다. mount source·destination·mode와 UID/GID는 frozen runtime manifest에서만 계산한다.
- shell, package install, arbitrary executable, provider endpoint 호출을 허용하지 않는다.
- query와 dump는 순차 실행한다. 병렬 연결을 만들지 않는다.

## 11. 데이터 흐름

```text
Keychain 또는 승인된 caller
  └─ SUPABASE_DB_PASSWORD (runner process only)
       └─ trusted one-shot stdin prompt (Docker env/config 제외)
            ├─ metadata-before: psql + begin read only
            ├─ server major 17 확인
            ├─ schema-only: pg_dump public,dashboard_private
            └─ metadata-after: psql + begin read only
                 └─ snapshot·migration drift·artifact 검증
                      └─ 성공한 경우에만 기존 local DB 17단계 시작
```

운영에서 로컬로 이동하는 것은 schema definition과 migration/catalog metadata뿐이다. table row와 provider secret은 이 흐름에 들어오지 않는다.

## 12. 오류 처리·cleanup

- route·image·credential preflight 실패: collector와 local DB를 시작하지 않는다.
- CA 또는 client version preflight 실패: remote connection과 local DB를 시작하지 않는다.
- metadata query 실패: `notification_local_db_remote_metadata_query_failed`
- remote server/client major 불일치: `notification_local_db_remote_client_version_refused`
- schema dump 실패: `notification_local_db_remote_schema_dump_failed`
- metadata shape 실패: `notification_local_db_remote_metadata_invalid`
- schema artifact 실패: `notification_local_db_remote_schema_dump_refused`
- metadata 전후 불일치: `notification_local_db_remote_snapshot_changed`
- collector container 또는 temp artifact cleanup 실패: `cleanupCode=notification_local_db_cleanup_failed`

collector 내부와 outer wrapper는 colon으로 이어 붙인 오류 문자열을 사용하지 않는다. 모든 오류는 `NotificationLocalDbQaError`의 frozen evidence `{ primaryCode, cleanupCode }`로 전달한다. source failure가 있으면 safe `primaryCode`를 그대로 보존하고, artifact cleanup·container cleanup 중 하나라도 실패하면 최종 `cleanupCode`는 `notification_local_db_cleanup_failed`다. outer wrapper는 `error.evidence`를 먼저 읽고 message fallback은 exact safe code일 때만 사용한다.

모든 실패는 local DB start 전에 종료한다. cleanup은 current random collector label의 exact container ID만 제거하며 prefix-wide `docker rm`, image prune, volume prune, network prune를 사용하지 않는다. raw stderr와 secret은 보고하지 않는다.

## 13. 테스트 전략

구현은 TDD로 진행한다.

### 13.1 Route·image validation

- 승인 descriptor와 exact image tag+digest만 통과
- 다른 `aws-0`/`aws-2` lane, direct host, `:6543`, 다른 user/ref/DB, non-`verify-full` SSL 거부
- environment route override와 raw URL 거부
- CA path·file type·hash·expiry drift 거부
- image inspect missing·tag drift·digest drift와 `psql`·`pg_dump` major drift 거부
- metadata-before server major가 17이 아니면 dump call 0, local orchestration call 0

### 13.2 Invocation·secret boundary

- metadata → dump → metadata 순서 고정
- command는 Docker CLI, inner executable은 `psql` 또는 `pg_dump`만 허용
- full ordered Docker args를 deep-equal로 고정한다. assertion에는 `--interactive`, `--entrypoint`, exact labels, `--user`, mounts, tmpfs, network, env key 순서, image tag+digest와 inner args가 모두 포함된다.
- Docker argv·child env·container config model·evidence에 password, `PGPASSWORD`, DB URL, access token, webhook이 없음
- fake trusted transport에서 sentinel password가 child stdin bytes에만 한 번 나타나고 provider 1회·stdin close·end callback 이후 buffer zero가 확인됨
- delayed stdin transport에서도 callback 전 buffer가 유지되고 callback·error 후에는 성공·실패 모두 zeroize됨
- remote child에만 exact non-secret `PG*` environment가 있고 local child에는 없음
- metadata query와 CA는 read-only exact mount, dump output file은 exact single-file mount
- output file의 pre/post inode·UID·GID·mode와 exact `--user <uid>:<gid>` 일치
- 모든 invocation object·args·env는 freeze

### 13.3 Read-only·schema-only contract

- metadata SQL의 첫 statement `begin read only`, 마지막 `rollback`
- psql stdout exact one-row JSON array만 허용하고 object-only output은 거부
- SQL outer envelope가 `[{"notification_local_qa_remote_metadata":{...}}]`를 만드는지 exact fixture로 검증하며 기존 parser는 그대로 유지
- `pg_dump --schema-only`와 두 schema exact allowlist 확인
- data marker, COPY, URL, token, webhook 포함 dump 거부
- metadata 전후 snapshot과 migration catalog drift 검사 유지

### 13.4 Failure·cleanup

- route, image inspect, metadata-before, dump, metadata-after 각 실패에서 local orchestration call 0
- partial collector container가 남으면 cleanup 1회
- inner artifact failure와 outer container cleanup failure 조합별 structured `{ primaryCode, cleanupCode }` 보존
- colon-composite error message가 outer prepare wrapper를 통과하지 못하도록 회귀 검증
- SIGINT·SIGTERM이 same cleanup controller 사용
- pre-existing matching collector가 있으면 삭제하지 않고 중단

### 13.5 Regression

- `tests/notification-isolated-db-qa.test.mjs` 전체
- `tests/notification-content-local-qa-fixture.test.mjs` 전체
- `tests/notification-content-no-send-qa.test.mjs` 전체
- 기존 local 17단계, fixture counts, pgTAP 10/10, provider worker 0, queue delta 0, dispatch flags pre/post 0 assertion 유지
- lint와 `git diff --check`

## 14. 완료 기준과 후속 gate

Task 5A 구현 완료는 다음만 의미한다.

- fake executor 기반 테스트에서 IPv4 session-pooler collector 계약 통과
- 기존 전체 관련 회귀 통과
- secret non-leak와 exact cleanup 검증
- 코드 diff 검토와 단일 구현 commit

Task 5A 통과만으로 실제 DB QA 완료, 운영 migration, push, deploy, rule activation, provider send를 주장하지 않는다.

실제 Task 5 재실행에는 Supabase가 인정하는 올바른 **Database password**가 별도로 필요하다. 현재 Keychain 값은 exact session-pooler host의 실제 `psql` 인증에서 거부됐으므로, credential gate가 해소되기 전에는 production metadata나 schema를 다시 수집하지 않는다.

올바른 credential이 준비된 뒤에만 다음 순서로 실제 QA를 재개한다.

1. Docker·CLI image·collector resource-zero preflight
2. remote metadata-before → schema-only dump → metadata-after
3. local DB 17단계 orchestration
4. synthetic fixture·read-only evidence·round-trip·pgTAP 10개
5. exact cleanup과 독립 resource-zero 확인
