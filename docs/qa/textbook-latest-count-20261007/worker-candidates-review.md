# Worker 동시 실행·전체 deadline 후보 독립 검토

**결론:** 런타임 mutex와 `Promise.race`만으로 다중 인스턴스 중첩 방지를 보장할 수 없다. 작은 처리 예산은 부하 완화 후보지만, 완료 소유권·큐 공정성·다음 기동·발송 불명 상태를 함께 다뤄야 한다. 보장 가능한 실행 소유권에는 DB의 원자적 run 취득과 token 기반 갱신/완료가 필요하다. 아직 구현 후보 단계이며 운영 장애 원인이나 실제 중첩을 확정하지 않는다.

- 기준: `69e978b2b3c6d448d3f25a7a700cfb154aad091b`, `tips-query-bottleneck-fix`.
- 검토 시작 때 worktree clean. PR112 검토 HEAD `f19bdbc923663cfbd2aa989423d5098529263dbb`부터 현재까지 notifications 소스·route·migration diff는 없다. 기존 동일 runtime 중첩 합성 결과는 관련 코드가 동일한 이전 증거이며, 이번에 운영 실행으로 재검증하지 않았다.
- 제품 파일·운영 SQL·로그·중지 플래그·설정·배포를 변경하거나 호출하지 않았다. 이 문서만 작성했다.

## 현재 최종 계약

| 영역 | 최종 소스 / migration | 확인한 계약 |
| --- | --- | --- |
| route gate | `src/app/api/notifications/worker/route.ts:56`; `20260812195130_notification_worker_production_schedule.sql:303` | service role/worker ID/stop latch 확인. run lease 취득이나 generation 검증은 없음. |
| wakeup / completion | `20260815120000_event_driven_notification_worker.sql:26,147` | global row lock으로 enqueue 합치기. job lease 60초, HTTP 응답 대기 25초, wakeup lease 90초. completion은 **다른 generation**을 무시. 성공 시 더 새 요청 또는 due fanout만 있으면 다음 POST를 즉시 enqueue. |
| claims / apply / finish | `20260716112000_notification_control_plane_worker_rpc.sql:1278,1511,1627,1681,1742,2083,2905` | queue별 `SKIP LOCKED`, job별 claim token. global 실행 소유권은 없음. apply/finish가 claim token을 확인하지만 run token은 없음. |
| reaper | `20260812213138_notification_delivery_lease_reap_schedule_fix.sql:8` | 만료한 claimed job/delivery는 pending, sending delivery는 `delivery_unknown`. 이 구분을 보존해야 함. |
| heartbeat | `20260809105000_registration_observation_google_chat.sql:5024` | 같은 run ID 기록의 충돌 방지. advisory **transaction** lock이 RPC 반환 뒤까지 batch를 잠그지는 않음. 서로 다른 run ID의 실행은 허용. |
| provider 준비 | `20260722120000_science_notification_connection.sql:2344`; ACL은 `20260722130000_notification_prepare_acl_hardening.sql` | source/flag/delivery/ownership 검사와 잠금 계약. service-role 실행 권한 유지 필요. |
| 외부 시도 등록 | `20260716194500_notification_legacy_contract_telemetry.sql:670` + 아래 ordered patches | dispatch identity와 동일 dispatch token의 등록 이력으로 중복 시도 차단. provider 호출 전 현재 source/preview/retirement 검사 유지 필요. |

`register_notification_external_attempt_v1`은 최초 정의만 보면 안 된다. `20260901111100` v2 source fence → `20260907101952` word-retest gate → `20260908042546` visit/cancellation fence → `20260908044502` preview fence → `20260908062222` final gate assertion → `20260909050943` subject completion fence → `20260909084130` tasks/word_retests retirement → `20260922021144` approvals retirement를 순서대로 검토했다. 최종 retirement와 explicit 등록 발송 경계를 유지해야 한다.

## 후보별 판정

| 후보 | 줄일 수 있는 것 | 부족한 보장 / 판정 |
| --- | --- | --- |
| 프로세스 `inFlight` mutex | 같은 runtime의 동시 진입 | 다른 인스턴스·cold start·이전 배포 실행은 남음. 보조 최적화만 가능. |
| `Promise.race(runBatch, timeout)` | HTTP handler가 기다리는 시간 | underlying batch/SQL/provider는 계속될 수 있음. 즉시 completion/release하면 새 run과 겹침. **단독 적용 부적합.** |
| chunk·admission deadline | 새 claim/job 시작 수, 미리 claim한 대기량 | 다중 인스턴스 배타성 없음. 고정 큐 순서와 재기동 문제까지 처리한 완화로만 표현. |
| DB run lease + conditional renew/complete | 서로 다른 프로세스의 새 run 승인, 늦은 완료 차단 | lease 만료 뒤 구 run이 계속할 수 있으므로 후속 쓰기/provider 시작에도 fencing 필요. **실행 소유권의 최소 후보.** |
| 단일 장기 SQL transaction/advisory session lock을 HTTP 전 구간 유지 | DB 연결 하나에 배타성 유지 가능 | REST RPC 경계와 맞지 않고 provider 동안 연결/잠금을 점유. 현재 구조의 최소 수정안으로 채택하지 않음. |

## 구현 시 필요한 최소 계약

1. **dispatch generation과 실행 identity를 분리한다.** 기존 wakeup state를 무조건 재활용해 active_generation만 검사하면 같은 generation의 중복 POST가 둘 다 진입할 수 있다. DB에서 `run_id + fencing_token + lease_expires_at`을 원자적으로 취득하고 stop latch도 같은 admission에서 검사한다. generation 없는 구 invoke/manual 경로도 같은 gate를 통과시킬지, 명시적으로 거절할지 호환 계약을 정해야 한다.
2. **미취득 요청은 winner의 completion을 호출하지 않는다.** 현재 complete는 generation만 비교한다. 새 gate에서 중복을 거절한 route가 기존 `finally`를 그대로 실행하면 같은 generation의 실제 실행을 완료·해제할 위험이 있다. 취득한 run/token에 대해서만 renew/complete를 허용하고, 이미 교체된 token의 완료는 no-op으로 만든다.
3. **lease 만료만 믿지 않는다.** 구 run은 소유권을 잃으면 새 claim·DB 변경·provider 시작을 중단한다. DB fence는 검사와 쓰기를 같은 transaction에서 수행해야 한다. lease row를 잠금 없이 한 번 읽는 검사만으로는 takeover와 쓰기 사이 경쟁이 남는다. 기존 source→delivery→ownership 잠금 순서와 충돌하지 않도록 설계·로컬 검증해야 한다.
4. **다음 실행을 durable하게 예약한다.** 기존 성공 completion은 현재 due fanout만 본다. future `next_attempt_at`과 rule/target/delivery-only backlog가 있어도 다시 기동되는 계약이 필요하다. 최소 due-at 한 개를 보존하고 명시적으로 승인된 기존 scheduler/dispatcher가 소비하도록 한다. 단순 `setTimeout`이나 새 이벤트가 오기를 기대하지 않는다. 새 cron/운영 설정 추가는 이 조사 범위에서 하지 않는다.
5. **event wakeup에도 stop latch를 적용할 수 있다.** fanout 저장 자체는 실패시키지 않고 pending/wakeup 필요 상태를 보존한다. 이미 실행 중인 배치·발송을 취소하는 기능이라고 표현하지 않는다. 재개 뒤 대기 업무가 자동 또는 명시적 한 번의 wakeup으로 이어지는지 검증한다.

새 run lease 및 RPC 계약은 DB migration이 필요하다. 소스만 바꾸는 mutex/deadline 후보와 같은 수준의 보장으로 묶지 않는다.

## 전체 deadline과 큐 공정성

현재 `notification-worker.ts:1873–1986`은 fanout → rule → target → delivery 순서이고 각 queue를 기본 50개씩 claim한다. 총 50개가 아니다. production에서는 observation claim/reap 두 항목을 로컬 빈 결과로 대체한다.

- 총예산만 추가하고 매번 fanout부터 시작하면 계속 많은 fanout이 delivery까지의 예산을 다 써서 발송이 기아 상태가 될 수 있다. **큐별 작은 chunk를 한 번씩 처리하는 round-robin과 다음 시작 queue를 잇는 상태**, 또는 각 queue의 처리 여유를 보장하는 명시적 quota가 필요하다. 모든 queue가 due인 합성 fixture에서 연속 run 동안 각 queue가 진전하는지 확인한다.
- job lease 60초는 claim 시점부터다. 50개를 먼저 claim하면 뒤의 job은 시작 전 만료될 수 있다. 처리 직전 작은 chunk만 claim하고, 남은 lease가 `최대 처리 시간 + 정리 여유`보다 충분할 때 시작한다. 갱신은 token과 소유권을 조건으로 하며 DB 오류를 소유권 유지로 해석하지 않는다.
- **batch_size=1도 큰 fanout apply를 해결하지 않는다.** `notification-worker.ts:935–981`은 한 job의 모든 target을 렌더해 단일 apply RPC에 넣는다. SQL은 전체 target-set hash를 검사한다. targets 배열만 잘라 보내면 계약을 깨므로, target chunk가 필요하면 cursor/hash 계약을 별도로 설계해야 한다.
- admission deadline, 요청 응답 deadline, 서버 작업 종료 deadline을 구분한다. 남은 예산이 없으면 새 일을 시작하지 않되, 이미 실행 중인 쓰기는 완료/불명 여부를 정리한다. read 전용 `withReadDeadline`을 그대로 mutation/provider에 붙여 성공/실패를 확정하면 안 된다.
- route의 gate·첫 heartbeat·실패 heartbeat·generation completion도 현재 무제한 await다. 이들을 제외한 loop만 제한하면 전체 요청 시간 상한이 아니다. deadline/cancellation 처리 경로 자체도 별도 제한과 늦은 완료 방어가 필요하다.
- 실제 hard deadline은 DB/provider 호출의 서버 측 제한까지 확인해야 한다. HTTP 응답 대기 25초가 worker 실행 종료를 보장하지 않는다. 함수 내부 `SET LOCAL`만으로 RPC 전체 SQL 실행 상한이 증명됐다고 가정하지 말고, 로컬 PG17에서 실제 문장 취소와 늦은 성공 경계를 검증한다. 이 문서는 운영 timeout 값을 제안·변경하지 않는다.

## Provider 중복과 늦은 완료

현재 Google Chat provider는 `google-chat-provider.ts:335`에서 signal/timeout 없이 POST하며 dispatch_token을 외부 멱등 키로 전달하지 않는다. 내부 ledger의 `external_attempt_registered` 검사는 같은 dispatch token의 중복 시작을 막지만 외부 exactly-once를 증명하지 않는다.

- provider 호출이 시작됐으면 timeout·접속 단절 후에도 실제 발송됐을 수 있다. 해당 결과는 `delivery_unknown`으로 유지하고 일반 retry/pending으로 바꾸지 않는다. 현재 production의 HTTP 408→unknown, sending lease 만료→unknown, 외부 시도 등록 결과 불명→unknown을 보존한다.
- `register_notification_external_attempt_v1`의 현재 source/retirement/preview/ownership 검사와 기존 dispatch identity를 유지한다. run fencing을 추가한다고 새 delivery/dispatch token을 만들어 재발송하지 않는다.
- run lease가 사라진 뒤 provider 결과가 늦게 도착할 수 있다. 기존 `finalize_notification_delivery_v1`은 claim token/status가 바뀌었으면 거절한다. generic deadline handler와 늦은 provider continuation이 둘 다 finalize하지 않도록 한 실행의 결과 정리 주체를 하나로 정해야 한다. 이미 unknown으로 확정된 값을 단순한 늦은 응답으로 덮어쓰지 않는다.
- 현재 다른 generation의 늦은 completion은 이미 무시된다. 추가 검증의 핵심은 **같은 generation의 중복 run**, lease 만료 후 token 교체, completion timeout 후 재호출이다. 이 경우 새 run의 lease/heartbeat/final status를 구 run이 바꾸면 안 된다.
- DB fencing은 이미 네트워크로 보낸 외부 요청을 취소하지 못한다. “동시에 유효한 DB 실행 소유자는 하나”와 “원격 발송이 언제나 하나”는 별개의 보장이다.

## 후보 승인 전 로컬 검증 기준

1. 두 별도 runtime의 같은 generation 동시 시작: 취득 1개, loser의 claim/provider/complete 0회. 서로 다른 generation·generation 0 경로도 검사.
2. lease/token 교체: 구 token의 renew·claim·apply·complete 거절, 새 token 상태 보존. 같은 generation을 재취득한 경우도 포함.
3. RPC가 deadline 후 성공/실패: 새 페이지/job/claim 시작 0, 재실행 0, completion은 token 조건을 유지.
4. 각 queue 단독 backlog와 모든 queue 동시 backlog: 예산이 반복 소진돼도 모든 due queue가 진전하고 future retry가 다시 기동.
5. provider 직전/직후 timeout, 외부 시도 등록 응답 손실, late provider success: provider 중복 0, 불명확한 sending은 unknown 유지.
6. stop→resume, old deployment·new deployment 겹침, 기존 retired/no-send 경계와 ACL/RLS 유지. SQLSTATE가 필요한 새 도메인 거절에 `40001`을 임의 부여하지 않는다.

## 다른 병목 가설과 구분

교재 `read_taxonomy` stored generated column과 이를 쓰는 `textbook_read_keys_v1`은 `20260927103000_performance_catalog_and_workload.sql`에 이미 있다. ops 두 source 함수의 `force_custom_plan`도 `20260905064919_ops_task_parameter_sensitive_plans.sql`에 이미 적용돼 있다. 이를 미적용 개선안으로 다시 제안하지 않는다. 교재 flags 반복 계산/stock-count lateral 비용은 부모의 별도 PG17 측정 범위이며, worker 소스 위험만으로 그 비용이나 운영 장애 원인을 확정하지 않는다.
