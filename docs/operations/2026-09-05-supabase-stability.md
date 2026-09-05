# 2026-09-05 Supabase 안정성 진단과 수정안

조사 대상: `tips dashboard` (`slnjqlzzhewblvttiidk`), Seoul, PostgreSQL 17.6.1.084. 시각은 별도 표기가 없으면 한국 표준시(KST)다. 조사 시점 운영 배포는 `c5be39a0727137ec2d2b91714bae857012c71d2e`이며 GitHub Production deployment 성공 시각은 9월 2일 11:24경이다.

**9월 5일 사용자 결정:** 무료 요금제와 Nano 컴퓨트를 유지한다. 아래 유료 확장 제안은 보류한다. 승인된 운영 반영 범위는 두 조회 함수 최적화, 진단 도구, CI 회귀 검사이며 적용 후 같은 권한·필터에서 성능과 오류를 확인한다.

## 판단

확인된 직접 문제는 업무 목록과 통계의 반복적인 SQL 시간 초과다. 두 경로 모두 여러 업무 유형을 한 SQL 함수에서 처리하는 실행 계획에 비용이 들었다. 무료 Nano의 작은 메모리와 재시작 전 스왑 사용도 확인되어, 조회 부하와 자원 여유 부족이 함께 영향을 주었을 가능성이 높다.

다만 당시 Disk I/O budget·IOPS 보고서가 로드되지 않아 버스트 소진 수치와 정확한 발생 시점을 확보하지 못했다. OOM 종료 로그도 확인하지 못했다. 따라서 “I/O budget 소진이 Unhealthy의 유일한 원인” 또는 “OOM이 발생했다”고 확정하지 않는다. 재시작은 가용성을 회복시켰으며 느린 조회 구조를 수정한 것은 아니다.

## 직접 확인한 증거

| 관찰 | 결과 | 의미 |
| --- | --- | --- |
| 9월 4일 17:30~20:00 Postgres error 로그 | 전체 64행: timeout 57, permission denied 6, invalid filters 1 | 기본 도구의 최근 100행이 아닌 브라우저에서 전체 구간 64/64행을 확인 |
| 18:13:25.289 및 19:37:28.846 | `57014`, `get_ops_task_list_stats_v1` → `ops_task_list_stats_legacy_v1` → `ops_task_page_source_v1` 시작 단계 | 동일 통계 경로에서 반복 지연 |
| 18:13:24.867 | `57014`, `list_ops_task_numbered_page_v1` → `ops_task_numbered_keys_v1` 시작 단계 | 실제 목록 읽기도 영향 |
| 19:12:25~26 | 관리 목록/필터/통계 RPC의 `42501` 6건 | 권한 거절은 별도 조사 대상. 이를 해결하려고 anon 실행 권한을 열지 않음 |
| 19:37:07 | `ops_task_filters_invalid`, `22023` | 잘못된 입력과 시간 초과를 구분 |
| 9월 5일 재시작 전 | Postgres timeout과 Auth token API `502`/`504` 관찰 | 로그인 지연도 함께 발생 |
| 9월 5일 15:18:28 | `pg_postmaster_start_time()` | 사용자가 시행한 재시작 시각 |
| 재시작 전후의 종료/시작 로그 | `57P01`/`57P03` | 재시작에 수반되는 로그를 최초 장애 원인으로 세지 않음 |
| 9월 5일 재확인 | `ACTIVE_HEALTHY`, 차단 세션·idle-in-transaction 없음 | 조사 시점에 지속되는 잠금 폭주는 관찰되지 않음 |
| 현재 컴퓨트 | Free / Nano, 메모리 최대 0.5 GB | 앱, Auth와 DB 운영 작업이 같은 작은 인스턴스 자원을 사용 |
| 24시간 메모리 그래프 | 재시작 전 수백 MB의 스왑, 대략 550~650 MB 영역 관찰 | 메모리 압박 징후. 그래프의 memory commitment는 실제 물리 메모리 사용량으로 해석하지 않음 |
| DB 크기·연결 | 141,946,003 bytes(약 135 MiB), 연결은 관찰 시점 9~13개/최대 60 | 데이터 저장 공간이나 최대 연결 수 초과를 뒷받침하지 않음 |
| 15:25:41~15:28:05 누적 rollback 비교 | 119,481,378 → 119,481,378 | 약 144초 동안 신규 rollback 증가 0. 큰 과거 누적값을 현재 폭주로 오인하면 안 됨 |
| 현재 cron | 과학 상담 보존·rate-limit 정리 2개, 최근 정상 완료 | 이전 알림 cron 폭주가 현재 계속된다는 증거 없음 |

확인한 로그 행 ID: 통계 `dc941cc9-bc98-4a40-8af9-b76a2d2b9899`, `e0a9ec8d-dbc6-4430-83e3-31d7d9b9757c`; 목록 `c9f2c6d7-b4f2-4a8a-bd37-b9a1cc51e552`. 통계 query ID: `-1977991744889982606`.

`pg_stat_statements`의 reset 시각은 8월 13일이다. level-test 저장 RPC 약 439만 회, rollback 약 1.19억 회, 임시 파일 약 109 GB 등은 최근 24시간 수치가 아니다. 관찰 구간에 예전 대량 저장 RPC의 호출 수는 증가하지 않았다. 이후 진단용 `ROLLBACK`도 DB 누적 rollback에 포함되므로 증가량은 SQLSTATE·호출 경로와 대조해야 한다.

Supabase의 9월 4일 공개 lifecycle incident는 17:18 KST에 종료됐고 기존 실행 프로젝트의 Data API/직접 Postgres 연결은 영향 대상이 아니라고 공지됐다. 이 공지로 18~19시 업무 쿼리 timeout을 설명할 수는 없다. [Supabase 상태 이력](https://status.supabase.com/)

## 성능 측정과 코드 변경

운영 DB에서는 `READ ONLY`, authenticated 역할과 실제 관리자 RLS, statement timeout 5초, lock timeout 500ms를 사용했다. 데이터·정책·함수는 수정하지 않았다.

| 운영 현재 코드 측정 | 실행 시간 | 공유 버퍼 접근 |
| --- | ---: | ---: |
| 일반 업무 통계 RPC | 829.413 ms | 5,445 |
| 일반 업무 첫 페이지 RPC, 10건 요청 | 525.138 ms | 5,063 |
| 일반 업무 원천 함수의 count | 184.204 ms | 4,137 |

전체 일반 업무는 6건이고 선택한 inbox 결과는 1건이었다. 단일 표본이며 네트워크 시간은 제외한다. 함수 본문에 동일 필터를 상수로 넣은 조사용 count는 실행 4.698ms, 계획 16.288ms로 측정됐다. 이 직접 SQL 실험과 운영 RPC 응답 시간을 같은 종류의 수치로 비교하지 않는다.

일반 업무 통계는 총계 1회, 형제 queue 3회, metric 5회, facet 4회로 원천 함수를 13회 호출한다. 숫자를 집계할 때도 화면용 JSON을 만드는 구조가 남아 있다. 이번 수정은 먼저 공통 실행 계획 비용을 줄인다. 이 반복 호출 전체를 한 번의 집계로 바꾼 수정은 아니다.

`20260905064919_ops_task_parameter_sensitive_plans.sql`은 다음 두 함수만 변경한다.

- `dashboard_private.ops_task_page_source_v1(text,jsonb)`
- `dashboard_private.ops_task_numbered_keys_v1(text,jsonb)`

SQL 함수의 기존 본문을 최종 migration chain에서 읽어 그대로 유지하고, PL/pgSQL 안에서 실제 인수에 맞게 계획하도록 함수 범위에 `plan_cache_mode=force_custom_plan`을 지정한다. SQL 함수는 `SET` 절 때문에 인라인되지 않던 경로다. PostgreSQL 문서도 매개변수에 따라 최적 계획이 달라지면 개별 계획 생성의 이점이 있을 수 있음을 설명한다. [PostgreSQL 계획 캐시 문서](https://www.postgresql.org/docs/17/plpgsql-implementation.html)

RLS, security invoker, 빈 search_path, 서울 시간대, authenticated 전용 실행 ACL, 반환 필드, 필터와 정렬은 보존한다. 본문·권한의 예상 형태가 다르면 SQLSTATE `55000`으로 적용을 중단한다. 과거 버전의 함수로 덮어쓰지 않는다. 인덱스나 RLS 정책, 업무 상태, 알림 설정에는 변경이 없다.

로컬 합성 데이터 6건, 동일 authenticated RLS, warm 조건에서 원천 함수의 공유 버퍼 접근은 **366 → 118(약 68% 감소)**였다. 실행 시간은 이전 진단 표본 3.928ms, 수정 후 2.132ms였지만 경과시간은 하드웨어·캐시의 영향을 받으므로 회귀 기준은 버퍼 작업량으로 두었다. 수정된 번호형 key 함수는 59회, 1.367ms였다. 이 로컬 결과는 운영 RPC가 68% 빨라졌다는 뜻이 아니다.

## 재발 방지와 유지보수

1. 검증된 두 함수 변경을 먼저 운영 DB에 적용하고 같은 권한·필터의 전후 계획을 다시 수집한다. 적용은 정상 운영 시간과 구분해 수행하고 이후 30분 및 다음 업무 피크의 timeout/Auth 5xx·메모리·스왑 I/O를 확인한다.
2. 운영 용도로 **Pro + Small(2 GB)**을 권장한다. 한 프로젝트, 기본 사용량 기준 월 약 **$30**($25 플랜 + 약 $15 compute − $10 credit, 세금·추가 사용량 별도)이다. 최소 대안인 Micro(1 GB)는 월 약 $25다. Small은 Nano보다 물리 메모리와 기본 I/O 여유가 크다. Pro로 바꾸어도 기존 Nano 컴퓨트는 자동 상향되지 않으므로 프로젝트 compute 크기를 별도로 확인한다. [Compute 사양](https://supabase.com/docs/guides/platform/compute-and-disk), [요금·크레딧](https://supabase.com/pricing)
3. 보강된 read-only collector로 전후 샘플을 남긴다. commit/rollback·임시 파일·deadlock의 증가량과 초당 변화율, 실제 차단 세션, 오래 열린 트랜잭션, 쿼리의 임시 블록을 확인한다. 재시작·누락·counter 감소를 0으로 해석하지 않는다.
4. SQL review CI에서 목록·통계·역할별 접근 회귀와 두 함수의 작업량 예산을 계속 실행한다. 느린 화면은 일반/등록/퇴원/전반/단어 재시험의 실제 필터로 측정하며, 변경은 성능 표본과 권한 검증을 함께 남긴다.
5. 다음 최적화는 통계 전용의 작은 projection과 집계 통합이다. 무조건 전체 인덱스 추가, advisor 일괄 수정, timeout 연장, work_mem·최대 연결 수 증가를 먼저 하지 않는다. 실제 느린 경로를 기준으로 하나씩 검증한다.
6. Pro의 일일 백업(7일 보존)을 확인하고 복원 절차를 정기적으로 검증한다. 백업은 가용성 병목 해결과 별도 운영 항목이다. [Pro 백업 포함 사항](https://supabase.com/pricing)

수집·비교 도구는 직접 실행하는 도구다. 새 정기 자동화나 알림 발송은 생성하지 않았다. 장애 알림을 추가할 때에는 단순 누적값 대신 일정 구간의 반복 `57014`, Auth/REST 5xx, 지속되는 스왑 I/O, 실제 blocking을 기준으로 설정한다.

## 검증 및 적용 상태

- 작업 브랜치: `codex/supabase-stability-stats`, 운영 main SHA에서 분리.
- 기존 코드에서 6건 원천 조회의 버퍼 예산 검사 실패(366 > 200)를 확인한 뒤 수정했다.
- 로컬 기준 스키마 parity/smoke 1,937개 통과.
- 목록·통계·권한·성능 pgTAP 606개 통과. 전체 로컬 SQL lint 통과.
- 진단 비교·SQLSTATE·migration layout·트랜잭션 preflight Node 검사 61개 통과. 기존 등록 업무의 postdeploy 읽기 계약도 격리 DB에서 통과.
- CI 실행 목록에 새 검사와 기존 목록/통계 회귀를 추가했고, 검증 workflow의 고정 해시를 정확한 새 바이트에 맞췄다. 보호된 배포 절차와 자격증명 범위에는 변경이 없다.
- 변경한 진단 SQL 3개를 운영에서 read-only로 실행해 결과 형식과 접근 가능 여부 확인.
- 기존 스키마·데이터·회원 역할·예약·알림·고객 발송에 대한 운영 변경 없음.
- 운영 마이그레이션, GitHub push/CI, Vercel 배포, 유료 컴퓨트 변경은 아직 수행하지 않았다. 적용 후 실측해야 운영 개선 완료로 판단할 수 있다.

관련 재현 검사: `supabase/tests/ops_task_source_plan_budget_test.sql`, `supabase/tests/ops_task_page_reads_test.sql`, `supabase/tests/ops_task_numbered_pages_test.sql`. 재사용할 수집·비교 절차는 `docs/runbooks/supabase-resource-pressure.md`에 반영했다.
