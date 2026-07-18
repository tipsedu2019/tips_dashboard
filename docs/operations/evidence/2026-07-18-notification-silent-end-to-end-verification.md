# 알림 시스템 조용한 종단간 검증 결과

기록일: 2026-07-18 (Asia/Seoul)

상태: **조용한 검증 완료, 실제 발송 비활성 유지**

이 문서는 기존 알림 흐름을 변경하지 않고 새 공통 알림 시스템을 실제 공급자 호출 없이 검증한 결과다. Google Chat, Web Push, SOLAPI의 실제 발송 요청은 한 번도 실행하지 않았다.

## 1. 운영 기준선

### 저장소와 배포

- 확인 당시 로컬 `main`, `origin/main`, Vercel 운영 배포의 Git revision은 모두 `d9ea4843678d400810c87f128972c37d0a87e48d`였다.
- 운영 `/api/notifications/contract-version`은 `contractVersion=2`, `environment=production`을 반환했다.
- 운영이 반환한 `buildRevisionHash`는 위 Git revision의 SHA-256인 `f395347eb7553c4cbeec81c0af7ee1b71f0b0845eb33cad3eb8f78dbdff74229`와 일치했다.
- 알림 계약·worker 경로의 최근 24시간 Vercel 런타임 오류는 0건이었다.
- 이번 수정은 `codex/notification-shadow-qa-20260718` 로컬 브랜치에만 남겼다. `main` push, 운영 배포, 운영 소유권 전환은 하지 않았다.

### Supabase

- 연결된 Supabase 플러그인으로 `tips dashboard` 프로젝트가 `ACTIVE_HEALTHY`, PostgreSQL 17.6 상태임을 확인했다.
- 공통 제어면 런타임 버전은 1이다.
- 설정 UI 플래그만 `true`이며, 그림자 기록·7개 업무 dispatch·등록 phone/visit/SOLAPI 어댑터 플래그 11개는 모두 `false`다.
- 2026-07-18 23:01 KST 최종 재조회 결과는 다음과 같다.

| 항목 | 건수 |
| --- | ---: |
| 설정 규칙 | 174 |
| canonical 이벤트 | 0 |
| canonical 전달 | 0 |
| fanout 작업 | 0 |
| 대상 재계산 작업 | 0 |
| dispatch 소유권 claim | 0 |
| 규칙 재계산 작업 | 2, 모두 기존 완료 기록 |

- 감사 기록은 기존 `settings_updated` 2건과 `runtime_flag_changed` 1건뿐이며, 이번 검증에서 새 외부 발송·소유권 기록은 생기지 않았다.
- 원격에는 공통 제어면, 설정, worker, seed, inbox, 등록 예약 producer, 할 일 producer, 즉시형 재계산 보완까지 적용돼 있다.
- 전반·퇴원, 휴보강, 전자결재, 등록 인수인계, legacy 관찰 브리지와 그 뒤 closure·schedule·forward-compat·shadow 증거 마이그레이션은 아직 적용하지 않았다.
- 운영 DB에 bridge 마이그레이션을 적용하는 요청은 안전 심사에서 차단됐다. 다른 SQL 경로로 우회하지 않았고 운영 DB 변경은 0건이다.

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

등록의 고정 인수인계 계약에는 다음 항목도 포함된다. 이 항목의 원격 bridge는 아직 적용하지 않았고 관련 어댑터 플래그도 모두 `false`다.

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

- 429와 명시적 사전 거절 425만 bounded `retry_wait`을 사용한다.
- timeout, connection reset, 5xx와 외부 시도 등록 결과 불명은 `delivery_unknown`으로 종결해 자동 재발송하지 않는다.
- Google Chat과 Web Push의 HTTP 408이 자동 재시도로 분류되던 중복 위험을 발견해 수정했다. 이제 `delivery_unknown/provider_ambiguous_response`, `nextAttemptAt=null`이다.
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

운영 shadow 실행기는 `--apply` 없이 dry-run으로만 확인했고 10개 RPC 계획만 만들었다. worker schedule 관리기도 `inspect`만 실행했고 설치·변경은 하지 않았다.

실제 관리자 화면의 최근 전달 요약은 마지막 전달 기록 없음, 대기 0, 완료 0, 실패 0, 결과 확인 필요 0이었다. 화면 전환 중 콘솔 error와 warning은 각각 0건이었다. 연결 탭의 `테스트 메시지 보내기`는 누르지 않았다.

기존 legacy 발송 경로는 이번 작업에서 수정하거나 전역 차단하지 않았다. 실제 업무 이벤트를 만들지 않고 새 시스템의 주입 전송기·preview만 실행해 기존 운영 흐름과 분리했다.

## 5. 수정과 검증 결과

발견한 문제는 모두 로컬 브랜치에서 수정하고 재검증했다.

1. Google Chat/Web Push HTTP 408 자동 재시도 위험 제거
2. 수신자 0명 규칙의 `no_recipient` 증거 누락 제거
3. 현재 TypeScript 대상과 맞지 않는 own-property 검사 호환성 보완

검증 결과:

- 알림 전체 회귀: 335/335 통과
- 저장소 전체 Node 테스트: 1497/1497 통과
- 즉시 어댑터 집중 재검증: 11/11 통과
- TypeScript `tsc --noEmit`: 통과
- ESLint: 오류 0건, 500KB 초과 기존 대형 파일 2개의 Babel 최적화 생략 안내만 존재
- `git diff --check`: 통과
- 두 수정 모두 독립 코드 리뷰에서 Critical과 Important 0건으로 최종 승인. 첫 리뷰의 Minor 1건은 425 재시도 시각 테스트를 더 엄격히 할 수 있다는 비차단 권고였다.
- 로컬 개발 서버: `http://localhost:3001`, PID 81369, 계속 실행 중

## 6. 실제 발송 전 남은 작업

1. 별도 운영 승인을 받아 bridge 마이그레이션 `191000`~`194500`을 순서대로 적용하고 동일 계약을 포함한 운영 배포를 확인한다.
2. 배포 영수증을 5분 간격으로 수집해 서울 기준 완결된 하루와 24시간 이상 legacy/canonical 자연 발생 비교를 통과한다.
3. 그 뒤에만 legacy closure, worker/watchdog schedule, provider claim, forward-compat, shadow 증거 마이그레이션을 단계별로 검토한다.
4. 7일 운영 shadow에서 10개 범위의 자연 발생 일치와 수신자 0명 조사를 완료한다.
5. 역할 중첩 사용자의 동일 내용 중복 수신 정책을 확정한다.
6. 첫 실제 발송은 별도 승인과 중단 래치·rollback 확인 뒤 한 소유자씩 진행한다.

이 문서 작성 시점에도 실제 발송 플래그는 켜지 않았으며, Google Chat·Web Push·SOLAPI 실발송은 모두 비활성 상태다.
