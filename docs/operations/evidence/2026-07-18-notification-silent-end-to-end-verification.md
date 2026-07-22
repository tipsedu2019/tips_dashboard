# 알림 시스템 조용한 종단간 검증 결과

기록일: 2026-07-18, 최신 갱신 2026-07-19 (Asia/Seoul)

상태: **운영 bridge 설치·안전 코드 `main` 배포 완료, 무발송 관측 조기 종료, 새 시스템 실제 발송 비활성 유지**

이 문서는 기존 알림 흐름을 변경하지 않고 새 공통 알림 시스템을 실제 공급자 호출 없이 검증한 결과다. Google Chat, Web Push, SOLAPI의 실제 발송 요청은 한 번도 실행하지 않았다.

## 1. 운영 기준선

### 저장소와 배포

- 무발송 관측 종료 당시 로컬 `main`, `origin/main`, Vercel 운영 배포의 Git revision은 모두 `fbcf3006657ed00f22ad7b6e74779ed4370fa9aa`였다.
- 운영 `/api/notifications/contract-version`은 `contractVersion=2`, `environment=production`을 반환했다.
- 운영이 반환한 `buildRevisionHash`는 위 Git revision의 SHA-256인 `ccc4c5e699fade4c7beec5c887fecdc14f01f9e83eeea611f9fe9973fa62b3fe`와 일치했다.
- Vercel 운영 배포 `dpl_B65rwVDXe2qQfS72fqkU33JS2MT8`는 `READY`이며 운영 별칭 오류가 없다.
- 승인된 안전 코드는 `main`과 Vercel 운영에 배포됐다. 배포 뒤 Vercel 런타임 오류와 해당 배포의 HTTP 5xx는 모두 0건이다.
- 운영 소유권 전환은 하지 않았다.

### Supabase

- 연결된 Supabase 플러그인으로 `tips dashboard` 프로젝트가 `ACTIVE_HEALTHY`, PostgreSQL 17.6 상태임을 확인했다.
- 공통 제어면 런타임 버전은 1이다.
- 12개 런타임 플래그 중 설정 UI 플래그만 `true`(revision 2)이며, 그림자 기록·7개 업무 dispatch·등록 phone/visit/SOLAPI 어댑터 플래그 11개는 모두 `false`(revision 1)다.
- 2026-07-19 bridge 설치 후 재조회 결과는 다음과 같다.

| 항목 | 건수 |
| --- | ---: |
| 7개 업무 설정 화면 규칙 | 174 |
| canonical 이벤트 | 23, 모두 보존된 휴보강 이력 |
| canonical 전달 | 93, 모두 보존된 휴보강 이력 |
| fanout 작업 | 0 |
| 대상 재계산 작업 | 0 |
| legacy 소유권 | 93, 모두 폐쇄 상태 |
| 규칙 재계산 작업 | 2, 모두 기존 완료 기록 |

- 휴보강 보존 자료는 기존 전달 93건을 canonical 이벤트 23건과 전달 93건으로 가져오고, 같은 93건의 legacy 소유권을 모두 폐쇄했다. 누락 0건, 위험 전달 상태 0건, 금지 fanout 0건이며 원본과 canonical 체크섬이 일치한다.
- legacy 계약 계측 bridge는 열림 상태(`closed_at is null`)다. traffic과 outcome은 0건이다. 관측 중 600초를 넘긴 구간은 그 이전 후보 창을 폐기하고 재기준화했다. 마지막 유효 창은 2026-07-19 18:59:35 KST부터 20:00:13 KST까지이며 영수증 11건, 비준수 0건이다. 마지막 인접 간격은 302.159712초였고 모든 영수증은 bridge 인식 서버 1대·이전 계약 서버 0대를 기록했다.
- 원격에는 공통 제어면, 설정, worker RPC 기반, seed, inbox, 등록 예약 producer, 할 일 producer, 즉시형 재계산 보완이 적용돼 있다. worker 스케줄과 실제 실행은 설치·활성화하지 않았다.
- 사용자 승인 범위에 따라 canonical `20260716191000`, `20260716192000`, `20260716193000`, `20260716194000`, `20260716194500` bridge 마이그레이션을 연결된 Supabase 플러그인으로 순서대로 적용했다. 원격 이력에 저장된 SQL과 각 로컬 파일의 바이트·MD5가 모두 일치한다.
- 전환·활성화 번들 `20260716195000`, `20260716195500`, `20260716195800`, `20260716195900`, `20260716196000`, `20260717145304`는 적용하지 않았다. 따라서 legacy closure, worker/watchdog schedule, provider claim, forward-compat, shadow 증거는 모두 비활성이다. 이보다 늦은 시각 번호의 즉시형 안전 보완 마이그레이션과 혼동하지 않는다. `pg_cron` 확장과 `cron.job`도 없다.
- 위 과거 6개 SQL은 현재 immutable quarantine의 reference-only 자료다. 직접 적용하거나 active lane으로 승격하지 않는다. 과거 본문은 현재 과학 인지 함수 `public.revalidate_immediate_notification_delivery_v1`와 `public.prepare_notification_immediate_delivery_v1`를 이전 정의로 덮어쓸 수 있다.
- 승인 범위는 위 bridge 설치, 같은 안전 코드의 `main` 배포, 무발송 계약 관측까지다. 2026-07-19 20:00:13 KST 영수증을 마지막으로 예약 관측을 조기 종료했고 자동 실행을 삭제했다. shadow 활성화, worker 일정 설치, 소유권 전환, 실제 공급자 발송은 승인 범위 밖으로 유지한다.

## 2. 발송 예정 계약

아래 표는 공통 설정 174행과 고정 어댑터 계약을 함께 정리한 것이다. `대시보드`는 canonical in-app이며, 현재 모든 새 dispatch 플래그가 꺼져 있으므로 표의 항목은 실제 발송 결과가 아니라 향후 발송 예정 계약이다.

| 업무 | 언제 | 누구에게 | 예정 채널 | 현재 화면 규칙 |
| --- | --- | --- | --- | ---: |
| 할 일 | 생성, 담당 변경, 일정 변경, 상태 변경, 완료, 취소, 재개, 댓글 직후 | 요청자, 주 담당자, 보조 담당자, 관리팀 | 대시보드, 관리팀 Google Chat | 40행, 활성 표시 0 |
| 영어 단어 재시험 | 생성, 배정, 본시험일 변경, 시작, 결과 보고, 미응시 보고, 수정 요청, 후속 재시험 생성, 완료, 취소 직후 | 요청 선생님, 담당 조교, 보조 담당자, 관리팀 | 대시보드, 관리팀 Google Chat | 50행, 활성 표시 0 |
| 등록 | 문의 접수·등록 완료·문의 종료 직후, 예약 전날 14:00·당일 14:00·1시간 전 | 관리팀, 과목별 상담 책임자 | 대시보드, 관리팀 Google Chat | 12행, 기존 의도 3행만 활성 표시 |
| 전반 | 신청 제출, 처리 완료 직후 | 관리팀 | Google Chat | 2행, 기존 의도 2행 활성 표시 |
| 퇴원 | 신청 제출, 처리 완료 직후 | 관리팀 | Google Chat | 2행, 기존 의도 2행 활성 표시 |
| 휴보강 | 신청 제출, 환불 신청, 승인, 환불 완료, 승인 취소, 보완 요청, 반려 직후 | 신청자, 결재자, 관리팀, 경영진, 과목팀 | 대시보드, 대상별 Google Chat | 32행, 기존 저장값 14행 활성 표시 |
| 전자결재 | 생성, 제출, 검토 시작, 결재자 변경, 승인, 반려, 취소, 재상신, 댓글 직후 | 요청자, 현재 결재자, 관리팀 | 대시보드, 관리팀 Google Chat | 36행, 활성 표시 0 |

등록의 고정 인수인계 계약에는 다음 항목도 포함된다. 이 항목의 원격 bridge는 설치됐지만 관련 어댑터 플래그는 모두 `false`이므로 전달을 생산하지 않는다.

- 전화상담 준비 시 과목별 상담 책임자에게 대시보드 알림
- 방문상담 예약·변경·대체·과목 해제·취소 시 과목별 상담 책임자 대시보드 및 관리팀 Google Chat 알림
- 입학서류 고객 메시지를 보호자에게 SOLAPI로 전달하는 전용 흐름

Web Push는 대시보드 알림의 파생 채널로만 존재하며 공통 설정의 독립 규칙으로 열리지 않는다. 이번 검증에서는 구독 self-test와 실제 Push provider를 실행하지 않았다.

## 3. 누락·중복·대상·취소·재시도 검증

### 누락과 대상

- 실제 관리자 화면에서 7개 업무를 하나씩 선택했고 40+50+12+2+2+32+36=174행이 Supabase 규칙 수와 정확히 일치했다.
- 모든 업무 선택 상태, 규칙 표, 저장 변경 없음 상태를 확인했다. 저장 버튼은 전 과정에서 비활성이었다.
- 잘못된 workflow, event, audience, channel, connection 조합은 schema 오류로 fail-closed하는 테스트를 통과했다.
- profile UUID는 중복 제거·정렬 후 hash하며, 등록·휴보강·전자결재는 브라우저가 보낸 수신자를 신뢰하지 않고 권위 원본을 다시 읽는다.
- 수신자가 0명인 규칙이 빈 배열로 사라지는 문제를 발견해 수정했다. 이제 `audience:<audienceKey>` 증거 1건을 만들고 SQL에서 `skipped/no_recipient`로 남길 수 있다. 이 행은 worker claim 대상이 아니므로 공급자를 호출하지 않는다.

### 중복

- 동일 요청 ID replay, 동일 occurrence, 동일 delivery dedupe key, 동일 dispatch token의 외부 시도 중복을 모두 거부하는 계약을 통과했다.
- 결정적 preview 2회를 연속 실행했고 두 번 모두 manifest digest가 `e9c22bdae184e6fc9e48edaa0eb93a077e3e0ff205c2a1c3cf3bdb04607b1b68`로 같았다.
- 두 실행 모두 `duplicateExternalRequests=0`, `externalRequests=0`, `providerAttempts=0`이었다.
- 한 사람이 요청자와 관리팀처럼 서로 다른 업무 역할을 동시에 가진 경우는 서로 다른 규칙 의도다. 현재 시스템은 이를 임의로 합치지 않는다. 실제 발송 전 운영 데이터로 역할 중첩 빈도를 확인하고, 같은 내용의 중복 수신을 하나로 합칠지 업무 정책을 확정해야 한다.

### 취소

- 일정 변경·취소는 아직 시작하지 않은 전달만 정확히 무효화한다.
- 전자결재의 결재자 변경·취소와 휴보강 승인 취소·삭제는 이전 수신자의 미발송분만 `source_status_changed` 또는 취소 상태로 닫는다.
- `claimed`는 취소 요청을 기록한 뒤 begin 단계에서 중단하고, `sending`은 발송 여부가 불명하므로 자동 재발송하지 않는다.
- 부분 rollback과 전체 rollback 시뮬레이션은 모든 지점에서 외부 side-effect 소유자가 정확히 하나임을 확인했다.

### 재시도

- 새 canonical worker에서는 429와 명시적 사전 거절 425만 bounded `retry_wait`을 사용한다.
- timeout, connection reset, 5xx와 외부 시도 등록 결과 불명은 `delivery_unknown`으로 종결해 자동 재발송하지 않는다.
- 새 canonical worker의 Google Chat과 Web Push HTTP 408이 자동 재시도로 분류되던 중복 위험을 발견해 수정했다. canonical 경로에서는 `delivery_unknown/provider_ambiguous_response`, `nextAttemptAt=null`이다. 공용 provider의 생략 기본값은 기존 legacy 계약인 `retry_wait`으로 유지해 기존 흐름을 바꾸지 않았다.
- 등록 예약 외부 알림은 초회 후 1분, 다음 5분, 총 3회까지만 허용하며 예약 시각을 넘기는 재시도는 `retry_window_closed`로 닫는다.

## 4. 실제 발송 0 증거

순수 로컬 preview는 고정 10개 범위(`tasks`, `word_retests`, `approvals`, `transfer`, `withdrawal`, `makeup_requests`, `registration`, `registration_phone`, `registration_visit`, `registration_solapi`)를 모두 완료했다.

| 지표 | 결과 |
| --- | ---: |
| 완료 범위 | 10/10 |
| legacy 의도 기록 | 10 |
| canonical shadow 행 | 10, 모두 `skipped/shadow_mode` |
| 외부 요청 | 0 |
| provider 시도 | 0 |
| canonical inbox 투영 | 0 |
| 중복 외부 요청 | 0 |
| DB 작업 | 0 |

운영 shadow 실행기는 `--apply` 없이 dry-run으로만 확인했고 10개 RPC 계획만 만들었다. worker schedule 관리기도 `inspect`만 실행했고 설치·변경은 하지 않았다. bridge 설치 뒤에도 `pg_cron`과 `cron.job`은 없고 새 worker는 예약 실행되지 않는다.

bridge 적용 전 실제 관리자 화면의 최근 전달 요약은 마지막 전달 기록 없음, 대기 0, 완료 0, 실패 0, 결과 확인 필요 0이었다. bridge 적용 후 DB에는 보존 이력 93건만 존재하며 상태는 `sent` 20건, `skipped` 4건, `disabled` 69건이다. 새 발송 대기·재시도·처리 중·결과 불명 상태는 0건이다. 운영 배포 뒤 같은 화면의 7개 업무도 읽기 전용으로 다시 확인했다. 모든 저장 버튼은 변경 없음 상태였고 연결 탭의 `테스트 메시지 보내기`는 누르지 않았다.

기존 legacy 발송 경로는 이번 작업에서 수정하거나 전역 차단하지 않았다. 실제 업무 이벤트를 만들지 않고 새 시스템의 주입 전송기·preview만 실행해 기존 운영 흐름과 분리했다.

## 5. 수정과 검증 결과

발견한 문제는 모두 로컬 브랜치에서 수정하고 재검증했다. bridge SQL은 운영 적용 전에 전체 트랜잭션 rollback dry-run을 통과한 것만 적용했다.

1. canonical Google Chat/Web Push HTTP 408 자동 재시도 위험 제거와 legacy 기본 동작 보존
2. 수신자 0명 규칙의 `no_recipient` 증거 누락 제거
3. 현재 TypeScript 대상과 맞지 않는 own-property 검사 호환성 보완
4. `191000`의 PL/pgSQL `CASE` 조건 파싱 오류
5. `192000`의 `event_key` 모호성 및 동일인 `rejected` 보존 규칙 오류
6. `194000`의 `CASE` 조건과 composite `INTO` 세 곳 오류
7. `194500`의 schema-qualified `EXTRACT` 오류

위 네 bridge SQL 문제는 각각 수정 후 rollback dry-run과 계약 회귀를 다시 통과했다. 실패한 시도는 트랜잭션 전체가 되돌려졌고 부분 적용이나 발송 side effect는 없었다.

검증 결과:

- 저장소 전체 Node 테스트: 1533/1533 통과
- 즉시 어댑터 집중 재검증: 11/11 통과
- TypeScript `tsc --noEmit`: 통과
- ESLint: 오류 0건, 500KB 초과 기존 대형 파일 2개의 Babel 최적화 생략 안내만 존재
- `git diff --check`: 통과
- 수신자 0명 수정은 독립 코드 리뷰에서 Critical, Important, Minor 0건으로 승인됐다. 408 격리는 별도 최종 리뷰로 legacy 보존과 canonical 분리를 다시 확인했다. bridge SQL 수정도 적용 전 회귀와 원격 rollback dry-run으로 재검증했다.
- Webpack 로컬 서버는 `http://localhost:3001`에서 계속 실행 중이며 host HTTP 200을 확인했다.

## 6. 조기 종료 결과와 실제 발송 전 남은 작업

1. 이번 관측은 약 1시간의 마지막 유효 창만 확보한 상태에서 조기 종료했다. 24시간 이상과 서울 기준 완결된 하루 조건을 충족하지 않았으므로 `get_notification_contract_drain_evidence_v1` 최종 판정과 legacy 계약 drain 승인은 완료되지 않았다.
2. 실제 발송 전 검증을 다시 시작하려면 새 관측을 별도로 승인하고, 인접 영수증 간격 600초 이하로 24시간 이상과 서울 기준 완결된 하루를 새로 확보해야 한다.
3. 관측을 다시 시작하더라도 과거 전환·활성화 번들 6개는 적용·승격하지 않는다. 최신 schema 기준의 새 forward-dated install migration과 service-role 전용 activation RPC를 별도 설계·검증·승인한다.
4. 7일 운영 shadow에서 10개 범위의 자연 발생 일치와 수신자 0명 조사를 완료한다.
5. 역할 중첩 사용자의 동일 내용 중복 수신 정책을 확정한다.
6. 첫 실제 발송은 별도 승인과 중단 래치·rollback 확인 뒤 한 소유자씩 진행한다.

이 문서 작성 시점에도 새 알림 시스템의 실제 발송 플래그는 켜지 않았으며, 새 시스템을 통한 Google Chat·Web Push·SOLAPI 실발송은 0건이고 모두 비활성 상태다. 예약 관측은 삭제했으며 24시간 이상 및 서울 기준 완결된 하루의 최종 증거는 확보하지 않은 상태로 종료한다.
