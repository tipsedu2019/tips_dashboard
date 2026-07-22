# 알림 bridge 무발송 관측 기록

기록 시각: 2026-07-19 03:56 KST (Asia/Seoul)
최종 대조 시각: 2026-07-19 20:00 KST

상태: **운영 배포 완료, 5분 영수증 관측 조기 종료, 실제 발송 비활성 유지**

## 1. 운영 배포

- 관측 종료 당시 Git `main`, 로컬 `HEAD`, `origin/main`: `fbcf3006657ed00f22ad7b6e74779ed4370fa9aa`
- Vercel 운영 배포: `dpl_B65rwVDXe2qQfS72fqkU33JS2MT8`
- 운영 별칭: `https://tipsdashboard.vercel.app`
- 상태: `READY`, 대상 `production`, alias 오류 없음
- 운영 계약: version 2, environment `production`
- build revision hash: `ccc4c5e699fade4c7beec5c887fecdc14f01f9e83eeea611f9fe9973fa62b3fe`
- 위 hash는 Git revision 문자열의 SHA-256과 일치한다.
- 배포 직후 Vercel 런타임 오류는 0건이며 계약 endpoint는 HTTP 200이다.

## 2. 배포 영수증

- 첫 기록: 2026-07-19 03:54:58 KST
- request ID: `ad5835ab-f9e3-550e-802a-f4aac93237ee`
- inventory source: `vercel_production_alias_v1`
- active server: 1
- bridge-aware server: 1
- pre-bridge server: 0
- bridge 상태: 열림(`closed_at is null`)

두 번째 영수증도 같은 운영 build와 계약으로 기록했다.

- 두 번째 기록: 2026-07-19 04:05:22 KST
- request ID: `8a2fa108-4382-573c-895c-d931c68ad4c7`
- active server: 1
- bridge-aware server: 1
- pre-bridge server: 0
- 첫 기록부터 두 번째 기록까지: 10분 23초

첫 기록과 두 번째 기록의 실제 간격은 623초로 엄격한 600초 상한을 23초 넘었다. 발송 안전 불변식에는 영향이 없지만 첫 기록은 연속 배포 증거 창에서 제외하고, 두 번째 기록을 유효 관측 시작점으로 재기준화했다.

세 번째 영수증은 유효 시작점과 같은 운영 build·계약으로 기록했다.

- 세 번째 기록: 2026-07-19 04:11:09 KST
- request ID: `c41642fb-27a7-500f-8562-77444f9d11c6`
- active server: 1
- bridge-aware server: 1
- pre-bridge server: 0
- 두 번째 기록부터 세 번째 기록까지: 347.368462초
- 누적 영수증: 3건
- 현재 유효 증거 창 영수증: 2건, 비준수 0건

로컬에 Vercel 토큰을 새로 저장하지 않았다. 연결된 Vercel 플러그인으로 운영 배포를 확인하고, 연결된 Supabase 플러그인으로 동일한 고정 영수증 계약을 기록했다.

## 3. 관측 경과와 조기 종료

- Codex heartbeat `알림 bridge 무발송 관측`을 5분 간격으로 실행했고, 연결된 Vercel·Supabase 플러그인으로 매 실행의 배포 계약과 발송 잠금을 확인했다.
- 인접 영수증의 실제 시각 간격이 600초를 넘은 구간은 그 이전 후보 창을 폐기하고 다음 영수증부터 재기준화했다.
- 마지막 유효 관측 시작점은 request ID `4813c0fc-7709-588f-8de3-365d0d1ae10e`의 2026-07-19 18:59:35 KST다.
- 마지막 영수증은 request ID `39cd2cd7-c130-50fc-8651-ded0fe0a9cc0`의 2026-07-19 20:00:13 KST다.
- 마지막 유효 창은 영수증 11건, 비준수 0건이며 마지막 인접 간격은 302.159712초다.
- 사용자 요청으로 이 시점에 예약 관측을 조기 종료하고 heartbeat 자동 실행을 삭제했다.
- 유효 창이 24시간 및 서울 기준 완결된 하루 조건에 미달하므로 `get_notification_contract_drain_evidence_v1` 최종 판정은 실행하지 않았다.
- 전환·활성화 번들 `20260716195000`, `20260716195500`, `20260716195800`, `20260716195900`, `20260716196000`, `20260717145304`, shadow, worker/watchdog 일정, 소유권 전환, 실제 발송은 적용하지 않았다.
- 위 과거 6개 SQL은 현재 immutable quarantine의 reference-only 자료이며 직접 적용하거나 active lane으로 승격하지 않는다. 과거 본문은 현재 과학 인지 함수 `public.revalidate_immediate_notification_delivery_v1`와 `public.prepare_notification_immediate_delivery_v1`를 이전 정의로 덮어쓸 수 있다.

## 4. 발송 잠금 상태

- 설정 UI 외 런타임 플래그 11개: 모두 `false`
- canonical fanout: 0
- 대기·재시도·처리 중·결과 불명 전달: 0
- `pg_cron`, `cron.job`: 없음
- Google Chat 실제 발송: 0
- Web Push 실제 발송: 0
- SOLAPI 실제 발송: 0

마지막 영수증 직후 다시 조회한 결과도 다음과 같이 동일했다.

- 전체 런타임 플래그: 12개
- 설정 화면 플래그: `true`
- 설정 화면 외 런타임 플래그: 11개 모두 `false`
- canonical fanout: 0건
- canonical 전달: 93건 유지(`sent` 20, `skipped` 4, `disabled` 69)
- bridge 설치 뒤 새 canonical 전달: 0건
- 대기·재시도·처리 중·결과 불명 전달: 0건
- legacy 계약 traffic: 0건
- legacy 계약 route outcome: 0건
- `pg_cron` 확장: 없음
- `cron.job` 테이블: 없음

## 5. 운영 화면 읽기 전용 확인

운영 알림 설정 화면에서 7개 업무 탭을 모두 열어 읽기 전용으로 확인했다.

| 업무 | 화면에 확인된 이벤트 수 | 확인 결과 |
|---|---:|---|
| 할 일 | 8 | 화면 표시 정상, 변경 없음 |
| 영어 단어 재시험 | 10 | 화면 표시 정상, 변경 없음 |
| 등록 | 4 | 기존 설정 표시 유지, 변경 없음 |
| 전반 | 2 | 기존 설정 표시 유지, 변경 없음 |
| 퇴원 | 2 | 기존 설정 표시 유지, 변경 없음 |
| 휴보강 | 7 | 기존 설정 표시 유지, 변경 없음 |
| 전자결재 | 9 | 화면 표시 정상, 변경 없음 |

반응형 화면용 DOM이 중복 렌더링되므로 DOM 원시 체크 수는 논리 규칙 수로 사용하지 않았다. 모든 저장 버튼은 비활성 상태였고 `변경사항이 없습니다` 상태를 유지했다. 스위치, 저장, 테스트 발송 버튼은 누르지 않았다.

## 6. 조기 종료 시점 최종 확인

- Vercel 운영 배포: `READY`, `main` SHA 일치, 운영 alias 오류 없음
- 배포 뒤 Vercel 런타임 오류: 0건
- 해당 배포의 HTTP 5xx: 0건
- 로컬 `http://127.0.0.1:3001/admin/settings/notifications`: HTTP 200
- 관측 종료 당시 로컬 `HEAD`와 `origin/main`: `fbcf3006657ed00f22ad7b6e74779ed4370fa9aa`로 일치
- 24시간 및 서울 기준 완결된 하루 증거: 미확보
- 최종 drain evidence: 미실행
- 예약 관측 자동 실행: 삭제 완료

이 기록 이후에도 실제 알림 발송은 켜지 않는다. 관찰을 다시 시작할 때도 24시간 이상 및 Asia/Seoul 기준 완결된 하루와 7일 운영 shadow라는 역사적 요구조건을 유지한다. 다만 이 조건은 과거 6개 SQL의 적용 권한이 아니며, 최신 schema 기준의 새 forward-dated install migration과 service-role 전용 activation RPC를 별도 설계·검증·승인해야 한다.
