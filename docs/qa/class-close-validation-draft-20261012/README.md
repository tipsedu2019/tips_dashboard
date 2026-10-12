종강으로 주간 점유가 바뀔 때 validator가 날짜마다 전체 회차 배열을 다시 탐색한다. 날짜별 배열을 한 번 구성해 모든 날짜·회차·중복·override·unknown 충돌 검사와 전체 참조 반환을 보존하면서 반복 탐색을 줄인다. 종강 RPC는 반환 영수증의 수업 ID와 상태를 확인한 뒤 성공 흐름으로 진행한다. 빈 응답·다른 수업·다른 상태는 불확실한 결과로 처리하고 입력과 같은 요청의 재시도 키를 유지한다. 8초 클라이언트 시한과 기존 timeout, actor/ACL/RLS/잠금/idempotency/no-send 경계는 유지한다.

수정 후보의 기준 main은 `dc1e142df9d95bd69799d953f77077a572ad2d12`이며 원본 로컬 후보는 `14baa43b3f06d5f1cf77193c7f257d50f1767c7c`, tree `bcf4f6ebf79a78e325e71a76122bde155bfb1811`이다. 원본 커밋은 로컬에 보존한다. 이 전달 브랜치의 소스·테스트·gate 13개 파일은 `source-manifest.json`의 원본 후보 SHA256와 바이트가 동일하다. 원본의 실행 로그와 운영 조회 기록은 게시 범위에서 제외하기 위해 원본 커밋을 전달 브랜치의 부모로 사용하지 않는다. 새 README와 source manifest, 복구 SQL만 검토 문서로 포함한다. PR137·138·139를 보존하며 별도 등록 UX는 변경하지 않는다.

| 검증 | 기존 동일 소스의 로컬 결과 | 제한 |
|---|---|---|
| 관련 관리·시간표·종강·퇴원·query budget 회귀 | 524/524 통과 | 전체 프로젝트/hosted gate와 구분 |
| SQL 정적 계약 검사 | 55/55 통과 | 실제 cached PostgreSQL 10개 fixture는 미실행 |
| 소스·manifest·receipt 핀 | 15/15 통과 | 기존 156개 legacy prefix와 기존 SHA 유지 |
| migration layout 음성 검사 | 48/48 통과 | 모든 기존 음성 assertion 유지 |
| focused PostgreSQL17 pgTAP | 9/9 통과 | 실제 최종 validator/helpers + 합성 reader/context; 전체 writer/auth/RLS 통합 검사가 아님 |
| build·TypeScript·전체 lint·Squawk·free-tier/query·SQLSTATE verifier | 통과 | 원본 후보의 동일 source/lockfile 실행 근거 |
| 독립 리뷰 | 미해결 코드 finding 없음 | CI 연결 및 필드별 음성/정확한 반복량 단언 보강 완료 |

게시 준비 worktree에서 관리·종강·operational·source receipt pin 표적 검사 34/34와 layout/SQLSTATE verifier를 별도로 재실행해 통과했다. 독립 게시 준비 검토에서 소스 13개 동일성과 원문 로그·운영 조회 제외, 검증 한계 표현을 확인했다.

위 결과는 동일 source hash의 이전 로컬 실행 근거이며 이 전달 HEAD의 전체 검사를 새로 완료한 결과로 표시하지 않는다. 합성 검사에서 전체 회차 3,600개·날짜 1,200개를 양쪽 모두 평가하며 반복 입력 검사량을 8,640,000에서 정확히 7,200으로 줄였다. 이 수치는 운영 개선율이 아니다. 실제 로컬 statement timeout/pg_cancel_backend는 각각 57014로 전파되고 합성 write+validation 거래의 독립 재조회에서 롤백을 확인했다. 정상 commit, 응답 유실 전후, post-commit refresh 실패와 중복/취소/상태 재조회 흐름은 구분해 검증했다.

**Draft — 전체 검증이 남아 있다.** 전체 Supabase schema의 97 SQL/21 probe, 실제 writer·인증·RLS·잠금·동시성·AI producer parity, cached PostgreSQL 10개 fixture와 운영 적용 후 E2E는 미완료다. 별도 준비된 격리 환경에서 정확한 전달 HEAD/기준 main을 기록해 현행 workflow 명령과 독립 검토를 실행해야 한다. 검사 source/base가 바뀌면 근거를 갱신한다. 빈·실패·취소·미실행 required check를 통과로 표시하지 않는다.

`20261012155755_timetable_validation_date_reuse.sql`은 로컬에서 작성한 forward migration 후보다. SHA256 `83ec63aad313c61b6c2205ce4748a0707b1f478a424e5e6c67d92fb4b27c9e82`. `rollback-validator.sql`은 직전 최종 20261006095753 validator만 복구하는 별도 검토 제안이며 이미 commit된 수업·학생 상태를 되돌리지 않는다. 두 SQL 모두 운영에 적용하지 않았다. 이번 게시 범위는 비공개 draft PR의 일반 소스 전달뿐이며 운영 SQL·종강/저장 재시도·merge/deploy·권한 변경은 승인하거나 수행하지 않는다.
