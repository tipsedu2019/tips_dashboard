# 대시보드 처리 대기 업무

## 집계 기준

- 등록은 활성 과목 트랙별 1건, 전반·퇴원은 미완료 요청별 1건, 휴보강은 미완료 신청별 1건이다. 완료·취소·반려 및 보관된 등록 과목은 제외한다.
- 등록의 상담·청강 원장 확인 단계는 과목 팀과 해당 상담 담당자, 그 외 등록 단계는 관리팀 공통 업무로 집계한다. 전반·퇴원은 담당자(검토 요청은 요청자), 휴보강은 결재자·보완 요청자·보강 담당자에 귀속한다. 환불 처리는 관리팀 공통이다.
- 개인 담당자가 없는 건은 `담당 미지정`, 공동 처리 단계는 `팀 공통`으로 구분한다. 같은 이름의 다른 계정은 합치지 않는다.
- 접수 후 경과 시간은 등록 과목의 생성 시점 또는 원본 요청의 생성 시점부터 계산한다. 현재 단계 경과 시간은 등록의 단계 진입 시각, 전반·퇴원·휴보강의 마지막 해당 상태 변경 이력부터 계산한다. 이력이 없으면 생성 시각으로 계산하므로 오래된 자료의 단계 경과 시간은 보수적인 대체값이다.
- 평균 경과는 미처리 건의 총 경과 시간 / 건수, 최장 경과는 가장 오래된 접수 건이다. `7일 이상`은 접수 후 168시간 이상이며 처리 기한 위반이나 개인 평가를 뜻하지 않는다. 정렬은 7일 이상 건수, 전체 건수 내림차순이다.
- 요약과 상세는 같은 DB projection을 사용하며 호출자의 RLS를 유지한다. 전체 관리자와 담당 선생님의 조회 범위는 기존 업무 권한을 따른다.

## 화면 및 조회

기존 대시보드의 오늘 일정 위에 공통 표를 배치한다. 팀 또는 담당자별 건수를 누르면 공통 상세창에서 단계별 필터와 10/15/20행 페이지 이동을 사용하고, 업무를 누르면 기존 상세 URL로 이동한다. 선택한 단계가 자동 갱신으로 0건이 되어도 조회 조건을 임의로 넓히지 않는다.

화면이 보이고 온라인일 때 60초마다 갱신하며 포커스 복귀 조회는 30초 이내 반복하지 않는다. RPC는 8초 제한, 자동 재시도 없음이다. 같은 조회의 실패는 이전 결과와 기준 시각을 유지하고 재시도를 제공한다. 계정·권한·필터가 바뀌면 이전 조회 결과를 제거한다.

## 검증 기록

- 새 업무 집계·서비스·갱신 테스트, 기존 공통 표·페이지 이동 및 일일 요약 테스트 통과.
- TypeScript, 변경 파일 ESLint, Next webpack production build 통과. Build의 외부 의존성은 합성 localhost API로 격리했다.
- `dashboard_workload_test.sql`: 최종 migration chain의 격리 PostgreSQL 17에서 22개 pgTAP 검증 통과. RLS, 익명 ACL, 정확한 42501/22023, 소유자 전환, 완료/보관 제외, 단계/누적 시간, 전체 건수와 페이지 일치 포함.
- `probe-dashboard-workload-dto.mjs`: 같은 격리 DB에서 실제 두 RPC JSON을 운영 TypeScript parser와 행렬 집계에 입력하여 16건 요약, 14건 상세 및 서로 다른 접수/단계 시각 검증 통과.
- 합성 데이터 25건으로 실제 앱의 1440px/390px, 라이트/다크, 긴 이름·수업명, 페이지 2, 단계 필터, 상세 경과 시간, Escape 후 초점 복귀, 실패 후 이전 결과 유지와 재시도·0건 상태를 브라우저에서 확인했다. 모바일 문서의 가로 넘침은 없고 표 내부만 스크롤한다.
- 공통 시각 토큰이나 컴포넌트를 변경하지 않았다. 행렬 요약의 페이지 예외는 DESIGN.md에 기록했다.

재현 명령:

```sh
node --test tests/dashboard-workload.test.mjs tests/dashboard-workload-interaction.test.mjs tests/dashboard-daily-brief.test.mjs tests/dashboard-daily-brief-interaction.test.mjs tests/data-table-surface.test.mjs tests/data-table-pagination.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id dashboard-workload-review-20260922 --review-head --require-final --test supabase/tests/dashboard_workload_test.sql --probe tests/probe-dashboard-workload-dto.mjs
```

브라우저 재현은 `scripts/qa/dashboard-workload-fixture-server.mjs`(3230/3232)와 합성 Supabase URL `http://127.0.0.1:3232`로 실행한 Next dev(3231)를 사용한다. `/__fixture`, `/__fixture?theme=dark`에서 시작하고 `/__control`의 mode(`normal`, `loading`, `error`, `empty`)로 상태를 전환한다. 실제 운영 데이터는 fixture에 포함하지 않는다.

운영 반영 순서는 새 migration 적용 후 앱 배포이다. 이 기록은 로컬·격리 DB 검증이며 운영 migration 적용이나 앱 배포의 증거가 아니다.
