# 교재 latest-count 집계 독립 코드 리뷰

**판정: 남은 P1/P2 없음. 현재 후보는 최소 SQL 성능 수정으로 적합하다.** 현재 스키마의 `counted_at date NOT NULL` 전제에서 결과 동치가 성립하고, 권한·업무 데이터·저장·알림 계약을 바꾸지 않는다. DB migration 적용이 필요한 후보이며, 운영 적용이나 장애 근본 원인 해소를 확인한 판정은 아니다.

## 검토 기준과 파일 고정

- 기준 main: `69e978b2b3c6d448d3f25a7a700cfb154aad091b`.
- 검토 대상: `supabase/migrations/20261007135140_textbook_latest_count_read_aggregation.sql`, `supabase/tests/textbook_latest_count_read_test.sql`, manifest의 마지막 migration 항목. 검토 시 미커밋 상태였다.
- migration SHA-256: `1491b4b824c343e23dc24b83e1be41214f5fda197813dca012c252a9b541cb23` — manifest와 일치.
- test SHA-256: `53202fdb89f11617b2c80407b5620f74481540597c6f129f2a5a32b5a9823184`.
- `counts-only.sql`의 벤치마크 함수와 migration의 함수 본체가 정확히 같은 문자열임을 확인했다. 제외한 flags materialization 실험의 수치를 최종 후보로 사용하지 않았다.

## SQL 결과 계약

최종 기존 함수는 `20260927103000_performance_catalog_and_workload.sql`의 stored-taxonomy 버전이다. 후보는 이를 유지하고, 교재마다 수행하던 `counted_at DESC, id DESC LIMIT 1` lateral 조회를 위치별 `GROUP BY textbook_id, MAX(counted_at)` 결과와의 left join으로 교체한다.

- `counted_at`은 `20260429110000_textbook_management.sql:178`에서 date NOT NULL이며, 독립 로컬 pg_catalog 조회에서도 이를 확인했다. 따라서 MAX가 NULL을 무시하는 성질과 기존 DESC의 NULL 우선 정렬 사이 차이가 없다. **향후 counted_at에 NULL을 허용하면 동치 전제를 재검토해야 한다.**
- 기존 lateral에서 밖으로 내보내는 값은 date뿐이다. 동일 날짜의 descending UUID tie는 투영 결과를 바꾸지 않으므로 이를 제거해도 결과가 같다.
- `p_location := lower(p_location)`과 UUID의 text 비교를 유지했다. 유효 위치의 대소문자, 다른/없는 위치, 잘못된 문자열, 공백 문자열, 빈 문자열, NULL이 기존과 같다. UUID 강제 cast나 trim을 추가하지 않았다.
- 빈 위치는 전체 재고 balances를 의미하되, latest count는 기존처럼 빈 값이다. `p_location<>''` 조건으로 이를 빠르게 제외한다. NULL location의 count를 임의로 가져오지 않는다.
- teacher/student 양쪽 copy scope의 count를 고려하는 기존 계약을 보존한다. 날짜의 ±infinity, 미래 날짜, count 없음, inactive 교재와 `days_since`/`audit_status` 계산도 유지한다.
- taxonomy·quality flags/score·stock balances·stock value·현재 수량과 함수 반환 열/형은 변경하지 않았다. 최신 count의 세부 수량/UUID를 조회하는 경로로 확대하지 않았다.

## 권한과 데이터 영향

`STABLE SECURITY INVOKER`, 고정 빈 search_path, 기존 `textbook_read_guard_v1()` 호출을 유지한다. 같은 signature에 대한 CREATE OR REPLACE이므로 기존 함수 소유권·ACL을 유지하며 GRANT/REVOKE 변경은 없다. 독립 로컬 확인은 authenticated 실행 허용, anon/PUBLIC 실행 불허였다. 부모 pgTAP도 실제 teacher·anon·identity 없음의 거절을 검사한다.

집계는 같은 public 테이블에 대한 invoker 조회이므로 RLS를 우회하지 않는다. migration은 함수 정의만 교체하며 업무 행 INSERT/UPDATE/DELETE, 테이블 rewrite, 새 인덱스, 정책/역할/비밀/알림 변경이 없다. transaction에 local lock timeout 5초와 statement timeout 10초를 둔다. 배포에는 앱 코드 변경이 아닌 해당 DB migration의 별도 적용이 필요하다.

## 독립 실행과 증거 대조

독립 실행은 부모 소유 컨테이너 `tips_query_20261007_repro`의 `network=none`, owner `20261007-root`를 확인한 뒤 한 번 수행했다. `READ ONLY`, statement timeout 3초, `ROLLBACK`이며 pg_catalog와 VALUES 합성만 사용했다. 기존 fixture 데이터/함수 DDL/컨테이너 상태는 변경하지 않았다.

- 재현: `independent-count-edge.sql`; 결과: `independent-count-edge.log`.
- **48개 조합에서 prior lateral와 grouped MAX의 date/days/audit mismatch 0.** 위치 8종 × 교재 상태 6종이며 날짜 tie, 두 copy scope, ±infinity, 미래 날짜, count 없음, inactive를 포함한다.
- 실제 fixture의 date NOT NULL, stable invoker, ACL, candidate aggregation 정의 존재를 확인했다. 이 검사는 운영 DB 관측이 아니다.

부모가 생성한 EXPLAIN/벤치 로그를 별도로 파싱·대조했다. 400 books / 10,000 moves / 20,000 counts fixture의 stock-count scan은 다음과 같다.

| 값 | 기존 | 최종 후보 |
| --- | ---: | ---: |
| stock-count scan Actual Loops | 400 | 1 |
| stock-count scan Shared Hit Blocks | 119,600 | 299 |
| scan당 필터 제외 행 | 19,971 | 8,571 |
| inventory list median ms | 210.135 | 26.743 |
| inventory summary median ms | 230.558 | 47.660 |
| master list median ms | 208.847 | 23.966 |
| master summary median ms | 229.279 | 42.816 |

6개 반환 JSON digest가 before/after 모두 일치하고 각 5회 측정에서도 안정적이었다. 해당 증거는 `baseline-explain.json`, `candidate-explain.json`, `baseline-bench.log`, `counts-only-bench.log`다. 실행계획은 함수 본문의 위치 상수를 넣은 동일 SQL을 PG17에서 측정한 것이며, 반환 JSON/시간은 실제 RPC 호출 벤치다.

부모 실행 pgTAP 로그도 최종 내용을 확인했다: 새 회귀 **15/15**, inventory **198/198**, stored taxonomy **12/12**. Linux Node 22 contract **265/265**와 실제 SQL DTO 10개 parser PASS는 부모 보고 결과이며 독립 실행 수에 합산하지 않는다. 나는 전체 suite를 다시 실행하지 않았다.

## 인덱스 미추가의 한계와 배포 판단

현재 개선은 반복 full scan을 없애는 것이다. 최종 fixture plan에서도 stock_counts 한 번의 sequential scan은 남는다. 위치를 text로 비교하는 기존 계약도 유지하므로 대규모 누적 counts에서 특정 위치를 빠르게 찾는 인덱스 최적화까지 해결한 것은 아니다. 전체 counts가 더 커지면 집계 CPU·메모리·I/O가 커질 수 있다.

이번 자료에서는 새 인덱스 없이 큰 개선이 확인됐으므로 인덱스 build·write amplification·권한/형식 변경을 추가하지 않는 범위가 적절하다. “어떤 데이터와 planner에서도 항상 한 번만 스캔한다”거나 “운영 지연을 이 수정으로 모두 해소한다”는 보장은 하지 않는다. 운영 cardinality·통계·캐시·경합 조건의 성능은 별도 관측 대상이다.

최종 SHA/tree가 검토 내용과 같고 부모의 배포 조율을 거치면 적용 후보로 적합하다. 실제 운영 DB 원인, PR113 이후 운영 상태, worker 중첩 문제를 이 SQL 변경의 검증 결과와 혼동하지 않는다. 제품 파일을 수정하거나 운영 SQL·설정·배포를 수행하지 않았다.
