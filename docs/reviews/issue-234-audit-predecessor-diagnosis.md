# #234 감사 선행 이력 조회의 격리 합성 진단

이 문서는 구현 승인 전 합성 진단 시점의 기록이다. 이후 승인과 로컬 migration 구현·검증은 [후속 구현 기록](issue-234-audit-predecessor-implementation.md)에서 구분한다.

이 자료는 감사 선행 이력 SELECT의 계획과 의미만 비교한다. 제품 함수·migration·인덱스·권한은 변경하지 않는다. 운영 데이터, 전체 writer, 인증/RLS, 동시성, 실제 요청의 단계별 소요 시간을 검증한 결과가 아니다.

## 입력과 후보

소스는 PR243 HEAD `e8be004bff2d682899882321a0139c1f6ed008f1`이다. 앞선 읽기 조사에서 원격 main `0891ebea6295ce16b2983bec423717880215d0e1`과 변경 파일 0개를 확인했다. 기존 migration `20260814115116_dashboard_audit_diff_format.sql`의 선행 이력 SELECT와 부분 복합 인덱스 정의를 진단 runner가 직접 추출한다. SQL 파일의 SHA256은 결과 JSON에 포함한다.

원본의 `entity_id IS NOT DISTINCT FROM audit_entity_id`만 다음 두 분기로 나눈 후보를 합성 fixture 안에서 비교한다.

- NULL 인자: `entity_id IS NULL`
- NULL 아닌 인자: `entity_id = audit_entity_id`

테이블 이름, v2 format 필터, `ORDER BY event_sequence DESC LIMIT 1`, 결과 전체 행은 유지한다. 빈 문자열을 NULL로 합치지 않는다. 감사 연속성 검사·락·기록 쓰기·권한을 제거하거나 약화하는 후보가 아니다.

## 실행과 경계

```sh
node scripts/diagnose-issue-234-audit-predecessor.mjs docs/reviews/issue-234-audit-predecessor-measurements.json
```

기존 캐시의 `postgres:17-alpine`만 사용하며 image pull은 금지한다. Docker는 network none, 포트 공개 없음, host bind 없음, CPU 2개, 메모리 768MiB, 데이터 tmpfs 512MiB로 실행하고 종료 시 제거한다. runner는 DB URL이나 운영 credential을 받지 않는다.

계획 fixture는 20,000행과 200,000행이다. 80%는 classes, 20%는 다른 entity table이며, 전체의 10%는 필터에서 제외되는 full_v1이다. full_v1 event_sequence는 NULL, v2 event_sequence는 고유한 정수다. ID 1,000개 bucket 중 하나는 NULL, 하나는 빈 문자열, 100개는 hot ID로 모은다. 모든 changed_at을 같게 둔다. 행에는 합성 256자 payload가 있다. 이 축소 행 구조는 실제 전체 감사 테이블 크기를 재현하지 않는다.

각 규모에서 non-NULL·NULL·빈 문자열·미존재 ID를 `force_custom_plan`과 `force_generic_plan`으로 비교한다. 각 쿼리를 한 번 예열하고 원본/후보 순서를 번갈아 5쌍 실행한다. 플래너의 scan 종류나 parallelism은 강제하지 않는다. 시간은 관측값이며 통과 임계값이 아니다. 후보의 entity_id index condition과 반환 행 수를 구조적으로 검사한다.

기존 `dashboard-audit-diff-format.test.mjs`, `dashboard_audit_diff_format_test.sql`, 감사 연속성 probe는 먼저 읽었다. 이들은 존재·형태·연속성 계약을 다루지만 이 조회의 대규모 실행 계획을 측정하지 않는다. 이미 검증한 기존 스위트와 CI는 재실행하지 않는다.

별도 semantics fixture는 NULL/빈 값/없음, 동일 changed_at, v1 제외, 다른 테이블, 정렬·동률 및 감사 연속성 조건을 검증한다. event_sequence 동률에는 원래 SQL이 tie-breaker를 지정하지 않으므로 동일 ID 선택을 새 계약으로 만들지 않는다. NULL event_sequence는 현재 v2 shape check에 맞지 않는 적대 경계로 구분한다. 이는 전체 감사 trigger 또는 동시성 검증을 대체하지 않는다.

## 결과

PostgreSQL **17.11** (alpine, server_version_num 170011), image `sha256:ab20e934b27ba3ff927c1b4c9ff8cf6c32f315f743efe68dd3441182a87fb085`에서 통합 실행 1회 완료했다. work_mem=4MB, shared_buffers=128MB, random_page_cost=4, seq_page_cost=1, max_parallel_workers_per_gather=2, JIT=on이다. 이 버전이 운영의 PostgreSQL 17.6과 같다고 주장하지 않는다.

- 의미 회귀 **28 PASS**: lookup 12개 + continuity 16개. 고유 선행 행/미존재의 전체 행 동등성, 기대한 체인·ordinal·predecessor 링크, 기존 오류 코드/메시지를 확인했다.
- 2개 규모 × 2개 plan mode × 4개 조회 조건 = **16조건**, 각 5쌍으로 **160 EXPLAIN ANALYZE** 완료. 후보 index condition과 top-level 반환 행 수 검사 PASS. 추가 예열 32회는 측정 횟수에서 제외했다.
- 원본의 16조건 대표 계획 모두 entity_id를 index condition으로 사용하지 않고 순차 스캔했다. 200,000행에서는 parallel-aware 순차 스캔과 Gather/Sort 계열 계획이 선택됐다.
- 후보는 기존 부분 복합 인덱스에서 entity_id 등호/IS NULL 조건을 사용했다. NULL 분기는 해당 NULL 이력 140행을 읽고 정렬하므로 한 행만 읽는다고 확대하지 않는다.
- 실행 후 task 소유 컨테이너 제거 완료. 기존 제품 소스, migration, CI, 운영 DB에는 변경/실행이 없다.

다음 표는 warm-cache execution time의 5회 중앙값이다. 계획 수립 시간은 별도 JSON에 있다.

| 행 수 | 계획 모드 | 입력 | 원본 ms | 후보 ms | shared hit blocks 원본→후보 |
|---:|---|---|---:|---:|---:|
| 20,000 | custom | 일반 ID | 1.313 | 0.021 | 1,053→4 |
| 20,000 | generic | 일반 ID | 2.043 | 0.064 | 1,053→4 |
| 200,000 | custom | 일반 ID | 17.852 | 0.039 | 10,639→4 |
| 200,000 | generic | 일반 ID | 19.572 | 0.057 | 10,639→4 |
| 200,000 | generic | NULL | 17.275 | 0.221 | 10,639→146 |
| 200,000 | generic | 빈 문자열 | 18.609 | 0.050 | 10,639→4 |
| 200,000 | generic | 미존재 ID | 19.085 | 0.095 | 10,639→3 |

200,000행 generic 일반 ID의 개별 실행 범위는 원본 17.328–44.172ms, 후보 0.024–0.067ms다. CPU 제한·parallel worker 시작·cache 상태가 시간에 영향을 줄 수 있다. 물리 read blocks는 이 warm-cache 관측에서 0이었다. 200,000행 heap은 86,237,184 bytes, 부분 인덱스는 41,648,128 bytes였다. 시간 비율을 운영 전체 요청에 적용하지 않는다.

[측정 원문](issue-234-audit-predecessor-measurements.json)에는 원본/후보 쿼리, source/fixture SHA256, 서버 설정, 실제 분포, 모든 측정 시간/버퍼 수와 조건별 대표 JSON 계획, 28개 의미 결과가 있다. [runner](../../scripts/diagnose-issue-234-audit-predecessor.mjs)와 [의미 fixture](../../scripts/fixtures/issue-234-audit-predecessor-semantics.sql)는 재현 자료다.

실행한 runner SHA256은 `69a55d7d6abe5b5f44c4430afb69bb324a9127cc70ade66b21537e842cd9f049`, fixture는 `3915432b6263f56846d28a9e55fd9071ff3a42e402799a53fec8f87d0498653a`, 결과 JSON은 `bd0cc189e03f0ea0648b26f7ce21329e74e1e8bc87c54fbd898ea12c9f1505d0`이다.

## 판정과 다음 단일 조치

**합성 분포에서 NULL 안전 비교가 해당 인덱스의 entity_id 탐색 조건으로 쓰이지 않아 넓게 읽는 문제와, 두 분기 후보의 개선은 입증했다.** 실제 운영의 선택 계획, 행 수·폭·분포, cache 상태, RLS 실행 환경, 요청별 선행 비용/대기와 연결하지 않았으므로 운영 timeout의 주원인·8초 내 전체 종강 완료는 미확정이다. 기존 reader/finalizer/확인 경계는 재검사하지 않았다.

다음 단일 조치는 **RED 범위의 최소 forward migration 구현 승인 확인**이다. 구체 범위는 기존 감사 함수의 predecessor SELECT만 NULL/비NULL 두 분기로 바꾸고 나머지 본문·함수 속성·권한·락·sequence·감사 쓰기·연속성 조건을 그대로 보존하는 것이다. 새 인덱스는 이 합성 결과에 필요하지 않았다. 승인 후에도 exact 이전 함수/메타데이터 guard와 새 입력의 필요한 회귀·독립 검토·필수 CI가 별도로 필요하다. 현재 제품 migration 작성/적용, commit/push/PR, 배포·운영 QA는 수행하지 않았다.
