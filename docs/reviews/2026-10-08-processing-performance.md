# 처리 흐름 성능 점검 — 2026-10-08

기준 main은 `004e85f68e70ae4c4749c7a524865ac85d139163`이다. 원격에서 fresh read 했으며 PR119와 PR120을 모두 포함한다. 13:12 UTC 운영 Vercel `dpl_9bwEWrYzPK9WGWLzpNq6J6uU8h6v`가 같은 SHA로 READY였고 공개 `/api/notifications/contract-version` HTTP 200의 deployment/project/build hash가 일치했다. 이는 현재 배포 식별 확인이며 처리 버튼 속도 측정은 아니다.

## 이번 수정과 동일 조건 측정

| 경로 | 변경 | 합성 전 → 후 중앙값 | 유지한 계약 |
| --- | --- | --- | --- |
| 등록 상세 / 저장 후 상세 재조회 | phase 1 뒤 독립적인 수강 현황·이력과 청강 요약을 병렬 조회 | 245.9 → 164.0ms (-33.3%) | table 11 + reminder RPC 1, 전체 결과 JSON SHA256 동일 |
| 휴보강 보완 요청 | 전체 workspace 9 reads 대신 기존 단건 detail RPC 1회 | 254.26 → 168.78ms (-33.6%) | mutation 1회, 알림 시도 1회 |
| 휴보강 반려 | 같은 단건 detail 재사용 | 252.66 → 167.63ms (-33.7%) | 담당자·상태 확인, expectedStatus, request UUID |
| 휴보강 승인 취소 | 같은 단건 detail 재사용 | 253.43 → 166.38ms (-34.4%) | 담당자·상태·수업 확인, 서버 복구 RPC |

실제 서비스 코드를 격리 합성 transport로 실행했다. 등록은 table read당 80ms, 휴보강은 read/mutation/session/notification transport당 40ms를 넣고 같은 non-empty 입력으로 각각 5회 측정했다. Node 22.18.0과 package-lock에 일치하는 의존성을 사용했다. 휴보강 합성 read payload는 약 41–43KB에서 1.7KB로 줄었다. 이 fixture 크기는 운영 데이터 규모를 대표하지 않는다. 운영 DB시간, 브라우저 렌더, 실제 저장·완료 총시간, 외부 알림 도착 시간은 측정하지 않았다.

재현 스크립트:

```sh
git show 004e85f68e70ae4c4749c7a524865ac85d139163:src/features/tasks/registration-track-service.ts > /tmp/registration-before.ts
node scripts/measure-registration-case-detail.mjs /tmp/registration-before.ts
node scripts/measure-registration-case-detail.mjs
node scripts/measure-makeup-action-performance.mjs 004e85f68e70ae4c4749c7a524865ac85d139163 --compare
```

등록의 병렬 read는 어느 하나라도 실패하면 부분 상세를 성공 반환·캐시하지 않는다. 기존 abort/epoch/in-flight/cache-key/nullable-count를 유지한다. 실패 시 상대 read가 이미 시작될 수 있고 먼저 도착한 오류가 표시되는 것은 병렬화의 tradeoff다. 청강 summary의 기존 공유 loader/cancellation API는 바꾸지 않았다.

휴보강은 이미 승인 경로가 사용하는 `get_makeup_detail_v1`을 재사용한다. 서버 mutation receipt의 상태·시각·수업 데이터가 계속 기준이며, 표시이름만 권한이 확인된 detail에서 유지한다. 환불·삭제·재상신의 fresh 역할/학급 검증은 기존대로 둔다. 알림 await, 알림 실패 경고, 예상 상태 충돌, 요청 식별자, 승인취소의 서버 일정 복구를 바꾸지 않았다.

## 전체 범위 점검과 후속 우선순위

| 영역 | 코드 근거 | 판단 |
| --- | --- | --- |
| 등록·청강 | `registration-track-service.ts`의 loadCaseDetail 후속 waterfall | 위 최소 수정 적용 |
| 휴보강 | `makeup-request-service.ts`의 전체 workspace + 단건 재조회 | 보완·반려·승인취소 3경로 개선; 환불·재상신·삭제는 역할/입력 계약 때문에 별도 후보 |
| 교재 목록/저장 후 갱신 | `use-textbook-numbered-data.ts`, `textbook-operations-workspace.tsx`의 invalidateMaster/Purchase/Sales/Inventory는 이미 병렬, 활성 scope/actor만 조회 | 전체 새로고침으로 오인하지 않음. 금액·재고 preflight/순차 mutation을 임의 병렬화하지 않음 |
| 교재·수업 공개 캐시 | `public-classes-cache-invalidation.js`의 저장 뒤 세션 읽기 + 최대 3초 재검증 | 상한은 관찰 지연이 아님. pending 전달 계약·재시도/내구성 먼저 설계해야 하므로 미변경 |
| 자동 이력 | 등록 상세의 task-scoped `ops_task_events`가 before/after payload와 전체 이력을 재전송 | 대형 합성 이력의 payload/파싱 측정 후 열 때 조회/페이지 설계 후보. 임의 limit로 기록을 누락시키지 않음 |
| 청강 피드백 | `registration-track-editor.tsx`의 handleObservationSaved 뒤 feedback detail 재조회 | 선택/권한 ownership race 검증 후 별도 수정 후보 |
| 등록 완료·알림 | 등록 mutation 뒤 dispatch 응답과 상세/목록 refresh 대기 | 알림 경로는 기존 퇴원 담당과 소유권 조율 필요. await 제거·성공 선표시하지 않음 |
| 공통 auth/권한 | `auth-provider.tsx`는 세션 재사용, in-flight 합치기, 토큰 갱신 때 화면 유지가 이미 있음 | profile ID miss 뒤 identity fallback은 의존성이 있고 권한 gate는 필수. PR120 auth 파일 보존 |
| 수업 저장 후 상세 | `management-page.tsx` reconcileManagementPage가 목록 refresh 뒤 별도 detail을 직렬 조회 | 독립성 후보이나 학생·수업 공통 파일이므로 소유권 조율과 race 회귀 후 후속 작업 |
| 저장 후 목록 | `ops-task-workspace.tsx` onReload는 상세와 numbered page refresh가 이미 Promise.all | 퇴원 담당 파일 수정 제외. document full reload와 구분 |

이 표의 미수정 후보는 코드상 구조 관찰이다. 생산 환경의 느린 구간 순위를 실측했다고 주장하지 않는다. 시간표 예약/실효 점유 조회도 직렬 그룹이 있으나 범위 제한·취소·충돌 확인이 우선이므로 임의 병렬화하지 않았다.

## 경계와 릴리스 상태

운영 학생 변경·완료·취소·승인, 메일/Chat/문자 전송, 비밀번호/자격증명/보안 설정, 유료 조치, 운영 SQL·DB 인덱스·cron 변경은 0회다. SQL/RLS/ACL·금액·락·중복 방지 파일을 수정하지 않았다. 기존 container/process/tab과 원래 dirty checkout을 보존하고 별도 worktree에서 작업했다.

검증과 독립 리뷰, PR head/base 및 병합·배포 결과는 최종 릴리스 증거에서 별도로 기록한다. GitHub hosted Actions의 billing 실패를 PASS로 표시하지 않는다. 기존 local full Supabase/Auth baseline 실패를 반복하지 않았으며 SQL 변경이 없는 본 PR의 직접 영향은 실제 consumer/service 합성 회귀와 정적 SQL 계약으로 검증한다. 이 결과가 전체 schema-contract 실행 성공을 뜻하지는 않는다.

## 최종 변경분 검증

- 기존 free-tier workflow의 Node 검사 23개 명령 묶음: 2,618 pass, 0 fail, 0 skipped. 로컬 실행은 worker concurrency를 2로 제한했고 기존 선택 파일·패턴은 유지했다. 새 휴보강 76개 사례도 기존 CI 선택 파일에 포함했다.
- 같은 workflow의 Muse 오프라인 Python 계약: 10 + 86 pass.
- 최종 TypeScript noEmit, 변경 파일 ESLint, Next production build, diff whitespace 검사 통과.
- migration layout 및 domain SQLSTATE 정적 검사 통과. SQL diff는 0개.
- 등록 독립 검토: 서비스 92/92 통과와 전후 결과 해시 동일 확인. 휴보강 독립 검토: 소비자·알림 포함 161/161 통과, 최종 SQL 상세/전이 정의의 권한·락·중복 방지 유지 확인. 독립 리뷰는 배포 승인이 아니다.
- 운영 UI 읽기 QA는 기존 로그인 세션이 확인된 뒤 별도 임시 탭에서 진행하며, 해당 결과와 실제 변경 후 배포 검증은 별도 증거로 구분한다.
