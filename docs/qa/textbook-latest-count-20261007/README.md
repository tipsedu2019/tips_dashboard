# 교재 최신 실사 읽기: 격리 재현과 최소 수정

기준 main `69e978b2b3c6d448d3f25a7a700cfb154aad091b`.
운영 장애의 확정 원인이 아니라 **현재 소스에서 재현한 반복 전체 조회**를 수정한다.
운영 SQL·로그 조회, worker 정지, 배포, 권한·키·요금 변경은 수행하지 않았다.

## 결과

최종 `textbook_read_keys_v1`은 교재마다 `textbook_stock_counts`를 전체 조회했다.
main baseline + 146개 순서 migration 재생 결과 실사 테이블 인덱스는 PK뿐이었다.
400교재·10,000이동·20,000실사 합성 데이터에서 실사 Seq Scan은 400 loops,
약 800만 행 검사, 119,600 shared block hits였다. 선택 위치의 최신 날짜를 한 번
집계하고 교재와 결합하면 1 loop / 299 hits로 감소한다.

| RPC | 수정 전 중앙값 | 수정 후 중앙값 |
| --- | ---: | ---: |
| master list | 208.847ms | 23.966ms |
| master summary | 229.279ms | 42.816ms |
| inventory list | 210.135ms | 26.743ms |
| inventory summary | 230.558ms | 47.660ms |

같은 PG17.6 ARM64 컨테이너, `--network none`, 공개 포트 0, authenticated/admin
합성 사용자, JIT off, 서버 시계 측정, 각 RPC warmup 1회 후 5회 중앙값이다.
6개 key/list/summary 결과 전체 JSON 해시가 모두 일치했다. 실사 0건 대조군도
결과가 같으며 목록·요약은 전후 약 24~45ms였다(최대 중앙값 차이 1.502ms).
이 숫자는 운영 지연 예측이나 실제 데이터 규모의 추정값이 아니다.

## 수정과 영향

- migration `20261007135140_textbook_latest_count_read_aggregation.sql`만 제품 동작을 변경한다.
  `latest_counts`에서 위치별 `max(counted_at)`을 계산하고 기존 lateral join을 대체한다.
- `counted_at date NOT NULL`이므로 기존 `counted_at DESC,id DESC LIMIT 1`이
  반환하던 **날짜**와 동치다. UUID tie는 날짜 외의 열을 반환하지 않아 영향이 없다.
- 기존 위치 소문자 변환·텍스트 일치·NULL/빈 위치, 양쪽 copy scope, ±infinity,
  미래 날짜, 비활성 교재, 품질·정렬·재고·실사 상태 계약을 유지한다.
- stored taxonomy는 9/27 migration에서 이미 적용됐다. 다시 계산하도록 되돌리지 않는다.
  품질 JSON은 실행 계획에 8번 펼쳐졌지만 materialization의 개선폭은 약 2%여서 제외했다.
- 공통 helper를 쓰는 master/inventory 목록·요약 및 상세·중복 검색이 영향을 받는다.
  textbook workflow/operations summary, ops task, worker 실행 코드는 바꾸지 않는다.
- DB migration **필요**. 함수 교체만 하며 학생·수업·교재/실사 데이터 DML, 새 인덱스,
  RLS/ACL/권한 변경, 재고 재계산 저장은 없다. lock 5s / statement 10s 제한을 둔다.

## 검증

- 최종 함수에 신규 pgTAP 15/15, 기존 inventory numbered reads 198/198,
  stored taxonomy 12/12. SQLSTATE `42501` 및 기존 `22023` 회귀 포함.
- 기존 fixture의 신규 필수 학년·세부과목 제약과 pgTAP SELECT 표현을 맞춘 후 통과했다.
  성능 seed가 전역 facet 건수에 섞인 첫 실행은 분리 후 다시 검증했다.
- Linux Node22.18 소비자 계약 265/265, 이번 최종 SQL이 출력한 실제 DTO 10개를
  실제 `textbook-read-service.ts` 파서로 전달해 통과. UI 코드는 변경하지 않았다.
- 독립 검토: 48개 합성 위치/날짜 조합에서 이전 조회와 날짜·경과일·실사 상태 불일치 0.
- 전체 147개 migration manifest와 SHA 검증, free-tier query guard, whitespace check 통과.
  GitHub Actions를 실행하지 않았다.

## 재현

저장소 루트에서 Docker 캐시 이미지 `public.ecr.aws/supabase/postgres:17.6.1.159`가
필요하다. 아래 이름의 컨테이너가 이미 있으면 replay는 거부한다. 운영 연결은 없다.

```sh
python3 docs/qa/textbook-latest-count-20261007/replay.py --container tips_query_local_repro --prefix final
docker exec -i tips_query_local_repro psql -U postgres -X -v ON_ERROR_STOP=1 < docs/qa/textbook-latest-count-20261007/baseline-function.sql
docker exec -i tips_query_local_repro psql -U postgres -X -v ON_ERROR_STOP=1 < docs/qa/textbook-latest-count-20261007/seed.sql
docker exec -i tips_query_local_repro psql -U postgres -X -Atq -v ON_ERROR_STOP=1 < docs/qa/textbook-latest-count-20261007/bench.sql
docker exec -i tips_query_local_repro psql -U postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20261007135140_textbook_latest_count_read_aggregation.sql
docker exec -i tips_query_local_repro psql -U postgres -X -Atq -v ON_ERROR_STOP=1 < docs/qa/textbook-latest-count-20261007/bench.sql
docker exec -i tips_query_local_repro psql -U postgres -X -v ON_ERROR_STOP=1 < docs/qa/textbook-latest-count-20261007/remove-benchmark-fixture.sql
docker exec -i tips_query_local_repro psql -U postgres -X -Atq -v ON_ERROR_STOP=1 < supabase/tests/textbook_latest_count_read_test.sql
docker exec -i tips_query_local_repro psql -U postgres -X -Atq -v ON_ERROR_STOP=1 < supabase/tests/textbook_inventory_numbered_reads_test.sql > /tmp/latest-count-wire.log
node docs/qa/textbook-latest-count-20261007/check-wire.mjs /tmp/latest-count-wire.log
```

실사 0건 대조는 각 함수 상태에서 `bench-empty.sql`로 실행한다. 해당 script는
트랜잭션 안에서 합성 실사를 비우고 종료 시 rollback한다. 전체 반복 검증은 변경이나
실패 원인이 있을 때만 수행한다. 실제 측정 raw 결과·계획·테스트 로그는 이 폴더에 있다.

## 운영 장애와 남은 관측

운영의 현재 실사 건수·인덱스/실행 계획은 추가 조회하지 않았다. 따라서 이 반복 조회가
당일 `57014`·`08006`·Auth504를 발생시킨 원인인지, 전체 장애가 복구됐는지는 미확정이다.
초기 로그에서 교재·ops 실패가 PR112 배포보다 앞섰고 PR113 이후에도 DB 오류가
남았다는 부모 제공 증거와 양립하는 국소 성능 보완이다.

ops helper의 `force_custom_plan`은 9/5에 이미 적용됐으며 추가 결함으로 제안하지 않는다.
workflow의 전체 집계/alias lookup, summary의 반복 필터 계산은 소스 위험 후보지만
이번 운영 실패의 정확한 RPC·입력·계획에 연결되지 않아 추가 변경하지 않는다.

추가 판단에 필요한 최소 자료는 **부모가 이미 보유한 로그에서 실패한 정확한 RPC명,
시간·기간·SQLSTATE·query id/statement와 연결된 정보**다. 향후 별도 승인 시에도
관측은 해당 함수의 누적 실행 통계와 실사 테이블 추정 규모/인덱스 확인부터 제한하고,
운영 `EXPLAIN ANALYZE` 또는 인위적 부하 시험을 전제로 하지 않는다.

worker의 실행 소유권/전체 budget 후보와 발송 불확실성·큐 기아 위험은
[worker 독립 검토서](worker-candidates-review.md)에 분리했다. 실제 중첩 실행은 미확정이며,
이번 PR에 단순 mutex·Promise.race 또는 자동 재발송 변경을 포함하지 않는다.

로컬 검증을 통과한 제한된 DB 수정 후보다. 운영 적용·merge·배포는 부모 조율 대상이다.
일반적인 장애 재발 방지나 운영 DB 복구를 보증하지 않는다.

PostgreSQL [WITH materialization 문서](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION)를 참조했고,
판정은 실제 최종 함수와 격리 실행 계획에 근거했다.
