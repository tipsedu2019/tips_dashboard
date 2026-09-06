# Q-10 일정 충돌의 업무 오류 분류

기준: Q-09 `39d5a552`, 브랜치 `codex/conflict-business-sqlstate-20260905`. 이번 변경은 일정 충돌 업무 생성 함수의 확정된 상태 오류만 대상으로 한다. 전체 앱의 과거 `40001`을 일괄 교체하지 않는다.

## 근거와 적용

최종 active 정의는 `20260726035612_dashboard_conflict_task_producer.sql`의 `dashboard_private.create_dashboard_conflict_task_v1_impl(jsonb,uuid)`였다. 운영 함수에서도 `dashboard_conflict_stale`를 직접 `40001`로 발생시키는 15곳을 확인했다. 과거 일정, 사라진 수업/학생/시험, 실제 겹침 불일치, catalog/수강 상태 불일치 등의 확정된 업무 조건이며 데이터베이스의 serialization failure가 아니다.

새 migration `20260905143000_dashboard_conflict_business_sqlstate.sql`은 최종 함수의 해당 오류 코드 15개만 `23514`로 변경한다. 이전 본문에 정확히 이 치환을 적용한 결과와 새 본문이 동일함을 비교했다. SECURITY DEFINER, 빈 search_path, 기존 ACL, advisory/행 잠금, 정렬된 잠금 순서, 권한, 완료 요청 replay, fingerprint, 알림 미생성 로직을 유지한다. CLI 2.115.0의 `migration new`로 만들고 manifest에 순서와 SHA-256을 추가했다. 배포 전 Squawk 검사에서 누락된 migration 실행 제한을 발견해 기존과 같은 `SET LOCAL lock_timeout=5s`, `statement_timeout=120s`를 추가했다. 함수 본문은 동일하며 아직 운영 미적용인 새 migration과 manifest만 갱신했다.

## 검증

- RED: 최종 체인을 적용한 격리 PostgreSQL에서 잘못된 겹침 부분구간, 다음날 시험 과목, 지난 회차, 대기 학생, 사라진 원본의 5개 검사가 모두 `caught 40001 / wanted 23514`로 실패했다.
- GREEN: 새 최종 체인에 대해 업무 생성 **35개** + 통계 **55개**, 총 **90개 pgTAP** 통과. 마지막 실행은 lint와 postdeploy contract도 통과했고 격리 DB를 정리했다. 마지막 함수 정의에 수동 `40001`이 남지 않았는지도 확인한다.
- Node: 업무 서비스·충돌 UI·producer·SQLSTATE 묶음 **62개** 통과. 새 3개는 실제 서비스의 요청 ID 생성/저장/제거 로직을 실행한다. `23514` 실패 후 새 요청은 새 ID를 사용하고, 실제 serialization failure와 네트워크 실패는 동일 ID를 유지한다. 어느 경우도 서비스가 자동으로 두 번째 RPC를 만들지 않는다.
- 새 요청 복구 검사는 기존 free-tier CI의 설치 단계에 연결했다. 검토한 workflow 내용의 보호 해시만 갱신했다.
- 워크플로 보호 검사 **36개**, 오류 코드·migration layout 검사, 변경 스크립트 lint, diff whitespace 검사 통과. 앱 런타임 TS/TSX와 UI는 변경하지 않아 Q-09의 빌드·브라우저 결과와 구분한다.
- 기존 로컬 전용 동시성 스크립트의 source-race 기대값도 `23514`로 맞췄다. 이번에는 두 HTTP 연결 checkpoint 시나리오 자체를 실행하지 않았으므로 새 동시성 실측 결과라고 주장하지 않는다. pgTAP의 중복 업무·request replay·권한·알림 미생성은 통과했다.
- 로그: `/tmp/tips-q10-sql-red.log`, `/tmp/tips-q10-sql-final.log`, `/tmp/tips-q10-node.log`. 첫 GREEN 시도의 추가 메타 검사는 설치된 pgTAP에 없는 `unlike`를 호출해 실패했고 표준 `is(strpos(...),0)`로 고쳤다. 실패한 실행을 완료 증거로 사용하지 않았다.

## 조사에서 수정한 가설

확인일 2026-09-05. [PostgreSQL 17 오류 코드](https://www.postgresql.org/docs/17/errcodes-appendix.html)는 `23514`를 check_violation, `40001`을 serialization_failure로 정의한다. [serialization failure 처리](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)의 전체 트랜잭션 재시도 기준을 확정된 업무 상태 오류와 분리했다. 원문을 복제하지 않고 기존 프로젝트 지침에 맞춰 적용했다.

설치된 `@supabase/postgrest-js` **2.108.2**의 `src/PostgrestBuilder.ts`는 POST를 자동 재시도 대상으로 삼지 않는다. 설치된 실제 SDK와 mock fetch로 `40001`/HTTP 500, `23514`/HTTP 400을 각각 반환했을 때 두 경우 모두 요청 **1회**였다. 따라서 이 변경의 효과는 정확한 오류 분류·요청 복구 계약이며, 현재 해당 경로의 자동 재시도 폭주나 응답시간 감소를 입증한 것은 아니다. 측정되지 않은 성능 향상은 주장하지 않는다.

재사용 기준: SQLSTATE 이름만으로 SDK 재시도 동작을 추정하지 말고 설치된 버전의 실제 요청 방식과 실패 복구를 확인한다. 새 도구·패키지·스킬을 추가하지 않았고 기존 Supabase·systematic-debugging·실패 테스트 우선 방법을 사용했다.

## 상태

Q-10은 로컬 구현·검증 범위다. 운영 배포는 Q-09와 구분한다. 다음에는 등록 상태 전이와 동시성·중복 실행·no-send 시나리오를 격리 DB에서 검토한다.
