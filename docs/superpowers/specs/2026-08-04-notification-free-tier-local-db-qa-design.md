# 알림 콘텐츠 무료 티어 로컬 DB QA 설계

**작성일:** 2026-08-04
**상태:** 사용자 서면 승인 · 기술 교차 검토 보완 완료
**대상:** 대시보드·Google Chat 자기완결형 알림 콘텐츠의 DB 저장 왕복 및 pgTAP QA

## 1. 목표

Supabase Pro 기능이나 Preview Branch를 사용하지 않고 다음 항목을 실제 PostgreSQL에서 검증한다.

1. 현재 운영 스키마와 로컬 마이그레이션 이력의 정합성
2. 알림 템플릿 저장과 다시 읽기의 실제 왕복
3. 알림 콘텐츠·adapter·단일 writer·runtime·최종 문구 기준본을 다루는 pgTAP 10개 파일
4. Google Chat을 포함한 외부 공급자로 나가는 네트워크 egress 차단
5. 성공·실패와 관계없는 로컬 DB와 임시 파일 정리

운영 Supabase에는 읽기 전용 접근만 허용한다. 모든 스키마 변경, fixture 저장, pgTAP 실행은 일회성 로컬 Docker DB에서만 수행한다.

## 2. 확정된 운영 조건

- Supabase 조직은 Free 요금제를 유지한다.
- Preview Branch 생성·조회·삭제와 Pro 업그레이드 경로를 사용하지 않는다.
- 운영 DB의 스키마와 마이그레이션 이력은 읽을 수 있다.
- 운영 DB에 `db push`, `migration repair`, `db reset`, DDL, DML을 실행하지 않는다.
- 운영 행 데이터, 사용자 정보, 학생 정보, 알림 이력, 웹훅 URL, 암호문을 로컬로 복사하지 않는다.
- Docker는 일회성 로컬 PostgreSQL 실행에 사용할 수 있다.
- 운영 schema dump에 필요한 DB password는 실행 시 `SUPABASE_DB_PASSWORD` 환경변수로만 받고 argv·파일·evidence에 기록하지 않는다.
- 실제 Google Chat, Web Push, FCM, SOLAPI 요청을 보내지 않는다.
- 운영 migration, Git push, Vercel Production 배포, 공급자 실발송은 각각 별도 승인 경계로 남긴다.

## 3. 검토한 접근법

### 3.1 채택: 운영 schema-only 기준본 + 일회성 로컬 Docker DB

운영 DB에서 `public`과 `dashboard_private`의 schema-only 기준본과 적용된 migration version만 읽는다. 새 로컬 Supabase DB가 제공하는 `auth` 기반 객체 위에 운영 application schema를 복원하고, 운영에 아직 적용되지 않은 로컬 migration만 로컬 DB에 적용한다. 운영 row 대신 검토 가능한 합성 설정 fixture pack을 설치한 뒤 실제 저장 왕복과 pgTAP을 이 DB에서 수행한다.

이 방식은 운영 데이터 없이도 현재 운영 schema와 pending migration의 결합을 검증하고, 모든 쓰기를 로컬로 제한한다.

### 3.2 기각: 저장소 migration을 빈 DB에 처음부터 재생

저장소의 migration은 기존 운영 기반 schema 전체를 처음부터 만드는 완전한 baseline이 아니다. 예를 들어 일부 핵심 업무 table은 초기 migration 이전부터 존재한다. 빈 DB에 migration만 재생하면 운영과 다른 환경이 되어 QA 기준본으로 사용할 수 없다.

### 3.3 기각: 정적 SQL·Node 테스트만 실행

비용과 실행 부담은 가장 작지만 실제 PostgreSQL 저장 왕복, RLS·trigger·function 동작, pgTAP 결과를 증명하지 못한다. 보조 lane으로는 유지할 수 있지만 DB QA 완료 증거로 사용하지 않는다.

## 4. 아키텍처

QA runner는 서로 권한이 다른 다섯 단계를 분리한다.

### 4.1 Remote read-only collector

- 대상 project ref는 현재 운영 project 하나로 고정한다.
- DB password 존재와 remote 연결 가능 여부를 Docker 시작 전에 확인한다.
- application schema dump는 exact allowlist의 schema-only operation으로 제한한다. `pg_dump` 자체를 SQL의 `begin read only`로 감쌀 수 있다고 주장하지 않는다.
- remote metadata SQL은 `begin read only`로 시작하고 migration version, server version, extension, 필수 role·schema·catalog 존재 여부만 읽는다.
- data-only dump, `COPY` row export, table content 조회는 allowlist에 포함하지 않는다.
- dump와 query 결과는 mode `0600` 임시 파일에만 저장하고 Git 경로에 쓰지 않는다.
- 출력 evidence에는 DB URL, password, access token, provider secret을 포함하지 않는다.

### 4.2 Local database builder

- 임시 Supabase workdir마다 `tips_notification_db_qa_<random suffix>` 형식의 고유 project id와 사용 가능한 loopback port를 사용한다.
- 시작 전에 같은 exact project label의 container·volume·network가 0개인지 확인하고, 하나라도 있으면 소유권을 추측하지 않고 중단한다.
- QA용 Docker `--internal` network를 만들고 DB와 pgTAP runner만 연결해 인터넷 egress를 구조적으로 차단한다.
- remote server version과 필요한 extension을 확인하고 호환되는 로컬 PostgreSQL major를 선택한다. 다른 major를 쓰면 운영 parity가 아니라 전방 호환성 QA라고 evidence에 명시한다.
- 전체 Supabase stack 대신 DB 전용 로컬 runtime만 시작한다.
- 깨끗한 로컬 Supabase base 위에 remote schema-only 기준본을 복원한다.
- restore 전에 `public` 기본 권한을 안전한 기준으로 정리하고, restore 후 owner·grant·RLS와 `pgcrypto`, `pgtap` 사용 가능 여부를 검증한다.
- remote migration version/name과 로컬 migration 파일의 version/name을 비교한다. 중복, 중간 누락, remote-only 이력, remote 최대 version보다 오래된 local-only 파일이 하나라도 있으면 drift로 중단한다. 계산된 local pending 파일은 exact path와 SHA-256 manifest로 고정한다.
- 검증된 remote version만 `migration repair --local --status applied`로 로컬 history에 기록한다. repository migration은 DB 시작·schema restore 뒤 임시 workdir에 복사해 시작 과정의 자동 적용을 막는다.
- 계산된 exact pending 파일만 임시 workdir에 복사해 runtime activation scan한 다음 `db push --local --dry-run`과 actual push를 실행한다. 포괄적인 미확인 migration 적용을 허용하지 않는다.
- mutation command는 loopback DB URL만 허용한다. remote host나 production ref가 보이면 실행 전에 거부한다.

### 4.3 Synthetic configuration fixture builder

- schema-only 복원 뒤 운영 설정 row를 복사하지 않는다.
- version-controlled fixture pack이 고정 UUID와 `runtime.invalid` 가상 값으로 필요한 workflow registry, event, rule, template, content contract, legacy 설정만 만든다.
- fixture identity와 row 수, SQL hash를 manifest로 고정하고 예상 밖 row가 생기면 중단한다.
- 실제 학생·수업·delivery·inbox·webhook·connection secret row는 만들지 않는다.
- 합성 auth user와 profile은 필요한 최소 수만 허용하고 fixture manifest에 명시한다.
- 운영에 이미 적용된 seed migration의 data 효과와 migration history 기록을 분리해, schema-only 복원에서도 round-trip 기준본이 재현되게 한다.

### 4.4 Local evidence runner

- fixture 설치 전에는 업무 row, 사용자 row, 알림 전달 row, inbox row, 연결 secret row가 모두 0인지 확인한다. 설치 후에는 합성 user/profile과 설정 row가 manifest와 정확히 일치하는지 확인한다.
- dispatch/provider runtime flag는 전 구간 false여야 한다. settings UI flag만 disposable round-trip transaction 안에서 임시 true를 허용하며 rollback 뒤 전체 flag가 다시 false인지 확인한다.
- `notification-content-db-evidence.mjs`의 read-only mode와 disposable round-trip mode를 차례로 실행한다.
- 승인된 pgTAP 파일 10개를 정확한 allowlist로 실행한다.
- Node child process에는 Supabase access token과 Google Chat 관련 환경변수를 전달하지 않는다.
- DB 전용 runtime만 사용하고 cron, worker, provider sender를 시작하지 않는다.
- 사전·사후에 cron, `pg_net`, HTTP extension, FDW/dblink, provider queue를 확인하고 worker 0·queue delta 0을 증명한다.

### 4.5 Cleanup controller

- start 호출 전에 `localStartAttempted`를 기록해 부분 시작 실패도 정리한다.
- 성공·실패와 관계없이 `finally`에서 exact local project id만 `stop --no-backup`한다.
- exact 임시 디렉터리만 삭제한다.
- 다른 Supabase project, Docker volume, container, network를 포괄적으로 정리하지 않는다.
- SIGINT·SIGTERM에서도 같은 exact cleanup을 시도하고 stale-run manifest를 남겨 다음 실행이 소유권을 추측하지 않게 한다.
- 정리 후 해당 project label의 container·volume·network가 0개인지 다시 확인한다.
- 정리 실패 시 QA를 실패로 처리하고 다음 release task를 시작하지 않는다.
- 원래 실패와 cleanup 실패가 함께 발생하면 primary code와 cleanup code를 모두 보존하되 raw stderr와 secret은 버린다.

## 5. 데이터 흐름

```text
운영 Supabase
  └─ schema-only + migration/catalog metadata 읽기
       └─ mode 0600 임시 파일
            └─ egress 차단 일회성 로컬 Supabase DB 복원
                 └─ migration drift 검증·exact pending 적용
                      └─ 합성 설정 fixture 설치
                           ├─ read-only evidence
                           ├─ disposable 저장 왕복
                           └─ pgTAP 10개
                                └─ container·volume·network·임시 파일 강제 정리
```

운영에서 로컬로 이동하는 것은 schema definition과 migration version/name, catalog metadata뿐이다. table row와 provider secret은 이 흐름에 들어오지 않는다.

## 6. 명령 및 승인 경계

기존 Preview Branch 실행 플래그 `--approved-preview-branch`는 제거한다. 실제 무료 티어 로컬 QA는 다음 두 플래그를 함께 요구한다.

```text
--execute --approved-local-db
```

플래그가 없으면 다음 항목만 plan JSON으로 출력하고 외부 연결이나 로컬 자원 생성을 하지 않는다.

- remote read-only 작업 종류
- 예상 임시 로컬 DB project id pattern과 동적 port
- 실행할 pgTAP 파일 수
- production mutation 0, production row copy 0, provider egress 차단 계약
- 예상 cleanup 대상

runner의 명령 allowlist는 다음 두 그룹으로 분리한다.

- remote: schema-only dump, migration history와 catalog의 read-only query
- local: internal network 생성, DB start, schema restore, local migration history 기록, exact pending migration dry-run·apply, fixture, evidence, pgTAP, exact stop·network 정리

remote 대상에는 migration apply나 임의 SQL 파일을 허용하지 않는다. local mutation에는 literal loopback DB URL 검증을 요구한다.

## 7. 오류 처리

- DB password나 remote schema read가 없으면 local DB를 시작하지 않고 종료한다.
- remote 결과에 예상하지 않은 형식이나 secret pattern이 있으면 임시 파일을 삭제하고 종료한다.
- migration version/name/hash drift가 있으면 local apply 전에 종료한다.
- local restore 실패: pending migration과 테스트를 실행하지 않고 정리한다.
- pending migration dry-run에서 worker·cron·provider 활성화가 감지되면 actual apply 전에 종료한다.
- fixture 전 preflight에서 업무 row나 연결 secret row가 발견되거나 fixture 후 manifest가 어긋나면 저장 왕복 전에 종료한다.
- read-only evidence, round-trip, pgTAP 중 하나라도 실패하면 전체 QA를 실패로 처리한다.
- 원래 QA 오류와 cleanup 오류가 함께 발생하면 둘 다 안전한 식별자만으로 보고하고 secret이 포함된 stderr는 노출하지 않는다.

## 8. 테스트 전략

### 8.1 외부 요청 없는 runner 단위 테스트

- remote write command가 allowlist에 들어가지 않는지 확인한다.
- production URL과 production ref를 local mutation 대상으로 넘기면 거부하는지 확인한다.
- schema dump 명령에 data-only 또는 row export option이 들어가지 않는지 확인한다.
- remote DB password가 argv와 evidence에 들어가지 않는지 확인한다.
- local project id suffix, 동적 port, DB URL, internal network가 exact 실행 manifest와 일치하는지 확인한다.
- migration version/name drift와 exact pending path·SHA-256 selection을 확인한다.
- 합성 fixture identity·row count·hash를 확인한다.
- approval flag가 없으면 첫 child process 전 종료하는지 확인한다.
- secret redaction과 environment scrubbing을 확인한다.
- 부분 start와 각 실패 단계에서 exact local cleanup이 한 번 실행되고 primary+cleanup code가 보존되는지 확인한다.

### 8.2 실제 무료 티어 QA

- 운영 schema와 migration history를 read-only로 수집한다.
- internal network에서 local schema restore와 exact pending migration dry-run·apply를 완료한다.
- 합성 fixture manifest를 정확히 설치한다.
- read-only evidence와 disposable round-trip을 통과한다.
- 다음 pgTAP 10개를 모두 통과한다.
  - `notification_control_plane_schema_test.sql`
  - `notification_content_contract_test.sql`
  - `notification_makeup_single_writer_test.sql`
  - `notification_control_plane_runtime_test.sql`
  - `notification_ops_task_adapters_test.sql`
  - `notification_registration_handoffs_test.sql`
  - `notification_transfer_withdrawal_adapters_test.sql`
  - `notification_makeup_adapter_test.sql`
  - `notification_approval_adapter_test.sql`
  - `notification_system_template_vnext_test.sql`
- 최종적으로 egress 차단, provider worker 0, queue delta 0, production mutation 0, QA container·volume·network 0을 확인한다.

## 9. 완료 evidence 계약

성공 evidence에는 다음 의미가 포함되어야 한다.

```json
{
  "mode": "free-tier-local-db",
  "remote": {
    "schemaReadOnlyPassed": true,
    "migrationHistoryReadOnlyPassed": true,
    "rowDataCopied": 0,
    "productionMutationCount": 0
  },
  "local": {
    "migrationDriftPassed": true,
    "exactPendingMigrationsApplied": true,
    "syntheticFixtureManifestPassed": true,
    "readOnlyPassed": true,
    "roundTripPassed": true
  },
  "pgTap": {
    "passed": true,
    "fileCount": 10,
    "failureCount": 0
  },
  "provider": {
    "egressBlocked": true,
    "providerWorkersStarted": 0,
    "providerQueueDelta": 0,
    "dispatchFlagsEnabledBefore": 0,
    "dispatchFlagsEnabledAfter": 0
  },
  "cleanup": {
    "localDatabaseStopped": true,
    "containerCount": 0,
    "volumeCount": 0,
    "networkCount": 0,
    "tempDirectoryRemoved": true
  }
}
```

evidence에는 project password, DB URL, branch ref, access token, webhook URL, 운영 학생·사용자 식별자를 기록하지 않는다. `externalRequestCount`처럼 실제 계측하지 않은 값도 기록하지 않는다.

## 10. 범위 밖

- Supabase Pro 업그레이드
- Preview Branch 사용
- 운영 DB migration 적용
- 운영 데이터 또는 웹훅 설정 복제
- 실제 Google Chat 테스트 메시지
- rule 활성화 또는 dispatch owner 변경
- Git push, Vercel 배포, 운영 브라우저 QA
- Docker를 사용하지 않는 별도 native PostgreSQL runtime 구축

## 11. 구현 전환 기준

이 문서의 사용자 서면 검토가 완료됐으며 기술 교차 검토 보완을 반영했다. 별도 구현 계획에서 Preview Branch 능력을 먼저 fail-closed로 제거하고, 합성 fixture·10개 pgTAP 계약, remote collector, egress 차단 local runner, 실제 일회성 QA를 각각 분리해 한 task씩 수행한다.
