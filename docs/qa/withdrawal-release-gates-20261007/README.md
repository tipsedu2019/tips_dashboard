# 퇴원 추가 릴리스 검증 — 운영 적용 보류

제품 수정 기준은 `8b0ca153835bcf988d74f84428df18a3dc473bd5`다. 실제 Supabase PostgreSQL 17.6 / pg_cron 1.6.4의 제한된 확장 권한에서 이전 `240eff71`의 scheduler manager가 cron.job 직접 UPDATE로 `42501`을 반환했다. cron.alter_job도 postgres EXECUTE 권한이 없어 단순 치환으로 해결할 수 없었다. 추가 권한 없이 기존 허용 API인 cron.schedule/cron.unschedule만 사용하도록 수정했다.

`disable`과 `remove`는 해당 job을 unschedule하고 pending 예약을 보존한다. 실행 중 worker를 취소하지 않는다. `install`은 일치하는 활성 job을 유지하고 비활성 job은 제거 후 재생성한다. 실제 native probe에서 named schedule 재호출만으로는 active=false가 바뀌지 않음을 확인했으며, 재생성 시 job ID는 바뀔 수 있다. manager 이외 90000 migration의 queue·worker·core·ACL은 기존 후보와 바이트가 같다. TypeScript 앱 코드와 나머지 SQL 3개도 그대로다.

| 실행한 검증 | 결과 |
| --- | --- |
| 실제 Supabase 기준 스키마·선행 조건·151개 순차 migration | 158개 파일 적용 통과. 기존 240eff71을 재생한 뒤 최종 manager만 정확히 교체 |
| 최종 파일의 pgTAP | 완료 96/96, 날짜/예약 경계 123/123 |
| 실제 native cron API/ACL | 비활성 named schedule 유지, unschedule→재생성 활성화, 활성 반복 job ID 유지, 권한 변경 0 확인 |
| 관련 Linux Node 22.23.2 | 31/31, 실패·스킵 0 |
| Mac migration layout 테스트 | 45/45, 실패·스킵 0 |
| migration layout / domain SQLSTATE verifier | 모두 통과 |
| 실제 일정 resolver의 읽기 전용 확인 | 4/4: 고유 id 또는 sessionKey 필요, 중복 identity 거부 |
| 독립 코드 검토 | 새 코드 결함 없음. 운영 릴리스 판단은 보류 |

pgTAP 준비 데이터는 실제 Auth 트리거가 자동 생성하는 프로필을 upsert하고, 등록 claim의 회차가 실제 수업 일정과 일치하도록 보완했다. 학교 category도 실제 CHECK 값 high로 맞췄다. 업무 assertion을 완화하지 않았고, scheduler 중지 후 job 메타데이터 부재 검사 1개를 추가했다. 두 suite는 rollback하므로 deferred 시간표 검사의 COMMIT 통과를 증명하지 않는다. 관련 TypeScript는 이전 타입 검사 통과·lint 오류 0/기존 경고 3 때와 같아 SQL 전용 수정 뒤 반복하지 않았다. 이전 상세 검증은 [기존 보고서](../withdrawal-completion-20261007/README.md)에 보존한다.

실제 자동 cron을 위한 합성 seed COMMIT은 고유 일정 ID 누락으로 `23P01 timetable_resource_conflict`에서 중단됐다. 실제 resolver의 읽기 전용 확인으로 준비 데이터의 원인을 좁혔고 ID 보완 SQL을 작성했으나 실행 승인이 차단됐다. 자동 minute tick, 실제 worker의 30초 취소와 재시도, 화면 저장→service→실제 SQL→재조회는 완료하지 않았다. 브라우저 DB 연결·저장·완료는 0이다. 최종 8b0ca153 전체를 새 DB에 다시 재생한 증거도 없다.

자동 승인 검토는 합성 cron 실행과 한 번의 재검토를 모두 거절했다. 두 번째 판단은 추가 허용 지시가 assistant 전달 맥락에만 있고 end-user 메시지에는 없으므로 원래 문구 수정과 운영 SQL 금지 범위를 벗어난다는 이유였다. 거절된 호출의 프로세스·SQL 실행은 0이며 다른 경로로 우회하지 않았다. 직접 승인이 필요하다. GitHub도 PR 본문 갱신·push에 서버 오류를 반환해 두 번 실패했으며, 마지막 확인한 원격 PR115는 이전 240eff71이다. 이 이전 후보는 설치 대상으로 사용하지 않는다.

운영 학생 변경·완료·SQL·발송·재발송·배포·운영 scheduler 활성화는 수행하지 않았다. 미납 채권·청구·결제·기존 명단을 복원하거나 변경하는 운영 작업도 없다. [단계 적용 계획](rollout-plan.md)은 DB·앱을 먼저 적용하되 새 cron 활성화를 별도로 다루는 검토안이며, 미검증 gate와 AI DB 담당의 적용 순서 확인 전에는 실행하지 않는다. 원본 첨부 JPEG는 기존 Library materialization 실패로 여전히 픽셀 미확인이다.

검증용 PostgreSQL 컨테이너·브라우저 idle client·socket volume은 소유권과 ID를 확인한 뒤 정리했다. 종료 시 PID 0과 컨테이너/volume 부재를 확인했으며 정리 과정에서 SQL·cron 실행은 하지 않았다. 직접 승인 후 재개할 경우 새 격리 fixture를 구성해야 한다.
